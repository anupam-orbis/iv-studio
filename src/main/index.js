import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, protocol, safeStorage, screen, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { comfyFolders, dataLocation, incognitoDir, readSettings, resourcesDir, videosFolderOf, writerOf, writeSettings } from '../service/paths'
import { chooseTarget, copyData, discardCopy, freeBytes, listData, movableEntries, oldCopy, removeOldCopy, verifyCopy, writePointer } from '../service/datafolder'
import { EXTRA_BIN, harnessStatus } from '../service/harness'
import { pasteMessage, skillMarkdown, readGuide } from '../service/agent'
import { Cloud, GPUS, MODAL_VERSION } from '../service/cloud'
import { SetupProgress, about } from '../service/setupprogress'
import { RunPod, GPUS as RUNPOD_GPUS } from '../service/runpod'
import { MODEL_GROUPS, recommend, scanHardware } from '../service/hardware'
import { comboOptions } from '../service/setup'
import { comfyHome, comfyUp, findComfyElsewhere, findLaunchers, isComfyFolder, isLocalUrl, launch as launchComfy, launcherFor, launchersIn, waitUp } from '../service/comfylauncher'
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
import { findFizgig, LOCAL_TRAIN, RUNPOD_TRAIN_GPUS, SCENES, TALKS, TRAIN_DEFAULTS, TRAIN_GPUS, Trainings } from '../service/training'
import { Shinobi } from '../service/shinobi'
import { CharacterCatalog } from '../service/characters'
import { Replace, RESOLUTIONS, MAX_CHARACTERS, DEFAULT_TONE, OPENJUTSU } from '../service/replace'
import { CREDIT as REMAKE_CREDIT, Remake } from '../service/remake'
import { lintPrompt } from '../service/lint'
import { Reader } from '../service/reader'
import { Rebuilds } from '../service/rebuild'
import { Voices } from '../service/voices'
import { ACE_KEYS, monoDecoder, Music, MUSIC_DEFAULTS, MUSIC_ENGINES, REMIX } from '../service/music'
import { Images } from '../service/images'
import { RefMods } from '../service/refmods'
import { Civitai, CIVITAI_SITES, LORA_SORTS, LORA_TAGS } from '../service/civitai'
import { Comfy } from '../service/comfy'
import { checkKey as checkComfyCloudKey, COMFY_CLOUD, summarise as summariseComfyCloud } from '../service/comfycloud'

