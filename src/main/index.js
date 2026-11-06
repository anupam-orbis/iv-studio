import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage, screen, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { comfyFolders, dataDir, incognitoDir, readSettings, resourcesDir, writerOf, writeSettings } from '../service/paths'
import { EXTRA_BIN, harnessStatus } from '../service/harness'
import { pasteMessage, skillMarkdown, readGuide } from '../service/agent'
import { Cloud, GPUS } from '../service/cloud'
import { RunPod, GPUS as RUNPOD_GPUS } from '../service/runpod'
import { comfyUp, findLaunchers, isComfyFolder, isLocalUrl, launch as launchComfy, launcherFor, launchersIn, waitUp } from '../service/comfylauncher'
import { randomBytes } from 'node:crypto'
import { Edits, FORMATS, LOUDNESS } from '../service/edits'
import { EditGen } from '../service/editgen'
import { Productions } from '../service/productions'
import { Reels } from '../service/reel'
import { Cutouts } from '../service/cutout'
import { Reframes } from '../service/reframe'
import { DEFAULT_TRACKS } from '../service/timeline'
import { SCENE_KINDS, SIZZLE_FORMATS, Sizzles } from '../service/sizzle'
import { initUpdater, updateState, MANUAL as UPDATE_MANUAL } from './updater'
import { MediaTools } from '../service/media'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { ModelInstaller } from '../service/models'
import { CONTEXT_IR_PRICE, normalizeOllamaUrl, ollamaStatus, pullModel, setOllamaSource, unloadOllama } from '../service/prompter'
import { Studio } from '../service/studio'
import { Ranker } from '../service/ranking'
import { Reviewer } from '../service/review'
import { Previs } from '../service/previs'
import { SCENES, TALKS, TRAIN_GPUS, Trainings } from '../service/training'
import { Shinobi } from '../service/shinobi'
import { CharacterCatalog } from '../service/characters'
import { Replace, RESOLUTIONS, MAX_CHARACTERS, DEFAULT_TONE, OPENJUTSU } from '../service/replace'
import { CREDIT as REMAKE_CREDIT, Remake } from '../service/remake'
import { Voices } from '../service/voices'
import { ACE_KEYS, Music, MUSIC_DEFAULTS, MUSIC_ENGINES } from '../service/music'
import { Images } from '../service/images'
import { Civitai, CIVITAI_SITES, LORA_SORTS, LORA_TAGS } from '../service/civitai'
import { Comfy } from '../service/comfy'
import { checkKey as checkComfyCloudKey, COMFY_CLOUD, summarise as summariseComfyCloud } from '../service/comfycloud'

// An app opened from Finder gets a short PATH (/usr/bin:/bin:/usr/sbin:/sbin), so the tools IV Studio runs (Claude
// Code, Codex, Ollama, git) and what they need (node) would not be found; add the usual install folders.
if (process.platform === 'darwin') process.env.PATH = [...new Set([...String(process.env.PATH || '').split(':'), ...EXTRA_BIN()].filter(Boolean))].join(':')
if (process.env.IV_STUDIO_USER_DATA) app.setPath('userData', process.env.IV_STUDIO_USER_DATA)
if (!app.requestSingleInstanceLock()) {
  console.error('IV Studio is already running; this copy quits.')
  app.quit()
}
// ComfyUI refuses cross-site browser requests, so the window loads outputs through ivmedia://view?...,
// which the main process fetches from ComfyUI's /view (Range passed through so videos can seek).
// The editor plays local media through ivfile://local/?p=<path> (seekable, any media file on this PC).
protocol.registerSchemesAsPrivileged([
  { scheme: 'ivmedia', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  { scheme: 'ivfile', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
])
const MEDIA_FILE = /\.(mp4|mov|webm|mkv|m4v|wav|mp3|m4a|flac|ogg|aac|png|jpe?g|webp|bmp)$/i
const MIME = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', flac: 'audio/flac', ogg: 'audio/ogg', aac: 'audio/aac', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp' }
function serveFile(req) {
  const file = new URL(req.url).searchParams.get('p')
  if (!file || !MEDIA_FILE.test(file) || !fs.existsSync(file)) return new Response('Not found', { status: 404 })
  const size = fs.statSync(file).size
  const type = MIME[file.split('.').pop().toLowerCase()] || 'application/octet-stream'
  // The window's page is another origin; it reads files with fetch() too (the media editor's waveform).
  const cors = { 'Access-Control-Allow-Origin': '*' }
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '')
  if (!range) return new Response(Readable.toWeb(fs.createReadStream(file)), { headers: { ...cors, 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } })
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
    status: 206,
    headers: { ...cors, 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' }
  })
}

const BG = '#100c0e'
// A copy started with its own user data (testing beside the installed app) says so everywhere.
const TEST_COPY = !!process.env.IV_STUDIO_USER_DATA
// Settings and keys live in BASE. Everything made lives in DATA: BASE itself, or BASE\incognito while
// Incognito is on (see incognitoDir). The switch takes a restart, so one run never mixes the two.
const BASE = process.env.IV_STUDIO_DATA || dataDir()
// the writer's Ollama: Settings → Prompt writer → Ollama address (prompter.js)
setOllamaSource(() => readSettings(BASE).ollamaUrl)
const INCOGNITO = !!readSettings(BASE).incognito
const DATA = INCOGNITO ? incognitoDir(BASE) : BASE
// Downloads and exports: Videos\IV Studio, or a folder inside the Incognito data
const videosDir = () => (INCOGNITO ? path.join(DATA, 'videos') : path.join(app.getPath('videos'), 'IV Studio'))
let win = null
let studio = null
let stopWatch = null
let installer = null
let trainings = null
let replace = null
let remake = null
let catalog = null
let voices = null
let music = null
let images = null
let civitai = null
let runpodWake = null // starts a RunPod pod when the last one idled off (set up with the cloud handlers)
const pending = new Set() // job ids the window is waiting on
let ranker = null // ranks finished previews (ranking.js), set up with the services it reads
let reviewer = null // reviews a take against its brief (review.js)

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

