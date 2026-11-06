// IV Studio service: the one place both the studio window and the MCP server go through.
// Projects, jobs and characters live as JSON in the data folder, so either process can pick up the
// other's work. ComfyUI does the rendering; this records what was asked, what ran and what came out.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { Comfy } from './comfy.js'
import { probe } from './media.js'
import { buildPrompt, checkPrompt } from './graph.js'
import { planFinish, planPreviews } from './plan.js'
import { adaptGraph, capabilities, withLivePreview } from './remote.js'
import { Cast, resolveMentions } from './cast.js'
import { contextIrGraph, fromContextIr, writeHarness, writeLocal, writeStoryLocal } from './prompter.js'
import { renderOutGraph, retakeGraph, SAVES, SEQUENCE_DEFAULTS, takeGraph, validateSequence } from './sequence.js'
import { checkSetup, comboOptions, modelFileMap } from './setup.js'
import { comfyPlace, installPacks, missingPacks } from './nodepacks.js'
import { checkUpdates, copySnapshot, MANAGER_PACK, packFolders, readRecord, reenable, restart, undo, update, writeRecord } from './comfyupdate.js'
import { comfyUp, isDesktopLauncher, isLocalUrl } from './comfylauncher.js'

// A new shot's name from its prompt: the first words of [Shot 1] (not "subject_definitions" or the frames line),
// without the style opener, with {char} as the character's first name.
export function shotName(prompt, character) {
  const text = String(prompt || '')
  // where the shot itself starts, not "(appears in [Shot 1])"
  const first = text.match(/(?:^|\n|description:)\s*\[Shot 1\]\s*([^\n]+)/)?.[1] ?? text.replace(/^[a-z_]+:\s*/gim, '')
  let s = first.replace(/\{char\}/g, character?.name?.split(/\s+/)[0] || 'Someone').replace(/<[^>]+>|\s*\(S\d+\)/g, '').replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 4; i++) s = s.replace(/^(?:3d\s+)?(?:live-action|cinematic|realistic|photorealistic|animated|documentary|film(?:ic)?|natural)[^,.;]*[,.;]\s*/i, '')
  s = s.charAt(0).toUpperCase() + s.slice(1)
  return s.length > 40 ? `${s.slice(0, 40).replace(/\s+\S*$/, '')}…` : s || 'Untitled shot'
}

// the bundled ffprobe, outside the asar in a packaged app
const FFPROBE = ffmpegStatic.ffprobePath?.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)

const DEFAULT_CHARACTERS = [
  { id: 'tess', name: 'Tess Marlow', lora: 'MiniMax H3\\tess\\tess_mmh3-000040.safetensors', strength: 0.8, trigger: 't3ss4', voiceRefmod: 'characters/tess_audio', visualRefmod: 'characters/tess_visual' }
]
const PREVIEW_SAVES = { 1: '42', 2: '118', 3: '128' }
// The model family a job loads. Before a job, ComfyUI drops what a job of another family left loaded, so two
// big models never share the GPU (Z-Image or MiniMax Music next to H3 overflows a 24 GB card and 64 GB of RAM).
// Jobs of the same family keep their models: a finish reuses its preview's cached latent.
// Create -> Image jobs are 'picture:<family>' (see images.js), so switching image models unloads too.
const FAMILIES = { music: 'music', still: 'image', enhance: 'seedvr2', cutout: 'sam' }
const familyOf = (kind) => FAMILIES[kind] || (String(kind).startsWith('picture:') ? String(kind) : 'h3')
// The UNETLoader each mode of the IV Studio workflow uses (Settings can swap its model).
export const MODEL_NODES = { text: '101', frames: '201', reference: '301', continue: '601' }

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2))
  fs.renameSync(`${file}.tmp`, file)
}
const slug = (s) => (s || 'shot').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'shot'
const now = () => new Date().toISOString()

// SeedVR2 models for Enhance, best first: what's in ComfyUI's SEEDVR2 folder decides.
const ENHANCE_MODELS = ['seedvr2_ema_3b_fp16.safetensors', 'seedvr2_ema_3b_fp8_e4m3fn.safetensors', 'seedvr2_ema_3b-Q8_0.gguf']
// Frames per SeedVR2 batch (4n+1) by output size, sized for a 24 GB card: 21 at 1440 spilled into shared memory
// (16 min for 5 s) and ran out of memory at 2160 after 41 min. Bigger outputs take smaller batches and, at 4K,
// swap half the DiT's blocks to the CPU.
export const seedvr2Batch = (resolution) =>
  resolution > 1440 ? { batch: 5, overlap: 1, swap: 16 } : resolution > 1080 ? { batch: 9, overlap: 2, swap: 0 } : { batch: 21, overlap: 3, swap: 0 }

export class Studio {
  // models: { text, frames, reference, continue, take, retake } -> a UNET name per workflow (Settings).
  constructor({ dataDir, resourcesDir, comfyUrl, comfyToken = null, comfyApiKey = null, outputDir, models = null }) {
    this.models = models || {}
    this.dataDir = dataDir
    this.resourcesDir = resourcesDir
    this.template = JSON.parse(fs.readFileSync(path.join(resourcesDir, 'workflows', 'iv_studio_api.json'), 'utf8'))
    this.meta = JSON.parse(fs.readFileSync(path.join(resourcesDir, 'workflows', 'iv_studio_api.groups.json'), 'utf8'))
    this.manifest = JSON.parse(fs.readFileSync(path.join(resourcesDir, 'models.json'), 'utf8'))
    this.comfy = new Comfy(comfyUrl, `iv-studio-${randomUUID().slice(0, 8)}`, comfyToken, comfyApiKey)
    this.comfy.fileMapper = () => this.modelFiles()
    this.outputDir = outputDir || null
    this.progress = new Map() // promptId -> {value, max, node}
    this.live = new Map() // promptId -> the latest live preview step { image (data URL), step, total, take, at }
    this.running = null // the prompt ComfyUI is executing now, from its websocket
    this.cast = new Cast({ dataDir, characters: () => this.characters(), facePicture: (c) => this.facePicture(c, resourcesDir) })
  }

  // A character's face picture: its own, else the ready-made catalogue's (resources/characters).
  facePicture(ch, resourcesDir) {
    if (ch?.picture && fs.existsSync(ch.picture)) return ch.picture
    try {
      const dir = path.join(resourcesDir, 'characters')
      const ready = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8')).characters.find((c) => c.id === ch?.id)
      const file = ready?.picture && path.join(dir, ready.picture)
      return file && fs.existsSync(file) ? file : null
    } catch {
      return null
    }
  }

  // ---------- characters ----------
  characters() {
    return readJson(path.join(this.dataDir, 'characters.json'), DEFAULT_CHARACTERS)
  }
  saveCharacters(list) {
    writeJson(path.join(this.dataDir, 'characters.json'), list)
    return list
  }

  // ---------- projects ----------
  projectFile = (id) => path.join(this.dataDir, 'projects', `${id}.json`)
  listProjects() {
    const dir = path.join(this.dataDir, 'projects')
    if (!fs.existsSync(dir)) return []
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson(path.join(dir, f), null))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  getProject(id) {
    const p = readJson(this.projectFile(id), null)
    if (!p) throw new Error(`No project ${id}`)
    return p
  }
  // sequenceId / trainingId / tool: the project holds a sequence's shots, a character training's renders or a
  // workflow's runs (tool 'replace'), and stays out of Shots.
  createProject(name, sequenceId = null, trainingId = null, tool = null) {
    const p = { id: randomUUID().slice(0, 8), name: name || 'Untitled shot', createdAt: now(), updatedAt: now(), jobs: [], sequenceId, ...(trainingId && { trainingId }), ...(tool && { tool }) }
    writeJson(this.projectFile(p.id), p)
    return p
  }
  touchProject(id, jobId) {
    const p = this.getProject(id)
    if (jobId && !p.jobs.includes(jobId)) p.jobs.push(jobId)
    p.updatedAt = now()
    writeJson(this.projectFile(id), p)
    return p
  }
  // A shot and its run history. The rendered videos stay in ComfyUI's output folder.
  deleteProject(id) {
    const p = this.getProject(id)
    for (const j of p.jobs) fs.rmSync(this.jobFile(j), { force: true })
    fs.rmSync(this.projectFile(id), { force: true })
    return true
  }
  renameProject(id, name) {
    const p = this.getProject(id)
    p.name = name
    writeJson(this.projectFile(id), p)
    return p
  }

