// Updating the person's own ComfyUI from IV Studio: every custom node pack (ComfyUI-Manager included) to its newest
// version and ComfyUI to its newest stable release, then a restart, with a snapshot first so Undo can put it back.
// It drives ComfyUI-Manager's own HTTP API (the same calls as Manager's buttons) rather than running git or pip
// itself: Manager already knows git packs from registry packs, pip, and what a Desktop install can't do.
// Every dependency comes in as an argument (the Comfy client, the up/wait checks, the websocket listener, folders),
// so test/comfy-updates.mjs runs it all against a fake Manager.
import fs from 'node:fs'
import path from 'node:path'
import { comfyUp, waitUp } from './comfylauncher.js'

// Installed when Manager is missing. Pinned by commit: the Comfy Registry's newest ComfyUI-Manager is 3.0.1 (2024).
export const MANAGER_PACK = {
  label: 'ComfyUI-Manager',
  dir: 'ComfyUI-Manager',
  url: 'https://github.com/Comfy-Org/ComfyUI-Manager',
  git: 'https://github.com/Comfy-Org/ComfyUI-Manager',
  commit: '4c50a2bc8b9e684d8a85930567957470b952bebe', // V3.42
  for: 'Updates'
}

const MESSAGES = {
  security: 'ComfyUI-Manager’s security level blocks updates. Set security_level = normal in ComfyUI’s user/__manager/config.ini, then restart ComfyUI.',
  busy: 'ComfyUI-Manager is already working on something. Try again when it’s done.',
  rendering: 'ComfyUI is rendering or has jobs queued. Update when it’s done.',
  down: 'ComfyUI isn’t running.'
}
const fail = (code, message = MESSAGES[code]) => Object.assign(new Error(message), { code })

// One call to Manager (or ComfyUI). Manager answers some routes with plain text, which Comfy.req can't read.
export async function managerReq(comfy, route, { method = 'GET', json, timeout = 15000, text = false } = {}) {
  let res
  try {
    res = await fetch(comfy.url + route, {
      method,
      signal: AbortSignal.timeout(timeout),
      headers: comfy.headers(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      body: json !== undefined ? JSON.stringify(json) : undefined
    })
  } catch (err) {
    if (err.name === 'TimeoutError') throw fail('http', `ComfyUI-Manager did not answer ${route} within ${timeout / 1000} s`)
    if (err.cause?.code === 'ECONNREFUSED' || /fetch failed/.test(err.message)) throw fail('down')
    throw err
  }
  const body = await res.text()
  if (res.status === 403) throw fail('security')
  if (res.status === 401) throw fail('busy')
  if (res.status === 404) throw fail('missing', 'ComfyUI-Manager isn’t installed in this ComfyUI.')
  if (!res.ok) throw fail('http', `ComfyUI-Manager ${route} ${res.status}: ${body.slice(0, 300)}`)
  if (text) return body
  return body ? JSON.parse(body) : {}
}

// Is Manager there, which version, and does it update ComfyUI to stable releases or nightly?
export async function managerInfo(comfy) {
  try {
    const version = (await managerReq(comfy, '/manager/version', { text: true })).trim()
    const policy = (await managerReq(comfy, '/manager/policy/update', { text: true }).catch(() => '')).trim() || null
    return { present: true, version, policy }
  } catch (err) {
    if (err.code === 'missing') return { present: false, version: null, policy: null }
    throw err
  }
}

const semver = (t) => t.match(/^v(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number)
export function latestStable(versions) {
  const tags = (versions || []).filter(semver)
  tags.sort((a, b) => {
    const [x, y] = [semver(a), semver(b)]
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]
  })
  return tags[0] || null
}

// What would change: ComfyUI's version against its newest stable tag, and the installed packs with an update.
// Manager first fetches every pack's remote (no pull), which takes a while with many git packs.
export async function checkUpdates(comfy, { desktop = false } = {}) {
  const manager = await managerInfo(comfy)
  if (!manager.present) throw fail('missing', 'ComfyUI-Manager isn’t installed in this ComfyUI.')
  await managerReq(comfy, '/customnode/fetch_updates', { method: 'POST', json: { mode: 'cache' }, timeout: 300000 })
  const list = await managerReq(comfy, '/customnode/getlist?mode=cache&skip_update=true', { timeout: 120000 })
  const installed = Object.values(list.node_packs || {}).filter((p) => p.state === 'enabled')
  const withUpdates = installed.filter((p) => p['update-state'] === 'true').map((p) => ({ id: p.id, title: p.title || p.id })).sort((a, b) => a.title.localeCompare(b.title))
  const v = await managerReq(comfy, '/comfyui_manager/comfyui_versions', { timeout: 60000 })
  const latest = latestStable(v.versions)
  return {
    manager,
    comfyui: { current: v.current || null, latest, behind: !!latest && !!v.current && v.current !== 'nightly' && v.current !== latest },
    packs: { installed: installed.length, withUpdates },
    desktop
  }
}

// Nothing may be rendering or queued on ComfyUI, and Manager's own queue must be idle.
export async function ensureIdle(comfy) {
  const q = await managerReq(comfy, '/queue')
  if (q.queue_running?.length || q.queue_pending?.length) throw fail('rendering')
  const s = await managerReq(comfy, '/manager/queue/status')
  if (s.is_processing) throw fail('busy')
}

// Saves a Manager snapshot (ComfyUI's commit and every pack's version) and returns its name.
export async function saveSnapshot(comfy) {
  const before = new Set((await managerReq(comfy, '/snapshot/getlist')).items || [])
  await managerReq(comfy, '/snapshot/save', { method: 'POST', json: {} })
  const name = ((await managerReq(comfy, '/snapshot/getlist')).items || []).find((s) => !before.has(s))
  if (!name) throw fail('http', 'ComfyUI-Manager didn’t save a snapshot.')
  return name
}

// Manager reports each pack's result once, in a websocket message to every client, then forgets it.
export function listenQueueDone(comfy, { clientId = 'iv-studio-updates' } = {}) {
  let ws
  let resolveDone
  const done = new Promise((r) => (resolveDone = r))
  try {
    ws = new WebSocket(`${comfy.url.replace(/^http/, 'ws')}/ws?clientId=${clientId}`)
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'cm-queue-status' && msg.data?.status === 'done') resolveDone(msg.data)
      } catch {}
    }
    ws.onerror = () => {}
  } catch {}
  return { done, close: () => ws?.close() }
}