// Secrets at rest (the Comfy.org key, the cloud token) are encrypted with Windows' per-user key.
const seal = (text) => (text ? safeStorage.encryptString(text).toString('base64') : null)
const unseal = (enc) => {
  if (!enc) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

// Comfy Cloud takes the person's Comfy API key: its own, else the Comfy.org key saved for the paid prompt writer
// (both come from platform.comfy.org).
const comfyCloudKey = (s = readSettings(BASE)) => unseal(s.comfyCloudKey) || unseal(s.comfyApiKey)

function makeStudio() {
  stopWatch?.()
  const s = readSettings(BASE)
  const onRunPod = s.target === 'cloud' && s.cloudProvider === 'runpod'
  const onComfyCloud = s.target === 'cloud' && s.cloudProvider === 'comfycloud'
  // a RunPod pod's address changes with every pod; until one is up the waker (below) starts one on first use
  const cloud = onComfyCloud
    ? { comfyUrl: COMFY_CLOUD, comfyApiKey: comfyCloudKey(s) }
    : onRunPod
    ? { comfyUrl: s.runpod?.url || 'https://iv-studio-pod-asleep.proxy.runpod.net', comfyToken: unseal(s.runpodToken) }
    : s.target === 'cloud' && s.cloud?.url
      ? { comfyUrl: s.cloud.url, comfyToken: unseal(s.cloudToken) }
      : { comfyUrl: s.comfyUrl }
  studio = new Studio({ dataDir: DATA, resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')), models: s.models, ...cloud })
  if (onRunPod) studio.comfy.waker = () => runpodWake?.()
  studio.comfy.folders = comfyFolders(s, INCOGNITO)
  if (trainings) trainings.studio = studio
  if (replace) replace.studio = studio
  if (remake) remake.studio = studio
  if (catalog) catalog.studio = studio
  if (music) music.studio = studio
  if (images) images.studio = studio
  // LoRAs live on this PC's ComfyUI, also when renders go to the cloud
  if (civitai) civitai.comfy = new Comfy(s.comfyUrl)
  // nothing of IV Studio's own holds the GPU while ComfyUI renders (see Studio.makeRoom)
  studio.beforeRender = () => voices?.release()
  if (!installer?.running) installer = new ModelInstaller({ comfy: studio.comfy, manifest: studio.manifest, onUpdate: (u) => send('models:update', u) })
  stopWatch = studio.watch((msg) => {
    if (msg.type === 'progress' || msg.type === 'executing' || msg.type === 'execution_success' || msg.type === 'execution_error') pump()
    // a live preview step: to the window, keyed by the prompt (the shot page and the queue match it to their job)
    if (msg.type === 'iv_live') send('jobs:live', msg.data)
  })
}

// Refresh every job the window is watching and push the new state; finished jobs stop being watched.
let pumping = false
async function pump() {
  if (pumping) return
  pumping = true
  try {
    for (const id of [...pending]) {
      try {
        const job = await studio.refreshJob(id)
        send('jobs:update', job)
        if (['success', 'error', 'cancelled'].includes(job.status)) pending.delete(id)
        // a SeedVR2 finish starts its enhance step (Studio.refreshJob): watch that too
        if (job.enhanceJob && !pending.has(job.enhanceJob)) pending.add(job.enhanceJob)
        // finished previews are ranked in the background (ranking.js); the window hears when it's done
        if (job.kind === 'previews' && job.status === 'success' && !job.ranking && ranker) ranker.rank(id).then((r) => r && send('jobs:update', studio.publicJob(studio.getJob(id))), () => {})
      } catch (err) {
        send('jobs:update', { id, status: 'unknown', note: err.message })
      }
    }
  } finally {
    pumping = false
  }
}
setInterval(pump, 4000)

function savedBounds() {
  const b = readSettings(BASE).window
  if (!b) return { width: 1380, height: 900 }
  const visible = screen.getAllDisplays().some((d) => b.x < d.workArea.x + d.workArea.width - 100 && b.x + b.width > d.workArea.x + 100)
  return visible ? b : { width: b.width, height: b.height }
}

function createWindow() {
  win = new BrowserWindow({
    ...savedBounds(),
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: BG,
    title: TEST_COPY ? 'IV Studio (TEST COPY)' : 'IV Studio',
    icon: path.join(resourcesDir(path.join(app.getAppPath(), 'resources')), 'icon.png'),
    titleBarStyle: 'hidden',
    // Windows and Linux draw their window buttons on the right over the bar; a Mac its traffic lights on the
    // left, centred in the 40 px bar (the bar leaves room for them)
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 13 } } : { titleBarOverlay: { color: BG, symbolColor: '#f1ede5', height: 40 } }),
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.once('ready-to-show', () => win.show())
  if (TEST_COPY) win.on('page-title-updated', (e) => e.preventDefault())
  win.on('close', () => writeSettings({ window: win.getBounds() }, BASE))
  if (process.env.IV_STUDIO_SMOKE) smokeTest(win, process.env.IV_STUDIO_SMOKE)
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

// IV_STUDIO_SMOKE=<folder> (the Linux build check): once the window has loaded, opens each sidebar page, saves a
// picture of it and what the page said into the folder (smoke.json), then quits.
function smokeTest(w, dir) {
  fs.mkdirSync(dir, { recursive: true })
  const errors = []
  w.webContents.on('console-message', (e) => e.level === 'error' && errors.push(e.message))
  w.webContents.on('render-process-gone', (_e, d) => errors.push(`renderer gone: ${d.reason}`))
  w.webContents.once('did-finish-load', async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const pages = []
    try {
      await wait(4000)
      const names = await w.webContents.executeJavaScript(`[...document.querySelectorAll('.nav .nav-item')].map((b) => b.textContent.trim())`)
      for (let i = 0; i <= names.length; i++) {
        if (i > 0) await w.webContents.executeJavaScript(`document.querySelectorAll('.nav .nav-item')[${i - 1}].click()`)
        await wait(1500)
        const name = i === 0 ? 'start' : names[i - 1]
        const text = await w.webContents.executeJavaScript(`document.querySelector('#root')?.innerText.length || 0`)
        fs.writeFileSync(path.join(dir, `${String(i).padStart(2, '0')}-${name.replace(/[^\w]+/g, '-')}.png`), (await w.webContents.capturePage()).toPNG())
        pages.push({ name, text })
      }
    } catch (err) {
      errors.push(`smoke: ${err.message}`)
    }
    fs.writeFileSync(path.join(dir, 'smoke.json'), JSON.stringify({ platform: process.platform, version: app.getVersion(), mcp: mcpCommand(), pages, errors }, null, 2))
    app.exit(0)
  })
}

const localCopy = (file) => studio.localCopy(file, videosDir())

// Errors cross IPC as plain messages so the window can show them.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) }
    } catch (err) {
      return { ok: false, error: err.message, errors: err.errors }
    }
  })
}

const KEY_STORE_MISSING = process.platform === 'win32' ? 'Windows encryption is not available, so the key cannot be stored safely.' : process.platform === 'darwin' ? 'The macOS Keychain is not available to IV Studio, so the key cannot be stored safely.' : 'No system keyring (GNOME Keyring or KWallet) is available, so the key cannot be stored safely.'

// On Linux without a keyring Electron falls back to a fixed built-in password ('basic_text'), which isn't safe.
const keysSafe = () => safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text')

