// IV Studio MCP server (stdio). Same service, data folder and job records as the studio window, so an agent
// and a person see the same projects and results. Run with the app's own binary:
//   ELECTRON_RUN_AS_NODE=1 "IV Studio.exe" <resources>/app.asar/out/main/mcp.js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { INSTRUCTIONS, readGuide } from '../service/agent'
import { GUIDE_SOURCE, loadGuide } from '../service/h3guide'
import { blocking, lintPrompt } from '../service/lint'
import { Ranker } from '../service/ranking'
import { Reviewer } from '../service/review'
import { Previs } from '../service/previs'
import { setOllamaSource, unloadOllama } from '../service/prompter'
import { CAMERA_MOVES, lineCheck } from '../service/staging'
import { DIRECTING, DIRECTING_SOURCE } from '../service/directing'
import { menuMessage, START_MENU } from '../service/startmenu'
import { Edits, editLength, FORMATS, LOUDNESS } from '../service/edits'
import { EditGen, GEN_KINDS } from '../service/editgen'
import { Productions } from '../service/productions'
import { Reels } from '../service/reel'
import { Cutouts } from '../service/cutout'
import { Reframes } from '../service/reframe'
import { MediaTools } from '../service/media'
import { comfyFolders, contentDir, dataDir, readSettings, resourcesDir, writerOf, writeSettings } from '../service/paths'
import { ASPECTS, FRAME_GEN_FPS, MODES } from '../service/plan'
import { RETAKE_MODES, SHOT_SECONDS } from '../service/sequence'
import { Studio } from '../service/studio'
import { launcherFor } from '../service/comfylauncher'
import { applyOps, clipEnd, TRACK_ID, tracksOf, videoLayers } from '../service/timeline'
import { TALKS, TRAIN_GPUS, Trainings } from '../service/training'
import { Shinobi } from '../service/shinobi'
import { CharacterCatalog } from '../service/characters'
import { Replace, RESOLUTIONS } from '../service/replace'
import { Remake, REMAKE_KINDS } from '../service/remake'
import { VOICE_ENGINES, Voices } from '../service/voices'
import { ACE_KEYS, Music, MUSIC_DEFAULTS, MUSIC_ENGINES } from '../service/music'
import { IMAGE_ASPECTS, IMAGE_FAMILIES, Images } from '../service/images'
import { Civitai, LORA_SORTS, LORA_TAGS } from '../service/civitai'
import { Comfy } from '../service/comfy'
import { SCENE_KINDS, SIZZLE_FORMATS, Sizzles } from '../service/sizzle'

// Settings in BASE; what's made in DATA (BASE\incognito while the app is in Incognito; see contentDir).
const BASE = dataDir()
const INCOGNITO = !!readSettings(BASE).incognito
const DATA = contentDir(BASE)
// the writer's Ollama: the address in Settings → Prompt writer, else OLLAMA_HOST, else this PC (prompter.js)
setOllamaSource(() => readSettings(BASE).ollamaUrl)
const studio = new Studio({ dataDir: DATA, resourcesDir: resourcesDir(), comfyUrl: readSettings(BASE).comfyUrl, models: readSettings(BASE).models })
const server = new McpServer({ name: 'iv-studio', version: '0.1.0' }, { instructions: INSTRUCTIONS })
// Where the app puts downloads and exports (Electron's videos folder; this process has no Electron app).
const VIDEOS = INCOGNITO ? path.join(DATA, 'videos') : path.join(process.env.USERPROFILE || os.homedir(), 'Videos', 'IV Studio')
// Packaged, the ffmpeg binaries sit outside the asar archive.
const unpacked = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)

// MCP structured results must be objects, so lists go out as { items }.
const ok = (value) => {
  if (value?.image) return { content: [{ type: 'image', data: value.image, mimeType: 'image/png' }, { type: 'text', text: value.caption }] }
  const structured = value && typeof value === 'object' && !Array.isArray(value) ? value : { items: value }
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: structured }
}
const fail = (err) => ({ isError: true, content: [{ type: 'text', text: err.message }] })
const tool = (name, description, shape, fn) =>
  server.registerTool(name, { description, inputSchema: shape }, async (args) => {
    try {
      // the app switched Incognito on or off after this server started: its data is somewhere else now
      const s = readSettings(BASE)
      // the folders the person picked in Settings, as they are now
      studio.comfy.folders = comfyFolders(s, INCOGNITO)
      if (!!s.incognito !== INCOGNITO) throw new Error(`IV Studio switched Incognito ${INCOGNITO ? 'off' : 'on'} since this MCP server started. Restart the server (reconnect the iv-studio MCP) to work in the ${INCOGNITO ? 'normal' : 'Incognito'} data.`)
      return ok(await fn(args))
    } catch (err) {
      return fail(err)
    }
  })

const media = z
  .array(z.object({ kind: z.enum(['picture', 'video', 'audio']), file: z.string().describe('Absolute local path (uploaded to ComfyUI) or a name already in ComfyUI input') }))
  .optional()
  .describe('frames mode: 1-2 pictures (first, last). reference mode: pictures, videos, audio, named <Picture 1>, <Video 1>, <Audio 1> in the prompt. continue mode: 1 video.')
const request = {
  mode: z.enum(Object.keys(MODES)).default('text').describe('text, frames (first/last frame), reference (ref2va), continue (extend a video)'),
  prompt: z.string().describe('H3 prompt. Write {char} where the character trigger word goes, e.g. "{char} (S1) says: <d>[English] Hi.</d>"'),
  character: z.string().default('tess').describe('Character preset id from list_characters, or "none"'),
  aspect: z.enum(Object.keys(ASPECTS)).default('16:9'),
  megapixels: z.number().min(0.1).max(2.5).default(0.4).describe('Preview size. 0.4 is the tested default.'),
  seconds: z.number().min(1).max(15).default(5),
  previews: z.number().int().min(1).max(3).default(3),
  seed: z.number().int().min(0).default(4242).describe('Previews use seed, seed+1000, seed+2000'),
  steps: z.number().int().min(4).max(20).default(8),
  media,
  overlapFrames: z.number().int().optional().describe('continue mode: 5, 22, 39 or 56'),
  voiceLine: z.string().optional().describe('Absolute path to a voice recording; the previews lip-sync to it'),
  refmods: z.array(z.object({ name: z.string(), strength: z.number().min(0).max(1).optional(), copies: z.number().int().min(1).max(10).optional() })).optional(),
  retention: z.number().min(0).max(1).optional(),
  extraLoras: z.array(z.object({ name: z.string(), strength: z.number().optional() })).optional()
}
const finish = {
  candidate: z.number().int().min(1).max(3).default(1),
  megapixels: z.number().min(0.5).max(4).default(2),
  upscale2x: z.boolean().default(false).describe('RTX 2x after DLSS (2 MP -> about 4K)'),
  fps: z.number().int().default(0).describe(`Frame generation: ${FRAME_GEN_FPS.join(', ')} (0 = off)`),
  audio: z.enum(['pass', 'preview', 'voice']).default('pass').describe('Final sound: the 2 MP pass, the picked preview (keeps a cloned voice), or the voice line itself'),
  rerollSeed: z.number().int().optional(),
  enhancer: z.enum(['dlss', 'seedvr2']).default('dlss').describe('dlss: DLSS 5 in the finish (noise reduction, upscale2x, fps). seedvr2: the finish skips DLSS and SeedVR2 then restores detail to enhanceResolution (24 fps); follow the enhanceJob of the finish job with get_job'),
  enhanceResolution: z.union([z.literal(1080), z.literal(1440), z.literal(2160)]).default(1080).describe('seedvr2: the short side')
}

// The full how-to, as plain markdown (resources/agent-guide.md, also the Claude Code skill), or MiniMax's own H3
// prompt guide, which is downloaded from MiniMax rather than shipped (h3guide.js).
server.registerTool(
  'get_guide',
  {
    description: 'How to use IV Studio: rendering shots, writing H3 prompts, sequences, timeline edits, models, characters, and the house rules. Read it once before your first render or edit. topic "h3-prompts" returns MiniMax\'s own H3 prompt-writing guide (every mode, camera moves, speakers, sound): read it before writing an H3 prompt yourself. topic "directing" returns the directing method (reference map, staging and eyelines, action timeline, reviewing a take): follow it when you direct a scene.',
    inputSchema: { topic: z.enum(['iv-studio', 'h3-prompts', 'directing']).optional().describe('iv-studio (default), h3-prompts or directing') }
  },
  async ({ topic = 'iv-studio' }) => {
    if (topic === 'directing') return { content: [{ type: 'text', text: `${DIRECTING_SOURCE}. In IV Studio, the shot brief is a prompt plus its references; review_take does the review step on a rendered take.\n\n${DIRECTING}` }] }
    if (topic !== 'h3-prompts') return { content: [{ type: 'text', text: readGuide(resourcesDir()) }] }
    const guide = await loadGuide()
    if (!guide) throw new Error("MiniMax's H3 prompt guide couldn't be downloaded from GitHub. Check the internet connection and try again.")
    return { content: [{ type: 'text', text: `${GUIDE_SOURCE}. IV Studio's own notes (get_guide) still apply: {char} for the character, no face or voice for a LoRA character.\n\n${guide.base}\n\n${guide.ref}` }] }
  }
)
// The start menu: offered when a chat opens without a request (get_menu), and each entry as an MCP prompt, which
// clients like Claude Code list as slash commands.
server.registerTool('get_menu', { description: 'The start menu: what the person can make with IV Studio. Offer it as one multiple-choice question when a chat starts and they have not said what they want; each choice comes with what to do.', inputSchema: {} }, () => ({
  content: [{ type: 'text', text: JSON.stringify({ ask: 'What would you like to make?', choices: START_MENU.map(({ id, title, blurb, brief }) => ({ id, title, blurb, then: brief })), slashCommands: 'Also listed as prompts (slash commands) in apps that show MCP prompts.' }, null, 2) }]
}))
for (const entry of START_MENU)
  server.registerPrompt(entry.id, { title: entry.title, description: entry.blurb, argsSchema: Object.fromEntries(Object.entries(entry.args).map(([k, d]) => [k, z.string().optional().describe(d)])) }, (args) => ({
    messages: [{ role: 'user', content: { type: 'text', text: menuMessage(entry, args) } }]
  }))