// An app opened from Finder gets a short PATH (/usr/bin:/bin:/usr/sbin:/sbin), so the tools IV Studio runs (Claude
// Code, Codex, Ollama, git) and what they need (node) would not be found; add the usual install folders.
if (process.platform === 'darwin') process.env.PATH = [...new Set([...String(process.env.PATH || '').split(':'), ...EXTRA_BIN()].filter(Boolean))].join(':')
// Where the data folder is (paths.js): IV_STUDIO_DATA, a "data" folder beside IV Studio.exe (the portable zip),
// the folder it was moved to in Settings, or the default. A portable copy keeps the window's own files there too,
// so it leaves nothing behind in %APPDATA%.
const LOCATION = dataLocation()
const PORTABLE = LOCATION.source === 'portable'
if (process.env.IV_STUDIO_USER_DATA) app.setPath('userData', process.env.IV_STUDIO_USER_DATA)
else if (PORTABLE) app.setPath('userData', path.join(LOCATION.dir, 'browser'))
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
// A moved data folder that isn't there (its drive unplugged) is asked about first thing (below); until then
// this run reads the default folder and writes nothing.
const BASE = LOCATION.missing ? LOCATION.defaultDir : LOCATION.dir
// the writer's Ollama: Settings → Prompt writer → Ollama address (prompter.js)
setOllamaSource(() => readSettings(BASE).ollamaUrl)
const INCOGNITO = !!readSettings(BASE).incognito
const DATA = INCOGNITO ? incognitoDir(BASE) : BASE
// Downloads and exports: Videos\IV Studio, or a folder inside the Incognito data
const videosDir = () => videosFolderOf(readSettings(BASE), { incognito: INCOGNITO, dataDir: DATA, videos: app.getPath('videos') })
let win = null
let studio = null
// Settings → Accessibility → Text size: the whole window scales, like browser zoom
const TEXT_SIZES = { normal: 1, large: 1.15, larger: 1.3 }
let refitZoom = () => {}
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
  // A window whose page crashed, or whose graphics process did (seen as a blank window on a low-end PC), loads
  // itself again instead of staying blank; at most once in 30 s, so a crash that repeats doesn't loop. Each one is
  // noted in logs\window.log in the data folder.
  let reloadedAt = 0
  const note = (line) => {
    try {
      fs.mkdirSync(path.join(BASE, 'logs'), { recursive: true })
      fs.appendFileSync(path.join(BASE, 'logs', 'window.log'), `${new Date().toISOString()} ${line}\n`)
    } catch {}
  }
  const recover = (why) => {
    note(why)
    if (!win || win.isDestroyed() || Date.now() - reloadedAt < 30000) return
    reloadedAt = Date.now()
    setTimeout(() => win && !win.isDestroyed() && win.webContents.reload(), 600)
  }
  win.webContents.on('render-process-gone', (_e, d) => d.reason !== 'clean-exit' && recover(`page gone: ${d.reason} (exit ${d.exitCode}); reloading`))
  win.webContents.on('unresponsive', () => note('page not responding'))
  win.webContents.on('responsive', () => note('page responding again'))
  if (!createWindow.watching) {
    createWindow.watching = true
    app.on('child-process-gone', (_e, d) => d.type === 'GPU' && d.reason !== 'clean-exit' && recover(`graphics process gone: ${d.reason} (exit ${d.exitCode}); reloading`))
  }
  // A bigger window gets a bigger interface, so a full-screen window on a large monitor isn't a small laptop-sized
  // layout in one corner. Pages are laid out for about 1600 x 1000; past that everything scales up together (like
  // browser zoom, so the layout's own breakpoints still apply), to 150% at most.
  let zoomTimer = null
  const fitZoom = () => {
    if (!win || win.isDestroyed()) return
    const [w, h] = win.getContentSize()
    // Settings → Accessibility → Text size scales on top
    const scale = TEXT_SIZES[readSettings(BASE).textSize] || 1
    const z = Math.round(Math.min(1.5, Math.max(1, Math.min(w / 1600, h / 1000))) * scale * 20) / 20
    if (Math.abs(win.webContents.getZoomFactor() - z) < 0.01) return
    win.webContents.setZoomFactor(z)
    // the window buttons are drawn by the system over the 40 px bar: keep them the bar's (scaled) height
    try {
      if (process.platform === 'darwin') win.setWindowButtonPosition({ x: 14, y: Math.round(20 * z - 7) })
      else win.setTitleBarOverlay({ color: BG, symbolColor: '#f1ede5', height: Math.round(40 * z) })
    } catch {}
  }
  for (const ev of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, () => (clearTimeout(zoomTimer), (zoomTimer = setTimeout(fitZoom, 120))))
  win.webContents.on('did-finish-load', fitZoom)
  refitZoom = fitZoom
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
    fs.writeFileSync(path.join(dir, 'smoke.json'), JSON.stringify({ platform: process.platform, version: app.getVersion(), dataDir: DATA, dataSource: LOCATION.source, userData: app.getPath('userData'), mcp: mcpCommand(), pages, errors }, null, 2))
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