  // ---------- setup ----------
  // The required models this ComfyUI has in another version than IV Studio's own (setup.js modelFileMap), read
  // from just their loader nodes.
  async modelFiles() {
    const classes = [...new Set(this.manifest.models.filter((m) => !m.optional).flatMap((m) => [m.loader, m.altLoader].filter(Boolean).map((l) => l.split('.')[0])))]
    const info = Object.assign({}, ...(await Promise.all(classes.map((c) => this.comfy.objectInfo(c).catch(() => ({}))))))
    return modelFileMap(this.manifest, info, this.models)
  }

  // An unreachable ComfyUI still reports remote, so the title bar keeps its cloud badge and GPU meter.
  async checkSetup() {
    let result
    try {
      result = await checkSetup({ comfy: this.comfy, template: this.template, manifest: this.manifest, characters: this.characters(), chosen: this.models })
      this.comfy.fileMap = null
    } catch (err) {
      return { ready: false, items: [{ id: 'comfyui', label: 'ComfyUI', status: 'missing', detail: err.message }], remote: this.comfy.remote, hosted: this.comfy.hosted }
    }
    if (result.items[0]?.status === 'ok') result.caps = await this.capabilities(true).catch(() => null)
    return { ...result, remote: this.comfy.remote, hosted: this.comfy.hosted }
  }

  // Adds the node packs this ComfyUI is missing (nodepacks.js), at the versions IV Studio is tested with. folder: the
  // ComfyUI folder picked in Settings, used when ComfyUI doesn't say where custom_nodes is. Restart ComfyUI afterwards.
  async installNodePacks({ folder, onProgress } = {}) {
    if (this.comfy.remote) throw new Error('Node packs for the cloud are installed by IV Studio’s cloud setup, not here.')
    let info, stats
    try {
      ;[info, stats] = await Promise.all([this.comfy.objectInfo(), this.comfy.systemStats()])
    } catch {
      throw new Error('Start ComfyUI first: IV Studio asks it which nodes it already has and where its custom_nodes folder is.')
    }
    const packs = missingPacks(this.manifest, info, { linux: !['nt', 'win32'].includes(stats.system?.os) })
    if (!packs.length) return { results: [], restart: false }
    const place = await comfyPlace(this.comfy, folder)
    const results = await installPacks(packs, { ...place, resourcesDir: this.resourcesDir, onProgress })
    return { customNodes: place.customNodes, python: place.python, results, restart: results.some((r) => r.status === 'installed') }
  }

  // ---------- updating ComfyUI, its node packs and ComfyUI-Manager (comfyupdate.js) ----------
  // Only a ComfyUI on this PC. launcher: the one IV Studio starts ComfyUI with (comfylauncher.js launcherFor), to tell
  // the ComfyUI Desktop app (which updates ComfyUI and Manager itself) from the rest.
  localOnly() {
    if (this.comfy.remote || !isLocalUrl(this.comfy.url)) throw new Error('Updates run on this PC’s ComfyUI only.')
  }

  // A ComfyUI without ComfyUI-Manager answers { manager: { present: false } } (the window offers to install it).
  async comfyUpdates({ launcher = null } = {}) {
    this.localOnly()
    const desktop = isDesktopLauncher(launcher)
    try {
      return { ...(await checkUpdates(this.comfy, { desktop })), last: readRecord(this.dataDir) }
    } catch (err) {
      if (err.code === 'missing') return { manager: { present: false, version: null, policy: null }, desktop, last: readRecord(this.dataDir) }
      throw err
    }
  }

  // Snapshot, update everything, restart, and record what happened for Undo. onProgress: { phase, done, total }.
  async updateComfy({ folder = null, launcher = null, onProgress = () => {} } = {}) {
    this.localOnly()
    await this.beforeRender?.() // the voice engine gives its GPU back, as before a render
    const place = await comfyPlace(this.comfy, folder)
    const comfyRoot = path.dirname(place.customNodes)
    const before = (await this.comfy.systemStats()).system?.comfyui_version || null
    // the packs switched on now: Undo switches back on any that Manager's restore switches off (comfyupdate.js reenable)
    const enabledPacks = packFolders(place.customNodes)
    const { snapshot, results, reported } = await update(this.comfy, { desktop: isDesktopLauncher(launcher), onProgress })
    const record = { snapshot, snapshotCopy: copySnapshot(this.dataDir, comfyRoot, snapshot), comfyRoot, customNodes: place.customNodes, enabledPacks, at: new Date().toISOString(), comfyuiBefore: before, comfyuiAfter: null, results, reported }
    writeRecord(this.dataDir, record) // before the restart, so Undo works even if ComfyUI doesn't come back
    onProgress({ phase: 'restarting' })
    const { version } = await restart(this.comfy)
    record.comfyuiAfter = version
    // Manager says success-stable-vX for ComfyUI even when it was on vX already
    const core = record.results.find((r) => r.pack === 'comfyui')
    if (core?.status === 'updated' && before && before === version) Object.assign(core, { status: 'current', message: null })
    writeRecord(this.dataDir, record)
    await this.capabilities(true).catch(() => null)
    onProgress({ phase: 'done' })
    return record
  }

  // Puts the last update's snapshot back and restarts ComfyUI, then switches back on the packs Manager's restore
  // switched off (plain folders a snapshot can't track, IV Studio's own pack among them) and restarts once more.
  // start: starts ComfyUI with the person's launcher (the app passes its own); without it, a ComfyUI that was down
  // reports startNeeded, and calling this again once ComfyUI is up finishes the job.
  async undoComfyUpdate({ folder = null, start = null, onProgress = () => {} } = {}) {
    this.localOnly()
    const record = readRecord(this.dataDir)
    if (!record?.snapshot) throw new Error('There’s no update to undo.')
    const isUp = await comfyUp(this.comfy.url, 2000)
    let comfyRoot = record.comfyRoot || null
    if (isUp) comfyRoot = path.dirname((await comfyPlace(this.comfy, folder)).customNodes)
    else if (!comfyRoot && folder) comfyRoot = fs.existsSync(path.join(folder, 'ComfyUI')) ? path.join(folder, 'ComfyUI') : folder
    const customNodes = record.customNodes || (comfyRoot && path.join(comfyRoot, 'custom_nodes'))
    // after the restore ran: switch the packs back on, restart if any moved
    const finish = async (via) => {
      const reenabled = customNodes ? reenable(customNodes, record.enabledPacks || []) : []
      let version = (await this.comfy.systemStats()).system?.comfyui_version || null
      if (reenabled.length) {
        onProgress({ phase: 'restarting' })
        version = (await restart(this.comfy)).version
      }
      writeRecord(this.dataDir, { ...record, restorePending: false, undoneAt: new Date().toISOString() })
      await this.capabilities(true).catch(() => null)
      onProgress({ phase: 'done' })
      return { via, version, snapshot: record.snapshot, reenabled }
    }
    if (isUp && record.restorePending) return finish('file') // the restore ran when ComfyUI last started
    onProgress({ phase: 'restoring' })
    const { via } = await undo(this.comfy, record, { comfyRoot })
    if (via === 'api') {
      onProgress({ phase: 'restarting' })
      await restart(this.comfy)
      return finish(via)
    }
    writeRecord(this.dataDir, { ...record, restorePending: true })
    if (!start) return { via, startNeeded: true, snapshot: record.snapshot }
    onProgress({ phase: 'restarting' })
    await start()
    return finish(via)
  }