server.registerPrompt('start', { title: 'Start here', description: 'Choose what to make with IV Studio from a short menu.' }, () => ({
  messages: [{ role: 'user', content: { type: 'text', text: `I'd like to make something with IV Studio. Show me the start menu (get_menu) as one multiple-choice question, then help me with what I pick.` } }]
}))
tool('check_setup', 'Report ComfyUI, GPU, node packs, models and characters, with fixes for anything missing.', {}, () => studio.checkSetup())
tool('install_node_packs', "Install the ComfyUI node packs check_setup reports missing into this PC's ComfyUI: IV Studio's own pack is copied, the others downloaded at the versions IV Studio is tested with (GitHub commit or Comfy Registry release) and given their requirements with ComfyUI's Python. Folders already in custom_nodes are left alone. ComfyUI must be running; restart it afterwards to load them.", {}, () => studio.installNodePacks({ folder: readSettings(BASE).comfyFolder || null }))
tool('check_comfy_updates', "What updating this PC's ComfyUI would change, through ComfyUI-Manager: ComfyUI's version against its newest stable release, the installed custom node packs that have updates (Manager included), Manager's version and update policy, and the last update (for undo_comfy_update). Changes nothing, but Manager fetches every pack's remote first, so it takes a minute or two. manager.present false: ComfyUI-Manager isn't installed.", {}, () => studio.comfyUpdates({ launcher: launcherFor(readSettings(BASE)) }))
tool('update_comfy', "Update this PC's ComfyUI through ComfyUI-Manager: saves a Manager snapshot, updates every custom node pack (ComfyUI-Manager included) to its newest version and ComfyUI to its newest stable release (or nightly, if Manager is set to that; the ComfyUI Desktop app updates ComfyUI itself), then restarts ComfyUI and waits for it. Refuses while ComfyUI is rendering or has jobs queued. Takes several minutes. Returns the snapshot, ComfyUI's version before and after and each pack's result; undo_comfy_update puts it all back. It changes the person's ComfyUI install: run it only when they ask.", {}, () => {
  const s = readSettings(BASE)
  return studio.updateComfy({ folder: s.comfyFolder || null, launcher: launcherFor(s) })
})
tool('undo_comfy_update', "Undo the last update_comfy (or the Setup screen's Update everything): restores the snapshot it saved and restarts ComfyUI. Afterwards it switches back on any pack ComfyUI-Manager's restore switched off (plain folders a snapshot can't track, IV Studio's own pack among them) and restarts again; reenabled lists them. If ComfyUI isn't running, the snapshot is set to restore at its next start (startNeeded: true): start ComfyUI, then call this again to finish.", {}, () => studio.undoComfyUpdate({ folder: readSettings(BASE).comfyFolder || null }))
tool('list_characters', 'Character presets (LoRA, strength, trigger word).', {}, () => studio.characters())
tool('list_projects', 'Projects in the IV Studio library, newest first.', {}, () => studio.listProjects())
tool('plan_render', 'Validate a request and resolve size, frames, duration, seeds and the finished size, without rendering.', { ...request, finish: z.object(finish).partial().optional() }, ({ finish: f, ...r }) => studio.planRender(r, f || {}))
// The prompt checker (src/service/lint.js) for a request: its context is the request's own mode, length and media.
const checkRequest = (r) => {
  const ch = r.character && r.character !== 'none' ? studio.characters().find((c) => c.id === r.character) : null
  return lintPrompt(r.prompt || '', { mode: r.mode, seconds: r.seconds, media: r.media || [], character: ch ? { name: ch.name, trigger: ch.trigger } : null, voiceLine: r.voiceLine })
}
tool('list_cast', 'Who and what a prompt can mention with @: character presets (@Tess: the picked character becomes {char}; anyone else with a face picture is attached as a reference) and places (@BusStop: attached as the place). A shot that mentions a member with a picture renders in References mode with the pictures attached, as <Subject N>.', {}, () => ({ items: studio.cast.members().map(({ handle, kind, name, picture, description, film }) => ({ mention: `@${handle}`, kind, name, hasPicture: !!picture, description, film })) }))
tool('save_place', 'Save a place to mention as @Name in any prompt: a name, a picture (an image file path) and a short description of the room or setting.', { name: z.string(), picture: z.string().describe('An image file path'), description: z.string().default(''), id: z.string().optional().describe('To change a saved place') }, (args) => studio.cast.savePlace(args))
tool('enhance_final', "Enhance a finished shot: engine seedvr2 (SeedVR2 3B restores detail and upscales to a short side of resolution, sound kept) or dlss (DLSS 5 with the finish's own noise reduction, at scale 1 or 2). A new job in the same shot; follow with get_job. On this PC's ComfyUI only. jobId is the finish job.", { jobId: z.string(), engine: z.enum(['seedvr2', 'dlss']).default('seedvr2'), resolution: z.union([z.literal(1080), z.literal(1440), z.literal(2160)]).default(1080).describe('seedvr2: the short side'), scale: z.union([z.literal(1), z.literal(2)]).default(1).describe('dlss: 1 cleans up at the same size, 2 doubles it') }, async (args) => (readSettings(BASE).target === 'cloud' || (await voices.release()), studio.enhanceFinal(args)))
tool('check_prompt', "Check an H3 prompt before rendering: the prompt checker lists what H3 is likely to misread (wrong opening line for frames, cut times past the end, more lines than fit the time, quotes or names inside <d>, missing speaker IDs, references attached but never named, describing a LoRA character's face, filler words, too many camera moves). Each finding has a level (error blocks generate_previews unless force), a message and sometimes fix: the whole prompt mended.", { ...request }, (args) => ({ findings: checkRequest(args) }))
tool('generate_previews', 'Start preview candidates. Returns a job at once; follow with get_job. The prompt checker runs first: errors stop it (fix them, or pass force: true when you mean it).', { ...request, projectId: z.string().optional(), projectName: z.string().optional(), force: z.boolean().default(false) }, async ({ force, ...args }) => {
  const errors = blocking(checkRequest(args))
  if (errors.length && !force) throw new Error(`The prompt checker found ${errors.length} error${errors.length > 1 ? 's' : ''}: ${errors.map((f) => f.message).join(' | ')} Fix the prompt (check_prompt gives fixes), or pass force: true.`)
  if (readSettings(BASE).target !== 'cloud') await voices.release()
  return studio.generatePreviews(args)
})
tool('finish_candidate', "Finish one preview candidate (2 MP pass, then DLSS 5 with optional RTX 2x and frame generation, or SeedVR2 with enhancer seedvr2) from its recorded settings. Reuses the candidate's saved latent.", { jobId: z.string().describe('The previews job id'), ...finish }, (args) => studio.finishCandidate(args))
const sequenceFields = {
  name: z.string().optional(),
  method: z.enum(['take', 'shots']).optional().describe('take: every shot in one seamless render. shots: hunt and finish shot by shot, each continuing from the last.'),
  character: z.string().optional().describe('Character preset id, or "none"'),
  aspect: z.enum(Object.keys(ASPECTS)).optional(),
  megapixels: z.number().min(0.3).max(1.5).optional().describe('Render size of the sequence. 0.9 (1280x736 at 16:9) is the tested default.'),
  shotSeconds: z.number().refine((v) => SHOT_SECONDS.includes(v)).optional().describe(`Length of every shot: ${SHOT_SECONDS.join(' or ')} seconds`),
  steps: z.number().int().min(4).max(20).optional(),
  seed: z.number().int().min(0).optional(),
  voiceRef: z.string().nullable().optional().describe('take: absolute path to a voice sample the whole take keeps'),
  shots: z
    .array(z.object({ id: z.string().optional(), prompt: z.string(), mode: z.enum(['text', 'reference', 'frames']).optional(), media: media }))
    .optional()
    .describe("One prompt per shot. Each later shot should open holding the previous shot's closing arrangement and stay quiet ~2 s before anyone speaks; end settled with ~2 s to spare. {char} = trigger word.")
}
tool('list_sequences', 'Sequences (several shots that play as one continuous video), newest first.', {}, () => studio.listSequences())
tool('get_sequence', 'A sequence with its shots, versions (takes, shot-by-shot result, retakes) and render-outs.', { sequenceId: z.string() }, ({ sequenceId }) => studio.refreshSequence(sequenceId))
tool('save_sequence', 'Create a sequence (no sequenceId) or update its settings and shots.', { sequenceId: z.string().optional(), ...sequenceFields }, ({ sequenceId, ...patch }) =>
  sequenceId ? studio.saveSequence(sequenceId, patch) : studio.saveSequence(studio.createSequence().id, patch)
)
tool('render_take', 'Render every shot of a sequence as one seamless take (H3 Multishot). Adds a version; follow with get_job.', { sequenceId: z.string() }, ({ sequenceId }) => studio.renderTake(sequenceId))
tool('hunt_shot', 'Shot by shot: start previews for one shot (index from 0). Shot 1 gets 3 candidates; later shots continue from the previous finished shot.', { sequenceId: z.string(), index: z.number().int().min(0), seed: z.number().int().optional() }, ({ sequenceId, index, seed }) => studio.huntShot(sequenceId, index, { seed }))
tool('finish_shot', 'Shot by shot: finish the picked candidate of one shot at the sequence size.', { sequenceId: z.string(), index: z.number().int().min(0), candidate: z.number().int().min(1).max(3).default(1) }, ({ sequenceId, index, candidate }) => studio.finishShot(sequenceId, index, { candidate }))
tool('retake', 'Redo start..end seconds of a finished version and keep the rest. Adds a new version.', {
  sequenceId: z.string(),
  versionId: z.string().describe('From get_sequence versions, e.g. v1 or shots'),
  prompt: z.string().describe('What happens in that stretch, written like a shot prompt'),
  start: z.number().min(0),
  end: z.number().min(0.1),
  mode: z.enum(Object.keys(RETAKE_MODES)).default('both').describe('both: picture and sound. video: keep the performance (audio). audio: keep the picture.'),
  seed: z.number().int().optional()
}, ({ sequenceId, ...opts }) => studio.retakeSequence(sequenceId, opts))
tool('render_out', 'Finish a version: optional colour smoothing across the joins, then DLSS (scale 1 or 2, frame generation).', {
  sequenceId: z.string(),
  versionId: z.string(),
  normalize: z.boolean().default(false).describe('Smooth colour shifts at the joins (most useful for shot by shot)'),
  scale: z.number().int().min(1).max(2).default(1),
  fps: z.number().int().default(0).describe(`Frame generation: ${FRAME_GEN_FPS.join(', ')} (0 = off)`)
}, ({ sequenceId, ...opts }) => studio.renderOutSequence(sequenceId, opts))
tool('write_prompt', "Write a MiniMax H3 prompt from a plain-words idea, using the same writer as the app. engine (default: the choice in Settings → Prompt writer) local = free model in Ollama; claude / codex = the Claude Code or Codex installed on this PC, on its own login; contextir = MiniMax Context IR, paid per call, needs COMFY_ORG_API_KEY in the environment of this server. local, claude and codex follow MiniMax's H3 prompt guide; Context IR is MiniMax's own rewriter.", {
  idea: z.string(),
  mode: z.enum(Object.keys(MODES)).default('text'),
  seconds: z.number().min(1).max(15).default(5),
  aspect: z.enum(Object.keys(ASPECTS)).default('16:9'),
  character: z.string().default('tess').describe('Character preset id or "none"; the result uses {char} for it'),
  media,
  sequence: z.boolean().default(false).describe('Write it as one shot of a continuous sequence (join rules)'),
  previous: z.string().optional().describe('sequence: the prompt of the previous shot'),
  engine: z.enum(['local', 'claude', 'codex', 'contextir']).optional().describe('Defaults to the choice in Settings → Prompt writer')
}, ({ engine, ...request }) => {
  const s = readSettings(BASE)
  const chosen = engine || (s.promptEngine === 'contextir' && !process.env.COMFY_ORG_API_KEY ? 'local' : s.promptEngine || 'local')
  const w = writerOf({ ...s, promptEngine: chosen })
  return studio.writePrompt(request, { engine: w.engine, apiKey: process.env.COMFY_ORG_API_KEY || null, model: w.model }).then((prompt) => ({ prompt, engine: w.engine }))
})
tool('write_shots_from_story', 'Split a short story into sequence shots and write each one so they join as one continuous take (the writer chosen in Settings: local, Claude Code or Codex).', {
  story: z.string(),
  shots: z.number().int().min(1).max(8).default(3),
  seconds: z.number().refine((v) => SHOT_SECONDS.includes(v)).default(10),
  character: z.string().default('tess')
}, (args) => {
  const w = writerOf(readSettings(BASE))
  return studio.writeStory(args, w.engine === 'claude' || w.engine === 'codex' ? w : { model: readSettings(BASE).ollamaModel }).then((shots) => ({ shots }))
})
tool('get_job', 'Status, progress and outputs of a job.', { jobId: z.string() }, ({ jobId }) => studio.refreshJob(jobId))
tool('cancel_job', 'Cancel an IV Studio job (removes it from the queue or interrupts it if running); never touches other work.', { jobId: z.string() }, ({ jobId }) => studio.cancelJob(jobId))
tool('get_outputs', 'Playable outputs (paths and URLs) with the settings that made them, for a job or a whole project.', { jobId: z.string().optional(), projectId: z.string().optional() }, async ({ jobId, projectId }) => {
  if (jobId) {
    const j = await studio.refreshJob(jobId)
    return { job: j.id, status: j.status, resolved: j.plan.resolved, outputs: j.outputs }
  }
  if (projectId) return studio.listJobs(projectId).map((j) => ({ job: j.id, kind: j.kind, status: j.status, resolved: j.plan.resolved, outputs: j.outputs }))
  throw new Error('Give jobId or projectId.')
})

// ---------- projects and sequences ----------
tool('rename_project', 'Rename a project in the library.', { projectId: z.string(), name: z.string().min(1) }, ({ projectId, name }) => studio.renameProject(projectId, name))
tool('delete_project', "Delete a shot (project) and its run history. Its videos stay in ComfyUI's output folder. Ask the person first.", { projectId: z.string() }, ({ projectId }) => studio.deleteProject(projectId))
tool('delete_sequence', 'Delete a sequence and its record of versions. Rendered video files stay on disk. Ask the person first.', { sequenceId: z.string() }, ({ sequenceId }) => studio.deleteSequence(sequenceId))

// ---------- renders library ----------
tool('list_renders', 'Every IV Studio render (shot finals and previews, sequence versions and finals), newest first. Pass a key to add_media to put one on a timeline.', { limit: z.number().int().min(1).max(500).default(50) }, ({ limit }) =>
  studio.library().slice(0, limit).map(({ key, label, group, at, file }) => ({ key, label, group, at, path: file.path || null, url: file.url || null }))
)

// ---------- edits (the timeline editor) ----------
const edits = new Edits({
  dataDir: DATA,
  ffmpeg: unpacked(ffmpegStatic.ffmpegPath),
  ffprobe: unpacked(ffmpegStatic.ffprobePath),
  fontFile: path.join(resourcesDir(), 'fonts', 'BarlowCondensed-SemiBold.ttf')
})
const mediaTools = new MediaTools({ dataDir: DATA, ffmpeg: edits.ffmpeg, ffprobe: edits.ffprobe })
tool('prepare_media', 'Crop a picture, or trim (and optionally crop) a video or a sound, before using it as a reference, frame, source video or voice line; fitH3 also resizes it to fit H3 as an input. The original stays as it is; returns the new file. For first/last frames, crop to the shot aspect: frames are stretched to the shot size. H3 video lengths are 17n+5 frames at 24 fps (73 = 3.04 s, 124 = 5.17 s).', {
  file: z.string().describe('Absolute path on this PC'),
  crop: z.object({ x: z.number().min(0), y: z.number().min(0), w: z.number().min(16), h: z.number().min(16) }).optional().describe('In source pixels'),
  start: z.number().min(0).optional().describe('Seconds'),
  end: z.number().optional().describe('Seconds'),
  fitH3: z.number().min(0.2).max(4).optional().describe("Megapixels (0.5, 1 or 2 are usual): resizes, after any crop, to about that size with both sides on H3's 32-pixel grid, keeping the shape; videos also become 24 fps. Use it when a source video or frame is an odd size (e.g. 1290x720).")
}, (args) => mediaTools.prepare(args))
const exporting = new Map() // edit id -> { state, progress, file, error, startedAt }

// An edit as an agent reads it: media by id, each track's clips in time order with the media name, the
// tracks' states (top to bottom, as the timeline shows them) and the markers.
function describe(e) {
  const list = tracksOf(e)
  const tracks = Object.fromEntries(
    list.map((t) => [
      t.id,
      e.clips
        .filter((c) => c.track === t.id)
        .sort((a, b) => a.start - b.start)
        .map((c) => ({ clip: c.id, ...(c.text ? { title: c.text } : { media: c.media, name: e.media[c.media]?.name }), start: c.start, end: +clipEnd(c).toFixed(3), in: c.in, out: c.out, fadeIn: c.fadeIn, fadeOut: c.fadeOut, ...(c.text ? {} : { volume: c.volume ?? 1, muted: !!c.muted }) }))
    ])
  )
  return { id: e.id, name: e.name, settings: e.settings, seconds: +editLength(e).toFixed(3), media: Object.values(e.media).map(({ id, name, kind, duration, width, height, hasAudio, path: p }) => ({ id, name, kind, duration, width, height, hasAudio, path: p })), tracks, trackList: list.map(({ id, kind, label, hidden, locked, muted, solo }) => ({ id, kind, label, hidden: !!hidden, locked: !!locked, muted: !!muted, solo: !!solo })), markers: e.markers || [], exports: e.exports || [] }
}