// The data folder was moved to a drive that isn't there: try again (after plugging it in), use the default
// folder for this run, or quit. Returns false when IV Studio is restarting or quitting.
function missingDataFolder() {
  if (!LOCATION.missing) return true
  const r = dialog.showMessageBoxSync({
    type: 'warning',
    title: 'IV Studio',
    message: 'IV Studio can’t find its data folder',
    detail: `Your projects, voices and settings were moved to\n${LOCATION.dir}\nbut that folder isn’t there. If it’s on a drive that isn’t plugged in, connect it and press Try again.\n\nUse the default folder opens IV Studio with the data in ${LOCATION.defaultDir} for now; your moved data isn’t touched.`,
    buttons: ['Try again', 'Use the default folder', 'Quit'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  })
  if (r === 1) return true
  if (r === 0) app.relaunch()
  app.exit(0)
  return false
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  if (!missingDataFolder()) return
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
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, dataDir: DATA, dataSource: LOCATION.missing ? 'default' : LOCATION.source, portable: PORTABLE, mcp: mcpCommand(), testCopy: TEST_COPY, incognito: INCOGNITO, links }))
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
  music = new Music({ studio, dataDir: DATA, probe: (f) => edits.probe(f), decode: monoDecoder((a) => edits.run(a)) })
  handle('music:meta', () => ({ engines: MUSIC_ENGINES, defaults: MUSIC_DEFAULTS, keys: ACE_KEYS, remix: REMIX }))
  handle('music:status', () => music.status())
  handle('music:create', async (opts) => {
    await voices.release()
    return music.create(opts)
  })
  handle('music:analyse', (opts) => music.analyse(opts))
  handle('music:remix', async (opts) => {
    await voices.release()
    return music.remix(opts)
  })
  handle('music:pickSong', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'A song to remix', properties: ['openFile'], filters: [{ name: 'Sound', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wma'] }] })
    return r.canceled ? null : r.filePaths[0]
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
  // Rebuild (rebuild.js): a video read into shots and remade. The agent tools (MCP) drive the plan; this page starts
  // one, shows where it is and gives the person's OKs. Built the way the MCP server builds it.
  const rebuilds = new Rebuilds({ dataDir: DATA, reader: new Reader({ ffmpeg: edits.ffmpeg, ffprobe: edits.ffprobe, run: (a) => edits.run(a), runErr: (a) => edits.runErr(a), beatsOf: (f) => reels.beatsOf(f), voices }), studio, images, remake, edits, writer: () => writerOf(readSettings(BASE)), lint: lintPrompt, onLog: (line) => send('rebuild:log', line) })
  const rebuildView = async (id) => {
    const r = rebuilds.get(id)
    return rebuilds.view(['rendering', 'ready'].includes(r.status) ? await rebuilds.refresh(id) : r)
  }
  handle('rebuild:list', () => rebuilds.list())
  handle('rebuild:get', (id) => rebuildView(id))
  handle('rebuild:pickVideo', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'A video to rebuild', properties: ['openFile'], filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv'] }] })
    return r.canceled ? null : r.filePaths[0]
  })
  handle('rebuild:read', async (opts) => rebuilds.view(await rebuilds.read(opts)))
  handle('rebuild:readWithWriter', async (id) => rebuilds.view(await rebuilds.readWithWriter(id)))
  handle('rebuild:approvePlan', (id) => rebuilds.view(rebuilds.approvePlan(id)))
  handle('rebuild:makeFrames', async (id) => rebuilds.view(await rebuilds.makeFrames(id)))
  handle('rebuild:approveFrames', (id) => rebuilds.view(rebuilds.approveFrames(id)))
  handle('rebuild:makeShots', async (id) => rebuilds.view(await rebuilds.makeShots(id)))
  handle('rebuild:pick', (id, index, candidate) => rebuilds.view(rebuilds.pick(id, index, candidate)))
  handle('rebuild:firstCut', (id) => rebuilds.firstCut(id))
  handle('rebuild:delete', (id) => rebuilds.remove(id))
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
  handle('training:meta', () => ({ gpus: TRAIN_GPUS, gpusBy: { modal: TRAIN_GPUS, runpod: RUNPOD_TRAIN_GPUS, local: [LOCAL_TRAIN] }, scenes: SCENES, talks: TALKS, trainDefaults: TRAIN_DEFAULTS }))
  // training on this PC: Fizgig's folder and the five H3 files
  handle('training:localCheck', async () => {
    const fiz = findFizgig(readSettings(BASE).fizgigFolder || '')
    let missing = null
    try {
      missing = (await trainings.localFiles()).missing
    } catch (err) {
      return { fizgig: fiz?.dir || null, missing: null, error: err.message }
    }
    return { fizgig: fiz?.dir || null, missing }
  })
  handle('training:chooseFizgig', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Fizgig’s folder', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    const fiz = findFizgig(r.filePaths[0])
    if (!fiz) throw new Error('That folder has no Fizgig in it (with its venv). Pick the folder you cloned Fizgig into.')
    writeSettings({ fizgigFolder: fiz.dir }, BASE)
    return fiz.dir
  })

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
  handle('training:score', (id) => trainings.scoreCheckpoints(id))

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
  const cloud = new Cloud({ dataDir: DATA, resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')), onLog: (line) => (send('cloud:log', line), setupNow && !setupNow.finishedAt && setupNow.fromLine(line)) })
  let cloudBusy = null
  // The cloud setup's progress (setupprogress.js): the window's progress view and title-bar pill follow it
  // (cloud:progress, and cloud:status after a reload), and it says when it's done (a notification, cloud:setupDone).
  let setupNow = null
  const tracked = async (provider, fn, models = []) => {
    let last = 0
    const t = new SetupProgress(provider, {
      models,
      onChange: (snap) => {
        // a few updates a second at most; the first, the last and every step change always go
        const now = Date.now()
        if (snap.finishedAt || now - last > 250 || snap.steps.some((s) => s.status === 'running' && s.seconds === 0)) (send('cloud:progress', snap), (last = now))
      }
    })
    setupNow = t
    t.changed()
    const tell = (title, body) => {
      send('cloud:setupDone', { ok: t.ok, title, body })
      try {
        if (!Notification.isSupported() || (win && !win.isDestroyed() && win.isFocused())) return
        const n = new Notification({ title, body, icon: path.join(resourcesDir(path.join(app.getAppPath(), 'resources')), 'icon.png') })
        n.on('click', () => {
          if (!win || win.isDestroyed()) return
          if (win.isMinimized()) win.restore()
          win.show()
          win.focus()
          send('cloud:open')
        })
        n.show()
      } catch {}
    }
    const name = provider === 'runpod' ? 'RunPod' : 'Modal'
    try {
      const out = await fn(t)
      t.finish()
      tell(`The cloud is ready`, `${name} is set up (${about(t.snapshot().elapsed)}). Switch on The cloud to render there.`)
      return out
    } catch (err) {
      t.fail(err)
      tell('Cloud setup stopped', `${name}: ${String(err.message || err).split('\n')[0].slice(0, 160)}`)
      throw err
    }
  }
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
      // an install from an older IV Studio: Modal's client is updated before the next setup, render or training
      toolkitVersion: cloud.toolkitReady() ? cloud.toolkitVersion() : null,
      toolkitUpdate: cloud.toolkitReady() && !cloud.toolkitCurrent() ? MODAL_VERSION : null,
      workspace: s.cloudProvider === 'runpod' || s.cloudProvider === 'comfycloud' ? null : await cloud.workspace(),
      // while Modal's sign-in waits: its page, for when no browser opened
      signInUrl: cloud.signInUrl || null,
      signingIn: !!cloud.signing,
      cloud: s.cloud,
      runpod: { ...rp, hasKey: !!s.runpodKey, ready: !!(rp.modelsAt && s.runpodToken) },
      comfycloud: { ...(s.comfycloud || {}), hasKey: !!(s.comfyCloudKey || s.comfyApiKey), ownKey: !!s.comfyCloudKey },
      target: s.target,
      gpus: GPUS,
      runpodGpus: RUNPOD_GPUS,
      busy: cloudBusy,
      // the last (or current) setup's progress, for a window that opens or reloads mid-setup
      setup: setupNow?.snapshot() || null,
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
  handle('cloud:signIn', () => cloudTask('signing in to Modal', () => cloud.signIn()))
  // stop waiting for the browser (the window offers it while it waits)
  handle('cloud:cancelSignIn', () => cloud.cancelSignIn())
  // sign out of Modal, to sign in again or with another account (not while rendering on it)
  handle('cloud:signOut', () => {
    const s = readSettings(BASE)
    if (s.target === 'cloud' && (s.cloudProvider || 'modal') === 'modal') throw new Error('Switch rendering to This PC first, then sign out of Modal.')
    if (cloud.signing) cloud.cancelSignIn()
    const r = cloud.signOut()
    // the app it deployed belongs to that account: setting up again starts fresh
    writeSettings({ cloud: null, cloudToken: null }, BASE)
    return r
  })
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
  // The whole Modal setup in one call: the access token and image (deploy), the models, then the characters. It
  // runs here, not in the window, so leaving the page or reloading the window doesn't stop it.
  handle('cloud:setUp', ({ gpu, idleSeconds }) =>
    cloudTask('setting up the cloud', () =>
      tracked(
        'modal',
        async (t) => {
          // IV_STUDIO_FAKE_SETUP (test copies only): replays a setup's output quickly, so the progress view can be
          // checked without touching a Modal account
          if (process.env.IV_STUDIO_FAKE_SETUP) return fakeSetup(t, process.env.IV_STUDIO_FAKE_SETUP)
          const { url, token } = await cloud.deploy({ gpu, idleSeconds })
          writeSettings({ cloudToken: seal(token) }, BASE)
          saveCloud({ url, gpu, idleSeconds, workspace: await cloud.workspace(), deployedAt: new Date().toISOString() })
          t.start('models', 'Checking which models your storage already has')
          await cloud.fetchModels()
          saveCloud({ modelsAt: new Date().toISOString() })
          t.start('characters')
          const done = await uploadModalCharacters()
          if (done === null) t.done('characters', 'No ComfyUI on this PC, so there are no character files to upload')
          else t.done('characters', done.length ? `${done.length} file${done.length === 1 ? '' : 's'} uploaded` : 'No character files to upload')
          return readSettings(BASE).cloud
        },
        cloudModels()
      )
    )
  )
  // A stand-in Modal setup for test copies: Modal's own lines, sped up. "fail" stops it in the model download.
  async function fakeSetup(t, mode) {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const say = (line) => cloud.onLog(line)
    say('Saving the access token in your Modal workspace…')
    await wait(1500)
    say('Building the cloud image and publishing ComfyUI (the first time takes 10–15 minutes)…')
    for (const l of ['Building image im-a1b2c3', '=> Step 0: FROM base', '=> Step 1: RUN apt-get install -y ffmpeg git', '=> Step 2: RUN pip install torch==2.9.1', '=> Step 3: RUN git clone ComfyUI v0.42.5', '=> Step 4: COPY node packs', 'Built image im-a1b2c3 in 412.3s']) (say(l), await wait(1500))
    t.start('models', 'Checking which models your storage already has')
    say('Downloading the H3 models into your cloud storage (about 60 GB, once)…')
    const models = cloudModels()
    for (const [i, m] of models.entries()) {
      if (i === 0) (say(`have ${m.label}`), await wait(600))
      else {
        say(`downloading ${m.label}`)
        for (let p = 0; p <= 100; p += 20) {
          say(`progress ${m.id} ${p}% of ${m.size}`)
          await wait(350)
          if (mode === 'fail' && i === 2 && p === 60) throw new Error(`${m.label}: the host answered 503 for https://huggingface.co/...`)
        }
        say(`done ${m.label} (checksum verified)`)
      }
    }
    say(`models ready: ${models.length}/${models.length} in 1234 s`)
    t.start('characters')
    await wait(1200)
    t.done('characters', 'No character files to upload')
    return readSettings(BASE).cloud
  }
  // the models the Modal setup downloads (models.json without the optional ones, plus cloud.json's extras)
  function cloudModels() {
    try {
      const res = resourcesDir(path.join(app.getAppPath(), 'resources'))
      const m = JSON.parse(fs.readFileSync(path.join(res, 'models.json'), 'utf8')).models.filter((x) => !x.optional)
      const extra = JSON.parse(fs.readFileSync(path.join(res, 'cloud', 'cloud.json'), 'utf8')).extraModels || []
      return [...m, ...extra].map((x) => ({ id: x.id, label: x.label, size: x.size || 0 }))
    } catch {
      return []
    }
  }
  // Each character's LoRA and RefMods, found through this PC's ComfyUI, into the Modal volume. null when there's no
  // ComfyUI on this PC (a cloud-only PC): nothing to upload, and not an error.
  async function uploadModalCharacters() {
    let local
    try {
      local = await fetch(`${readSettings(BASE).comfyUrl}/experiment/models`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json())
    } catch {
      saveCloud({ charactersAt: new Date().toISOString() })
      return null
    }
    const roots = (name) => local.find((f) => f.name === name)?.folders || []
    const find = (kind, rel) => roots(kind).map((d) => path.join(d, rel)).find((p) => fs.existsSync(p))
    const done = []
    for (const c of studio.characters()) {
      const lora = c.lora && find('loras', c.lora)
      if (lora) await cloud.uploadModel(lora, `loras/${c.lora.replace(/\\/g, '/')}`), done.push(c.lora)
      for (const r of [c.refmod, c.voiceRefmod, c.visualRefmod].filter(Boolean)) {
        const file = find('refmods', `${r}.safetensors`)
        if (file) await cloud.uploadModel(file, `refmods/${r}.safetensors`), done.push(r)
      }
    }
    saveCloud({ charactersAt: new Date().toISOString() })
    return done
  }
  handle('cloud:uploadCharacters', () => cloudTask('uploading characters', async () => (await uploadModalCharacters()) || []))
  // ---------- cloud on RunPod (the user's own account; runpod.js) ----------
  const runpod = new RunPod({ resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')), key: () => unseal(readSettings(BASE).runpodKey), onLog: (line) => send('cloud:log', line) })
  // character training on RunPod uses the same account
  if (trainings) trainings.runpod = runpod
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
      const lora = c.lora && find('loras', c.lora)
      if (lora) files.push({ file: lora, remote: `loras/${c.lora.replace(/\\/g, '/')}`, name: c.lora })
      for (const r of [c.refmod, c.voiceRefmod, c.visualRefmod].filter(Boolean)) {
        const file = find('refmods', `${r}.safetensors`)
        if (file) files.push({ file, remote: `refmods/${r}.safetensors`, name: r })
      }
    }
    return files
  }
  // Set up (and Set up again): the volume, a pod that installs ComfyUI and downloads the models onto it, then
  // the characters. A new gate token each time, so pods started with the old one are shut down first.
  handle('cloud:runpodSetUp', ({ gpu, idleSeconds }) =>
    cloudTask('setting up RunPod', () => tracked('runpod', async (t) => {
      const s = readSettings(BASE)
      if (s.target === 'cloud') throw new Error('Switch rendering to My PC first.')
      await runpod.stopAll()
      const known = s.runpod?.volumeId ? { id: s.runpod.volumeId, dataCenter: s.runpod.dataCenter } : null
      if (!known) send('cloud:log', 'Finding a data center with network storage and a free GPU…')
      if (known) t.skip('storage', `Already made, in ${known.dataCenter}`)
      else t.start('storage', 'Finding a data center with network storage and a free GPU')
      const volume = known || (await runpod.ensureVolume(await runpod.pickDataCenter(gpu)))
      t.start('pod', `Starting a ${RUNPOD_GPUS.find((g) => g.id === gpu)?.label.split(' ·')[0] || 'GPU'} in ${volume.dataCenter}`)
      writeSettings({ runpodToken: seal(randomBytes(24).toString('base64url')) }, BASE)
      saveRunpod({ gpu, idleSeconds, volumeId: volume.id, dataCenter: volume.dataCenter, url: null, podId: null })
      send('cloud:log', `Starting a pod in ${volume.dataCenter}. The first time, it installs ComfyUI and downloads the H3 models onto your volume (20–40 minutes).`)
      runpod.onHealth = (h) => t.fromHealth(h)
      let url
      try {
        url = await wakeRunpod()
      } finally {
        runpod.onHealth = null
      }
      saveRunpod({ modelsAt: new Date().toISOString(), setUpAt: new Date().toISOString() })
      t.start('characters')
      const done = []
      for (const f of await characterFiles().catch(() => [])) {
        t.update('characters', { detail: `Uploading ${f.name}` })
        await runpod.uploadModel(url, runpodToken(), f.file, f.remote)
        done.push(f.name)
      }
      t.done('characters', done.length ? `${done.length} file${done.length === 1 ? '' : 's'} uploaded` : 'No character files to upload')
      saveRunpod({ charactersAt: new Date().toISOString() })
      send('cloud:log', `Ready. ${done.length} character file${done.length === 1 ? '' : 's'} uploaded. The GPU shuts itself off after ${Math.round(idleSeconds / 60)} idle minutes.`)
      return readSettings(BASE).runpod
    }))
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
    if ('textSize' in safe && !(safe.textSize in TEXT_SIZES)) delete safe.textSize
    const s = publicSettings(writeSettings(safe, BASE))
    if ('textSize' in safe) refitZoom()
    if ('comfyUrl' in (patch || {})) makeStudio()
    if ('models' in (patch || {})) studio.models = s.models || {}
    // the render folders apply to the next render
    studio.comfy.folders = comfyFolders(readSettings(BASE), INCOGNITO)
    return s
  })
  handle('setup:check', () => studio.checkSetup())
  // Create → Advanced: the samplers and schedulers this ComfyUI offers
  handle('h3:samplers', async () => {
    const [k, b] = await Promise.all([studio.comfy.objectInfo('KSamplerSelect'), studio.comfy.objectInfo('BasicScheduler')])
    return { samplers: comboOptions(k, 'KSamplerSelect', 'sampler_name') || [], schedulers: comboOptions(b, 'BasicScheduler', 'scheduler') || [] }
  })
  // Check my PC (the welcome wizard): this computer's parts, what's installed, and what to set up for it
  handle('hardware:scan', async () => {
    const s = readSettings(BASE)
    const local = s.target !== 'cloud' && isLocalUrl(s.comfyUrl)
    const [gpuInfo, ollama, running] = await Promise.all([app.getGPUInfo('complete').catch(() => null), ollamaStatus().catch(() => null), local ? comfyUp(s.comfyUrl).catch(() => false) : false])
    const setup = running ? await studio.checkSetup().catch(() => null) : null
    // nothing at the saved address: a ComfyUI on another usual port (the Desktop app's 8000, say), offered as "Use it"
    const elsewhere = local && !running ? await findComfyElsewhere(s.comfyUrl).catch(() => null) : null
    const foldersOf = async (url) => {
      const paths = url ? await fetch(`${url}/internal/folder_paths`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json()) : await studio.comfy.req('/internal/folder_paths', { timeout: 5000 })
      return (paths.diffusion_models || paths.checkpoints || []).map((p) => (Array.isArray(p) ? p[0] : p)).find((p) => p && fs.existsSync(p)) || null
    }
    let modelsFolder = null
    if (running || elsewhere) {
      try {
        modelsFolder = await foldersOf(running ? null : elsewhere)
      } catch {}
    }
    const launchers = findLaunchers()
    // the drive to measure: the running ComfyUI's models folder, else the chosen folder, else the folder the launcher
    // IV Studio would start keeps its ComfyUI in (a shortcut's target, the Desktop app's install folder)
    const home = (f) => comfyHome(f, { readLink: (p) => shell.readShortcutLink(p) })
    const comfyFolder = modelsFolder || s.comfyFolder || home(launcherFor(s)) || launchers.map((l) => home(l.path)).find(Boolean) || ''
    const harness = harnessStatus()
    const ids = new Set(MODEL_GROUPS.flatMap((g) => g.ids))
    const installs = {
      comfyRunning: !!running,
      comfyElsewhere: elsewhere,
      comfyFound: !!(running || elsewhere || s.comfyFolder || launchers.length),
      ollama: !!(ollama?.running || ollama?.installed),
      claude: !!harness.claude.installed,
      codex: !!harness.codex.installed,
      voices: !!voices?.engine?.installed?.(),
      cloud: !!(s.cloud || s.runpod),
      modelsKnown: !!setup,
      modelsPresent: (setup?.items || []).filter((i) => i.kind === 'model' && i.status === 'ok').map((i) => i.model),
      modelSizes: Object.fromEntries((studio.manifest?.models || []).filter((m) => ids.has(m.id)).map((m) => [m.id, m.size || 0]))
    }
    const scan = await scanHardware({ electronGpu: gpuInfo, installs, comfyFolder, videosFolder: videosDir() })
    // testing: IV_STUDIO_FAKE_HARDWARE=<json file> swaps in made-up parts ({ gpus, ram, os, installs }) to see other tiers
    if (process.env.IV_STUDIO_FAKE_HARDWARE) {
      const fake = JSON.parse(fs.readFileSync(process.env.IV_STUDIO_FAKE_HARDWARE, 'utf8'))
      Object.assign(scan, fake, { installs: { ...scan.installs, ...(fake.installs || {}) } })
    }
    return { scan, rec: recommend(scan), promptEngine: s.promptEngine, onboarded: s.onboarded }
  })
  // what the wizard chose: the shot defaults and the writer, and that it's been done (so it doesn't open again)
  handle('hardware:apply', ({ shotPrefs, promptEngine, hardware, highContrast } = {}) => {
    const patch = { onboarded: new Date().toISOString() }
    if (typeof highContrast === 'boolean') patch.highContrast = highContrast
    if (shotPrefs) patch.shotPrefs = shotPrefs
    if (hardware) patch.hardware = hardware
    if (promptEngine && ['local', 'claude', 'codex'].includes(promptEngine)) patch.promptEngine = promptEngine
    return publicSettings(writeSettings(patch, BASE))
  })
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
  // Settings → Folders → Finished videos (and Check my PC): where exports and cloud renders brought home go
  const videosState = () => {
    const s = readSettings(BASE)
    const dir = videosDir()
    let free = null
    try {
      let p = dir
      while (!fs.existsSync(p) && path.dirname(p) !== p) p = path.dirname(p)
      free = freeBytes(p)
    } catch {}
    return { path: dir, custom: !!s.videosFolder && !INCOGNITO, incognito: INCOGNITO, free }
  }
  handle('folders:videos', async () => videosState())
  handle('folders:chooseVideos', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Where finished videos go', defaultPath: videosDir(), properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    const dir = r.filePaths[0]
    fs.mkdirSync(dir, { recursive: true })
    fs.accessSync(dir, fs.constants.W_OK)
    writeSettings({ videosFolder: dir }, BASE)
    return videosState()
  })
  handle('folders:resetVideos', async () => (writeSettings({ videosFolder: '' }, BASE), videosState()))
  handle('comfy:chooseFolder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Your ComfyUI folder', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    const dir = r.filePaths[0]
    if (!isComfyFolder(dir)) throw new Error(process.platform === 'win32' ? 'That folder doesn’t look like ComfyUI. Pick the folder that holds ComfyUI (its main.py, or run_nvidia_gpu.bat and the ComfyUI folder), or ComfyUI.exe’s folder.' : 'That folder doesn’t look like ComfyUI. Pick the folder that holds its main.py.')
    writeSettings({ comfyFolder: dir, comfyLauncher: '' }, BASE)
    return dir
  })
  handle('comfy:start', () => startComfy())

  // ---------- the data folder (Settings → Data folder; datafolder.js) ----------
  // Moves IV Studio's own data (not ComfyUI's models or renders, which live in ComfyUI) to another folder:
  // copy, check, point the default folder at it, restart. The window hears data:progress
  // ({ phase: 'counting' | 'copying' | 'copied' | 'checking' | 'checked' | 'done', done, total, file }).
  let moving = false
  const canMove = () => !PORTABLE && LOCATION.source !== 'env' && !LOCATION.missing
  const whyNot = () =>
    PORTABLE
      ? 'This is the portable copy: its data folder is the “data” folder beside IV Studio.exe. Move the whole IV Studio folder to move it.'
      : LOCATION.source === 'env'
        ? 'IV_STUDIO_DATA sets the data folder on this PC, so it can’t be moved from here.'
        : 'The data folder can’t be moved from this copy.'
  const target = (picked) => chooseTarget(picked, { from: BASE, defaultDir: LOCATION.defaultDir })
  handle('data:info', () => ({
    dir: BASE,
    source: LOCATION.missing ? 'default' : LOCATION.source,
    defaultDir: LOCATION.defaultDir,
    moved: LOCATION.missing ? LOCATION.dir : null,
    portable: PORTABLE,
    canMove: canMove(),
    whyNot: canMove() ? null : whyNot(),
    moving,
    old: oldCopy(LOCATION.defaultDir, BASE),
    free: freeBytes(BASE)
  }))
  handle('data:size', async () => {
    const items = await listData(BASE)
    return { bytes: items.reduce((n, i) => n + i.size, 0), files: items.filter((i) => !i.dir).length }
  })
  handle('data:choose', async () => {
    if (!canMove()) throw new Error(whyNot())
    const r = await dialog.showOpenDialog(win, { title: 'Move IV Studio’s data to…', properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    const to = target(r.filePaths[0])
    return { to, free: freeBytes(to) }
  })
  handle('data:move', async (picked) => {
    if (!canMove()) throw new Error(whyNot())
    if (moving) throw new Error('IV Studio is already moving its data.')
    const to = target(picked)
    const keepDir = fs.existsSync(to)
    const entries = movableEntries(BASE)
    moving = true
    try {
      const copied = await copyData(BASE, to, { entries, onProgress: (p) => send('data:progress', p) })
      await verifyCopy(to, copied, { onProgress: (p) => send('data:progress', p) })
      writePointer(LOCATION.defaultDir, { to, from: BASE, entries: copied.entries })
      send('data:progress', { phase: 'done', done: copied.bytes, total: copied.bytes })
      return { to, bytes: copied.bytes, files: copied.files.length }
    } catch (err) {
      await discardCopy(to, entries, { keepDir })
      throw err
    } finally {
      moving = false
    }
  })
  // Restarts on the new folder once a move is done.
  handle('data:restart', () => {
    voices?.release()
    setTimeout(() => (app.relaunch(), app.exit(0)), 200)
    return true
  })
  handle('data:removeOld', () => removeOldCopy(LOCATION.defaultDir, BASE))
  handle('data:open', () => shell.openPath(BASE))

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
  // RefMod characters: list the refmods folder, check this ComfyUI can make one, and make one (refmods.js)
  const refmodMaker = new RefMods({ studio, dataDir: DATA })
  handle('refmods:list', () => refmodMaker.list())
  handle('refmods:ready', () => refmodMaker.ready())
  handle('refmods:make', async (opts) => {
    await voices.release()
    return refmodMaker.make({ ...opts, onStatus: (s) => send('refmods:status', s) })
  })
  handle('characters:save', (list) => studio.saveCharacters(list))
  handle('projects:list', () =>
    studio.listProjects().filter((p) => !p.sequenceId && !p.trainingId && !p.tool).map((p) => {
      const jobs = studio.listJobs(p.id)
      const finals = jobs.flatMap((j) => j.outputs.filter((o) => o.kind === 'final'))
      const previews = jobs.flatMap((j) => j.outputs.filter((o) => o.kind === 'preview'))
      // the latest run's request, for Shots' filters (kind of shot, who's in it, its shape)
      const req = [...jobs].reverse().find((j) => j.plan?.request)?.plan.request || {}
      return { ...p, jobCount: jobs.length, cover: (finals.at(-1) || previews.at(-1))?.url || null, finals: finals.length, running: jobs.some((j) => !['success', 'error', 'cancelled'].includes(j.status)), mode: req.mode || null, character: req.character || 'none', aspect: req.aspect || null }
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
  handle('sequences:runsOf', (projectId) => studio.sequenceRunsOf(projectId))
  handle('sequences:linkRun', (id, opts) => studio.linkShotRun(id, opts))
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
    // a short wait: the meter asks every few seconds, so a busy ComfyUI just skips a reading
    const st = await studio.comfy.systemStats({ timeout: 4000 }).catch(() => null)
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
      const d = (await studio.comfy.systemStats({ timeout: 4000 }).catch(() => null))?.devices?.[0]
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
  // The guide: the bundled PDF (resources/guide), copied to the data folder first so it opens from a normal
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
    // opening the download page (the portable copy, or a Mac copy that can't replace itself) needs nothing to finish first
    if (UPDATE_MANUAL || updateState().status === 'available') return updater.install()
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