// What Manager said about one pack: 'skip' (already current), 'success' or 'success-stable-v0.44.1' (updated, or
// ComfyUI at that release), 'Path not found: …' (a plain folder with no git or registry source, which Manager can't
// update, such as IV Studio's own pack), or an error.
export function resultOf(pack, msg) {
  const m = String(msg ?? 'unknown')
  if (m === 'skip') return { pack, ok: true, status: 'current', message: null }
  if (m.startsWith('success')) return { pack, ok: true, status: 'updated', message: m === 'success' ? null : m }
  if (/^Path not found/i.test(m)) return { pack, ok: true, status: 'unmanaged', message: 'Not a git or Comfy Registry pack, so ComfyUI-Manager leaves it as it is.' }
  return { pack, ok: false, status: 'failed', message: m }
}

// Snapshot, then every pack and ComfyUI through Manager's queue. onProgress: { phase, done, total }.
// Returns { snapshot, results: [{ pack, ok, message }] }. ComfyUI loads the new versions when it restarts.
export async function update(comfy, { desktop = false, onProgress = () => {}, listen = listenQueueDone, every = 2000, timeoutMs = 60 * 60 * 1000 } = {}) {
  await ensureIdle(comfy)
  onProgress({ phase: 'snapshot' })
  const snapshot = await saveSnapshot(comfy)
  const listener = listen(comfy)
  try {
    await managerReq(comfy, '/manager/queue/reset', { method: 'POST', json: {} })
    await managerReq(comfy, '/manager/queue/update_all', { method: 'POST', json: { mode: 'cache' }, timeout: 120000 })
    if (!desktop) await managerReq(comfy, '/manager/queue/update_comfyui', { method: 'POST', json: {} })
    await managerReq(comfy, '/manager/queue/start', { method: 'POST', json: {} })
    let report = null
    listener.done.then((r) => (report = r))
    const t0 = Date.now()
    for (;;) {
      const s = await managerReq(comfy, '/manager/queue/status')
      onProgress({ phase: 'updating', done: s.done_count, total: s.total_count })
      if (!s.is_processing) {
        // the final message can trail the queue going idle by a moment
        report ||= await Promise.race([listener.done, new Promise((r) => setTimeout(() => r(null), 10000))])
        break
      }
      if (Date.now() - t0 > timeoutMs) throw fail('http', 'ComfyUI-Manager didn’t finish within an hour.')
      await new Promise((r) => setTimeout(r, every))
    }
    const results = Object.entries(report?.nodepack_result || {}).map(([pack, v]) => resultOf(pack, v && typeof v === 'object' ? v.msg : v))
    return { snapshot, results, reported: !!report }
  } finally {
    listener.close()
  }
}