const LIVE = 'If the edit is open in the IV Studio window, it reloads there and the person can undo your change with Ctrl+Z.'
const LIVE_FILM = 'The person sees it on the Projects page.'
tool('list_edits', 'Edits (timelines in the Edit page), newest first.', {}, () => edits.list())
tool('get_edit', 'An edit: its media (with ids), each track\'s clips in order (clip ids, start/end on the timeline, in/out in the media, fades, volume), settings, markers and past exports. Tracks: a higher V track is drawn over a lower one (V2 over V1); T1 holds titles; A tracks are sound; add_track adds more. trackList gives each track\'s state: hidden tracks are left out of the picture, muted ones out of the sound (and when any track is soloed, only soloed tracks are heard), and locked tracks can\'t be changed. Video clips play their own sound too unless muted.', { editId: z.string() }, ({ editId }) => describe(edits.get(editId)))
tool('create_edit', 'Create an empty edit.', { name: z.string().default('Untitled edit'), format: z.enum(Object.keys(FORMATS)).default('1080p'), fps: z.number().int().min(12).max(60).default(24) }, ({ name, format, fps }) => {
  const e = edits.create(name)
  return describe(edits.save(e.id, { settings: { format, fps } }))
})
tool('set_edit_settings', `Rename an edit or change its export format (${Object.entries(FORMATS).map(([k, f]) => `${k} = ${f.label}`).join(', ')}), frame rate or loudness: web (the default) brings the sound to about -14 LUFS for phones and the web, tv to -23 LUFS, off leaves it as mixed. A film whose loud parts already touch the ceiling stops a little short rather than being crushed; each export records its loudness before and after. ${LIVE}`, {
  editId: z.string(),
  name: z.string().min(1).optional(),
  format: z.enum(Object.keys(FORMATS)).optional(),
  fps: z.number().int().min(12).max(60).optional(),
  loudness: z.enum(Object.keys(LOUDNESS)).optional()
}, ({ editId, name, format, fps, loudness }) => {
  const e = edits.get(editId)
  return describe(edits.save(editId, { name, settings: { ...e.settings, ...(format && { format }), ...(fps && { fps }), ...(loudness && { loudness }) } }))
})
tool('delete_edit', 'Delete an edit (the timeline only: its media files and exported videos stay). Ask the person first.', { editId: z.string() }, ({ editId }) => edits.remove(editId))
tool('add_media', `Add files to an edit's media bin: local video, picture or audio paths, and/or IV Studio renders by key (list_renders; cloud renders download to Videos\\IV Studio). Returns the new media ids. With append, each also goes on the end of V1 (video, pictures) or A1 (sound), in the order given. ${LIVE}`, {
  editId: z.string(),
  files: z.array(z.string()).optional().describe('Absolute paths on this PC'),
  renders: z.array(z.string()).optional().describe('Keys from list_renders'),
  append: z.boolean().default(false)
}, async ({ editId, files = [], renders = [], append }) => {
  const e = edits.get(editId)
  const lib = renders.length ? studio.library() : []
  const added = []
  for (const f of files) added.push(await edits.addMedia(f))
  for (const key of renders) {
    const item = lib.find((i) => i.key === key)
    if (!item) throw new Error(`No render ${key}. list_renders gives the keys.`)
    added.push(await edits.addMedia(await studio.localCopy(item.file, VIDEOS), { type: 'iv', label: item.label }))
  }
  if (!added.length) throw new Error('Give files or renders.')
  const media = { ...e.media, ...Object.fromEntries(added.map((m) => [m.id, m])) }
  const { clips, results } = append ? applyOps({ ...e, media }, added.map((m) => ({ op: 'add_clip', media: m.id }))) : { clips: e.clips, results: [] }
  edits.save(editId, { media, clips })
  return { media: added.map(({ id, name, kind, duration, width, height, hasAudio }) => ({ id, name, kind, duration, width, height, hasAudio })), placed: results }
})

const trackId = z.string().regex(TRACK_ID, 'Tracks are T1, V1, V2, ... or A1, A2, ...')
const op = {
  add_clip: z.object({ op: z.literal('add_clip'), media: z.string().describe('Media id'), track: trackId.optional().describe('Default V1, or A1 for sound'), start: z.number().min(0).optional().describe('Timeline seconds; default = the end of that track'), in: z.number().min(0).optional().describe('Where in the media to start (default 0)'), out: z.number().optional().describe('Where in the media to stop (default its end; pictures 4 s)'), duration: z.number().optional().describe('Instead of out: how long the clip plays'), fadeIn: z.number().min(0).optional(), fadeOut: z.number().min(0).optional(), volume: z.number().min(0).max(4).optional(), muted: z.boolean().optional() }),
  add_title: z.object({ op: z.literal('add_title'), content: z.string(), start: z.number().min(0).default(0), duration: z.number().min(0.1).default(3), size: z.number().min(2).max(30).optional().describe('Text height as % of the frame (default 8)'), position: z.enum(['top', 'center', 'bottom']).optional(), color: z.string().optional().describe('#rrggbb'), box: z.boolean().optional().describe('Dark box behind the text'), fadeIn: z.number().min(0).optional(), fadeOut: z.number().min(0).optional() }),
  insert_clip: z.object({ op: z.literal('insert_clip'), media: z.string().describe('Media id'), track: trackId.optional().describe('Default V1, or A1 for sound'), at: z.number().min(0).describe('Timeline seconds. Everything on that track from here on moves right to make room; a clip it lands in is cut in two'), in: z.number().min(0).optional().describe('Media in point (default 0)'), out: z.number().optional().describe('Media out point (default its end; pictures 4 s)'), duration: z.number().optional(), volume: z.number().min(0).max(4).optional() }),
  overwrite_clip: z.object({ op: z.literal('overwrite_clip'), media: z.string().describe('Media id'), track: trackId.optional().describe('Default V1, or A1 for sound'), at: z.number().min(0).describe('Timeline seconds. Replaces whatever is on that track for the clip\'s length; nothing moves'), in: z.number().min(0).optional(), out: z.number().optional(), duration: z.number().optional(), volume: z.number().min(0).max(4).optional() }),
  add_track: z.object({ op: z.literal('add_track'), kind: z.enum(['video', 'audio']), label: z.string().optional().describe('Default its id, e.g. V3') }),
  update_track: z.object({ op: z.literal('update_track'), track: trackId, label: z.string().optional(), hidden: z.boolean().optional().describe('Video and titles: leave it out of the picture'), muted: z.boolean().optional().describe('Leave its sound out'), solo: z.boolean().optional().describe('Hear only soloed tracks'), locked: z.boolean().optional().describe('Usually the person\'s call: a locked track refuses changes') }),
  remove_track: z.object({ op: z.literal('remove_track'), track: trackId.describe('An empty track (not V1, A1 or T1)') }),
  add_marker: z.object({ op: z.literal('add_marker'), at: z.number().min(0).describe('Timeline seconds'), label: z.string().optional(), color: z.string().optional().describe('#rrggbb') }),
  update_marker: z.object({ op: z.literal('update_marker'), marker: z.string(), at: z.number().min(0).optional(), label: z.string().optional(), color: z.string().optional() }),
  remove_marker: z.object({ op: z.literal('remove_marker'), marker: z.string() }),
  update_clip: z.object({ op: z.literal('update_clip'), clip: z.string(), track: trackId.optional(), start: z.number().min(0).optional().describe('Move it on the timeline'), in: z.number().min(0).optional().describe('Trim the head (media seconds)'), out: z.number().optional().describe('Trim the tail (media seconds)'), duration: z.number().optional(), fadeIn: z.number().min(0).optional(), fadeOut: z.number().min(0).optional(), volume: z.number().min(0).max(4).optional(), muted: z.boolean().optional(), content: z.string().optional().describe('Titles only, as are size, position, color, box'), size: z.number().optional(), position: z.enum(['top', 'center', 'bottom']).optional(), color: z.string().optional(), box: z.boolean().optional() }),
  split_clip: z.object({ op: z.literal('split_clip'), clip: z.string(), at: z.number().describe('Timeline seconds, inside the clip') }),
  remove_clip: z.object({ op: z.literal('remove_clip'), clip: z.string(), ripple: z.boolean().default(false).describe('Close the gap: later clips on the same track move left') }),
  remove_media: z.object({ op: z.literal('remove_media'), media: z.string().describe('Takes it out of the bin with all its clips (the file stays)') }),
  clear: z.object({ op: z.literal('clear'), track: trackId.optional().describe('One track, or every clip on unlocked tracks when left out') })
}
tool('edit_timeline', `Change an edit's timeline with a list of operations, applied in order: add_clip, insert_clip and overwrite_clip (Premiere's insert and overwrite edits), add_title, update_clip (move, trim, change track, fades, volume, mute, title text), split_clip, remove_clip (optionally ripple), remove_media, clear, add_track / update_track (label, hide, mute, solo, lock) / remove_track, and add_marker / update_marker / remove_marker. Locked tracks refuse changes. All are checked first; if one fails, nothing changes. Returns what each did and the edit afterwards. ${LIVE}`, {
  editId: z.string(),
  ops: z.array(z.discriminatedUnion('op', Object.values(op))).min(1)
}, ({ editId, ops }) => {
  const e = edits.get(editId)
  const { clips, media, tracks, markers, results } = applyOps(e, ops)
  return { results, edit: describe(edits.save(editId, { clips, media, tracks, markers })) }
})