  // ComfyUI-Manager itself, for a ComfyUI that hasn't got it (it registers no nodes, so Setup's node check can't see it).
  async installManager({ folder = null, onProgress } = {}) {
    this.localOnly()
    const place = await comfyPlace(this.comfy, folder)
    const results = await installPacks([MANAGER_PACK], { ...place, resourcesDir: this.resourcesDir, onProgress })
    return { results, restart: results.some((r) => r.status === 'installed') }
  }

  // What the connected ComfyUI can do (Linux paths, DLSS or the cloud's upscale + RIFE); cached.
  async capabilities(refresh = false) {
    if (!this._caps || refresh) {
      const [info, stats] = await Promise.all([this.comfy.objectInfo(), this.comfy.systemStats()])
      this._caps = capabilities(info, stats)
    }
    return this._caps
  }

  // ---------- planning ----------
  // With @ mentions resolved as a render would (cast.js); notes says what they turned into.
  planRender(asked, finish) {
    const { request, notes } = resolveMentions(asked, this.cast.members())
    const plan = planPreviews(request, this.characters())
    const out = { resolved: plan.resolved, groups: plan.groups, notes, mode: request.mode }
    if (finish !== false) out.finish = planFinish(plan, { candidate: 1, ...(finish || {}) }).resolved
    return out
  }