// How an agent starts the MCP server: this app's own binary in Node mode, on its bundled mcp.js. An AppImage runs
// from a new temporary folder each time, and its launcher may add --no-sandbox, which Node mode refuses, so its
// command is a small shell script in the data folder: it mounts the .AppImage, runs the binary inside in Node mode,
// and unmounts when the server ends. The app rewrites it on each start, so a moved AppImage is followed.
function mcpCommand() {
  if (process.env.APPIMAGE) {
    const starter = path.join(BASE, 'mcp-start.sh')
    const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`
    const text = [
      '#!/bin/sh',
      '# Written by IV Studio: starts its MCP server from the AppImage.',
      `APP=${q(process.env.APPIMAGE)}`,
      'out=$(mktemp)',
      '"$APP" --appimage-mount >"$out" </dev/null &',
      'mounter=$!',
      'trap \'kill $mounter 2>/dev/null; rm -f "$out"\' EXIT INT TERM',
      'i=0',
      'while [ ! -s "$out" ] && [ $i -lt 150 ]; do sleep 0.1; i=$((i + 1)); done',
      'dir=$(head -n 1 "$out")',
      '[ -n "$dir" ] || { echo "IV Studio: could not open $APP" >&2; exit 1; }',
      `ELECTRON_RUN_AS_NODE=1 "$dir/iv-studio" "$dir/resources/app.asar/out/main/mcp.js"`,
      ''
    ].join('\n')
    try {
      if (!fs.existsSync(starter) || fs.readFileSync(starter, 'utf8') !== text) fs.writeFileSync(starter, text, { mode: 0o755 })
    } catch {}
    return { command: '/bin/sh', args: [starter], env: {} }
  }
  const exe = process.execPath
  const script = app.isPackaged ? path.join(process.resourcesPath, 'app.asar', 'out', 'main', 'mcp.js') : path.join(app.getAppPath(), 'out', 'main', 'mcp.js')
  return { command: exe, args: [script], env: { ELECTRON_RUN_AS_NODE: '1' } }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  makeStudio()
  protocol.handle('ivfile', serveFile)
  protocol.handle('ivmedia', (req) => {
    const u = new URL(req.url)
    if (u.hostname !== 'view') return new Response('Not found', { status: 404 })
    const range = req.headers.get('range')
    return fetch(`${studio.comfy.url}/view${u.search}`, { headers: studio.comfy.headers(range ? { Range: range } : {}) })
  })

  const links = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(resourcesDir(path.join(app.getAppPath(), 'resources')), 'links.json'), 'utf8'))
    } catch {
      return { website: 'https://infinitevariance.ai', modalSignup: null }
    }
  })()
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, dataDir: DATA, mcp: mcpCommand(), testCopy: TEST_COPY, incognito: INCOGNITO, links }))
  // The window never sees the Comfy.org or Civitai key, only whether one is saved.
  const publicSettings = (s) => {
    const { comfyApiKey, cloudToken, civitaiKey, runpodKey, runpodToken, comfyCloudKey: _ck, ...rest } = s
    return { ...rest, hasComfyKey: !!comfyApiKey, hasCloudToken: !!cloudToken, hasCivitaiKey: !!civitaiKey, hasRunpodKey: !!runpodKey }
  }
  const comfyKey = () => unseal(readSettings(BASE).comfyApiKey)
  handle('settings:get', () => publicSettings(readSettings(BASE)))
  handle('settings:setComfyKey', (key) => {
    const k = String(key || '').trim()
    if (k && !keysSafe()) throw new Error(KEY_STORE_MISSING)
    return publicSettings(writeSettings({ comfyApiKey: seal(k) }, BASE))
  })
  handle('settings:setCivitaiKey', (key) => {
    const k = String(key || '').trim()
    if (k && !keysSafe()) throw new Error(KEY_STORE_MISSING)
    return publicSettings(writeSettings({ civitaiKey: seal(k) }, BASE))
  })
  // ---------- edits (the timeline editor) ----------
  const unpacked = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
  const edits = new Edits({
    dataDir: DATA,
    ffmpeg: unpacked(ffmpegStatic.ffmpegPath),
    ffprobe: unpacked(ffmpegStatic.ffprobePath),
    fontFile: path.join(resourcesDir(path.join(app.getAppPath(), 'resources')), 'fonts', 'BarlowCondensed-SemiBold.ttf')
  })
  // Reel: pictures and a song cut to the beat, as an edit (Workflows → Reel).
  const reels = new Reels({ dataDir: DATA, edits })
  handle('reels:make', (opts) => reels.make(opts))
  // Cut-outs: keep only who or what you name, see-through elsewhere (SAM 3.1 on this PC's ComfyUI).
  const cutouts = new Cutouts({ dataDir: DATA, studio: () => studio, edits })
  handle('cutouts:make', async (opts) => {
    await voices.release()
    const r = await cutouts.make(opts)
    return { ...r, media: await edits.addMedia(r.file, { type: 'cutout', from: opts.file, what: r.what }) }
  })
  // Reframe: a shot or picture in a new frame shape, with what lies beyond its edges drawn (H3 / Qwen outpaint).
  const reframes = new Reframes({ dataDir: DATA, studio: () => studio, edits, images: () => images })
  handle('reframes:make', async (opts) => {
    await voices.release()
    const r = /\.(png|jpe?g|webp|bmp)$/i.test(opts.file) ? await reframes.makePicture(opts) : await reframes.make(opts)
    return { ...r, media: await edits.addMedia(r.file, { type: 'reframe', from: opts.file, shape: r.shape }) }
  })
  // Crop and trim references before they go to H3 (Create's media editor).
  const mediaTools = new MediaTools({ dataDir: DATA, ffmpeg: edits.ffmpeg, ffprobe: edits.ffprobe })
  // ---------- Audio: voices (IV Studio's own engine speaks: VoxCPM2 and Whisper in its data folder) ----------
  voices = new Voices({ dataDir: DATA, resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')), ffmpeg: edits.ffmpeg, onLog: (line) => send('voices:log', line), comfy: () => (readSettings(BASE).target === 'cloud' ? null : studio.comfy) })
  handle('voices:status', () => voices.status())
  handle('voices:setup', () => voices.setup())
  handle('voices:list', async () => (await catalog?.attachVoices().catch(() => {}), voices.list()))
  handle('voices:design', (opts) => voices.design(opts))
  handle('voices:create', (opts) => voices.create(opts))
  handle('voices:update', (id, patch) => voices.update(id, patch))
  handle('voices:delete', (id) => {
    const r = voices.delete(id)
    studio.saveCharacters(studio.characters().map((c) => (c.voiceId === id ? { ...c, voiceId: null } : c)))
    return r
  })
  handle('voices:speak', (opts) => voices.speak(opts))
  handle('voices:lines', (voiceId) => voices.lines(voiceId))
  handle('voices:deleteLine', (id) => voices.deleteLine(id))
  handle('voices:transcribe', (file) => voices.transcribe(file))
  // ---------- Audio: music (MiniMax Music 3 and ACE-Step 1.5 on this PC's ComfyUI) ----------
  music = new Music({ studio, dataDir: DATA, probe: (f) => edits.probe(f) })
  handle('music:meta', () => ({ engines: MUSIC_ENGINES, defaults: MUSIC_DEFAULTS, keys: ACE_KEYS }))
  handle('music:status', () => music.status())
  handle('music:create', async (opts) => {
    await voices.release()
    return music.create(opts)
  })
  handle('music:list', () => music.list())
  handle('music:get', (id) => music.get(id))
  handle('music:rename', (id, name) => music.rename(id, name))
  handle('music:cancel', (id) => music.cancel(id))
  handle('music:delete', (id) => music.delete(id))
  // A file onto the end of a track of an edit (A1 for sound, V1 for video); no edit id makes a new edit.
  const putOnEdit = async (file, name, editId, type) => {
    const e = editId ? edits.get(editId) : edits.create(name)
    const m = await edits.addMedia(file, { type, label: name })
    const track = m.kind === 'audio' ? 'A1' : 'V1'
    const start = Math.max(0, ...e.clips.filter((c) => c.track === track).map((c) => c.start + (c.out - c.in)))
    const clip = { id: `c${m.id}`, track, media: m.id, start, in: 0, out: m.duration || 4, fadeIn: 0, fadeOut: 0, volume: 1, muted: false }
    return edits.save(e.id, { media: { ...e.media, [m.id]: m }, clips: [...e.clips, clip] })
  }
  handle('music:toEdit', async (id, editId = null) => {
    const song = await music.get(id)
    if (!song.file) throw new Error('That song has not finished yet.')
    return putOnEdit(song.file, song.name, editId, 'music')
  })
  // ---------- Create -> Image: pictures from the person's own image models ----------
  images = new Images({ studio, dataDir: DATA })
  handle('images:status', () => images.status())
  handle('images:create', async (opts) => {
    await voices.release()
    return images.create(opts)
  })
  handle('images:list', () => images.list())
  handle('images:get', (id) => images.get(id))
  handle('images:cancel', (id) => images.cancel(id))
  handle('images:delete', (id) => images.delete(id))
  handle('images:toEdit', async (file, name, editId = null) => putOnEdit(file, name, editId, 'iv'))
  // ---------- LoRAs: Civitai's H3 LoRAs and the ones on this PC ----------
  civitai = new Civitai({ dataDir: DATA, comfy: new Comfy(readSettings(BASE).comfyUrl), key: () => unseal(readSettings(BASE).civitaiKey), mature: () => !!readSettings(BASE).civitaiMature, onProgress: (u) => send('loras:progress', u) })
  handle('loras:meta', () => ({ tags: LORA_TAGS, sorts: LORA_SORTS, sites: CIVITAI_SITES, mature: !!readSettings(BASE).civitaiMature, hasKey: !!readSettings(BASE).civitaiKey }))
  handle('loras:search', (opts) => civitai.search(opts))
  handle('loras:model', (id) => civitai.model(id))
  handle('loras:download', (opts) => civitai.download(opts))
  handle('loras:downloads', () => civitai.downloadState())
  handle('loras:yours', () => civitai.yours())
  handle('loras:identify', (name) => civitai.identify(name))
  handle('loras:prefs', (name, patch) => civitai.setPrefs(name, patch))
  // ---------- Library: everything made in IV Studio, in one place ----------
  handle('library:all', () => {
    const items = studio.library().map((i) => ({ ...i, type: 'video' }))
    for (const e of edits.list()) {
      for (const x of edits.get(e.id).exports || []) if (x.file && fs.existsSync(x.file)) items.push({ key: `export:${x.file}`, type: 'video', group: 'Edit exports', label: `${e.name} · ${x.format || ''} ${x.fps || ''} fps`.trim(), at: x.at, file: { path: x.file }, set: `edit:${e.id}`, setName: e.name, variant: `${x.format || 'Export'} · ${x.fps || ''} fps`, rank: 0, editId: e.id })
    }
    for (const s of music.all()) if (s.file && fs.existsSync(s.file)) items.push({ key: `music:${s.id}`, type: 'music', group: 'Music', label: s.name, detail: `${s.engine === 'minimax' ? 'MiniMax Music 3' : 'ACE-Step 1.5'}${s.instrumental ? ' · instrumental' : ''}`, duration: s.duration, at: s.finishedAt || s.createdAt, file: { path: s.file }, set: `music:${s.id}`, setName: s.name, variant: 'Song', rank: 0 })
    for (const r of images.all()) (r.files || []).forEach((f, i) => fs.existsSync(f) && items.push({ key: `image:${r.id}:${i}`, type: 'image', group: 'Images', label: r.name, detail: `${r.familyLabel} · ${r.mode === 'edit' ? 'edit' : 'generate'}`, at: r.finishedAt || r.createdAt, file: { path: f }, set: `image:${r.id}`, setName: r.name, variant: `Picture ${i + 1}`, rank: i, imageId: r.id }))
    for (const l of voices.lines()) if (fs.existsSync(l.file)) items.push({ key: `line:${l.id}`, type: 'voice', group: 'Voice lines', label: l.text, detail: l.voice, duration: l.duration, at: l.createdAt, file: { path: l.file }, set: `line:${l.id}`, setName: l.text, variant: `Seed ${l.seed}`, rank: 0 })
    return items.sort((a, b) => String(b.at).localeCompare(String(a.at)))
  })
  handle('library:toEdit', async (item, editId = null) => putOnEdit(await localCopy(item.file), item.label.slice(0, 60), editId, item.type === 'video' ? 'iv' : item.type))
  // ---------- characters: design, clips, training on Modal, pick ----------
  // ---------- Shinobi: the agent-driven editor (OpenKatana engine), and face likeness ----------
  const shinobi = new Shinobi({ dataDir: DATA, resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')), ffmpegDir: path.dirname(edits.ffmpeg), onLog: (line) => send('shinobi:log', line) })
  const briefFile = (id) => path.join(shinobi.projectDir(id), 'iv-brief.md')
  handle('shinobi:status', () => shinobi.status())
  handle('shinobi:install', () => shinobi.install())
  handle('shinobi:faceModels', () => shinobi.installFaceModels((p) => send('shinobi:faceProgress', p)))
  handle('shinobi:projects', () => shinobi.projects())
  handle('shinobi:delete', (id) => shinobi.deleteProject(id))
  handle('shinobi:project', (id) => ({ ...shinobi.project(id), brief: fs.existsSync(briefFile(id)) ? fs.readFileSync(briefFile(id), 'utf8') : '' }))
  handle('shinobi:create', (name) => shinobi.call('create_project', { name: name || 'Untitled film' }))
  handle('shinobi:saveBrief', (id, text) => fs.writeFileSync(briefFile(id), String(text)))
  // Files from a dialog, or IV Studio renders (library items); clips over 64 MB import fine through the engine.
  handle('shinobi:importFiles', async (id) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'webm', 'mkv', 'm4v', 'wav', 'mp3', 'm4a', 'flac', 'ogg', 'png', 'jpg', 'jpeg', 'webp'] }] })
    for (const f of r.canceled ? [] : r.filePaths) await shinobi.call('import_media', { project_id: id, source: f, audio_only: false })
    return shinobi.project(id)
  })
  handle('shinobi:importRender', async (id, item) => {
    await shinobi.call('import_media', { project_id: id, source: await localCopy(item.file) })
    return shinobi.project(id)
  })
  handle('shinobi:importAudioOf', async (id, file) => {
    await shinobi.call('import_media', { project_id: id, source: file, audio_only: true })
    return shinobi.project(id)
  })
  handle('shinobi:presets', async () => (await shinobi.call('get_capabilities')).presets)
  handle('shinobi:call', (tool, args) => shinobi.call(tool, args))
  handle('shinobi:tools', () => shinobi.tools())
  // A new edit holding one video on V1 (a Shinobi or Replace result).
  const editWith = async (video, name, type) => {
    const e = edits.create(name || 'Untitled edit')
    const m = await edits.addMedia(video, { type, label: name })
    return edits.save(e.id, { media: { [m.id]: m }, clips: [{ id: 'c1', track: 'V1', media: m.id, start: 0, in: 0, out: m.duration || 4, fadeIn: 0, fadeOut: 0, volume: 1, muted: false }] })
  }
  handle('shinobi:addToEdit', (video, name) => editWith(video, name || 'Shinobi cut', 'shinobi'))

  // ---------- Replace: swap people or objects in a video (OpenJutsu's workflows) ----------
  replace = new Replace({ studio, resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')), dataDir: DATA, ffmpeg: edits.ffmpeg, ffprobe: edits.ffprobe })
  handle('replace:meta', () => ({ resolutions: RESOLUTIONS, maxCharacters: MAX_CHARACTERS, tone: DEFAULT_TONE, openjutsu: OPENJUTSU }))
  handle('replace:check', (mode) => replace.check(mode))
  handle('replace:run', (input) => replace.run({ ...input, character: input.characterId ? studio.characters().find((c) => c.id === input.characterId) : null }))
  handle('replace:history', () => replace.history())
  // Remake (remake.js): Replace's engine for swapping people and changing the scene
  remake = new Remake({ studio, images, faces: shinobi, dataDir: DATA, resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')), ffmpeg: edits.ffmpeg, ffprobe: edits.ffprobe, writer: () => writerOf(readSettings(BASE)) })
  replace.remake = remake
  const presetOf = (id) => (id ? studio.characters().find((c) => c.id === id) || null : null)
  handle('remake:meta', () => ({ credit: REMAKE_CREDIT }))
  handle('remake:check', (kind) => remake.check(kind))
  handle('remake:prepare', (input) => remake.prepare(input))
  handle('remake:get', (id) => remake.get(id))
  handle('remake:paint', (id, input) => remake.paint(id, { ...input, onProgress: (u) => send('remake:progress', { id, ...u }) }))
  handle('remake:usePicture', (id, frame, file) => remake.usePicture(id, frame, file))
  handle('remake:setKeyframe', (id, frame, opts) => remake.setKeyframe(id, frame, opts))
  handle('remake:write', (id) => remake.write(id))
  handle('remake:setPrompt', (id, prompt) => remake.setPrompt(id, prompt))
  handle('remake:render', (id, opts = {}) => remake.render(id, { ...opts, character: presetOf(opts.characterId) }))
  // who can go in: character presets with a face (their own or the ready-made catalogue's)
  handle('remake:faces', () =>
    studio
      .characters()
      .map((c) => ({ id: c.id, name: c.name, characterId: c.id, picture: studio.facePicture(c, resourcesDir(path.join(app.getAppPath(), 'resources'))), lora: !!c.lora }))
      .filter((f) => f.picture)
  )
  handle('replace:toEdit', async (file, name) => editWith(await localCopy(file), name, 'replace'))
  // Trained characters' picked faces, as pictures for Replace.
  handle('replace:characterFaces', async () => {
    const out = []
    for (const t of trainings.list()) {
      if (!t.cover) continue
      try {
        out.push({ id: t.id, name: t.name, characterId: t.characterId, picture: await studio.localCopy(t.cover, path.join(DATA, 'trainings', t.id, 'stills')) })
      } catch {}
    }
    return out
  })

  trainings = new Trainings({
    shinobi,
    dataDir: DATA,
    resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')),
    studio,
    ffmpeg: edits.ffmpeg,
    ffprobe: edits.ffprobe,
    onLog: (line, id) => send('training:log', { id, line }),
    onChange: (id) => send('training:changed', { id }),
    voices
  })
  handle('training:meta', () => ({ gpus: TRAIN_GPUS, scenes: SCENES, talks: TALKS }))

  // ---------- Website sizzle: a web address in, a promo film out (captured site, storyboard, pieces, Shinobi) ----------
  const sizzles = new Sizzles({ dataDir: DATA, studio, music, voices, trainings, shinobi, onLog: (line) => send('sizzle:log', line) })
  handle('sizzle:meta', () => ({ formats: SIZZLE_FORMATS, kinds: SCENE_KINDS }))
  handle('sizzle:list', () => sizzles.list())
  handle('sizzle:create', (input) => sizzles.create(input))
  handle('sizzle:get', (id) => sizzles.refresh(id))
  handle('sizzle:savePlan', (id, plan) => sizzles.savePlan(id, plan))
  handle('sizzle:approve', (id) => sizzles.approve(id))
  handle('sizzle:makeAssets', (id) => sizzles.makeAssets(id))
  handle('sizzle:toShinobi', (id) => sizzles.toShinobi(id))
  handle('sizzle:firstCut', (id, opts) => sizzles.firstCut(id, opts))
  handle('sizzle:delete', (id) => sizzles.remove(id))
  handle('training:list', () => trainings.list())
  handle('training:create', (init) => trainings.create(init))
  handle('training:get', (id) => trainings.refresh(id))
  handle('training:save', (id, patch) => trainings.save(id, patch))
  handle('training:delete', (id) => trainings.remove(id))
  handle('training:designFaces', (id, opts) => trainings.designFaces(id, opts))
  handle('training:pickFace', (id, pick) => trainings.pickFace(id, pick))
  handle('training:designScenes', (id) => trainings.designScenes(id))
  handle('training:rerollStill', (id, stillId) => trainings.rerollStill(id, stillId))
  handle('training:pickStill', (id, stillId, pick) => trainings.pickStill(id, stillId, pick))
  handle('training:addStills', async (id, caption) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
    return r.canceled ? trainings.get(id) : trainings.addStills(id, r.filePaths, caption)
  })
  handle('training:addClips', async (id, caption) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'webm', 'mkv', 'm4v'] }] })
    return r.canceled ? trainings.get(id) : trainings.addClips(id, r.filePaths, caption)
  })
  handle('training:setCaption', (id, kind, itemId, text) => trainings.setCaption(id, kind, itemId, text))
  handle('training:removeItem', (id, kind, itemId) => trainings.removeItem(id, kind, itemId))
  handle('training:makeClips', (id, opts) => trainings.makeClips(id, opts))
  handle('training:remakeClips', (id, clipIds) => trainings.remakeClips(id, clipIds))
  handle('training:rank', (id, opts) => trainings.rank(id, opts))
  handle('training:keepClip', (id, clipId, keep) => trainings.keepClip(id, clipId, keep))
  handle('training:estimate', (id, opts) => trainings.estimateFor(trainings.get(id), opts))
  handle('training:buildDataset', (id) => trainings.buildDataset(id))
  handle('training:openDataset', async (id) => shell.openPath((await trainings.buildDataset(id)).dir))
  handle('training:start', (id, opts) => trainings.startTraining(id, opts))
  handle('training:check', (id) => trainings.checkTraining(id))
  handle('training:stop', (id) => trainings.stopTraining(id))
  handle('training:checkpoints', (id) => trainings.listCheckpoints(id))
  handle('training:fetch', (id, epochs) => trainings.fetchCheckpoints(id, epochs))
  handle('training:test', (id, opts) => trainings.testCheckpoints(id, opts))
  handle('training:adopt', (id, epoch) => trainings.adopt(id, epoch))

  handle('media:probe', (file) => mediaTools.probe(file))
  handle('media:prepare', (opts) => mediaTools.prepare(opts))
  handle('edits:meta', () => ({ tracks: DEFAULT_TRACKS, formats: FORMATS, loudness: LOUDNESS }))
  handle('edits:list', () => edits.list())
  handle('edits:get', (id) => edits.get(id))
  handle('edits:create', (name) => edits.create(name))
  // An agent (the MCP server) can change edits and Settings -> Models too: an open edit reloads in the
  // window, and renders pick up the models. Saves from the window itself are not echoed back.
  const ownWrites = new Map() // edit id -> updatedAt of the window's last save
  handle('edits:save', (id, patch) => {
    const e = edits.save(id, patch)
    ownWrites.set(id, e.updatedAt)
    return e
  })
  const settle = new Map()
  const later = (key, fn) => {
    clearTimeout(settle.get(key))
    settle.set(key, setTimeout(fn, 200))
  }
  fs.mkdirSync(edits.dir, { recursive: true })
  fs.watch(edits.dir, (_, name) => {
    if (!name?.endsWith('.json')) return
    const id = name.slice(0, -5)
    later(id, () => {
      let e
      try {
        e = edits.get(id)
      } catch {
        return
      }
      if (e.updatedAt === ownWrites.get(id)) return
      ownWrites.set(id, e.updatedAt)
      send('edits:changed', { id, updatedAt: e.updatedAt })
    })
  })
  fs.watch(BASE, (_, name) => name === 'settings.json' && later('settings', () => (studio.models = readSettings(BASE).models || {})))
  handle('edits:delete', (id) => edits.remove(id))
  handle('edits:pickFiles', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'webm', 'mkv', 'm4v', 'wav', 'mp3', 'm4a', 'flac', 'ogg', 'png', 'jpg', 'jpeg', 'webp'] }] })
    return Promise.all((r.canceled ? [] : r.filePaths).map((f) => edits.addMedia(f)))
  })
  handle('edits:library', () => studio.library())
  handle('edits:addOutput', async (item) => edits.addMedia(await localCopy(item.file), { type: 'iv', label: item.label }))
  handle('edits:export', (id) => edits.export(id, path.join(videosDir(), 'Edits'), (p) => send('edits:progress', { id, progress: p })))
  handle('edits:cancelExport', (id) => edits.cancelExport(id))
  handle('edits:filmstrip', (file, duration) => edits.filmstrip(file, duration))
  handle('edits:peaks', (file) => edits.peaks(file))
  // New footage from inside an edit (extend, fill/bridge, retake): placeholders on the timeline until each lands.
  const editgen = new EditGen({ edits, studio: () => studio, localCopy, onChange: (id) => send('editgen:changed', { id, gens: editgen.view(id) }) })
  const genEdits = new Set(editgen.openEdits().map((x) => x.id))
  let genTick = 0
  setInterval(async () => {
    // an agent's MCP server can start generations too: look for edits with open ones every half minute
    if (++genTick % 8 === 0) for (const x of editgen.openEdits()) genEdits.add(x.id)
    for (const id of [...genEdits]) {
      try {
        await editgen.advance(id)
        send('editgen:changed', { id, gens: editgen.view(id) })
        if (!editgen.open(edits.get(id))) genEdits.delete(id)
      } catch {
        genEdits.delete(id)
      }
    }
  }, 4000)
  handle('editgen:list', (id) => (genEdits.add(id), editgen.view(id)))
  handle('editgen:prepare', (id, spec) => editgen.prepare(id, spec))
  handle('editgen:start', async (id, spec) => {
    const g = await editgen.start(id, spec)
    genEdits.add(id)
    return g
  })
  handle('editgen:pick', async (id, genId, n) => {
    const f = await editgen.pick(id, genId, n)
    genEdits.add(id)
    return f
  })
  handle('editgen:cancel', (id, genId) => editgen.cancel(id, genId))
  // ---------- Projects (a short film from script to rough cut) ----------
  const productions = new Productions({ dataDir: DATA, studio: () => studio, voices: () => voices, images: () => images, previs: () => previs, catalog: () => catalog, edits, localCopy, onChange: (id) => send('productions:changed', { id }), model: () => readSettings(BASE).ollamaModel || undefined, writer: () => writerOf(readSettings(BASE)) })
  handle('productions:list', () => productions.list())
  handle('productions:get', (id) => productions.view(id))
  handle('productions:create', (opts) => productions.create(opts))
  handle('productions:update', (id, patch) => productions.update(id, patch))
  handle('productions:delete', (id) => productions.remove(id))
  handle('productions:setScript', (id, text) => productions.setScript(id, text))
  handle('productions:writeScript', (id, opts) => productions.writeScript(id, opts))
  handle('productions:sketch', async (id, opts) => {
    await voices.release()
    return productions.sketch(id, opts)
  })
  handle('productions:breakDown', (id, opts) => productions.breakDown(id, opts))
  handle('productions:writePrompt', (id, sceneId, shotId) => productions.writeShotPrompt(id, sceneId, shotId))
  handle('productions:editShot', (id, sceneId, shotId, patch) => productions.editShot(id, sceneId, shotId, patch))
  handle('productions:speak', (id, shotId, opts) => productions.speak(id, shotId, opts))
  handle('productions:render', async (id, shotId, opts) => {
    const j = await productions.render(id, shotId, opts)
    pending.add(j.id)
    return j
  })
  handle('productions:renderScene', async (id, sceneId, opts) => {
    const jobs = await productions.renderScene(id, sceneId, opts)
    for (const j of jobs) pending.add(j.id)
    return jobs
  })
  handle('productions:finish', async (id, shotId, candidate, opts) => {
    const j = await productions.finish(id, shotId, candidate, opts)
    pending.add(j.id)
    return j
  })
  handle('productions:roughCut', (id) => productions.roughCut(id))
  handle('productions:animatic', (id, opts) => productions.animatic(id, opts))
  handle('productions:useRecording', (id, shotId, file) => productions.useRecording(id, shotId, file))
  handle('productions:drawFace', async (id, role, opts) => {
    await voices.release()
    return productions.drawFace(id, role, opts)
  })
  handle('productions:useFace', (id, role, file) => productions.useFace(id, role, file))
  handle('productions:drawAngles', async (id, locationId, opts) => {
    await voices.release()
    return productions.drawAngles(id, locationId, opts)
  })
  // The editor's full-screen workspace: the window itself goes full screen too.
  handle('window:fullScreen', (on) => {
    win.setFullScreen(!!on)
    return win.isFullScreen()
  })

  // ---------- cloud (Modal, the user's own account) ----------
  const cloud = new Cloud({ dataDir: DATA, resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')), onLog: (line) => send('cloud:log', line) })
  let cloudBusy = null
  const cloudTask = async (label, fn) => {
    if (cloudBusy) throw new Error(`Still busy: ${cloudBusy}.`)
    cloudBusy = label
    try {
      return await fn()
    } finally {
      cloudBusy = null
    }
  }
  const saveCloud = (patch) => writeSettings({ cloud: { ...(readSettings(BASE).cloud || {}), ...patch } }, BASE)
  const provider = () => readSettings(BASE).cloudProvider || 'modal'
  handle('cloud:status', async () => {
    const s = readSettings(BASE)
    const { url, podId, ...rp } = s.runpod || {}
    return {
      provider: s.cloudProvider || 'modal',
      toolkit: cloud.toolkitReady(),
      workspace: s.cloudProvider === 'runpod' || s.cloudProvider === 'comfycloud' ? null : await cloud.workspace(),
      cloud: s.cloud,
      runpod: { ...rp, hasKey: !!s.runpodKey, ready: !!(rp.modelsAt && s.runpodToken) },
      comfycloud: { ...(s.comfycloud || {}), hasKey: !!(s.comfyCloudKey || s.comfyApiKey), ownKey: !!s.comfyCloudKey },
      target: s.target,
      gpus: GPUS,
      runpodGpus: RUNPOD_GPUS,
      busy: cloudBusy,
      hasToken: !!s.cloudToken
    }
  })
  handle('cloud:provider', (p) => {
    if (readSettings(BASE).target === 'cloud') throw new Error('Switch rendering to My PC first.')
    writeSettings({ cloudProvider: ['runpod', 'comfycloud'].includes(p) ? p : 'modal' }, BASE)
    return p
  })
  // ---------- Comfy Cloud (comfycloud.js): Comfy's hosted ComfyUI, on the person's Comfy account ----------
  handle('cloud:comfyCloudKey', async (key) => {
    const k = String(key || '').trim()
    if (!k) return (writeSettings({ comfyCloudKey: null, comfycloud: null }, BASE), { hasKey: false })
    if (!keysSafe()) throw new Error(KEY_STORE_MISSING)
    await checkComfyCloudKey(k) // a wrong key, or one without an active plan, is refused before it's kept
    writeSettings({ comfyCloudKey: seal(k) }, BASE)
    return { hasKey: true }
  })
  // What IV Studio can do on Comfy Cloud today: asks it (free: no render runs) and keeps the answer for the page.
  handle('cloud:comfyCloudCheck', async () => {
    const key = comfyCloudKey()
    if (!key) throw new Error('Save your Comfy API key first.')
    const s = readSettings(BASE)
    const there = new Studio({ dataDir: DATA, resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')), models: s.models, comfyUrl: COMFY_CLOUD, comfyApiKey: key })
    const setup = await there.checkSetup()
    const reached = setup.items?.[0]?.status === 'ok'
    const [img, mus] = reached ? await Promise.all([new Images({ studio: there, dataDir: DATA }).status(), new Music({ studio: there, dataDir: DATA }).status()]) : [null, null]
    const survey = summariseComfyCloud({ setup, images: img, music: mus })
    if (!survey.reached) throw new Error(survey.error)
    writeSettings({ comfycloud: { survey, checkedAt: new Date().toISOString() } }, BASE)
    return survey
  })
  handle('cloud:install', () => cloudTask('installing the cloud tools', () => cloud.installToolkit()))
  handle('cloud:signIn', () => cloudTask('signing in to Modal', async () => (await cloud.signIn(), cloud.workspace())))
  handle('cloud:deploy', ({ gpu, idleSeconds }) =>
    cloudTask('setting up the cloud', async () => {
      const { url, token } = await cloud.deploy({ gpu, idleSeconds })
      writeSettings({ cloudToken: seal(token) }, BASE)
      saveCloud({ url, gpu, idleSeconds, workspace: await cloud.workspace(), deployedAt: new Date().toISOString() })
      return readSettings(BASE).cloud
    })
  )
  handle('cloud:fetchModels', () =>
    cloudTask('downloading the models', async () => {
      await cloud.fetchModels()
      return saveCloud({ modelsAt: new Date().toISOString() }).cloud
    })
  )
  // Each character's LoRA and the RefMods it uses, found through the local ComfyUI's model folders.
  handle('cloud:uploadCharacters', () =>
    cloudTask('uploading characters', async () => {
      const local = await fetch(`${readSettings(BASE).comfyUrl}/experiment/models`).then((r) => r.json())
      const roots = (name) => local.find((f) => f.name === name)?.folders || []
      const find = (kind, rel) => roots(kind).map((d) => path.join(d, rel)).find((p) => fs.existsSync(p))
      const done = []
      for (const c of studio.characters()) {
        const lora = find('loras', c.lora)
        if (lora) await cloud.uploadModel(lora, `loras/${c.lora.replace(/\\/g, '/')}`), done.push(c.lora)
        for (const r of [c.voiceRefmod, c.visualRefmod].filter(Boolean)) {
          const file = find('refmods', `${r}.safetensors`)
          if (file) await cloud.uploadModel(file, `refmods/${r}.safetensors`), done.push(r)
        }
      }
      saveCloud({ charactersAt: new Date().toISOString() })
      return done
    })
  )
  // ---------- cloud on RunPod (the user's own account; runpod.js) ----------
  const runpod = new RunPod({ resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')), key: () => unseal(readSettings(BASE).runpodKey), onLog: (line) => send('cloud:log', line) })
  const saveRunpod = (patch) => writeSettings({ runpod: { ...(readSettings(BASE).runpod || {}), ...patch } }, BASE)
  const runpodToken = () => unseal(readSettings(BASE).runpodToken)
  handle('cloud:runpodKey', async (key) => {
    const k = String(key || '').trim()
    if (!k) return (writeSettings({ runpodKey: null }, BASE), { hasKey: false })
    if (!keysSafe()) throw new Error(KEY_STORE_MISSING)
    await new RunPod({ resourcesDir: runpod.resourcesDir, key: () => k }).check() // a wrong key is refused before it's kept
    writeSettings({ runpodKey: seal(k) }, BASE)
    return { hasKey: true }
  })
  handle('cloud:runpodCatalog', () => runpod.catalog())
  // A running pod's address: the current one when its ComfyUI answers, else a booting one of ours, else a new
  // pod in the volume's data center. Single flight: the window and a render asking at once start one pod.
  let waking = null
  const wakeRunpod = () =>
    (waking ||= (async () => {
      const r = readSettings(BASE).runpod || {}
      if (!r.volumeId) throw new Error('Set up RunPod on the Cloud page first.')
      const current = r.url && (await runpod.health(r.url))
      if (current?.stage === 'ready') return r.url
      let url = current ? r.url : (await runpod.pods())[0]?.url
      if (!url) {
        send('cloud:log', 'Starting a cloud GPU on RunPod…')
        const pod = await runpod.createPod({ gpu: r.gpu || RUNPOD_GPUS[0].id, volume: { id: r.volumeId, dataCenter: r.dataCenter }, token: runpodToken(), idleSeconds: r.idleSeconds || 300 })
        url = pod.url
        saveRunpod({ url, podId: pod.id, podGpu: pod.gpu })
      } else saveRunpod({ url })
      await runpod.waitReady(url)
      return url
    })().finally(() => (waking = null)))
  // For the ComfyUI client: null when the pod it talks to still answers, else the address of one that does.
  runpodWake = async () => {
    const url = studio?.comfy.url
    if (url && (await runpod.health(url))?.stage === 'ready') return null
    return wakeRunpod()
  }
  // Each character's LoRA and the RefMods it uses, found through this PC's ComfyUI model folders.
  async function characterFiles() {
    const local = await fetch(`${readSettings(BASE).comfyUrl}/experiment/models`).then((r) => r.json())
    const roots = (name) => local.find((f) => f.name === name)?.folders || []
    const find = (kind, rel) => roots(kind).map((d) => path.join(d, rel)).find((p) => fs.existsSync(p))
    const files = []
    for (const c of studio.characters()) {
      const lora = find('loras', c.lora)
      if (lora) files.push({ file: lora, remote: `loras/${c.lora.replace(/\\/g, '/')}`, name: c.lora })
      for (const r of [c.voiceRefmod, c.visualRefmod].filter(Boolean)) {
        const file = find('refmods', `${r}.safetensors`)
        if (file) files.push({ file, remote: `refmods/${r}.safetensors`, name: r })
      }
    }
    return files
  }
  // Set up (and Set up again): the volume, a pod that installs ComfyUI and downloads the models onto it, then
  // the characters. A new gate token each time, so pods started with the old one are shut down first.
  handle('cloud:runpodSetUp', ({ gpu, idleSeconds }) =>
    cloudTask('setting up RunPod', async () => {
      const s = readSettings(BASE)
      if (s.target === 'cloud') throw new Error('Switch rendering to My PC first.')
      await runpod.stopAll()
      const known = s.runpod?.volumeId ? { id: s.runpod.volumeId, dataCenter: s.runpod.dataCenter } : null
      if (!known) send('cloud:log', 'Finding a data center with network storage and a free GPU…')
      const volume = known || (await runpod.ensureVolume(await runpod.pickDataCenter(gpu)))
      writeSettings({ runpodToken: seal(randomBytes(24).toString('base64url')) }, BASE)
      saveRunpod({ gpu, idleSeconds, volumeId: volume.id, dataCenter: volume.dataCenter, url: null, podId: null })
      send('cloud:log', `Starting a pod in ${volume.dataCenter}. The first time, it installs ComfyUI and downloads the H3 models onto your volume (20–40 minutes).`)
      const url = await wakeRunpod()
      saveRunpod({ modelsAt: new Date().toISOString(), setUpAt: new Date().toISOString() })
      const done = []
      for (const f of await characterFiles().catch(() => [])) {
        await runpod.uploadModel(url, runpodToken(), f.file, f.remote)
        done.push(f.name)
      }
      saveRunpod({ charactersAt: new Date().toISOString() })
      send('cloud:log', `Ready. ${done.length} character file${done.length === 1 ? '' : 's'} uploaded. The GPU shuts itself off after ${Math.round(idleSeconds / 60)} idle minutes.`)
      return readSettings(BASE).runpod
    })
  )
  handle('cloud:use', (target) => {
    const s = readSettings(BASE)
    if (target === 'cloud' && s.cloudProvider === 'comfycloud' && !comfyCloudKey(s)) throw new Error('Save your Comfy API key first.')
    if (target === 'cloud' && s.cloudProvider === 'runpod' && !(s.runpod?.modelsAt && s.runpodToken)) throw new Error('Set up RunPod first.')
    if (target === 'cloud' && (s.cloudProvider || 'modal') === 'modal' && !(s.cloud?.url && s.cloudToken)) throw new Error('Set up the cloud first.')
    writeSettings({ target: target === 'cloud' ? 'cloud' : 'local' }, BASE)
    makeStudio()
    return target
  })
  // What the cloud GPU is doing, for the title-bar meter: the running containers and the chosen GPU's rate.
  handle('cloud:usage', async () => {
    const s = readSettings(BASE)
    // Comfy Cloud bills per run on the person's Comfy account: no GPU of theirs runs between renders
    if (provider() === 'comfycloud') return { gpu: 'Comfy Cloud', perHour: 0, running: [], hosted: true }
    if (provider() === 'runpod') {
      const running = s.runpodKey ? await runpod.pods() : []
      const gpu = RUNPOD_GPUS.find((g) => g.id === (running[0]?.gpu || s.runpod?.gpu)) || RUNPOD_GPUS[0]
      return { gpu: gpu.label.split(' · ')[0], perHour: running[0]?.perHour || gpu.perHour, running: running.map((p) => ({ id: p.id, startedAt: Date.parse(p.startedAt) })) }
    }
    const gpu = GPUS.find((g) => g.id === s.cloud?.gpu) || GPUS[0]
    const running = cloud.toolkitReady() ? await cloud.containers() : []
    return { gpu: gpu.id, perHour: gpu.perHour, running: running.map((c) => ({ id: c.id, startedAt: Date.parse(String(c.startedAt).replace(' ', 'T')) })) }
  })
  // Stops the cloud GPU now (the "Shut down GPU" button). A render running there is lost.
  handle('cloud:stop', () => {
    if (cloudBusy) throw new Error(`Still busy: ${cloudBusy}.`)
    if (provider() === 'comfycloud') throw new Error('Comfy Cloud runs no GPU of yours between renders, so there is nothing to shut down.')
    if (provider() === 'runpod') return runpod.stopAll()
    if (!cloud.toolkitReady()) throw new Error('The cloud tools are not installed.')
    return cloud.stopGpu()
  })
  // Wakes the cloud GPU (a cold start loads ComfyUI; Modal holds the request until it is up).
  handle('cloud:wake', async () => {
    const t0 = Date.now()
    if (provider() === 'runpod') {
      studio.comfy.url = await wakeRunpod()
      const stats = await studio.comfy.req('/system_stats', { timeout: 60000 })
      return { seconds: Math.round((Date.now() - t0) / 1000), gpu: stats.devices?.[0]?.name }
    }
    for (;;) {
      try {
        const stats = await studio.comfy.req('/system_stats', { timeout: 600000 })
        return { seconds: Math.round((Date.now() - t0) / 1000), gpu: stats.devices?.[0]?.name }
      } catch (err) {
        if (!err.starting || Date.now() - t0 > 900000) throw err
        await new Promise((r) => setTimeout(r, 5000))
      }
    }
  })
  handle('prompts:status', async () => ({ ...(await ollamaStatus()), engine: readSettings(BASE).promptEngine, model: readSettings(BASE).ollamaModel, hasComfyKey: !!readSettings(BASE).comfyApiKey, contextIrPrice: CONTEXT_IR_PRICE, harnesses: harnessStatus() }))
  handle('prompts:write', (request) => {
    const s = readSettings(BASE)
    const w = writerOf(request?.engine ? { ...s, promptEngine: request.engine } : s)
    return studio.writePrompt(request, { engine: w.engine, apiKey: w.engine === 'contextir' ? comfyKey() : null, model: w.model })
  })
  handle('prompts:story', (request) => {
    const w = writerOf(readSettings(BASE))
    return studio.writeStory(request, w.engine === 'claude' || w.engine === 'codex' ? w : { model: readSettings(BASE).ollamaModel })
  })
  handle('prompts:pull', (model) => pullModel(model, (ev) => send('prompts:pull', { model, ...ev })))
  handle('settings:set', (patch) => {
    const { comfyApiKey, cloudToken, civitaiKey, cloud, target, cloudProvider, runpod, runpodKey, runpodToken, comfyCloudKey: _ck, comfycloud, ...safe } = patch || {}
    if ('ollamaUrl' in safe) {
      try {
        safe.ollamaUrl = normalizeOllamaUrl(safe.ollamaUrl)
      } catch {
        throw new Error('That isn’t an address. Use host:port, like 192.168.1.20:11434 or http://ollama:11434.')
      }
    }
    const s = publicSettings(writeSettings(safe, BASE))
    if ('comfyUrl' in (patch || {})) makeStudio()
    if ('models' in (patch || {})) studio.models = s.models || {}
    // the render folders apply to the next render
    studio.comfy.folders = comfyFolders(readSettings(BASE), INCOGNITO)
    return s
  })
  handle('setup:check', () => studio.checkSetup())
  handle('setup:installNodes', () => studio.installNodePacks({ folder: readSettings(BASE).comfyFolder || null, onProgress: (u) => send('setup:nodes', u) }))

  // ---------- starting ComfyUI (comfylauncher.js) ----------
  // The launcher is comfylauncher.js launcherFor: the one picked in Settings, else the best one in the ComfyUI
  // folder picked there, else the best one found on this PC. The window hears
  // comfy:state ({state: 'starting' | 'up' | 'failed', detail}) and rechecks when ComfyUI is up.
  let comfyStarting = null
  const launcherOf = launcherFor
  const startComfy = () =>
    (comfyStarting ||= (async () => {
      const s = readSettings(BASE)
      if (!isLocalUrl(s.comfyUrl)) throw new Error('ComfyUI isn’t on this PC (Settings → ComfyUI), so IV Studio can’t start it.')
      if (await comfyUp(s.comfyUrl)) return { seconds: 0, already: true }
      const file = launcherOf(s)
      if (!file) throw new Error('No ComfyUI launcher found. Pick one in Settings → ComfyUI.')
      send('comfy:state', { state: 'starting', detail: path.basename(file) })
      try {
        launchComfy(file, { logFile: path.join(DATA, 'comfyui.log') })
        const up = await waitUp(s.comfyUrl)
        send('comfy:state', { state: 'up', detail: `ComfyUI started in ${up.seconds} s.` })
        return up
      } catch (err) {
        send('comfy:state', { state: 'failed', detail: err.message })
        throw err
      }
    })().finally(() => (comfyStarting = null)))
  handle('comfy:launcher', () => {
    const s = readSettings(BASE)
    const folder = s.comfyFolder && fs.existsSync(s.comfyFolder) ? s.comfyFolder : null
    return { chosen: s.comfyLauncher || null, using: launcherOf(s), folder, inFolder: folder ? launchersIn(folder) : [], found: findLaunchers(), autoStart: s.comfyAutoStart !== false, local: isLocalUrl(s.comfyUrl) && s.target !== 'cloud', starting: !!comfyStarting }
  })
  handle('comfy:chooseLauncher', async () => {
    const filters =
      process.platform === 'win32'
        ? [{ name: 'Shortcut, .bat or ComfyUI.exe', extensions: ['lnk', 'bat', 'cmd', 'exe'] }]
        : process.platform === 'darwin'
          ? [{ name: 'ComfyUI.app, a shell script or main.py', extensions: ['app', 'sh', 'py'] }]
          : [{ name: 'Shell script or main.py', extensions: ['sh', 'py', 'AppImage'] }]
    const r = await dialog.showOpenDialog(win, { title: 'Start ComfyUI with', properties: ['openFile'], filters })
    if (r.canceled || !r.filePaths[0]) return null
    writeSettings({ comfyLauncher: r.filePaths[0] }, BASE)
    return r.filePaths[0]
  })
  // The main ComfyUI folder: IV Studio starts it with the best launcher in it (or the one picked from it).
  handle('comfy:chooseFolder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Your ComfyUI folder', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    const dir = r.filePaths[0]
    if (!isComfyFolder(dir)) throw new Error(process.platform === 'win32' ? 'That folder doesn’t look like ComfyUI. Pick the folder that holds ComfyUI (its main.py, or run_nvidia_gpu.bat and the ComfyUI folder), or ComfyUI.exe’s folder.' : 'That folder doesn’t look like ComfyUI. Pick the folder that holds its main.py.')
    writeSettings({ comfyFolder: dir, comfyLauncher: '' }, BASE)
    return dir
  })
  handle('comfy:start', () => startComfy())

  // ---------- updating ComfyUI, its node packs and ComfyUI-Manager (studio.js, comfyupdate.js) ----------
  // The window hears setup:updates ({ phase: 'snapshot' | 'updating' | 'restoring' | 'restarting' | 'done', done, total }).
  handle('setup:updates:check', () => studio.comfyUpdates({ launcher: launcherFor(readSettings(BASE)) }))
  handle('setup:updates:run', () => {
    const s = readSettings(BASE)
    return studio.updateComfy({ folder: s.comfyFolder || null, launcher: launcherFor(s), onProgress: (u) => send('setup:updates', u) })
  })
  handle('setup:updates:undo', () => studio.undoComfyUpdate({ folder: readSettings(BASE).comfyFolder || null, start: startComfy, onProgress: (u) => send('setup:updates', u) }))
  handle('setup:updates:installManager', () => studio.installManager({ folder: readSettings(BASE).comfyFolder || null, onProgress: (u) => send('setup:nodes', u) }))
  // Settings -> Agents: what to paste into an agent, and the Claude Code skill (with this install's command).
  const skillFile = path.join(app.getPath('home'), '.claude', 'skills', 'iv-studio', 'SKILL.md')
  const skillText = () => skillMarkdown(readGuide(resourcesDir(path.join(app.getAppPath(), 'resources'))), mcpCommand())
  handle('agents:info', () => {
    const installed = fs.existsSync(skillFile)
    return { paste: pasteMessage(mcpCommand()), skillFile, skillInstalled: installed, skillCurrent: installed && fs.readFileSync(skillFile, 'utf8') === skillText() }
  })
  handle('agents:installSkill', () => {
    fs.mkdirSync(path.dirname(skillFile), { recursive: true })
    fs.writeFileSync(skillFile, skillText())
    return skillFile
  })
  handle('models:h3', () => studio.h3Models())
  handle('models:status', () => installer.status())
  handle('models:download', (ids) => installer.enqueue(ids))
  handle('models:cancel', (id) => installer.cancel(id))
  handle('characters:list', async () => (await catalog?.attachVoices().catch(() => {}), studio.characters()))
  // Ready-made characters: bundled picture, LoRA downloaded on request (resources/characters/catalog.json).
  catalog = new CharacterCatalog({ studio, voices, resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')) })
  handle('characters:catalog', () => catalog.list())
  handle('characters:install', (id) => catalog.install(id, (cid, p) => send('characters:progress', { id: cid, progress: p })))
  handle('characters:loras', () => studio.loraNames())
  handle('characters:save', (list) => studio.saveCharacters(list))
  handle('projects:list', () =>
    studio.listProjects().filter((p) => !p.sequenceId && !p.trainingId && !p.tool).map((p) => {
      const jobs = studio.listJobs(p.id)
      const finals = jobs.flatMap((j) => j.outputs.filter((o) => o.kind === 'final'))
      const previews = jobs.flatMap((j) => j.outputs.filter((o) => o.kind === 'preview'))
      return { ...p, jobCount: jobs.length, cover: (finals.at(-1) || previews.at(-1))?.url || null, finals: finals.length, running: jobs.some((j) => !['success', 'error', 'cancelled'].includes(j.status)) }
    })
  )
  handle('sequences:list', () => studio.listSequences())
  handle('sequences:get', (id) => studio.refreshSequence(id))
  handle('sequences:create', (init) => studio.createSequence(init))
  handle('sequences:save', (id, patch) => studio.saveSequence(id, patch))
  handle('sequences:delete', (id) => studio.deleteSequence(id))
  const track = async (p) => {
    const job = await p
    pending.add(job.id)
    return job
  }
  handle('sequences:take', (id) => track(studio.renderTake(id)))
  handle('sequences:retake', (id, opts) => track(studio.retakeSequence(id, opts)))
  handle('sequences:renderOut', (id, opts) => track(studio.renderOutSequence(id, opts)))
  handle('sequences:huntShot', (id, index, opts) => track(studio.huntShot(id, index, opts)))
  handle('sequences:finishShot', (id, index, opts) => track(studio.finishShot(id, index, opts)))
  handle('projects:get', (id) => ({ project: studio.getProject(id), jobs: studio.listJobs(id) }))
  handle('projects:rename', (id, name) => studio.renameProject(id, name))
  handle('projects:delete', (id) => studio.deleteProject(id))
  handle('render:plan', (request, finish) => studio.planRender(request, finish))
  handle('render:planFinish', (jobId, finish) => studio.planFinishJob(jobId, finish))
  // A voice engine still holding the GPU would slow H3 down: let it go before a render on this PC.
  const freeVoices = () => (readSettings(BASE).target === 'cloud' ? null : voices.release())
  // Take ranking: after a previews run finishes, and when asked; picks teach it
  ranker = new Ranker({ studio: () => studio, voices: () => voices, shinobi: () => shinobi, ffmpeg: edits.ffmpeg, dataDir: DATA })
  handle('rank:job', async (id) => (await ranker.rank(id), studio.publicJob(studio.getJob(id))))
  handle('rank:learn', (id, candidate) => ranker.learn(id, candidate))
  reviewer = new Reviewer({ studio: () => studio, voices: () => voices, ffmpeg: edits.ffmpeg })
  handle('review:take', async (id, candidate) => (await reviewer.review(id, candidate, writerOf(readSettings(BASE))), studio.publicJob(studio.getJob(id))))
  // a staging board in motion: a grey previs clip for <Video n> (Edge or Chrome draws it, about 3 s)
  const previs = new Previs({ resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')), dataDir: DATA, browser: () => shinobi.browser(), ffmpeg: edits.ffmpeg })
  handle('previs:make', (opts) => previs.make(opts))
  handle('render:enhance', async (opts) => {
    await freeVoices()
    const job = await studio.enhanceFinal(opts)
    pending.add(job.id)
    return job
  })
  // The title bar's GPU and memory readout: this PC's RAM, and the GPU as ComfyUI sees it (none in cloud mode).
  handle('system:stats', async () => {
    if (readSettings(BASE).target === 'cloud') return null
    const st = await studio.comfy.systemStats().catch(() => null)
    const d = st?.devices?.[0]
    return {
      ram: { total: os.totalmem(), free: os.freemem() },
      gpu: d ? { name: String(d.name).replace(/^cuda:\d+\s*/, '').replace(/\s*:.*$/, ''), total: d.vram_total, free: d.vram_free, comfyHeld: d.torch_vram_total } : null
    }
  })
  // The title bar's Free memory: ComfyUI unloads its models and frees memory (between prompts, so a running render
  // carries on), IV Studio's voice engine stops, and Ollama lets go of a writer model. Returns what changed.
  handle('system:free', async () => {
    const vram = async () => {
      const d = (await studio.comfy.systemStats().catch(() => null))?.devices?.[0]
      return d ? d.vram_total - d.vram_free : null
    }
    const before = { vram: await vram(), ram: os.totalmem() - os.freemem() }
    await studio.comfy.freeMemory().catch(() => {})
    if (readSettings(BASE).target !== 'cloud') await voices.release().catch(() => {})
    const ollama = await unloadOllama()
    const busy = !!(await studio.comfy.queue().catch(() => null))?.queue_running?.length
    // ComfyUI unloads in its own worker loop a few seconds after /free: wait until the GPU number settles
    // (up to 12 s; not while a render holds it), or the result undercounts (it said 7.2 GB when 17 GB went)
    let last = before.vram
    for (let i = 0, still = 0; i < (busy ? 2 : 12) && still < 2; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      const v = await vram()
      still = v != null && last != null && last - v < 100 * 1024 ** 2 && i >= 2 ? still + 1 : 0
      last = v
    }
    const after = { vram: await vram(), ram: os.totalmem() - os.freemem() }
    return { before, after, ollama, busy }
  })
  // @ mentions: the cast (characters) and places a prompt can name, and the places themselves
  handle('cast:list', () => studio.cast.members())
  handle('cast:places', () => studio.cast.places())
  handle('cast:savePlace', (place) => studio.cast.savePlace(place))
  handle('cast:deletePlace', (id) => studio.cast.deletePlace(id))
  handle('render:previews', async (request) => {
    await freeVoices()
    const job = await studio.generatePreviews(request)
    pending.add(job.id)
    return job
  })
  handle('render:finish', async (opts) => {
    await freeVoices()
    const job = await studio.finishCandidate(opts)
    pending.add(job.id)
    return job
  })
  handle('jobs:watch', (ids) => {
    for (const id of ids || []) pending.add(id)
    pump()
    return true
  })
  handle('jobs:cancel', (id) => studio.cancelJob(id))
  // The sidebar's render queue, and its cancel (only for IV Studio's own work, never someone else's).
  handle('queue:list', () => studio.renderQueue())
  handle('queue:cancel', async (promptId) => {
    const { items } = await studio.renderQueue()
    const item = items.find((i) => i.promptId === promptId)
    if (!item) return 'already finished'
    if (!item.ours) throw new Error("That render isn't IV Studio's, so it is left alone.")
    return studio.cancelQueued(promptId)
  })
  handle('files:pick', async (kind) => {
    const filters = {
      picture: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      video: [{ name: 'Videos', extensions: ['mp4', 'mov', 'webm', 'mkv'] }],
      audio: [{ name: 'Audio', extensions: ['wav', 'mp3', 'flac', 'm4a', 'ogg'] }]
    }[kind]
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', ...(kind === 'picture' ? ['multiSelections'] : [])], filters })
    return r.canceled ? [] : r.filePaths
  })
  // A path on this PC opens in Explorer. An output that lives in the cloud is downloaded to
  // Videos\IV Studio first (same file name), then shown.
  handle('files:reveal', async (file) => {
    const p = await localCopy(file)
    shell.showItemInFolder(p)
    return p
  })
  // Learn's guide: the bundled PDF (resources/guide), copied to the data folder first so it opens from a normal
  // path (an AppImage's resources live in a temporary mount), then opened in the PC's PDF viewer.
  handle('learn:openGuide', async () => {
    const src = path.join(resourcesDir(path.join(app.getAppPath(), 'resources')), 'guide', 'IV Studio Guide.pdf')
    const dest = path.join(BASE, 'guide', `IV Studio Guide ${app.getVersion()}.pdf`)
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(src, dest)
    }
    const err = await shell.openPath(dest)
    if (err) throw new Error(`Couldn’t open the guide: ${err}`)
    return dest
  })
  handle('links:open', (url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url)
    return true
  })

  // ---------- updates ----------
  // Restarting stops work this process is doing itself, so the update waits for it. Renders keep going in
  // ComfyUI either way.
  const busy = () =>
    [
      edits.exports.size && 'an edit is exporting',
      installer?.running && 'models are downloading',
      Object.values(civitai.downloadState()).some((d) => d.status === 'downloading') && 'a LoRA is downloading'
    ].filter(Boolean)
  const updater = initUpdater((state) => send('update:changed', state))
  handle('update:state', () => updateState())
  handle('update:check', () => updater.check())
  handle('update:install', () => {
    // a Mac only opens the download page, which needs nothing to finish first
    if (UPDATE_MANUAL) return updater.install()
    const waits = busy()
    if (waits.length) throw new Error(`Restart when it's done: ${waits.join(' and ')}.`)
    return updater.install()
  })

  // ---------- Incognito ----------
  // Switching restarts the app into the other set of data (see BASE / DATA). Leaving Incognito also takes
  // its renders out of ComfyUI's history, whose queue panel would show them; the files stay in IV Private.
  handle('incognito:set', async (on) => {
    if (!!on === INCOGNITO) return { on: INCOGNITO }
    const waits = [...busy(), pending.size && 'a render is running'].filter(Boolean)
    if (waits.length) throw new Error(`Switch when it's done: ${waits.join(' and ')}.`)
    if (INCOGNITO && !studio.comfy.remote) {
      const dir = path.join(DATA, 'jobs')
      const promptOf = (f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).promptId || []
        } catch {
          return []
        }
      }
      await studio.comfy.deleteHistory(fs.existsSync(dir) ? fs.readdirSync(dir).flatMap(promptOf) : []).catch(() => {})
    }
    writeSettings({ incognito: !!on }, BASE)
    setTimeout(() => (app.relaunch(), app.exit(0)), 200)
    return { on: !!on, restarting: true }
  })
  createWindow()
  // Start ComfyUI when IV Studio opens (Settings → ComfyUI), only for a ComfyUI on this PC that isn't up yet.
  const boot = readSettings(BASE)
  if (boot.comfyAutoStart !== false && boot.target !== 'cloud' && isLocalUrl(boot.comfyUrl) && (!TEST_COPY || process.env.IV_STUDIO_COMFY_AUTOSTART === '1'))
    comfyUp(boot.comfyUrl).then((up) => up || startComfy().catch(() => {}))
})

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})
app.on('window-all-closed', () => app.quit())
// the voice engine is a Python process of ours: stop it with the app
app.on('will-quit', () => voices?.release())