tool('grab_frame', 'A picture of one moment, to check an edit or a render by eye: either an edit at a timeline time (the top visible video clip, without titles) or any video file at a time.', {
  editId: z.string().optional(),
  file: z.string().optional().describe('Instead of editId: an absolute video path'),
  at: z.number().min(0).describe('Seconds'),
  width: z.number().int().min(160).max(1920).default(640)
}, async ({ editId, file, at, width }) => {
  let src = file
  let t = at
  if (editId) {
    const e = edits.get(editId)
    const layers = videoLayers(tracksOf(e)).filter((t) => !t.hidden).reverse()
    const c = layers.flatMap((tr) => e.clips.filter((x) => x.track === tr.id && at >= x.start && at < clipEnd(x)))[0]
    if (!c) throw new Error(`Nothing on a visible video track at ${at} s.`)
    src = e.media[c.media].path
    t = e.media[c.media].kind === 'image' ? 0 : c.in + (at - c.start)
  }
  if (!src || !fs.existsSync(src)) throw new Error('Give editId or an existing file.')
  const png = await new Promise((resolve, reject) => {
    const p = spawn(edits.ffmpeg, ['-v', 'error', '-ss', t.toFixed(3), '-i', src, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'], { windowsHide: true })
    const out = []
    p.stdout.on('data', (d) => out.push(d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 && out.length ? resolve(Buffer.concat(out)) : reject(new Error(`No frame at ${t.toFixed(2)} s in ${path.basename(src)}.`))))
  })
  return { image: png.toString('base64'), caption: `${path.basename(src)} at ${t.toFixed(2)} s` }
})

// ---------- Projects: a short film from script to rough cut (the app's Projects page; "films" here, because
// list_projects already means shots) ----------
const films = new Productions({ dataDir: DATA, studio: () => studio, voices: () => voices, images: () => images, previs: () => previs, catalog: () => catalog, edits, localCopy: (f) => studio.localCopy(f, VIDEOS), model: () => readSettings(BASE).ollamaModel || undefined, writer: () => writerOf(readSettings(BASE)) })
const stageSchema = z
  .object({
    people: z.array(z.object({ name: z.string(), x: z.number(), y: z.number(), facing: z.number().describe('degrees on the floor: 0 into the room (away from a camera at the front), 90 to the room\'s right, 180 toward the front'), to: z.object({ x: z.number(), y: z.number() }).nullable().optional().describe('where they walk to'), lookAt: z.string().nullable().optional() })).max(4),
    camera: z.object({ x: z.number(), y: z.number(), facing: z.number(), lens: z.enum(['wide', 'normal', 'long']).default('normal'), move: z.enum(Object.keys(CAMERA_MOVES)).default('static'), height: z.enum(['eye', 'low', 'high']).default('eye') })
  })
  .describe('A staging board plan in metres on an 8 x 8 m floor centred on 0,0 (x to the right, y into the room; the camera usually at y -3 facing 0). Its words fill staging and camera unless those are given too.')
const shotPatch = { stage: stageSchema.optional(), action: z.string().optional(), staging: z.string().optional().describe('Who stands where by screen side at the start, facing, eyelines, distance, movement'), camera: z.string().optional(), ends: z.string().optional().describe('How the shot leaves things: positions, facing, hands and props, gaze, direction of travel; the next shot opens on it'), characters: z.array(z.string()).optional(), speaker: z.string().optional(), line: z.string().optional(), seconds: z.number().min(1).max(15).optional(), prompt: z.string().optional(), character: z.string().optional().describe('Character preset id or none'), continues: z.boolean().optional().describe("Film on from the end of the previous shot's take as one unbroken take (Continue mode); film and pick the previous shot first") }
tool('list_films', 'Short-film projects (the app\'s Projects page): name, logline, aspect, scenes and shots.', {}, () => ({ items: films.list() }))
tool('create_film', `Start a short-film project. script (optional) is screenplay text: a scene starts with a heading like "INT. POTTERY STUDIO - DAY", a name in capitals on its own line with words under it is dialogue, other paragraphs are action. ${LIVE_FILM}`, {
  name: z.string().default('Untitled film'),
  logline: z.string().default(''),
  aspect: z.enum(Object.keys(ASPECTS)).default('16:9'),
  targetSeconds: z.number().min(10).max(3600).default(120),
  script: z.string().optional()
}, (args) => films.create(args))
tool('get_film', 'A short-film project with its brief, cast, locations, props, look, scenes and every shot (what we see, camera, speaker and line, seconds, prompt, character) and where each shot is: state.status draft, ready, rendering, pick (previews to choose from, in state.candidates), finishing, finished (state.final) or error. Totals add it up.', { filmId: z.string() }, ({ filmId }) => films.view(filmId))
tool('update_film', `Change a film's brief or assets: name, logline, aspect, targetSeconds, look {notes, loras:[{name, strength}]}, cast [{characterId, as}] (a made-up person no preset plays is {characterId: null, as, description, face}), locations and props [{name, description, pictures:[paths]}]. Lists replace the old ones whole. ${LIVE_FILM}`, {
  filmId: z.string(),
  name: z.string().optional(),
  logline: z.string().optional(),
  aspect: z.enum(Object.keys(ASPECTS)).optional(),
  targetSeconds: z.number().min(10).max(3600).optional(),
  step: z.enum(['idea', 'story', 'cast', 'board', 'film', 'watch']).optional().describe('The wizard step the person sees'),
  look: z.object({ notes: z.string().optional(), loras: z.array(z.object({ name: z.string(), strength: z.number() })).optional() }).optional(),
  cast: z.array(z.object({ characterId: z.string().nullable(), as: z.string().optional(), description: z.string().optional(), face: z.string().nullable().optional() })).optional(),
  locations: z.array(z.object({ id: z.string().optional(), name: z.string(), description: z.string().optional(), pictures: z.array(z.string()).optional() })).optional(),
  props: z.array(z.object({ name: z.string(), description: z.string().optional(), pictures: z.array(z.string()).optional() })).optional()
}, ({ filmId, ...patch }) => films.update(filmId, patch))
tool('set_film_script', `Replace a film's script (screenplay text, see create_film). Scenes are read from it; scenes that didn't change keep their shots, changed ones are marked stale. Speakers who share a first name with a character preset join the cast, and the scene headings add locations. ${LIVE_FILM}`, { filmId: z.string(), script: z.string().min(1) }, ({ filmId, script }) => films.setScript(filmId, script))
tool('write_film_script', `Draft a film's script with the local writer from its idea (idea, else the film's logline), its cast and its target length. It replaces the script, so ask before writing over one the person wrote. Takes a minute or two. ${LIVE_FILM}`, { filmId: z.string(), idea: z.string().optional() }, ({ filmId, idea }) => films.writeScript(filmId, { idea }))
tool('sketch_film_shots', "Draw a storyboard still for each shot without one (or shotIds, or every shot with redo), on this PC's picture models: about 15-30 s a shot, free. A shot's character face and its place's picture are kept when an editing model is set up. get_film shows each shot's sketch once drawn.", { filmId: z.string(), shotIds: z.array(z.string()).optional(), redo: z.boolean().default(false) }, async ({ filmId, ...opts }) => {
  if (readSettings(BASE).target !== 'cloud') await voices.release()
  return { items: await films.sketch(filmId, opts) }
})
tool('break_down_film', 'Break the script into shots with the local writer: each scene becomes 3-10 s shots (what we see, camera, who is on screen, at most one speaker and their exact words), then each shot gets its H3 prompt. Runs in the background (minutes); get_film shows breakdown progress. By default only scenes without shots, or stale ones; redo does every scene. sketch (on by default) then draws each new shot\'s storyboard still, as the Projects page does. Show the person the board and get their OK before rendering: renders take GPU time.', {
  filmId: z.string(),
  redo: z.boolean().default(false),
  sceneIds: z.array(z.string()).optional(),
  sketch: z.boolean().default(true)
}, ({ filmId, ...opts }) => films.breakDown(filmId, opts))
tool('edit_film_shot', `Change a shot (any of action, staging, camera, ends, characters, speaker, line, seconds, prompt, character, stage), add one after it (add: true, with the new shot's fields), remove it (remove: true) or move it within its scene (move: -1 or 1). stage is the staging board's plan: its exact screen-side words become staging and camera, and lineWarnings says when two people swap sides from the scene's previous staged shot. After changing what happens, write_film_shot_prompt rewrites its prompt. A change to action, staging, camera or stage marks an existing sketch sketchStale: filming starts without it until sketch_film_shots redraws it. ${LIVE_FILM}`, {
  filmId: z.string(),
  sceneId: z.string(),
  shotId: z.string().optional().describe('Omit with add to add at the end of the scene'),
  add: z.boolean().optional(),
  remove: z.boolean().optional(),
  move: z.number().int().min(-1).max(1).optional(),
  ...shotPatch
}, async ({ filmId, sceneId, shotId, ...patch }) => {
  const out = await films.editShot(filmId, sceneId, shotId || null, patch)
  if (!patch.stage || !shotId) return out
  const shots = films.get(filmId).scenes.find((s) => s.id === sceneId)?.shots || []
  const before = shots.slice(0, shots.findIndex((s) => s.id === shotId)).reverse().find((s) => s.stage)
  return { ...out, lineWarnings: lineCheck(before?.stage, patch.stage) }
})
tool('write_film_shot_prompt', 'Write (or rewrite) one shot\'s H3 prompt from its description with the local writer.', { filmId: z.string(), sceneId: z.string(), shotId: z.string() }, async ({ filmId, sceneId, shotId }) => ({ prompt: await films.writeShotPrompt(filmId, sceneId, shotId) }))
tool('speak_film_line', 'Say a shot\'s line in its character\'s voice; the shot then lip-syncs to it when rendered, and its finish uses that sound. Each take is read back with Whisper and said again (up to 3 seeds) until every word is there; heard is what Whisper heard. again: a new take with fresh seeds, then film new takes to use it. The character needs a voice (Characters page).', { filmId: z.string(), shotId: z.string(), again: z.boolean().default(false) }, async ({ filmId, shotId, again }) => {
  if (readSettings(BASE).target !== 'cloud') await voices.release()
  await films.speak(filmId, shotId, { again })
  const { sh } = films.find(films.get(filmId), shotId)
  return { file: sh.voiceLine.file, duration: sh.voiceLine.duration, heard: sh.voiceLine.heard ?? null }
})
tool('render_film_shot', 'Hunt previews for one shot (3 by default; an ordinary IV Studio shot, so it also shows in Shots). A shot with a storyboard sketch opens exactly on it (fromSketch: false films from the prompt alone). When its place has a picture (sketching draws one for every place without a photo), it films in Reference mode: the sketch is the first frame, the place picture keeps the room the same however the camera moves, and other cast characters on screen come from their face pictures (room: false uses Frames mode, the sketch alone). Every line is said before any shot renders; a shot with no line is told nobody speaks. A line its character has a voice for is said in that voice first, so the shot lip-syncs to it (voice: false skips that). Poll get_film or get_job; when its status is pick, show the person the takes and finish_film_shot the one they choose.', { filmId: z.string(), shotId: z.string(), previews: z.number().int().min(1).max(3).default(3), seed: z.number().int().optional(), voice: z.boolean().default(true), fromSketch: z.boolean().default(true).describe("Open on the shot's storyboard sketch when it has one"), room: z.boolean().default(true).describe("With a picture of the place, keep the room the same (Reference mode)"), previs: z.boolean().default(true).describe("A staged shot whose camera arcs films from its previs (<Video 1>); other moves film from the staging words") }, async ({ filmId, shotId, ...opts }) => {
  if (readSettings(BASE).target !== 'cloud') await voices.release()
  return films.render(filmId, shotId, opts)
})
tool('render_film_scene', 'Hunt previews for every shot in a scene (or, without sceneId, the whole film) that has a prompt and nothing rendered yet. Ask the person first: each shot is minutes of GPU time.', { filmId: z.string(), sceneId: z.string().optional(), previews: z.number().int().min(1).max(3).default(3), fromSketch: z.boolean().default(true), room: z.boolean().default(true), previs: z.boolean().default(true) }, async ({ filmId, sceneId, ...opts }) => {
  if (readSettings(BASE).target !== 'cloud') await voices.release()
  return { items: await films.renderScene(filmId, sceneId, opts) }
})
tool('finish_film_shot', 'Finish take n of a shot\'s latest previews at 2 MP (with its spoken line as the sound when it has one).', { filmId: z.string(), shotId: z.string(), candidate: z.number().int().min(1).max(3), megapixels: z.number().min(0.5).max(4).default(2), upscale2x: z.boolean().default(false) }, ({ filmId, shotId, candidate, ...opts }) => films.finish(filmId, shotId, candidate, opts))
tool('make_animatic', `The storyboard as a film before anything is filmed: each sketch held for its shot's length with a slow push-in, the shot's spoken line where it has one, and the words on screen (a shot with no sketch shows its action on a dark card). A few seconds on this PC, free. voice: first say every line whose character has a voice (the voice engine, about 5-40 s a line). Returns the file, its length and how many shots have sketches and spoken lines; show it to the person before filming. ${LIVE_FILM}`, { filmId: z.string(), voice: z.boolean().default(false) }, ({ filmId, voice }) => films.animatic(filmId, { voice }))
tool('draw_film_face', `Draw a face for someone in the film no character preset plays (a made-up role, by the name the script uses), from their description in the cast when it has one. It is kept on their cast entry, and every sketch and shot of them uses it (their shots film in References mode with the face), so they look the same throughout. Sketching draws one for every such speaker without a face; again: a new face. Their existing sketches are marked to redraw. About 20 s on this PC. ${LIVE_FILM}`, { filmId: z.string(), role: z.string(), again: z.boolean().default(false) }, async ({ filmId, role, again }) => {
  if (readSettings(BASE).target !== 'cloud') await voices.release()
  return films.drawFace(filmId, role, { again })
})
tool('use_film_face', `Use the person's own picture (a file on this PC: concept art, a reference sheet) as the face of someone in the film no character preset plays, instead of a drawn one. Crop it to their face and hair first (prepare_media) when the picture shows more. It is kept on their cast entry like a drawn face, and every sketch and shot of them uses it. Their existing sketches are marked to redraw. ${LIVE_FILM}`, { filmId: z.string(), role: z.string(), file: z.string() }, ({ filmId, role, file }) => films.useFace(filmId, role, file))
tool('draw_place_angles', `Draw more views of a film's place from its photo with the QMA camera angles LoRA on Qwen Image 2.1's edit (both from Settings → Setup): quarter (a quarter turn), side (from the side) and wide (from further back). There is no true reverse: the LoRA's back view keeps facing the same way. Sketches and shots then pick the view that suits their camera: wide for wide or establishing shots, side for a staged camera turned well away or words like reverse or profile, quarter for a slight turn or over-the-shoulder. About 50 s a view on this PC, free. ${LIVE_FILM}`, { filmId: z.string(), locationId: z.string(), views: z.array(z.enum(['quarter', 'side', 'wide'])).optional() }, async ({ filmId, locationId, views }) => {
  if (readSettings(BASE).target !== 'cloud') await voices.release()
  return films.drawAngles(filmId, locationId, views ? { views } : {})
})
tool('use_film_recording', `Use a recording (any sound file: the person's own voice, an actor, a take from elsewhere) as a shot's line, so the shot lip-syncs to it and its finish uses it; 14 s at most. Whisper reads it back when voices are set up (heard); a shot with no line yet takes the words heard, into its prompt too. Film new takes to use it. ${LIVE_FILM}`, { filmId: z.string(), shotId: z.string(), file: z.string() }, ({ filmId, shotId, file }) => films.useRecording(filmId, shotId, file))
tool('build_rough_cut', `Put every shot of a film in script order on V1 of its edit (made the first time): the finished take, else the picked or first preview. Rebuilding replaces V1 only. Returns the edit id, how many shots went in, and which are missing; get_edit and export_edit take it from there. ${LIVE}`, { filmId: z.string() }, ({ filmId }) => films.roughCut(filmId))

// New footage from inside an edit: the same Extend, Fill/Bridge and Retake as the editor's right-click menu.
const editgen = new EditGen({ edits, studio: () => studio, localCopy: (f) => studio.localCopy(f, VIDEOS) })
const genView = (editId) => editgen.advance(editId).then(() => ({ items: editgen.view(editId) }))
tool('generate_in_edit', `Make new footage on an edit's timeline with H3, the way the editor's right-click menu does. kind extend: carry clip on for seconds (5, 10 or 15) from its last frames (Continue a video); it is finished by itself and inserted after the clip. kind bridge: a new shot from clip's last frame to next's first frame (inserted between them, seconds long), or fill gap {track, from, to} (up to 15 s, over the gap); it makes 3 previews, then call pick_generation. kind retake: render from..to (timeline seconds inside clip) again, mode both (picture and sound), video (keep the performance) or audio (keep the picture); it replaces that stretch. Each takes GPU minutes; follow with list_generations every 20-30 s. The prompt is an H3 prompt ({char} for the character); write_prompt can write it. ${LIVE}`, {
  editId: z.string(),
  kind: z.enum(GEN_KINDS),
  prompt: z.string().min(1),
  clip: z.string().optional().describe('extend, retake, bridge: the clip id (get_edit)'),
  next: z.string().optional().describe('bridge: the clip right after it'),
  gap: z.object({ track: z.string(), from: z.number(), to: z.number() }).optional().describe('bridge: fill this gap instead'),
  seconds: z.number().optional().describe('extend: 5, 10 or 15; bridge between clips: its length (default 3)'),
  overlap: z.number().int().optional().describe('extend: how many of the clip\'s last frames Continue carries into the join, 5, 22 (default), 39 or 56. More keeps the motion smoother through the join; fewer lets the new part change more. At 15 s the overlap comes out of the new part.'),
  from: z.number().optional().describe('retake: start, timeline seconds'),
  to: z.number().optional().describe('retake: end, timeline seconds'),
  mode: z.enum(Object.keys(RETAKE_MODES)).optional(),
  character: z.string().default('none').describe('A character preset id, or none'),
  seed: z.number().int().optional()
}, async ({ editId, ...spec }) => {
  if (readSettings(BASE).target !== 'cloud') await voices.release()
  return editgen.start(editId, spec)
})
tool('list_generations', 'The new footage an edit is making (generate_in_edit), each moved on first: rendering (with step progress), pick (a bridge waiting for pick_generation, with its candidates), finishing, done (placedClip is the clip on the timeline), error or cancelled.', { editId: z.string() }, ({ editId }) => genView(editId))
tool('pick_generation', `Pick which of a bridge's previews to finish (candidate 1-3, from list_generations). It is finished at 2 MP and lands on the timeline. ${LIVE}`, { editId: z.string(), genId: z.string(), candidate: z.number().int().min(1).max(3) }, async ({ editId, genId, candidate }) => {
  await editgen.pick(editId, genId, candidate)
  return genView(editId)
})
tool('cancel_generation', 'Stop a generation (only ones you started, or the person asked you to) and remove its placeholder.', { editId: z.string(), genId: z.string() }, async ({ editId, genId }) => ({ removed: await editgen.cancel(editId, genId) }))

const reframes = new Reframes({ dataDir: DATA, studio: () => studio, edits, images: () => images })
tool('reframe', `Put a video or picture in a new frame shape (9:16, 1:1, 4:5 or 16:9) by drawing what lies beyond its edges instead of cropping: it is kept as it is in the middle and the bars are filled. Video: MiniMax H3's masked edit on this PC (the original picture and sound are held; up to 15 s; a few minutes for 5 s); about tells H3 what the shot shows. Picture: Qwen Image 2.1 with the outpaint LoRA, the original pasted back (about 30 s). zoom above 1 crops into it first, so less is drawn. Returns the file and how much of the frame was drawn (filled). Free, local; check the result before using it.`, {
  file: z.string(),
  shape: z.enum(['9:16', '1:1', '4:5', '16:9']).default('9:16'),
  about: z.string().default('').describe('What it shows, in a sentence'),
  zoom: z.number().min(1).max(2).default(1),
  seed: z.number().int().default(42)
}, async (args) => {
  if (readSettings(BASE).target !== 'cloud') await voices.release()
  return /\.(png|jpe?g|webp|bmp)$/i.test(args.file) ? reframes.makePicture(args) : reframes.make(args)
})
const cutouts = new Cutouts({ dataDir: DATA, studio: () => studio, edits })
tool('cut_out', `Cut out who or what you name from a picture or video (SAM 3.1 on this PC's ComfyUI, free): what stays is found in every frame and the rest turns see-through. Returns a PNG (pictures) or a WebM with a see-through background and the video's sound, plus coverage (how much of the frame stays). About 15 s for a picture and 30 s for a 5 s clip. Put it on a track above other footage (add_media, then edit_timeline); export_edit keeps it see-through. Use plain words ("person", "dog", "bird"): a fancier name ("bluebird") can catch someone else while the thing is off screen, and when it leaves the frame the track can jump to something nearby, so check the frames. Fails when nothing matching is found: try other words.`, {
  file: z.string().describe('A picture or video on this PC'),
  what: z.string().default('person').describe('Who or what stays: "person", "the woman", "the dog", "the red car"'),
  soften: z.number().min(0).max(6).default(1.2).describe('Edge softness in pixels')
}, async (args) => {
  if (readSettings(BASE).target !== 'cloud') await voices.release()
  return cutouts.make(args)
})
const reels = new Reels({ dataDir: DATA, edits })
tool('make_reel', `Make a reel: pictures (and video clips), in order, cut to a song's beat with a slow move on each picture (push in, drift, pull out), as a new edit with the song on A1 fading out at the end. The beat is found from the song itself (tempo and bar-aligned cuts; a song without a clear pulse is cut evenly). pace: calm (about 3 s a picture), normal (about 2 s) or fast (about 1 s), always a whole number of beats. format: 1080p, vertical or square. It ends with the pictures or the song (or length), whichever comes first; returns the edit id, its length, the BPM found, and how many pictures fit. Seconds on this PC, free; then get_edit, edit_timeline and export_edit. ${LIVE}`, {
  items: z.array(z.string()).min(1).describe('Picture or video files, in order'),
  song: z.string().describe('A sound file (a song from list_music has a file)'),
  pace: z.enum(['calm', 'normal', 'fast']).default('normal'),
  format: z.enum(['1080p', 'vertical', 'square']).default('1080p'),
  length: z.number().min(3).optional().describe('At most this many seconds'),
  name: z.string().default('Reel')
}, (args) => reels.make(args))
tool('export_edit', `Render the whole edit to one MP4 (H.264 + AAC) in Videos\\IV Studio\\Edits, or outDir. Returns at once; follow with get_edit_export. The export runs inside this MCP server, so it stops if the server stops.`, {
  editId: z.string(),
  outDir: z.string().optional()
}, ({ editId, outDir }) => {
  if (exporting.get(editId)?.state === 'running') throw new Error('This edit is already exporting.')
  const e = edits.get(editId)
  if (!e.clips.length) throw new Error('The timeline is empty.')
  const st = { state: 'running', progress: 0, file: null, error: null, startedAt: new Date().toISOString(), seconds: +editLength(e).toFixed(2) }
  exporting.set(editId, st)
  edits
    .export(editId, outDir || path.join(VIDEOS, 'Edits'), (p) => (st.progress = +p.toFixed(3)))
    .then((f) => Object.assign(st, { state: 'done', progress: 1, file: f }))
    .catch((err) => Object.assign(st, { state: /cancel/i.test(err.message) ? 'cancelled' : 'failed', error: err.message }))
  return st
})
tool('get_edit_export', 'Progress of an export started with export_edit (state running, done, failed or cancelled; file when done).', { editId: z.string() }, ({ editId }) => {
  const st = exporting.get(editId)
  if (!st) throw new Error('No export started for this edit from this MCP server. Past exports are in get_edit.')
  return st
})
tool('cancel_edit_export', 'Stop an export started with export_edit.', { editId: z.string() }, ({ editId }) => ({ cancelled: edits.cancelExport(editId) }))

// ---------- character training ----------
// ---------- Shinobi: the agent-driven editor (OpenKatana engine) ----------
const shinobi = new Shinobi({ dataDir: DATA, resourcesDir: resourcesDir(), ffmpegDir: path.dirname(edits.ffmpeg) })
// Pictures a Shinobi tool made (preview frames, contact sheets), as small JPEGs for the agent to look at.
async function picturesOf(result, max = 4) {
  const paths = []
  const walk = (v) => {
    if (paths.length >= max) return
    if (typeof v === 'string' && /\.(png|jpe?g)$/i.test(v) && fs.existsSync(v)) paths.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(result)
  const out = []
  for (const p of paths) {
    const jpg = path.join(os.tmpdir(), `shinobi-${path.basename(p)}-${Date.now()}.jpg`)
    await new Promise((res) => spawn(edits.ffmpeg, ['-v', 'error', '-y', '-i', p, '-vf', 'scale=768:-2', '-q:v', '4', jpg], { windowsHide: true }).on('close', res))
    if (fs.existsSync(jpg)) out.push({ type: 'image', data: fs.readFileSync(jpg).toString('base64'), mimeType: 'image/jpeg' }), fs.rmSync(jpg, { force: true })
  }
  return out
}
tool('shinobi_status', "Is Shinobi (IV Studio's agent-driven editor) set up on this PC, which browser it renders with, and its projects folder.", {}, () => ({ ...shinobi.status(), projects: shinobi.status().installed ? shinobi.projects() : [] }))
tool('shinobi_setup', "Install Shinobi's engine into IV Studio's folder (about 440 MB, under a minute; nothing else on the PC changes). Ask the person first.", {}, () => shinobi.install())
tool('shinobi_tools', 'Every Shinobi tool with its parameters: media inspection, timeline authoring, beat analysis, captions, effects, 3D, rendering and review. Call them with the shinobi tool. Start with read_guide (agent, timeline, effects).', {}, () => shinobi.tools())
server.registerTool('shinobi', {
  description: "Call one Shinobi tool (see shinobi_tools) with its arguments. Projects live in IV Studio's Shinobi workspace and show on the Shinobi page. Typical flow: create_project, import_media (any IV Studio render path or file), preview_source, save_timeline (with the revision from get_project), preview_timeline, start_render, get_render. Preview pictures come back as images. Never call paid or hosted model tools without the person's OK.",
  inputSchema: { tool: z.string(), arguments: z.record(z.any()).default({}) }
}, async ({ tool: name, arguments: args }) => {
  try {
    const result = await shinobi.call(name, args)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }, ...(await picturesOf(result))] }
  } catch (err) {
    return fail(err)
  }
})
tool('shinobi_project', "A Shinobi project as IV Studio sees it: media with file paths, the saved edit's length and shape, renders with their video files, and the person's brief.", { projectId: z.string() }, ({ projectId }) => {
  const p = shinobi.project(projectId)
  const brief = path.join(p.dir, 'iv-brief.md')
  return { ...p, brief: fs.existsSync(brief) ? fs.readFileSync(brief, 'utf8') : '' }
})