  // Local files (absolute paths) are uploaded into ComfyUI's input folder; names already in input pass through.
  async stage(file, sub) {
    if (!file) return file
    if (/^[a-zA-Z]:[\\/]|^\//.test(file)) {
      if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`)
      return this.comfy.upload(file, sub)
    }
    return file
  }

  // characterOverride: a character that isn't a saved preset (a training's checkpoint under test).
  async generatePreviews(input) {
    const { projectId, projectName, characterOverride, ...asked } = input
    // @ mentions (cast.js): the picked character's becomes {char}; anyone or anywhere else with a picture is attached
    const { request, notes } = resolveMentions(asked, this.cast.members())
    const unknown = notes.filter((n) => n.level === 'error')
    if (unknown.length) throw new Error(unknown.map((n) => n.message).join(' '))
    const project = projectId ? this.getProject(projectId) : this.createProject(projectName || shotName(request.prompt, this.characters().find((c) => c.id === request.character)))
    const media = []
    for (const m of request.media || []) {
      // H3's media loader refuses a video without sound when it's told to pair it (a previs, a silent clip)
      const local = m.file || m.path
      const sound = m.kind === 'video' && m.hasAudio === undefined && local && fs.existsSync(local) ? { hasAudio: (await probe(FFPROBE, local).catch(() => null))?.hasAudio ?? true } : {}
      media.push({ ...m, ...sound, file: await this.stage(local, 'minimax_h3') })
    }
    const voiceLine = request.voiceLine ? await this.stage(request.voiceLine, 'iv_studio') : null
    const characters = characterOverride ? [...this.characters(), characterOverride] : this.characters()
    const plan = planPreviews({ ...request, media, voiceLine, ...(characterOverride && { character: characterOverride.id }) }, characters)
    const unet = this.models[plan.request.mode]
    if (unet) plan.values[`${MODEL_NODES[plan.request.mode]}.unet_name`] = unet
    // the run keeps what was asked as written (mentions and all, media as local files), for "Edit and run again"
    plan.asked = { prompt: asked.prompt, mode: asked.mode, media: (asked.media || []).map((m) => ({ kind: m.kind, file: m.file || m.path })), voiceLine: asked.voiceLine || null }
    const run = project.jobs.length + 1
    const name = `${slug(project.name)}_${project.id}_r${run}`
    plan.values['80'] = name
    return this.submit({ kind: 'previews', project, plan, name })
  }

  // What a finish of this previews job would produce, without rendering.
  planFinishJob(jobId, finish) {
    const source = this.getJob(jobId)
    if (source.kind !== 'previews') throw new Error('Needs a previews job id.')
    return planFinish(source.plan, finish).resolved
  }

  async finishCandidate({ jobId, ...finish }) {
    const source = this.getJob(jobId, { refresh: false })
    if (source.kind !== 'previews') throw new Error('finish_candidate needs a previews job id.')
    const caps = await this.capabilities()
    if (finish.fps && !caps.fps.includes(finish.fps)) throw new Error(`This ComfyUI can make ${caps.fps.filter(Boolean).join(', ') || 'no other'} fps.`)
    if (finish.upscale2x && !caps.upscale2x && finish.enhancer !== 'seedvr2') throw new Error('This ComfyUI has no 2x upscaler.')
    if (finish.enhancer === 'seedvr2' && this.comfy.remote) throw new Error('SeedVR2 runs on this PC\'s ComfyUI only; the cloud finishes with its own upscaler.')
    const plan = planFinish(source.plan, finish)
    plan.values['80'] = source.name
    return this.submit({ kind: 'finish', project: this.getProject(source.projectId), plan, name: source.name, parent: source.id, previewPlan: source.plan })
  }

  async submit({ kind, project, plan, name, parent, previewPlan }) {
    let prompt = buildPrompt(this.template, this.meta, plan.groups, plan.values)
    // live previews of each step (remote.js), on this PC only: the cloud has no websocket to send them over
    if (kind === 'previews' && this.livePreview !== false && !this.comfy.remote && (await this.capabilities()).livePreview) prompt = withLivePreview(prompt)
    return this.submitGraph({ kind, graph: prompt, projectId: project.id, plan, name, parent, previewPlan })
  }

  // Before a render on this PC: IV Studio's own GPU users stop (beforeRender, set by the app and the MCP
  // server: the voice engine), and ComfyUI unloads if the job before this one, IV Studio's or anyone's, was
  // another model family. ComfyUI applies the unload between prompts, never inside one.
  async makeRoom(kind) {
    if (this.comfy.remote) return
    await this.beforeRender?.()
    if ((await this.lastFamily().catch(() => null)) !== familyOf(kind)) await this.comfy.freeMemory().catch(() => {})
  }
  // The family of the last job queued on ComfyUI, or of the last one it ran; 'other' for work that isn't IV Studio's.
  async lastFamily() {
    const q = await this.comfy.queue()
    const queued = [...q.queue_running, ...q.queue_pending].sort((a, b) => a[0] - b[0]).at(-1)
    const last = queued || Object.values(await this.comfy.req('/history?max_items=1'))[0]?.prompt
    if (!last) return null
    const kind = last[3]?.iv_studio?.kind
    return kind ? familyOf(kind) : 'other'
  }

  // Queues any graph and records it as a job. Sequence graphs carry plan.saves so their outputs can be read.
  async submitGraph({ kind, graph: built, projectId = null, sequenceId = null, plan, name, parent, previewPlan }) {
    const caps = await this.capabilities()
    // a finish SeedVR2 will enhance skips DLSS 5 (remote.js swaps its node for a plain save, as on the cloud)
    const graph = adaptGraph(built, plan?.finish?.enhancer === 'seedvr2' ? { ...caps, dlss: false, upscale2x: false, rife: false } : caps, { upscaleSize: plan?.resolved?.upscaleSize })
    const problems = checkPrompt(graph)
    if (problems.length) throw new Error(`Internal graph error: ${problems.join('; ')}`)
    await this.makeRoom(kind)
    const promptId = await this.comfy.submit(graph, { iv_studio: { kind, project: projectId, sequence: sequenceId } })
    const job = {
      id: randomUUID().slice(0, 12),
      kind,
      projectId,
      sequenceId,
      parent: parent || null,
      name,
      promptId,
      status: 'queued',
      createdAt: now(),
      plan: kind === 'previews' ? plan : { ...plan, preview: undefined },
      previewPlan: previewPlan || undefined,
      outputs: []
    }
    writeJson(this.jobFile(job.id), job)
    if (projectId) this.touchProject(projectId, job.id)
    return this.publicJob(job)
  }

  // ---------- Enhance: SeedVR2 over a finished video ----------
  // A final (or any finished video of a shot) through SeedVR2 3B (numz's ComfyUI-SeedVR2_VideoUpscaler, Apache-2.0)
  // to a short side of `resolution`, with its sound kept, as a new job of kind enhance in the same shot. On this PC
  // only: the cloud image has no SeedVR2.
  // engine dlss: DLSS 5 with the finish's own settings (noise reduction Default 0.8), at scale 1 or 2.
  async enhanceFinal({ jobId, engine = 'seedvr2', resolution = 1080, scale = 1 }) {
    if (this.comfy.remote) throw new Error('Enhance runs on this PC\'s ComfyUI only.')
    const source = this.getJob(jobId)
    const out = source.outputs.find((o) => o.kind === 'final') || source.outputs.find((o) => o.kind === 'master')
    if (!out?.path || !fs.existsSync(out.path)) throw new Error('That render has no finished video on this PC to enhance.')
    if (engine === 'dlss') return this.enhanceDlss(source, out, scale)
    const info = await this.comfy.objectInfo('SeedVR2LoadDiTModel').catch(() => null)
    const dits = info?.SeedVR2LoadDiTModel?.input?.required?.model?.[1]?.options || info?.SeedVR2LoadDiTModel?.input?.required?.model?.[0] || []
    if (!info?.SeedVR2LoadDiTModel) throw new Error('SeedVR2 isn\'t installed in ComfyUI (ComfyUI-SeedVR2_VideoUpscaler).')
    const dit = ENHANCE_MODELS.find((m) => dits.includes(m)) || dits[0]
    const fps = source.plan?.resolved?.fps || 24
    const name = `${path.basename(out.path).replace(/\.[^.]+$/, '').replace(/-audio$/, '')}_enhanced_${resolution}`
    const { batch, overlap, swap } = seedvr2Batch(resolution)
    const graph = {
      load: { class_type: 'VHS_LoadVideoPath', inputs: { video: out.path, force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1, format: 'AnimateDiff' } },
      dit: { class_type: 'SeedVR2LoadDiTModel', inputs: { model: dit, device: 'cuda:0', blocks_to_swap: swap, offload_device: 'cpu', cache_model: false, attention_mode: 'sdpa' } },
      vae: { class_type: 'SeedVR2LoadVAEModel', inputs: { model: 'ema_vae_fp16.safetensors', device: 'cuda:0', encode_tiled: true, decode_tiled: true, offload_device: 'cpu', cache_model: false } },
      up: { class_type: 'SeedVR2VideoUpscaler', inputs: { image: ['load', 0], dit: ['dit', 0], vae: ['vae', 0], seed: 42, resolution, max_resolution: 0, batch_size: batch, uniform_batch_size: false, color_correction: 'lab', temporal_overlap: overlap, offload_device: 'cpu' } },
      save: { class_type: 'VHS_VideoCombine', inputs: { images: ['up', 0], audio: ['load', 2], frame_rate: fps, loop_count: 0, filename_prefix: `H3/enhanced/${name}`, format: 'video/h264-mp4', pix_fmt: 'yuv420p', crf: 16, save_metadata: true, trim_to_audio: false, pingpong: false, save_output: true } }
    }
    const project = source.projectId ? this.getProject(source.projectId) : null
    return this.submitGraph({ kind: 'enhance', graph, projectId: project?.id || null, plan: { enhance: { engine: 'seedvr2', resolution, model: dit, from: out.path }, resolved: { ...source.plan?.resolved, fps } }, name, parent: source.id })
  }

  async enhanceDlss(source, out, scale) {
    if (!(await this.capabilities()).dlss) throw new Error('DLSS 5 isn\'t installed in ComfyUI.')
    const name = `${path.basename(out.path).replace(/\.[^.]+$/, '').replace(/-audio$/, '')}_dlss_${scale}x`
    const t = this.template['50'].inputs
    const graph = {
      dlss: { class_type: 'DLSS5_Enhance_Video', inputs: { ...t, 'Video Path': out.path, Scale: scale, 'Target FPS': 0, 'Filename Prefix': name, 'Output Directory': 'H3/enhanced', 'Input FPS': source.plan?.resolved?.fps || 24 } },
      out: { class_type: 'PreviewAny', inputs: { source: ['dlss', 0] } }
    }
    const project = source.projectId ? this.getProject(source.projectId) : null
    return this.submitGraph({ kind: 'enhance', graph, projectId: project?.id || null, plan: { enhance: { engine: 'dlss', scale, from: out.path }, resolved: source.plan?.resolved }, name, parent: source.id })
  }

  // ---------- renders, files and models (shared by the window and the MCP server) ----------
  // An output as a file on this PC: its own path when local, else downloaded from the (cloud)
  // ComfyUI into dir under the same name.
  async localCopy(file, dir) {
    const p = typeof file === 'string' ? file : file?.path
    if (p && fs.existsSync(p)) return p
    if (!file?.url) throw new Error('That file is not on this PC.')
    const u = new URL(file.url)
    const dest = path.join(dir, u.searchParams.get('filename'))
    if (!fs.existsSync(dest)) {
      const res = await fetch(`${this.comfy.url}/view${u.search}`, { headers: this.comfy.headers() })
      if (!res.ok) throw new Error(`Download failed (${res.status}).`)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(`${dest}.part`, Buffer.from(await res.arrayBuffer()))
      fs.renameSync(`${dest}.part`, dest)
    }
    return dest
  }

  // Every IV Studio render, newest first: shot finals and previews, sequence versions and finals.
  library() {
    const items = []
    for (const p of this.listProjects()) {
      if (p.trainingId) continue // a character training's test renders
      const jobs = this.listJobs(p.id)
      // a shot hunted more than once numbers its runs, so two takes never share the label "Preview 1"
      const byAge = (a, b) => String(a.createdAt).localeCompare(String(b.createdAt))
      const runs = new Map(jobs.filter((j) => j.kind === 'previews').sort(byAge).map((j, i) => [j.id, i + 1]))
      // several finishes of one run read Final, Final 2...; an enhanced final keeps its finish's name plus how
      const finishes = new Map()
      for (const j of jobs.filter((x) => x.kind === 'finish').sort(byAge)) {
        const n = jobs.filter((x) => x.kind === 'finish' && x.parent === j.parent && byAge(x, j) < 0).length + 1
        finishes.set(j.id, { run: j.parent, name: n > 1 ? `Final ${n}` : 'Final' })
      }
      const enhanced = (e) => (e?.engine === 'dlss' ? `DLSS 5 ${e.scale}×` : `SeedVR2 ${e?.resolution || ''}p`)
      for (const j of jobs) {
        for (const o of j.outputs || []) {
          if (!['final', 'preview'].includes(o.kind)) continue
          // a finish whose cached latent was dropped renders its preview again: the run already shows that take
          if (o.kind === 'preview' && j.kind !== 'previews' && runs.has(j.parent)) continue
          // set: the shot (or the sequence a shot render belongs to), so its takes show as one tile
          const fin = finishes.get(j.kind === 'enhance' ? j.parent : j.id)
          const runRaw = runs.size > 1 && runs.get(j.kind === 'previews' ? j.id : fin?.run ?? j.parent)
          const run = runRaw || 0
          const name = o.kind !== 'final' ? `Preview ${o.candidate}` : j.kind === 'enhance' ? `${fin?.name || 'Final'} · ${enhanced(j.plan?.enhance)}` : fin?.name || 'Final'
          const variant = `${run ? `Run ${run} · ` : ''}${name}`
          items.push({ key: `${j.id}:${o.kind}:${o.candidate || ''}`, label: `${p.name} · ${variant.toLowerCase()}`, group: p.tool === 'replace' ? 'Replace' : p.sequenceId ? 'Sequence shots' : 'Shots', at: j.finishedAt || j.createdAt, file: { path: o.path, url: o.url, filename: o.filename }, set: p.sequenceId ? `sequence:${p.sequenceId}` : `project:${p.id}`, setName: p.name.replace(/ \(sequence\)$/, ''), variant: p.sequenceId ? `Shot ${variant.toLowerCase()}` : variant, rank: (o.kind === 'final' ? 0 : 10 + (o.candidate || 0)) + (run ? (runs.size - run) * 100 : 0), projectId: p.sequenceId ? null : p.id, sequenceId: p.sequenceId || null })
        }
      }
    }
    for (const sq of this.listSequences()) {
      const v = this.sequenceView(sq.id)
      const set = { set: `sequence:${sq.id}`, setName: sq.name, sequenceId: sq.id, projectId: null }
      for (const x of v.versions) if (x.file) items.push({ key: `${sq.id}:${x.id}`, label: `${sq.name} · ${x.label}`, group: 'Sequences', at: x.createdAt, file: x.file, ...set, variant: x.label, rank: 5 })
      for (const r of v.renders) if (r.file) items.push({ key: `${sq.id}:r:${r.id}`, label: `${sq.name} · final`, group: 'Sequences', at: r.createdAt, file: r.file, ...set, variant: 'Final', rank: 0 })
    }
    const seen = new Set() // a finish job lists its picked preview again
    const out = items.filter((i) => !seen.has(i.file.path || i.file.url) && seen.add(i.file.path || i.file.url)).sort((a, b) => String(b.at).localeCompare(String(a.at)))
    const named = new Map() // the same version made twice (a SeedVR2 run repeated) reads "… (2)" for the newer one
    for (const i of [...out].reverse()) {
      const k = `${i.set}|${i.variant}`
      const n = (named.get(k) || 0) + 1
      named.set(k, n)
      if (n > 1) Object.assign(i, { variant: `${i.variant} (${n})`, label: `${i.label} (${n})` })
    }
    return out
  }

  // H3 models the ComfyUI can load, and each workflow's default (Settings -> Models).
  async h3Models() {
    const all = comboOptions(await this.comfy.objectInfo('UNETLoader'), 'UNETLoader', 'unet_name') || []
    const t = this.template
    return {
      models: all.filter((n) => /h3|minimax/i.test(n)),
      defaults: { text: t['101'].inputs.unet_name, frames: t['201'].inputs.unet_name, reference: t['301'].inputs.unet_name, continue: t['601'].inputs.unet_name, take: t['301'].inputs.unet_name, retake: t['301'].inputs.unet_name }
    }
  }

  // LoRA names ComfyUI lists, and the loras folder new character LoRAs go in: the one already holding
  // "MiniMax H3" (ComfyUI may list its install's own folder first, ahead of a shared one).
  async loraNames() {
    return comboOptions(await this.comfy.objectInfo('LoraLoaderModelOnly'), 'LoraLoaderModelOnly', 'lora_name') || []
  }
  async loraRoot() {
    const folders = (await fetch(`${this.comfy.url}/experiment/models`, { headers: this.comfy.headers() }).then((r) => r.json())).find((f) => f.name === 'loras')?.folders || []
    const real = folders.filter((f) => fs.existsSync(f))
    const root = real.find((f) => fs.existsSync(path.join(f, 'MiniMax H3'))) || real[0]
    if (!root) throw new Error("Couldn't find this ComfyUI's loras folder (character downloads need a ComfyUI on this PC).")
    return root
  }

  // Character LoRAs and RefMods the ComfyUI can load (for new characters and refmods in a request).
  async choices() {
    const refmod = this.template['1101'].class_type
    const [l, r] = await Promise.all([this.comfy.objectInfo('LoraLoaderModelOnly'), this.comfy.objectInfo(refmod)])
    return { loras: comboOptions(l, 'LoraLoaderModelOnly', 'lora_name') || [], refmods: (comboOptions(r, refmod, 'mod_1') || []).filter((n) => n !== '(none)') }
  }

  // ---------- prompt writer ----------
  // request: {idea, mode, seconds, aspect, character, media, sequence, previous}. engine: local | claude | codex |
  // contextir; model: the local model, or the Claude Code or Codex model ('' for the person's own default).
  async writePrompt(request, { engine = 'local', apiKey = null, model } = {}) {
    const { idea, character: charId = 'none', mode = 'text', seconds = 5, aspect = '16:9', media = [], sequence = false, previous = null } = request
    if (!idea?.trim()) throw new Error('Describe the idea first.')
    const character = charId === 'none' ? null : this.characters().find((c) => c.id === charId) || null
    const files = media.map((m) => ({ kind: m.kind, file: m.file || m.path }))
    if (engine === 'local') return writeLocal({ idea, mode, seconds, character, sequence, previous, media: files, model, cpu: await this.gpuBusy() })
    if (engine === 'claude' || engine === 'codex') return writeHarness({ engine, model, idea, mode, seconds, character, sequence, previous, media: files })
    if (engine !== 'contextir') throw new Error(`Unknown writer "${engine}".`)
    if (!apiKey) throw new Error('MiniMax Context IR needs a Comfy.org API key. Add it in Settings → Prompt writer.')
    const staged = []
    for (const m of files) staged.push({ kind: m.kind, name: await this.stage(m.file, 'iv_studio') })
    const graph = contextIrGraph({ idea, mode, seconds, aspect, character, media: staged, sequence })
    const promptId = await this.comfy.submit(graph, { api_key_comfy_org: apiKey, iv_studio: { kind: 'write_prompt' } }, { front: true })
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const h = (await this.comfy.history(promptId))[promptId]
      if (!h) continue
      const err = h.status?.messages?.find((m) => m[0] === 'execution_error')
      if (err) throw new Error(`Context IR: ${err[1].exception_message}`.slice(0, 600))
      const text = h.outputs?.out?.text?.[0]
      if (!text) throw new Error('Context IR returned no prompt.')
      return fromContextIr(text, character)
    }
    throw new Error('Context IR took too long. Try again.')
  }

  // engine: local, claude or codex (Context IR writes one shot at a time, so a story falls back to local).
  async writeStory({ story, shots = 3, seconds = 10, character: charId = 'none' }, { engine = 'local', model } = {}) {
    if (!story?.trim()) throw new Error('Write the story first.')
    const character = charId === 'none' ? null : this.characters().find((c) => c.id === charId) || null
    const harness = engine === 'claude' || engine === 'codex'
    return writeStoryLocal({ story, shots: Math.min(8, Math.max(1, shots)), seconds, character, engine: harness ? engine : 'local', model, cpu: harness ? false : await this.gpuBusy() })
  }

  // True while ComfyUI is rendering; the local writer then stays on the CPU so it can't take H3's VRAM.
  async gpuBusy() {
    try {
      return (await this.comfy.queue()).queue_running.length > 0
    } catch {
      return false
    }
  }

  // ---------- sequences ----------
  // A sequence is a list of shots that plays as one video. Each render (a whole take, the last shot of a
  // shot-by-shot chain, or a retake) is a version; a render-out finishes one version with DLSS.
  sequenceFile = (id) => path.join(this.dataDir, 'sequences', `${id}.json`)
  listSequences() {
    const dir = path.join(this.dataDir, 'sequences')
    if (!fs.existsSync(dir)) return []
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson(path.join(dir, f), null))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((s) => ({ id: s.id, name: s.name, method: s.method, shots: s.shots.length, versions: s.versions.length, renders: s.renders.length, updatedAt: s.updatedAt }))
  }
  getSequence(id) {
    const s = readJson(this.sequenceFile(id), null)
    if (!s) throw new Error(`No sequence ${id}`)
    return s
  }
  writeSequence(s) {
    s.updatedAt = now()
    writeJson(this.sequenceFile(s.id), s)
    return s
  }
  createSequence(init = {}) {
    const s = { ...SEQUENCE_DEFAULTS, name: 'Untitled sequence', shots: [{ id: randomUUID().slice(0, 6), prompt: '', mode: 'text', media: [] }], ...init, id: randomUUID().slice(0, 8), createdAt: now(), projectId: null, shotJobs: {}, versions: [], renders: [], jobs: [] }
    return this.writeSequence(s)
  }
  // Edits name, settings and shots. Renders already made stay; shot-by-shot shots go stale when their inputs change.
  saveSequence(id, patch) {
    const s = this.getSequence(id)
    const allowed = ['name', 'method', 'character', 'aspect', 'megapixels', 'shotSeconds', 'steps', 'seed', 'voiceRef', 'shots']
    for (const k of allowed) if (k in (patch || {})) s[k] = patch[k]
    s.shots = s.shots.map((sh) => ({ id: sh.id || randomUUID().slice(0, 6), prompt: sh.prompt || '', mode: sh.mode || 'text', media: sh.media || [] }))
    return this.writeSequence(s)
  }
  deleteSequence(id) {
    fs.rmSync(this.sequenceFile(id), { force: true })
    return true
  }

  // The sequence plus everything derived from its jobs: version files, shot-by-shot state, render-outs.
  sequenceView(id) {
    const s = this.getSequence(id)
    const job = (jid) => (jid ? readJson(this.jobFile(jid), null) : null)
    const out = (j, kind) => j?.outputs?.find((o) => o.kind === kind) || null

    // Shot by shot: a shot is fresh when its finish succeeded from the inputs it has now,
    // including the previous shot's video.
    const shots = []
    let prevRaw = null
    for (const [i, sh] of s.shots.entries()) {
      const rec = s.shotJobs[sh.id] || {}
      const pj = job(rec.previews)
      const fj = job(rec.finish)
      const raw = out(fj, i === 0 ? 'before_dlss' : 'continued_before_dlss')
      const key = this.shotKey(s, i, prevRaw)
      const fresh = !!(raw && rec.key === key)
      shots.push({ id: sh.id, previews: pj ? this.publicJob(pj) : null, finish: fj ? this.publicJob(fj) : null, raw, fresh, stale: !!rec.key && rec.key !== key, ready: i === 0 || !!prevRaw })
      prevRaw = fresh ? raw.path : null
    }

    const versions = s.versions.map((v) => {
      const j = job(v.jobId)
      return { ...v, job: j ? this.publicJob(j) : null, file: out(j, 'master') }
    })
    if (prevRaw && shots.length) versions.unshift({ id: 'shots', kind: 'shots', label: 'Shot by shot', createdAt: shots.at(-1).finish?.createdAt, job: shots.at(-1).finish, file: shots.at(-1).raw })
    const renders = s.renders.map((r) => {
      const j = job(r.jobId)
      return { ...r, job: j ? this.publicJob(j) : null, file: out(j, 'final') }
    })
    return { sequence: s, shots, versions, renders }
  }

  // sequenceView after asking ComfyUI about any of the sequence's jobs that haven't finished.
  async refreshSequence(id) {
    for (const jid of this.getSequence(id).jobs) {
      const j = readJson(this.jobFile(jid), null)
      if (j && !['success', 'error', 'cancelled'].includes(j.status)) await this.refreshJob(jid).catch(() => {})
    }
    return this.sequenceView(id)
  }

  shotKey(s, i, prevRaw) {
    const sh = s.shots[i]
    return JSON.stringify([sh.prompt, sh.mode, sh.media, s.character, s.aspect, s.megapixels, s.shotSeconds, s.steps, i ? prevRaw : null])
  }

  sequenceCharacter(s) {
    return validateSequence(s, this.characters())
  }
  sequenceJob(s, j) {
    s.jobs.push(j.id)
    this.writeSequence(s)
    return j
  }

  async renderTake(id) {
    const s = this.getSequence(id)
    const character = this.sequenceCharacter(s)
    const voiceRef = s.voiceRef ? await this.stage(s.voiceRef, 'iv_studio') : null
    const n = s.versions.length + 1
    const name = `${slug(s.name)}_${s.id}_v${n}`
    const { graph, resolved } = takeGraph({ template: this.template, seq: s, character, name, voiceRef, unet: this.models.take })
    const j = await this.submitGraph({ kind: 'take', graph, sequenceId: s.id, name, plan: { saves: SAVES, resolved } })
    s.versions.push({ id: `v${n}`, kind: 'take', label: `Take ${s.versions.filter((v) => v.kind === 'take').length + 1}`, jobId: j.id, createdAt: j.createdAt, seed: s.seed })
    return this.sequenceJob(s, j)
  }

  versionPath(id, versionId) {
    const v = this.sequenceView(id).versions.find((x) => x.id === versionId)
    if (!v?.file?.path) throw new Error(`Version ${versionId} has no finished video yet.`)
    return { v, path: v.file.path }
  }

  // A retake of any video file (the editor's Retake): the graph Sequences use, at their defaults. The file must
  // be on the PC that runs ComfyUI.
  async retakeFile({ name, sourcePath, start, end, mode = 'both', prompt, character = 'none', seed }) {
    if (this.comfy.remote) throw new Error('Retake in the editor needs ComfyUI on this PC for now.')
    if (!(end > start)) throw new Error('The retake must end after it starts.')
    const ch = character === 'none' ? null : this.characters().find((c) => c.id === character) || null
    const base = `${slug(name)}_${randomUUID().slice(0, 6)}`
    const { graph } = retakeGraph({ template: this.template, seq: { ...SEQUENCE_DEFAULTS }, character: ch, name: base, sourcePath, prompt, start, end, mode, seed: seed ?? SEQUENCE_DEFAULTS.seed, unet: this.models.retake })
    return this.submitGraph({ kind: 'retake', graph, name: base, plan: { saves: SAVES, resolved: { start, end, mode } } })
  }

  async retakeSequence(id, { versionId, prompt, start, end, mode = 'both', seed }) {
    const s = this.getSequence(id)
    const character = this.sequenceCharacter(s)
    if (!prompt?.trim()) throw new Error('Describe what should happen in the retake.')
    if (!(end > start)) throw new Error('The retake must end after it starts.')
    const { v, path: sourcePath } = this.versionPath(id, versionId)
    const n = s.versions.length + 1
    const name = `${slug(s.name)}_${s.id}_v${n}`
    const { graph } = retakeGraph({ template: this.template, seq: s, character, name, sourcePath, prompt, start, end, mode, seed: seed ?? s.seed + n, unet: this.models.retake })
    const j = await this.submitGraph({ kind: 'retake', graph, sequenceId: s.id, name, plan: { saves: SAVES, resolved: { start, end, mode } } })
    s.versions.push({ id: `v${n}`, kind: 'retake', label: `Retake of ${v.label}, ${start}–${end} s`, jobId: j.id, createdAt: j.createdAt, source: versionId, start, end, mode, prompt })
    return this.sequenceJob(s, j)
  }

  async renderOutSequence(id, { versionId, normalize = false, scale = 1, fps = 0 }) {
    const s = this.getSequence(id)
    const { path: sourcePath } = this.versionPath(id, versionId)
    const name = `${slug(s.name)}_${s.id}_${versionId}_final`
    const { graph } = renderOutGraph({ template: this.template, name, sourcePath, normalize, scale, fps })
    const j = await this.submitGraph({ kind: 'renderout', graph, sequenceId: s.id, name, plan: { saves: SAVES, resolved: { normalize, scale, fps } } })
    s.renders.push({ id: j.id, versionId, jobId: j.id, createdAt: j.createdAt, normalize, scale, fps })
    return this.sequenceJob(s, j)
  }

  // Shot by shot: shot 1 is hunted like any shot; every later shot continues from the previous shot's video.
  async huntShot(id, index, { seed } = {}) {
    const s = this.getSequence(id)
    this.sequenceCharacter(s)
    const view = this.sequenceView(id)
    const sh = s.shots[index]
    if (!sh) throw new Error(`No shot ${index + 1}.`)
    const prev = index > 0 ? view.shots[index - 1] : null
    if (prev && !prev.fresh) throw new Error(`Finish shot ${index} first; shot ${index + 1} continues from it.`)
    if (!s.projectId) s.projectId = this.createProject(`${s.name} (sequence)`, s.id).id
    const base = { prompt: sh.prompt, character: s.character, aspect: s.aspect, seconds: s.shotSeconds, steps: s.steps, seed: seed ?? s.seed + index * 100 }
    const request = prev
      ? { ...base, mode: 'continue', media: [{ kind: 'video', file: prev.raw.path }], megapixels: s.megapixels, overlapFrames: 22 }
      : { ...base, mode: sh.mode || 'text', media: sh.media || [], megapixels: 0.4, previews: 3 }
    const j = await this.generatePreviews({ projectId: s.projectId, ...request })
    s.shotJobs[sh.id] = { previews: j.id, finish: null, key: this.shotKey(s, index, prev?.raw?.path || null) }
    return this.sequenceJob(s, j)
  }

  async finishShot(id, index, { candidate = 1 } = {}) {
    const s = this.getSequence(id)
    const sh = s.shots[index]
    const rec = s.shotJobs[sh?.id]
    if (!rec?.previews) throw new Error(`Hunt shot ${index + 1} first.`)
    const j = await this.finishCandidate({ jobId: rec.previews, candidate, megapixels: Math.max(0.5, s.megapixels), audio: 'pass', fps: 0, upscale2x: false })
    rec.finish = j.id
    return this.sequenceJob(s, j)
  }

  // ---------- jobs ----------
  jobFile = (id) => path.join(this.dataDir, 'jobs', `${id}.json`)

  getJob(id, { refresh = true } = {}) {
    const job = readJson(this.jobFile(id), null)
    if (!job) throw new Error(`No job ${id}`)
    return refresh ? job : job
  }
  // Adds fields to a saved job (its take ranking); returns the job as the window sees it.
  updateJob(id, patch) {
    const job = { ...this.getJob(id), ...patch }
    writeJson(this.jobFile(id), job)
    return this.publicJob(job)
  }

  async refreshJob(id) {
    const job = this.getJob(id)
    if (['success', 'error', 'cancelled'].includes(job.status)) return this.publicJob(job)
    let h
    try {
      h = (await this.comfy.history(job.promptId))[job.promptId]
    } catch (err) {
      return this.publicJob({ ...job, note: err.message })
    }
    if (h) {
      const msgs = h.status?.messages || []
      const err = msgs.find((m) => m[0] === 'execution_error')
      const interrupted = msgs.find((m) => m[0] === 'execution_interrupted')
      job.status = err ? 'error' : interrupted ? 'cancelled' : h.status?.status_str === 'success' ? 'success' : 'error'
      if (err) job.error = `${err[1].node_type}: ${err[1].exception_message}`.slice(0, 1200)
      const t = msgs.filter((m) => ['execution_start', 'execution_success', 'execution_error'].includes(m[0])).map((m) => m[1].timestamp)
      if (t.length > 1) job.seconds = Math.round((t.at(-1) - t[0]) / 1000)
      job.outputs = this.collectOutputs(job, h.outputs || {})
      job.finishedAt = now()
      writeJson(this.jobFile(job.id), job)
      // a finish whose enhancer is SeedVR2: its enhance step starts as soon as the finish is done
      if (job.kind === 'finish' && job.status === 'success' && job.plan?.finish?.enhancer === 'seedvr2' && !job.enhanceJob) {
        try {
          const e = await this.enhanceFinal({ jobId: job.id, engine: 'seedvr2', resolution: job.plan.finish.enhanceResolution })
          job.enhanceJob = e.id
        } catch (err) {
          job.enhanceError = err.message
        }
        writeJson(this.jobFile(job.id), job)
      }
      return this.publicJob(job)
    }
    const q = await this.comfy.queue()
    if (q.queue_running.some((i) => i[1] === job.promptId)) job.status = 'running'
    else {
      const pos = q.queue_pending.findIndex((i) => i[1] === job.promptId)
      job.status = pos >= 0 ? 'queued' : job.status
      job.queuePosition = pos >= 0 ? pos + 1 + q.queue_running.length : undefined
    }
    return this.publicJob({ ...job, progress: this.progress.get(job.promptId) })
  }

  async cancelJob(id) {
    const job = this.getJob(id)
    if (['success', 'error', 'cancelled'].includes(job.status)) return { job: this.publicJob(job), result: 'already finished' }
    const result = await this.comfy.cancel(job.promptId)
    if (result === 'removed from queue') {
      job.status = 'cancelled'
      writeJson(this.jobFile(job.id), job)
    }
    return { job: this.publicJob(job), result }
  }

  collectOutputs(job, outputs) {
    const list = []
    const file = (f, kind, extra = {}) => ({ kind, path: f.fullpath || null, url: this.comfy.viewUrl(f), filename: f.filename, subfolder: f.subfolder, ...extra })
    const videoOf = (o) => (o?.gifs || []).filter((f) => /\.mp4$/i.test(f.filename)).sort((a, b) => /-audio/.test(b.filename) - /-audio/.test(a.filename))[0]
    if (job.plan?.replace) {
      // OpenJutsu's workflows: the final video (Context Loop assembly or VHS), plus mask and "who is who" previews
      const fin = job.plan.replace.finalNode
      for (const [nid, out] of Object.entries(outputs)) {
        for (const f of [...(out.gifs || []), ...(out.videos || []), ...(out.video || [])]) if (/\.(mp4|webm|mov)$/i.test(f.filename)) list.push(file(f, nid === fin ? 'final' : 'video'))
        // a path, or (Context Loop 0.7.x) a sentence about it: "assembled 2 generated clips with ffmpeg; hard cuts -> F:\...\x.mp4; generated audio -> ..."
        for (const t of out.text || []) {
          const p = typeof t === 'string' && (t.match(/->\s*([^;]+?\.(?:mp4|webm|mov))\s*(?:;|$)/i)?.[1] || (/\.(mp4|webm|mov)$/i.test(t.trim()) ? t.trim() : null))
          if (p) list.push(this.fileFromPath(p, nid === fin ? 'final' : 'video'))
        }
        for (const img of out.images || []) {
          if (/\.(png|jpe?g|webp)$/i.test(img.filename)) list.push(file(img, 'image'))
          // core SaveVideo (Remake) lists its video under images; a LoadVideo's preview of the source is an input
          else if (/\.(mp4|webm|mov)$/i.test(img.filename) && img.type !== 'input') list.push(file(img, nid === fin ? 'final' : 'video'))
        }
      }
      return list
    }
    if (job.plan?.cutout) {
      // a cut-out's mask (cutout.js): a picture from SaveImage, or the mask video
      const o = outputs.mask
      const img = (o?.images || [])[0]
      const vid = (o?.gifs || []).find((f) => /\.mp4$/i.test(f.filename))
      if (img || vid) list.push(file(img || vid, 'mask'))
      return list
    }
    if (job.plan?.reframe) {
      // a reframed shot (reframe.js): the saved video with its sound
      const v = videoOf(outputs.save)
      if (v) list.push(file(v, 'final'))
      return list
    }
    if (job.plan?.enhance) {
      // Enhance: SeedVR2's saved video (with its sound), or the path DLSS 5 answers with
      const v = (o) => (o?.gifs || []).filter((f) => /\.mp4$/i.test(f.filename)).sort((a, b) => /-audio/.test(b.filename) - /-audio/.test(a.filename))[0]
      const saved = v(outputs.save)
      if (saved) list.push(file(saved, 'final'))
      const p = outputs.out?.text?.[0]
      if (p) list.push(this.fileFromPath(p, 'final'))
      return list
    }
    if (job.plan?.music) {
      // a song (Music): the SaveAudio output
      for (const nid of Object.keys(outputs).sort()) for (const a of outputs[nid].audio || []) list.push(file(a, 'audio'))
      return list
    }
    if (job.plan?.images) {
      // a picture graph (character design stills): every SaveImage output, in node order
      for (const nid of Object.keys(outputs).sort()) for (const img of outputs[nid].images || []) list.push(file(img, 'image'))
      return list
    }
    if (job.plan?.saves) {
      const master = videoOf(outputs[SAVES.master])
      if (master) list.push(file(master, 'master'))
      const p = outputs[SAVES.final]?.text?.[0]
      if (p) list.push(this.fileFromPath(p, 'final'))
      return list
    }
    for (const [k, nid] of Object.entries(PREVIEW_SAVES)) {
      const v = videoOf(outputs[nid])
      if (v) list.push(file(v, 'preview', { candidate: Number(k), seed: job.kind === 'previews' ? job.plan.resolved.seeds[k - 1] : undefined }))
    }
    const twoMp = videoOf(outputs['30'])
    if (twoMp) list.push(file(twoMp, 'before_dlss'))
    const cont = videoOf(outputs['619'])
    if (cont) list.push(file(cont, 'continued_before_dlss'))
    for (const nid of ['51', '704']) {
      const p = outputs[nid]?.text?.[0]
      if (p) list.push(this.fileFromPath(p, 'final'))
    }
    return list
  }

  fileFromPath(p, kind) {
    const norm = p.replace(/\\/g, '/')
    const m = norm.match(/\/output\/(.*)\/([^/]+)$/)
    const subfolder = m ? m[1] : ''
    const filename = m ? m[2] : norm.split('/').pop()
    return { kind, path: p, filename, subfolder, url: this.comfy.viewUrl({ filename, subfolder, type: 'output' }) }
  }

  publicJob(job) {
    const { previewPlan, ...rest } = job
    // the request goes out whole: the shot page shows its prompt in full
    return { ...rest, plan: { resolved: job.plan?.resolved, request: job.plan?.request, finish: job.plan?.finish, asked: job.plan?.asked, enhance: job.plan?.enhance } }
  }

  listJobs(projectId) {
    const ids = projectId ? this.getProject(projectId).jobs : []
    return ids.map((id) => readJson(this.jobFile(id), null)).filter(Boolean).map((j) => this.publicJob(j))
  }

  // The render queue in the sidebar: everything running or waiting on ComfyUI, IV Studio's own work named from
  // its job records (with live step progress from the websocket), anyone else's as "other". A cloud ComfyUI is
  // only asked while IV Studio has a job in flight, so the queue never keeps a cloud GPU awake.
  async renderQueue() {
    const known = this.queueIndex()
    if (this.comfy.remote && ![...known.values()].some((j) => j.open)) return { items: [] }
    const q = await this.comfy.queue()
    const seen = new Set()
    const items = [
      ...q.queue_running.map((i) => ['running', i]),
      ...[...q.queue_pending].sort((a, b) => a[0] - b[0]).map((i) => ['queued', i])
    ].map(([state, i], n) => {
      const promptId = i[1]
      const ours = i[3]?.iv_studio
      const job = known.get(promptId)
      seen.add(promptId)
      if (state === 'running' && !this.runningSince.has(promptId)) this.runningSince.set(promptId, Date.now())
      return {
        promptId,
        state,
        position: n + 1,
        ours: !!ours,
        jobId: job?.id || null,
        kind: job?.kind || ours?.kind || null,
        name: job?.name || null,
        projectId: job?.projectId || ours?.project || null,
        sequenceId: job?.sequenceId || ours?.sequence || null,
        startedAt: state === 'running' ? this.runningSince.get(promptId) : null,
        progress: state === 'running' ? this.progress.get(promptId) || null : null
      }
    })
    for (const id of this.runningSince.keys()) if (!seen.has(id)) this.runningSince.delete(id)
    return { items }
  }

  // promptId -> the job's name, kind and links, from the job files; only files written since the last look are read.
  queueIndex() {
    this.jobIndex ||= new Map()
    this.runningSince ||= new Map()
    const dir = path.join(this.dataDir, 'jobs')
    const since = this.jobIndexAt || 0
    this.jobIndexAt = Date.now()
    let files = []
    try {
      files = fs.readdirSync(dir)
    } catch {
      return this.jobIndex
    }
    for (const f of files) {
      const file = path.join(dir, f)
      try {
        if (fs.statSync(file).mtimeMs < since - 2000) continue
        const j = readJson(file, null)
        if (j?.promptId) this.jobIndex.set(j.promptId, { id: j.id, name: j.name, kind: j.kind, projectId: j.projectId, sequenceId: j.sequenceId, open: !['success', 'error', 'cancelled'].includes(j.status) })
      } catch {}
    }
    return this.jobIndex
  }

  // Cancels a queue item IV Studio started: through its job when there is one, else by prompt id.
  async cancelQueued(promptId) {
    const job = this.queueIndex().get(promptId)
    if (job?.id) return this.cancelJob(job.id)
    return this.comfy.cancel(promptId)
  }

  // Live progress from ComfyUI's websocket (the studio window keeps one open; the MCP server polls). ComfyUI sends
  // step progress only to the client id that queued the prompt, so this listens as that same id.
  watch(onEvent) {
    // A cloud ComfyUI shuts down when idle; an open websocket would keep it (and its bill) running.
    if (this.comfy.remote) return () => {}
    let ws
    let stopped = false
    const connect = () => {
      if (stopped) return
      try {
        ws = new WebSocket(`${this.comfy.url.replace(/^http/, 'ws')}/ws?clientId=${this.comfy.clientId}`)
      } catch {
        return setTimeout(connect, 3000)
      }
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        let msg
        try {
          msg = JSON.parse(ev.data)
        } catch {
          return
        }
        const d = msg.data || {}
        if (msg.type === 'progress' && d.prompt_id) this.progress.set(d.prompt_id, { value: d.value, max: d.max, node: d.node })
        if (msg.type === 'executing' && d.prompt_id) this.running = d.node == null ? null : d.prompt_id
        if (msg.type === 'executing' && d.prompt_id && d.node == null) (this.progress.delete(d.prompt_id), this.live.delete(d.prompt_id))
        // a live preview step (remote.js withLivePreview): it carries no prompt id, so it belongs to the running one;
        // its step count starting again means the next preview take has begun
        if (msg.type === 'kj_preview_override' && d.image && this.running) {
          const prev = this.live.get(this.running)
          const take = !prev ? 1 : d.step < prev.step ? prev.take + 1 : prev.take
          const live = { promptId: this.running, image: `data:${d.mime || 'image/jpeg'};base64,${d.image}`, step: d.step, total: d.total, take, at: Date.now() }
          this.live.set(this.running, live)
          msg = { type: 'iv_live', data: live }
        }
        onEvent?.(msg)
      }
      ws.onclose = () => setTimeout(connect, 3000)
      ws.onerror = () => {}
    }
    connect()
    return () => {
      stopped = true
      ws?.close()
    }
  }
}