// Manager restarts ComfyUI the way it was started (same flags); wait for it to go down, then to answer again.
export async function restart(comfy, { up = comfyUp, wait = waitUp, downTimeoutMs = 60000, every = 1000 } = {}) {
  try {
    await managerReq(comfy, '/manager/reboot', { method: 'POST', json: {}, timeout: 10000 })
  } catch (err) {
    if (err.code === 'security' || err.code === 'missing') throw err // the restart itself drops the connection; that's fine
  }
  const t0 = Date.now()
  while (await up(comfy.url, 2000)) {
    if (Date.now() - t0 > downTimeoutMs) throw fail('http', 'ComfyUI didn’t restart.')
    await new Promise((r) => setTimeout(r, every))
  }
  await wait(comfy.url)
  const stats = await managerReq(comfy, '/system_stats')
  return { version: stats.system?.comfyui_version || null }
}

// ---------- the last update, for Undo ----------
export const recordPath = (dataDir) => path.join(dataDir, 'comfy-updates.json')
export function readRecord(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(recordPath(dataDir), 'utf8'))
  } catch {
    return null
  }
}
export function writeRecord(dataDir, record) {
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(recordPath(dataDir), JSON.stringify(record, null, 2))
}
const managerDir = (comfyRoot) => path.join(comfyRoot, 'user', '__manager')

// IV Studio's own copy of the snapshot, so Undo still works when ComfyUI won't start.
export function copySnapshot(dataDir, comfyRoot, name) {
  const from = path.join(managerDir(comfyRoot), 'snapshots', `${name}.json`)
  if (!fs.existsSync(from)) return null
  const to = path.join(dataDir, 'comfy-snapshots', `${name}.json`)
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
  return to
}

// The pack folders that are switched on in custom_nodes (Manager keeps switched-off ones in custom_nodes/.disabled).
export function packFolders(customNodes) {
  try {
    return fs.readdirSync(customNodes, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== '__pycache__').map((e) => e.name).sort()
  } catch {
    return []
  }
}

// Manager's snapshot restore switches off every pack its snapshot doesn't track, and a snapshot tracks only git and
// Comfy Registry packs, so a plain folder (IV Studio's own pack among them) lands in .disabled. Undo puts back the
// ones that were on when the snapshot was saved: a folder of that name, or name@version, in .disabled moves back
// unless one of that name is in custom_nodes already. Returns the names moved; ComfyUI loads them when it restarts.
export function reenable(customNodes, names = []) {
  const disabledDir = path.join(customNodes, '.disabled')
  let inside
  try {
    inside = fs.readdirSync(disabledDir)
  } catch {
    return []
  }
  const moved = []
  for (const name of names) {
    if (fs.existsSync(path.join(customNodes, name))) continue
    const hit = inside.find((d) => d === name || d.toLowerCase().startsWith(`${name.toLowerCase()}@`))
    if (!hit) continue
    fs.renameSync(path.join(disabledDir, hit), path.join(customNodes, name))
    moved.push(name)
  }
  return moved
}

// Puts the snapshot back. ComfyUI up: Manager schedules it ('api'; restart next). ComfyUI down: the snapshot goes
// where Manager's restore puts it, startup-scripts/restore-snapshot.json, which Manager applies at the next start
// ('file'; start ComfyUI next).
export async function undo(comfy, record, { comfyRoot, up = comfyUp } = {}) {
  if (!record?.snapshot) throw new Error('There’s no update to undo.')
  if (await up(comfy.url, 2000)) {
    await managerReq(comfy, '/snapshot/restore', { method: 'POST', json: { target: record.snapshot } })
    return { via: 'api' }
  }
  const dir = managerDir(comfyRoot || '')
  if (!comfyRoot || !record.snapshotCopy || !fs.existsSync(record.snapshotCopy) || !fs.existsSync(dir)) throw new Error('Start ComfyUI first, then Undo.')
  fs.mkdirSync(path.join(dir, 'startup-scripts'), { recursive: true })
  fs.copyFileSync(record.snapshotCopy, path.join(dir, 'startup-scripts', 'restore-snapshot.json'))
  return { via: 'file' }
}