const trainings = new Trainings({ dataDir: DATA, resourcesDir: resourcesDir(), studio, ffmpeg: edits.ffmpeg, ffprobe: edits.ffprobe, shinobi })
// A training with each render's state; pictures and clips as file paths/URLs rather than the raw jobs.
async function trainingView(id) {
  const t = await trainings.refresh(id)
  const out = (jobId, kind) => {
    const j = t.jobs[jobId]
    const o = j?.outputs?.find((x) => x.kind === kind)
    return { jobId, status: j?.status, ...(o && { path: o.path, url: o.url }), ...(j?.error && { error: j.error }) }
  }
  return {
    id: t.id,
    name: t.name,
    trigger: t.trigger,
    who: t.who,
    faceText: t.faceText,
    consent: t.consent,
    face: t.face,
    faceCandidates: t.faceCandidates.map((c, i) => ({ index: i, seed: c.seed, ...out(c.jobId, 'image') })),
    stills: t.stills.map((s) => ({ id: s.id, source: s.source, caption: s.caption, pick: s.pick, inSet: !!s.file, candidates: s.candidates.map((c, i) => ({ index: i, ...out(c.jobId, 'image') })) })),
    clips: t.clips.map((c) => ({ id: c.id, source: c.source, caption: c.caption, keep: c.keep, file: c.file?.path || null, ...(c.jobId && { render: out(c.jobId, 'preview') }) })),
    voice: t.voice?.path || null,
    estimate: t.estimate,
    train: t.train,
    checkpoints: t.checkpoints,
    tests: t.tests.map((x) => ({ epoch: x.epoch, ...out(x.jobId, 'preview') })),
    characterId: t.characterId
  }
}
const firstOutput = async (id, jobId, kind) => {
  const t = await trainings.refresh(id)
  const o = t.jobs[jobId]?.outputs?.find((x) => x.kind === kind)
  if (!o) throw new Error('That render has not finished yet; check get_character_training.')
  return { path: o.path, url: o.url, filename: o.filename }
}
const TRAIN_HOW = 'Steps: create_character_training -> design_faces -> pick_face -> design_scenes -> pick_still (each scene) -> make_training_clips -> estimate_training -> start_training (paid, ask first) -> get_character_training until done -> test_checkpoints -> adopt_checkpoint. Look at the pictures by reading their files, and clips with grab_frame.'
tool('list_character_trainings', `Characters being designed or trained (the Characters page). ${TRAIN_HOW}`, {}, () => trainings.list())
tool('get_character_training', 'A character training: face candidates, scene stills, clips (with render status and files), the cost estimate, training progress, checkpoints and tests.', { trainingId: z.string() }, ({ trainingId }) => trainingView(trainingId))
tool('create_character_training', `Start designing a new invented character. ${TRAIN_HOW}`, {
  name: z.string().min(1),
  who: z.string().default('a woman in her thirties').describe('Kind of person, e.g. "a man in his fifties" (no face details here)')
}, (args) => trainingView(trainings.create(args).id))
tool('update_character_training', 'Change the name, trigger word (3-12 letters/numbers, made up), who, face description, consent (true only if the person confirmed their pictures/clips are of an invented person or someone who agreed), or the voice sample path.', {
  trainingId: z.string(),
  name: z.string().optional(),
  trigger: z.string().optional(),
  who: z.string().optional(),
  faceText: z.string().optional(),
  consent: z.boolean().optional(),
  voice: z.string().nullable().optional().describe('Absolute path to a clean recording of the designed voice, or null')
}, ({ trainingId, voice, ...patch }) => trainingView(trainings.save(trainingId, { ...patch, ...(voice !== undefined && { voice: voice ? { path: voice } : null }) }).id))
tool('design_faces', 'Render four face candidates on this PC (Z-Image Turbo, a few seconds each) from the face description: age, face shape, eyes, skin, hair.', { trainingId: z.string(), faceText: z.string().optional() }, ({ trainingId, faceText }) => trainings.designFaces(trainingId, { faceText }).then(() => trainingView(trainingId)))
tool('pick_face', 'Choose one face candidate (by index from get_character_training) once it has rendered.', { trainingId: z.string(), index: z.number().int().min(0) }, async ({ trainingId, index }) => {
  const c = trainings.get(trainingId).faceCandidates[index]
  if (!c) throw new Error('No face candidate with that index.')
  trainings.pickFace(trainingId, { jobId: c.jobId, file: await firstOutput(trainingId, c.jobId, 'image') })
  return trainingView(trainingId)
})
tool('design_scenes', 'Render the picked face in eight scenes (four candidates each), for the training stills. Pick the closest to the face in each; weak stills teach the LoRA a blend.', { trainingId: z.string() }, ({ trainingId }) => trainings.designScenes(trainingId).then(() => trainingView(trainingId)))
tool('pick_still', 'Keep one candidate of a scene in the training set (index), or leave the scene out (null). reroll: two more candidates instead.', {
  trainingId: z.string(),
  stillId: z.string(),
  index: z.number().int().min(0).nullable().optional(),
  reroll: z.boolean().optional()
}, async ({ trainingId, stillId, index, reroll }) => {
  if (reroll) await trainings.rerollStill(trainingId, stillId)
  else {
    const s = trainings.get(trainingId).stills.find((x) => x.id === stillId)
    if (!s) throw new Error('No still with that id.')
    trainings.pickStill(trainingId, stillId, index == null ? { pick: null } : { pick: index, file: await firstOutput(trainingId, s.candidates[index]?.jobId, 'image') })
  }
  return trainingView(trainingId)
})
tool('make_training_clips', 'Render talking clips (H3 reference-to-video from the picked face, one kept still and the voice sample, about 1.5 minutes each on this PC). lines: replace the default lines, one per clip. redo: clip ids to render again instead (new seed), for clips where the face drifts.', {
  trainingId: z.string(),
  lines: z.array(z.string()).max(TALKS.length).optional(),
  redo: z.array(z.string()).optional()
}, ({ trainingId, lines, redo }) => (redo?.length ? trainings.remakeClips(trainingId, redo) : trainings.makeClips(trainingId, { talks: lines ? lines.map((line, k) => ({ ...TALKS[k], line })) : TALKS })).then(() => trainingView(trainingId)))
tool('set_training_item', 'Edit a still or clip caption (trigger first, then clothes, place, action, framing, any line; never the face or voice), keep or drop a clip, or remove an uploaded item.', {
  trainingId: z.string(),
  kind: z.enum(['still', 'clip']),
  itemId: z.string(),
  caption: z.string().optional(),
  keep: z.boolean().optional(),
  remove: z.boolean().optional()
}, ({ trainingId, kind, itemId, caption, keep, remove }) => {
  if (remove) trainings.removeItem(trainingId, kind, itemId)
  if (caption !== undefined) trainings.setCaption(trainingId, kind, itemId, caption)
  if (keep !== undefined && kind === 'clip') trainings.keepClip(trainingId, itemId, keep)
  return trainingView(trainingId)
})
tool('add_training_files', "Add the person's own pictures or clips (needs consent: true first). Long clips are cut into 5 s pieces on the H3 frame grid when the set is built.", {
  trainingId: z.string(),
  kind: z.enum(['still', 'clip']),
  files: z.array(z.string()).min(1),
  caption: z.string().default('').describe('Clothes, place, framing; never the face')
}, ({ trainingId, kind, files, caption }) => trainingView((kind === 'still' ? trainings.addStills(trainingId, files, caption) : trainings.addClips(trainingId, files, caption)).id))
tool('estimate_training', 'Steps, minutes and dollars of a training run on Modal, before starting it.', {
  trainingId: z.string(),
  gpu: z.enum(TRAIN_GPUS.map((g) => g.id)).default('B200'),
  epochs: z.number().int().min(10).max(200).optional()
}, ({ trainingId, ...opts }) => trainings.estimateFor(trainings.get(trainingId), opts))
tool('start_training', "Train the character LoRA on the person's own Modal account (signed in on the Cloud page). This costs real money: run estimate_training, tell the person the minutes and dollars, and only call this after they say yes, passing confirm_cost with that dollar figure. Runs in the background; poll get_character_training (train.state, train.progress).", {
  trainingId: z.string(),
  gpu: z.enum(TRAIN_GPUS.map((g) => g.id)).default('B200'),
  epochs: z.number().int().min(10).max(200).optional(),
  confirm_cost: z.number().describe('The estimated dollars the person agreed to')
}, async ({ trainingId, gpu, epochs, confirm_cost }) => {
  const est = trainings.estimateFor(trainings.get(trainingId), { gpu, epochs })
  if (confirm_cost < est.dollars - 0.01) throw new Error(`The estimate is $${est.dollars}; ask the person to agree to that first.`)
  await trainings.startTraining(trainingId, { gpu, epochs })
  return trainingView(trainingId)
})
tool('stop_training', 'Stop a training run on Modal (billing stops; saved epochs stay). Ask the person first.', { trainingId: z.string() }, ({ trainingId }) => trainings.stopTraining(trainingId).then(() => trainingView(trainingId)))
tool('test_checkpoints', "After training: download the chosen epochs into ComfyUI's loras folder and render the same talking shot and seed with each, to compare by eye. Late epochs often look best.", {
  trainingId: z.string(),
  epochs: z.array(z.number().int()).min(1).max(6),
  prompt: z.string().optional().describe('Text-mode H3 prompt with {char}; default a talking close-up')
}, async ({ trainingId, epochs, prompt }) => {
  if (!trainings.get(trainingId).checkpoints.length) await trainings.listCheckpoints(trainingId)
  await trainings.fetchCheckpoints(trainingId, epochs)
  await trainings.testCheckpoints(trainingId, { epochs, prompt })
  return trainingView(trainingId)
})
tool('rank_likeness', 'Score every scene candidate and clip against the picked face with InsightFace ArcFace (0.6+ the same person, 0.4-0.6 a family resemblance, under 0.4 someone else); pick: keep the closest candidate of each scene. Needs the face models (the person downloads them on the Characters page; non-commercial licence).', {
  trainingId: z.string(),
  pick: z.boolean().default(false)
}, ({ trainingId, pick }) => trainings.rank(trainingId, { pick }))
tool('adopt_checkpoint', 'Save the chosen epoch as a character preset (strength 0.8), ready for every render.', { trainingId: z.string(), epoch: z.number().int() }, async ({ trainingId, epoch }) => trainingView((await trainings.adopt(trainingId, epoch)).id))

// ---------- Replace (OpenJutsu's workflows) ----------
const replace = new Replace({ studio, resourcesDir: resourcesDir(), dataDir: DATA, ffmpeg: edits.ffmpeg, ffprobe: edits.ffprobe })
const REPLACE_MODES = ['person', 'people', 'people_maxq', 'object', 'mask', 'faces', 'colours']
tool('replace_check', 'What this ComfyUI still needs for a Replace mode (node packs with links, models to download on the Setup page).', { mode: z.enum(REPLACE_MODES).default('person') }, ({ mode }) => replace.check(mode))
tool('replace_video', `The old Replace engine (OpenJutsu masks). For swapping people and changing the scene use remake_paint and remake_render instead; use this for faces and colours. Swap people or objects in a video; the camera, cuts, motion and soundtrack stay. Modes: person (one picture replaces the main person; settings.role says who, optional), people (1-4 pictures, settings.roles one per picture), people_maxq (exactly 2, one pass per person, better likeness), object (settings.mode change|remove|background, settings.target what SAM tracks such as "hair", settings.changeTo what it becomes, or a picture), mask (a quick preview of what would be redrawn; run it first), faces (redraw small faces from one picture, settings.style photo|mouth), colours (settings.detail -1..1). The video needs a soundtrack. Only use invented characters or people who agreed. Returns a job: poll get_job; the result is the output with kind final.`, {
  mode: z.enum(REPLACE_MODES),
  video: z.string().describe('Absolute path of the source video (prepare_media can trim it first)'),
  pictures: z.array(z.string()).default([]).describe('Absolute paths of character or object pictures'),
  characterId: z.string().optional().describe('person mode: a character preset whose LoRA joins the run'),
  start: z.number().min(0).default(0).describe('Seconds into the video'),
  length: z.number().min(0).default(0).describe('Seconds to use; 0 = to the end'),
  settings: z.object({
    resolution: z.enum(RESOLUTIONS).optional(),
    motion: z.union([z.literal(512), z.literal(768), z.literal(1376)]).optional().describe('Motion reference size; 512 (default) fits a 24 GB card'),
    clipSeconds: z.number().min(2.5).max(15).optional(),
    seed: z.number().int().min(0).optional(),
    margin: z.enum(['tight', 'normal', 'loose']).optional(),
    hatFix: z.boolean().optional(),
    noLipSync: z.boolean().optional(),
    role: z.string().optional(),
    roles: z.array(z.string()).optional(),
    mode: z.enum(['change', 'remove', 'background']).optional(),
    target: z.string().optional(),
    changeTo: z.string().optional(),
    style: z.enum(['photo', 'mouth']).optional(),
    detail: z.number().min(-1).max(1).optional()
  }).default({})
}, ({ characterId, start, length, ...input }) => replace.run({ ...input, section: { start, length }, character: characterId ? studio.characters().find((c) => c.id === characterId) : null }))
// Remake (remake.js): the engine for swapping people and changing the scene. The picture tools join below (images).
const remake = new Remake({ studio, images: null, dataDir: DATA, resourcesDir: resourcesDir(), ffmpeg: edits.ffmpeg, ffprobe: edits.ffprobe, writer: () => writerOf(readSettings(BASE)) })
replace.remake = remake
tool('remake_paint', `Remake, step 1 of 2: swap people (kind swap) or change the scene (kind change: remove or add things, weather, light, setting, style) in up to 14 s of video; the camera, motion, timing and soundtrack stay. Prepares the source on Remake's canvas, picks a frame per shot and paints each the way the result should look (Qwen Image 2.1 edit, local and free), and returns the session with each keyframe's source frame and painted picture. LOOK at the painted pictures before remake_render: they decide the result. Repaint one with only: [frame], or set your own with remake_use_picture. swap needs picture (the face of who goes in; list_cast or a character's picture) and who (whom they replace, in words). change needs ask (the change, in plain words). Only use invented characters or people who agreed.`, {
  kind: z.enum(REMAKE_KINDS),
  video: z.string().optional().describe('Absolute path of the source video (a new session)'),
  session: z.string().optional().describe('An existing session id, to repaint'),
  start: z.number().min(0).default(0),
  length: z.number().min(0).default(0).describe('Seconds to use; 0 = to the end (14.3 s at most)'),
  ask: z.string().optional(),
  who: z.string().optional(),
  picture: z.string().optional(),
  name: z.string().optional().describe('swap: the name of who goes in'),
  only: z.array(z.number().int()).optional().describe('repaint only these keyframe frame numbers')
}, async ({ kind, video, session, start, length, only, ...input }) => {
  const s = session ? remake.get(session) : await remake.prepare({ video, kind, section: { start, length } })
  return remake.paint(s.id, { ...input, only: only || null })
})
tool('remake_use_picture', "Set your own picture as a Remake keyframe (it is fitted to the canvas).", { session: z.string(), frame: z.number().int(), picture: z.string() }, ({ session, frame, picture }) => remake.usePicture(session, frame, picture))
tool('remake_render', `Remake, step 2 of 2: writes the six-section prompt with the person's prompt writer (from the source frames and the painted ones, following Viggle's guide) unless prompt is given, then renders takes (1-3, a few minutes each on a 24 GB card). Returns jobs: poll get_job, or replace_history for the result trimmed back to the source's length and shape.`, {
  session: z.string(),
  takes: z.number().int().min(1).max(3).default(1),
  seed: z.number().int().min(0).optional(),
  prompt: z.string().optional().describe('Your own six-section prompt (subject_definitions, summary, retention_analysis, detailed_description, overall_soundscape, non_diegetic_music)'),
  characterId: z.string().optional().describe('swap: a character preset whose LoRA joins the run')
}, async ({ session, prompt, characterId, ...opts }) => {
  if (prompt) remake.setPrompt(session, prompt)
  return remake.render(session, { ...opts, character: characterId ? studio.characters().find((c) => c.id === characterId) : null })
})
tool('replace_history', 'Past Replace runs, newest first, with their status and result videos.', {}, async () => (await replace.history()).map((j) => ({ job: j.id, name: j.projectName, status: j.status, mode: j.plan?.replace?.mode, error: j.error, outputs: j.outputs })))

// ---------- models and characters ----------
const WORKFLOWS = ['text', 'frames', 'reference', 'continue', 'take', 'retake']
tool('list_h3_models', 'H3 models the ComfyUI can load, each workflow\'s built-in default, and the model chosen in Settings for each (text, frames, reference, continue, take = Sequences one take, retake). Some models suit realism, others animation.', {}, async () => {
  const { models, defaults } = await studio.h3Models()
  return { models, defaults, chosen: readSettings(BASE).models || {} }
})
tool('set_workflow_model', 'Choose the H3 model one workflow uses (Settings -> Models). model null = back to the default. Applies to this MCP server at once and to the app window from its next render.', {
  workflow: z.enum(WORKFLOWS),
  model: z.string().nullable()
}, async ({ workflow, model }) => {
  if (model) {
    const { models } = await studio.h3Models()
    if (!models.includes(model)) throw new Error(`ComfyUI has no H3 model "${model}". list_h3_models shows them.`)
  }
  const next = { ...(readSettings(BASE).models || {}) }
  if (model) next[workflow] = model
  else delete next[workflow]
  studio.models = writeSettings({ models: next }, BASE).models
  return { chosen: studio.models }
})
tool('list_choices', 'Character LoRAs and RefMods the ComfyUI can load (for save_character and the refmods of a request).', {}, () => studio.choices())
tool('save_character', 'Add a character preset, or update one by id. The LoRA must be a name from list_choices. Only invented characters, or real people who agreed to it.', {
  id: z.string().regex(/^[a-z0-9_-]{2,32}$/).describe('Short id, e.g. "tess"'),
  name: z.string().min(1).optional(),
  lora: z.string().optional(),
  strength: z.number().min(0).max(1.5).optional(),
  trigger: z.string().min(2).optional().describe('The trigger word the LoRA was trained on; prompts write {char} for it'),
  voiceRefmod: z.string().nullable().optional(),
  visualRefmod: z.string().nullable().optional(),
  voiceId: z.string().nullable().optional().describe('A voice from list_voices: the voice speak_line uses for this character; null for none')
}, async ({ id, ...fields }) => {
  if (fields.voiceId) voices.get(fields.voiceId)
  if (fields.voiceId === null) fields.voiceDeclined = true
  const list = studio.characters()
  const old = list.find((c) => c.id === id)
  const next = { ...(old || { strength: 0.8 }), id, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) }
  for (const k of ['name', 'lora', 'trigger']) if (!next[k]) throw new Error(`A new character needs ${k}.`)
  if (fields.lora) {
    const { loras } = await studio.choices()
    if (!loras.some((l) => l.replace(/\\/g, '/') === fields.lora.replace(/\\/g, '/'))) throw new Error(`ComfyUI has no LoRA "${fields.lora}". list_choices shows them.`)
  }
  studio.saveCharacters(old ? list.map((c) => (c.id === id ? next : c)) : [...list, next])
  return next
})
// ---------- Audio: voices and spoken lines (IV Studio's own engine: VoxCPM2 and Whisper) ----------
const voices = new Voices({ dataDir: DATA, resourcesDir: resourcesDir(), ffmpeg: edits.ffmpeg, comfy: studio.comfy })
// Take ranking (ranking.js): the same scores the window shows, saved on the job
const ranker = new Ranker({ studio: () => studio, voices: () => voices, shinobi: () => shinobi, ffmpeg: edits.ffmpeg, dataDir: DATA })
tool('rank_takes', "Rank a finished previews job's takes: each is scored on hearing every spoken line (Whisper, when the prompt has lines and voices are set up), looking like the picked character (InsightFace, when the face models are set up), not freezing, and sharpness against the others; the best is marked with its reasons. The app ranks runs on its own as they finish; get_job then shows ranking. Pass picked to record the person's choice, which teaches the weights.", { jobId: z.string(), picked: z.number().int().min(1).max(3).optional().describe("The take the person chose, to learn from") }, async ({ jobId, picked }) => {
  const job = studio.getJob(jobId)
  const ranking = job.ranking || (await ranker.rank(jobId))
  if (!ranking) throw new Error('Only a finished previews job with its takes on this PC can be ranked.')
  return { ranking, ...(picked ? { weights: ranker.learn(jobId, picked) } : {}) }
})
const reviewer = new Reviewer({ studio: () => studio, voices: () => voices, ffmpeg: edits.ffmpeg })
const previs = new Previs({ resourcesDir: resourcesDir(), dataDir: DATA, browser: () => shinobi.browser(), ffmpeg: edits.ffmpeg })
tool('make_previs', "Draw a staging board plan in motion: a grey previs clip (plain mannequins and boxes) of the camera's move and the walks, about 3 s on this PC. H3 follows a previs's arc round people, which it barely does from words. Put the clip in generate_previews' media as a video in reference mode, and put words (it names <Video 1>; renumber it if other videos come first) into the prompt. Only worth it for an arc: a push, pull, track, pan or walk did as well or better from the staging words alone in tests, and renders 1.6-3.5x faster.", { stage: stageSchema, seconds: z.number().min(1).max(15).default(5), aspect: z.enum(Object.keys(ASPECTS)).default('16:9') }, ({ stage, seconds, aspect }) => previs.make({ stage, seconds, aspect }))
tool('review_take', "Review one take against its prompt, as a director would: the person's prompt writer (Claude Code, Codex, or the local vision model) looks at frames from the take and names each problem with the seconds it happens in (identity, wardrobe, anatomy, contact, staging, order, feeling, words), says what works, and picks one fix: none, revise_prompt (with revisedPrompt, already through the checker), change_reference, split_action, clean_stretch (with from and to) or edit. Saved on the job as reviews. jobId is a previews job (with candidate) or a finish job. Then, for revise_prompt, render revisedPrompt with generate_previews into the same projectId.", { jobId: z.string(), candidate: z.number().int().min(1).max(3).optional().describe('The take, for a previews job') }, async ({ jobId, candidate }) => {
  const job = studio.getJob(jobId, { refresh: false })
  return reviewer.review(jobId, job.kind === 'finish' ? 0 : candidate || 1, writerOf(readSettings(BASE)))
})
process.on('exit', () => voices.release())
studio.beforeRender = () => voices.release()
tool('voice_status', `Whether IV Studio's voice engine is set up (${VOICE_ENGINES.map((e) => `${e.label}: ${e.note}`).join(' ')} Whisper large-v3 turbo, MIT, reads the words in recordings). installed false: ask the person to press Set up voices on Audio > Voices, or run setup_voices with their OK.`, {}, () => voices.status())
tool('setup_voices', "Set up IV Studio's voice engine once: a Python environment with PyTorch and VoxCPM, plus the VoxCPM2 and Whisper models, about 12 GB of free downloads into IV Studio's data folder (roughly 5-15 minutes). Ask the person first. Returns when done.", {}, () => voices.setup())
tool('list_voices', 'Every saved voice: id, name, kind (designed, clone, ready), engine, seed, reference recording and its words, and which characters use it.', {}, async () => {
  await catalog.attachVoices().catch(() => {})
  const chars = studio.characters()
  return { items: voices.list().map((v) => ({ ...v, characters: chars.filter((c) => c.voiceId === v.id).map((c) => c.id) })) }
})
tool('design_voice', 'Make 1-4 candidate voices from a description (VoxCPM2 voice design, about 25 s each). Returns their files: listen or let the person listen, then save one with create_voice (kind designed, same seed and description). Only invented voices.', {
  description: z.string().min(10).describe('Age, accent, pitch, manner, recording: e.g. "A man in his sixties from Cork, gravelly and slow, close and natural"'),
  text: z.string().optional().describe('What the candidates say (optional)'),
  seed: z.number().int().default(1),
  count: z.number().int().min(1).max(4).default(3)
}, async (a) => ({ items: await voices.design(a) }))
tool('create_voice', 'Save a voice from a recording: a design_voice candidate (kind designed) or a recording of one person talking (kind clone; only their own voice, an invented one, or someone who agreed: set consent true only when the person has confirmed that). The first 20 s become the reference; text is its words (read by Whisper when left out).', {
  name: z.string().min(1),
  file: z.string().describe('A local wav, mp3, flac, m4a or ogg'),
  kind: z.enum(['designed', 'clone']).default('designed'),
  text: z.string().optional(),
  description: z.string().optional(),
  seed: z.number().int().nullable().optional(),
  consent: z.boolean().default(false)
}, (a) => voices.create(a))
tool('update_voice', 'Rename a voice or change its default seed, words or description.', { id: z.string(), name: z.string().optional(), seed: z.number().int().nullable().optional(), text: z.string().optional(), description: z.string().optional() }, ({ id, ...patch }) => voices.update(id, patch))
tool('delete_voice', 'Delete a voice and the lines spoken in it; characters using it lose their voice. Ask the person first.', { id: z.string() }, ({ id }) => {
  const r = voices.delete(id)
  studio.saveCharacters(studio.characters().map((c) => (c.voiceId === id ? { ...c, voiceId: null } : c)))
  return r
})
tool('speak_line', `Say a line in a voice (or a character's voice) and get a WAV: use it as voiceLine in generate_previews so H3 lip-syncs to it, with the same words inside the prompt's <d>[English] …</d>. About 5 s a line once the engine is warm (the first after a pause loads the model, about 25 s); the same words, voice and seed come back from the cache.`, {
  text: z.string().min(1).max(600),
  voiceId: z.string().optional(),
  character: z.string().optional().describe('A character id with a voice (save_character voiceId); used when voiceId is left out'),
  seed: z.number().int().optional()
}, ({ text, voiceId, character, seed }) => {
  const id = voiceId || studio.characters().find((c) => c.id === character)?.voiceId
  if (!id) throw new Error(character ? `${character} has no voice yet: give them one with save_character voiceId.` : 'Give voiceId or character.')
  return voices.speak({ voiceId: id, text, seed })
})
tool('list_lines', 'Lines spoken so far, newest first (optionally for one voice): text, file, duration, seed.', { voiceId: z.string().optional() }, ({ voiceId }) => ({ items: voices.lines(voiceId) }))
tool('delete_line', 'Delete a spoken line and its file.', { id: z.string() }, ({ id }) => voices.deleteLine(id))
tool('release_voice_engine', 'Stop the voice engine so its GPU memory goes back to ComfyUI (IV Studio also does this before a render, and ten minutes after the last line).', {}, async () => (await voices.release(), { released: true }))

// ---------- Audio: music (MiniMax Music 3 and ACE-Step 1.5 on this PC's ComfyUI) ----------
const music = new Music({ studio, dataDir: DATA, probe: (f) => edits.probe(f) })
tool('music_status', `Whether this PC's ComfyUI can make music, per engine: ${MUSIC_ENGINES.map((e) => `${e.id} = ${e.label} (${e.note}; ${e.licence})`).join(' ')} Lists missing models; the person downloads them on Audio > Music.`, {}, () => music.status())
tool('make_music', 'Make a song or an instrumental on this PC (free, local). Returns the song at once; follow with get_music until status is success, then use its file: add_media (files) puts it on an edit, generate_previews voiceLine makes a character sing to it (trim it with prepare_media first). MiniMax takes a few minutes per song; ACE-Step seconds.', {
  engine: z.enum(MUSIC_ENGINES.map((e) => e.id)).default(MUSIC_DEFAULTS.engine),
  caption: z.string().describe('The style: genre, mood, instruments, the voice and how it sings, tempo, how the song builds.'),
  lyrics: z.string().optional().describe('Lyrics with section tags on their own lines: [Intro], [Verse], [Chorus], [Bridge], [Instrumental], [Outro]. Leave out for an instrumental.'),
  instrumental: z.boolean().default(false),
  seconds: z.number().min(5).max(600).default(MUSIC_DEFAULTS.seconds).describe('minimax: up to 300, a limit; it sets the length from the lyrics (two short sections give about 15 s). ace: up to 600, exact.'),
  name: z.string().optional(),
  seed: z.number().int().min(0).optional(),
  bpm: z.number().int().min(30).max(300).optional().describe('ace only'),
  key: z.enum(ACE_KEYS).optional().describe('ace only, e.g. "E minor"'),
  timesignature: z.enum(['2', '3', '4', '6']).optional().describe('ace only: beats per bar'),
  language: z.string().optional().describe('ace only: lyrics language code, e.g. en, es, ja')
}, async (args) => (readSettings(BASE).target === 'cloud' || (await voices.release()), music.create(Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined)))))
tool('list_music', 'Every song made in IV Studio, newest first, with status, file (once finished), length, engine, style, lyrics and seed.', {}, () => music.list())
tool('get_music', 'One song, brought up to date: status (queued, running, success, error), progress, and its file once finished.', { songId: z.string() }, ({ songId }) => music.get(songId))
tool('cancel_music', 'Stop a song that is still being made. Never touches other ComfyUI work.', { songId: z.string() }, ({ songId }) => music.cancel(songId))
tool('rename_music', 'Rename a song.', { songId: z.string(), name: z.string().min(1) }, ({ songId, name }) => music.rename(songId, name))
tool('delete_music', "Delete a song and its file in IV Studio's music folder (ComfyUI's own output copy stays). Ask the person first.", { songId: z.string() }, ({ songId }) => music.delete(songId))

// ---------- Create -> Image: pictures from the person's own image models on this PC ----------
const images = new Images({ studio, dataDir: DATA })
remake.images = images
remake.faces = shinobi
tool('free_memory', "Clear the GPU and RAM now: ComfyUI unloads its models (between prompts; a running render keeps its memory until it finishes), this server's voice engine stops and the prompt writer's Ollama models unload. The next job loads what it needs. Use it when the person asks, or before a big job on a crowded GPU.", {}, async () => {
  await studio.comfy.freeMemory()
  await voices.release()
  const ollama = await unloadOllama().catch(() => [])
  const q = await studio.comfy.queue().catch(() => null)
  return { comfyui: 'asked to unload', voiceEngine: 'stopped', ollama, renderRunning: !!q?.queue_running?.length }
})
tool('list_image_models', `The image models on this PC's ComfyUI, by family: ${IMAGE_FAMILIES.map((f) => f.label).join(', ')}. Each family lists its checkpoints (pass one as make_image model), whether it is ready (and what's missing), whether it can edit, and its licence.`, {}, () => images.status())
tool('make_image', "Make pictures on this PC (free, local). mode generate: from the prompt. mode edit: change refs (local picture paths) with the prompt as the instruction; only families with edit true can. loras: the family's LoRAs (list_loras, model-only). Returns the set at once; follow with get_image until status is success, then use its files (use one as a shot's first frame: generate_previews mode frames with a media picture).", {
  mode: z.enum(['generate', 'edit']).default('generate'),
  model: z.string().describe('A checkpoint from list_image_models'),
  prompt: z.string().describe('generate: describe the picture. edit: what to change, and what to keep.'),
  negative: z.string().optional(),
  refs: z.array(z.string()).optional().describe('edit: absolute paths of the pictures to edit (Qwen Image 2.1: up to 3; Krea 2: 1; Flux: up to 6)'),
  loras: z.array(z.object({ name: z.string(), strength: z.number().min(0).max(2).default(1) })).optional(),
  aspect: z.enum(Object.keys(IMAGE_ASPECTS)).default('1:1'),
  megapixels: z.number().min(0.25).max(4).default(1),
  count: z.number().int().min(1).max(4).default(1),
  seed: z.number().int().min(0).optional(),
  steps: z.number().int().min(1).max(100).optional().describe("Leave out for the family's own setting"),
  cfg: z.number().min(0).max(20).optional(),
  name: z.string().optional()
}, async (args) => (readSettings(BASE).target === 'cloud' || (await voices.release()), images.create(Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined)))))
tool('list_images', 'Every picture set made in IV Studio, newest first, with status, files (once finished), model, prompt and seed.', {}, () => images.list())
tool('get_image', 'One picture set, brought up to date: status (queued, running, success, error), progress, and its files once finished.', { imageId: z.string() }, ({ imageId }) => images.get(imageId))
tool('cancel_image', 'Stop a picture set that is still being made. Never touches other ComfyUI work.', { imageId: z.string() }, ({ imageId }) => images.cancel(imageId))
tool('delete_image', "Delete a picture set and its files in IV Studio's images folder (ComfyUI's own output copies stay). Ask the person first.", { imageId: z.string() }, ({ imageId }) => images.delete(imageId))

// ---------- Website sizzle: a web address in, a promo film out ----------
const sizzles = new Sizzles({ dataDir: DATA, studio, music, voices, trainings, shinobi })
// A capture as a small JPEG for the agent to look at; screens can be tiled into one contact sheet.
async function sizzlePicture(files, { width = 960, tile = null, aspect = 16 / 9 } = {}) {
  const out = path.join(os.tmpdir(), `sizzle-${process.pid}-${Date.now()}.jpg`)
  const args = ['-v', 'error', '-y', ...files.flatMap((f) => ['-i', f])]
  if (tile && files.length > 1) {
    // same-size screens, in rows of tile[0]
    const h = Math.round(width / aspect / 2) * 2
    const scaled = files.map((_, k) => `[${k}]scale=${width}:${h}[v${k}]`).join(';')
    const layout = files.map((_, k) => `${(k % tile[0]) * width}_${Math.floor(k / tile[0]) * h}`).join('|')
    args.push('-filter_complex', `${scaled};${files.map((_, k) => `[v${k}]`).join('')}xstack=inputs=${files.length}:layout=${layout}:fill=black`)
  } else args.push('-vf', `scale=${width}:-2`)
  args.push('-frames:v', '1', '-q:v', '4', out)
  await edits.run(args)
  const data = fs.readFileSync(out).toString('base64')
  fs.rmSync(out, { force: true })
  return { type: 'image', data, mimeType: 'image/jpeg' }
}
const sizzleTool = (name, description, shape, fn) =>
  server.registerTool(name, { description, inputSchema: shape }, async (args) => {
    try {
      const { pictures = [], ...value } = await fn(args)
      return { content: [...pictures, { type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value }
    } catch (err) {
      return fail(err)
    }
  })
const sizzleSummary = (s) => {
  const { site, ...rest } = s
  return { ...rest, site: site && { url: site.url, title: site.title, description: site.description, headings: site.headings, ctas: site.ctas, nav: site.nav, paragraphs: site.paragraphs, colors: site.colors, fonts: site.fonts, captures: site.captures.map(({ name, width, height, what, file }) => ({ name, width, height, what, file })), images: site.images.map((im, k) => ({ name: `image-${k + 1}`, file: im.file, alt: im.alt, width: im.width, height: im.height })) } }
}
sizzleTool('sizzle_capture', `Website sizzle, step 1: capture a website for a promo film. Opens the address in this PC's Edge or Chrome (headless) and saves real screenshots (hero, one per screen down the page, the phone layout, the logo), the copy that's on the page, its colours and fonts, and its biggest pictures. Returns the sizzle and pictures of the captures to look at. Then write the storyboard (save_sizzle_plan). Takes about 30-60 s. Formats: ${Object.keys(SIZZLE_FORMATS).join(', ')}.`, {
  url: z.string().describe('The website, e.g. https://example.com'),
  name: z.string().optional(),
  format: z.enum(Object.keys(SIZZLE_FORMATS)).default('16:9')
}, async ({ url, name, format }) => {
  const s = await sizzles.create({ url, name, format })
  const cap = (n) => s.site.captures.find((c) => c.name === n)?.file
  const screens = s.site.captures.filter((c) => c.name === 'hero' || c.name.startsWith('screen-')).map((c) => c.file)
  const pictures = [await sizzlePicture([cap('hero')], { width: 960 }), await sizzlePicture(screens, { width: 480, tile: [4, Math.ceil(screens.length / 4)] }), await sizzlePicture([cap('mobile')], { width: 390 })]
  if (cap('logo')) pictures.push(await sizzlePicture([cap('logo')], { width: 480 }))
  return { pictures, ...sizzleSummary(s) }
})
sizzleTool('view_sizzle_capture', 'One capture of a sizzle (hero, screen-N, mobile, logo or image-N) as a picture, to look at before choosing it for a screen scene.', { sizzleId: z.string(), name: z.string(), width: z.number().int().min(240).max(1600).default(960) }, async ({ sizzleId, name, width }) => {
  const s = sizzles.get(sizzleId)
  const file = s.site.captures.find((c) => c.name === name)?.file || s.site.images[Number(String(name).split('-')[1]) - 1]?.file
  if (!file || !fs.existsSync(file)) throw new Error(`No capture ${name}.`)
  return { pictures: [await sizzlePicture([file], { width })], name, file }
})
tool('list_sizzles', 'Website sizzles, newest first: site, status (planning, approved, rendering, ready, editing), scenes and the finished film once Shinobi has rendered it.', {}, () => ({ items: sizzles.list() }))
tool('get_sizzle', 'A sizzle, brought up to date: the site capture, the storyboard, each scene\'s piece (status, file), the music and voice-over, and the Shinobi film. Call it to move rendering along: a finished H3 preview is finished at 1 MP here.', { sizzleId: z.string() }, async ({ sizzleId }) => sizzleSummary(await sizzles.refresh(sizzleId)))
tool('save_sizzle_plan', `Website sizzle, step 2: the storyboard. Scenes play in order: h3 (an H3 shot from prompt, ${'3-8 or 10'} s; character "none" or a preset), image (a Z-Image picture from prompt, shown with camera motion), screen (one of the site's captures, e.g. hero, screen-3, mobile, image-2) and title (words on screen, from the site's own copy). music: {engine minimax|ace, caption, lyrics?, instrumental?}. voiceover (optional): {voiceId, lines}. Saving resets approval. Then show the person the storyboard and wait for their OK.`, {
  sizzleId: z.string(),
  plan: z.object({
    scenes: z.array(z.object({ id: z.string().optional(), kind: z.enum(SCENE_KINDS), seconds: z.number(), prompt: z.string().optional(), character: z.string().optional(), capture: z.string().optional(), text: z.string().optional(), note: z.string().optional() })).min(2),
    music: z.object({ engine: z.enum(['minimax', 'ace']).default('minimax'), caption: z.string(), lyrics: z.string().optional(), instrumental: z.boolean().optional(), seconds: z.number().optional() }),
    voiceover: z.object({ voiceId: z.string(), lines: z.array(z.string()) }).optional(),
    notes: z.string().optional()
  })
}, ({ sizzleId, plan }) => sizzleSummary(sizzles.savePlan(sizzleId, plan)))
tool('approve_sizzle_plan', 'Record that the person approved the storyboard. Only call this after they said yes to it (or approve it on the Sizzle page themselves).', { sizzleId: z.string() }, ({ sizzleId }) => sizzleSummary(sizzles.approve(sizzleId)))
tool('make_sizzle_assets', 'Website sizzle, step 3: make the pieces on this PC from the approved storyboard: the voice-over, Z-Image pictures, the music, and one H3 preview per shot (each finished at 1 MP once its preview is done). Free and local, but it takes the GPU for a while (about 3-5 min per H3 shot). Poll get_sizzle until status is ready.', { sizzleId: z.string() }, async ({ sizzleId }) => sizzleSummary(await sizzles.makeAssets(sizzleId)))
tool('sizzle_to_shinobi', "Website sizzle, step 4: put every piece (shots, pictures, the site's screens and logo, music, voice-over) into a Shinobi project with a brief (iv-brief.md: the site's copy, colours, fonts, the storyboard and how to cut it). Use it to cut from scratch with the shinobi tools (read_guide agent and timeline first); sizzle_first_cut does this and cuts a first version for you.", { sizzleId: z.string() }, async ({ sizzleId }) => {
  const r = await sizzles.toShinobi(sizzleId)
  return { ...sizzleSummary(r), shinobi: r.shinobi, brief: r.brief }
})
sizzleTool('sizzle_first_cut', "Website sizzle, step 5: IV Studio cuts the film itself from the approved storyboard and saves it as the Shinobi project's timeline: cuts on the music's beat, the site's screens with slow push-ins, two-tone titles in the site's colours (Barlow Condensed), and an end card on the logo, the main button's words and the web address, ending where the music ends. Returns a frame from every scene to look at. render: true renders it too (about 2-3 min; get_sizzle shows the film when it's done). Then refine it with the shinobi tools if anything needs work; cutting again replaces the timeline.", { sizzleId: z.string(), render: z.boolean().default(false).describe('Render the film as well') }, async ({ sizzleId, render }) => {
  const r = await sizzles.firstCut(sizzleId, { render })
  const f = SIZZLE_FORMATS[r.format]
  const frames = (r.cut.previews || []).filter((x) => fs.existsSync(x))
  const pictures = frames.length ? [await sizzlePicture(frames, { width: f.width >= f.height ? 480 : 270, tile: [4, Math.ceil(frames.length / 4)], aspect: f.width / f.height })] : []
  return { pictures, ...sizzleSummary(r), shinobi: r.shinobi, warnings: r.warnings }
})
tool('delete_sizzle', 'Delete a sizzle and its capture (renders, songs and the Shinobi film stay). Ask the person first.', { sizzleId: z.string() }, ({ sizzleId }) => sizzles.remove(sizzleId))

// ---------- LoRAs: Civitai's H3 LoRAs and the ones on this PC ----------
// Downloads use CIVITAI_API_KEY from this server's environment (the app keeps its own key encrypted).
// Mature LoRAs only when the person has turned them on in the app (Settings > Civitai).
const civitai = new Civitai({ dataDir: DATA, comfy: new Comfy(readSettings(BASE).comfyUrl), key: () => process.env.CIVITAI_API_KEY || null, mature: () => !!readSettings(BASE).civitaiMature })
tool('search_loras', `Search Civitai for MiniMax H3 LoRAs (styles, looks, motion, speed). Returns cards: name, file size, downloads, trigger words, preview clip URLs and whether it's installed. tag: ${LORA_TAGS.filter(([t]) => t).map(([t]) => t).join(', ')}. Real-person LoRAs are never returned; mature ones only if the person turned them on in the app.`, {
  query: z.string().optional(),
  tag: z.string().optional(),
  sort: z.enum(LORA_SORTS).default(LORA_SORTS[0]),
  cursor: z.string().optional().describe('next from the previous page'),
  limit: z.number().int().min(1).max(50).default(12)
}, (a) => civitai.search(a))
tool('get_lora', 'One Civitai LoRA in full: versions (each with its file, trigger words and preview clips), licence (commercial use, credit) and the maker’s notes.', { modelId: z.number().int() }, ({ modelId }) => civitai.model(modelId))
tool('download_lora', 'Download a Civitai LoRA version into ComfyUI’s loras folder (Civitai/<model>/), checked against Civitai’s SHA-256. Needs CIVITAI_API_KEY in this server’s environment; ask the person first, and check the licence (get_lora) for commercial work. Returns the LoRA name to use in generate_previews extraLoras, and its trigger words.', { modelId: z.number().int(), versionId: z.number().int().optional() }, (a) => civitai.download(a))
tool('list_my_loras', 'The LoRAs ComfyUI can load, with what IV Studio knows about each: H3 or not, Civitai name, trigger words, preview, and the person’s favourite and default strength.', { h3Only: z.boolean().default(true) }, async ({ h3Only }) => ({ items: (await civitai.yours()).filter((x) => !h3Only || x.h3) }))
tool('identify_lora', 'Find an installed LoRA on Civitai by its file’s SHA-256 (name from list_my_loras): its Civitai name, base model, trigger words and a preview. Takes a few seconds per GB.', { name: z.string() }, ({ name }) => civitai.identify(name))

const catalog = new CharacterCatalog({ studio, voices, resourcesDir: resourcesDir() })
tool('list_ready_characters', "IV Studio's ready-made characters (Tess, Theo…): who they are, their face picture's path, and whether they're downloaded and usable.", {}, () => catalog.list())
tool('install_ready_character', 'Download a ready-made character (its LoRA, about 150 MB, into ComfyUI) and add it as a character preset.', { id: z.string() }, async ({ id }) => (await catalog.install(id)).find((c) => c.id === id))
tool('delete_character', 'Remove a character preset (the LoRA file stays). Ask the person first.', { id: z.string() }, ({ id }) => {
  const list = studio.characters()
  if (!list.some((c) => c.id === id)) throw new Error(`No character ${id}.`)
  return studio.saveCharacters(list.filter((c) => c.id !== id))
})

server.connect(new StdioServerTransport()).catch((err) => {
  console.error('IV Studio MCP server failed to start:', err)
  process.exit(1)
})
