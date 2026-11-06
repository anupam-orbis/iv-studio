// Updating ComfyUI, its node packs and ComfyUI-Manager (src/service/comfyupdate.js), against a fake ComfyUI-Manager:
// the check, the update with its snapshot and per-pack results, the restart, and Undo with ComfyUI up or down.
// Starts no real ComfyUI and changes nothing outside temporary folders.
//   node test/comfy-updates.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Comfy } from '../src/service/comfy.js'
import { checkUpdates, copySnapshot, ensureIdle, latestStable, managerInfo, managerReq, packFolders, readRecord, reenable, restart, resultOf, saveSnapshot, undo, update, writeRecord } from '../src/service/comfyupdate.js'
import { Studio } from '../src/service/studio.js'

let n = 0
const ok = async (name, fn) => {
  await fn()
  n++
  console.log(`ok  ${name}`)
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'iv-updates-'))

// ---------- the fake ComfyUI + ComfyUI-Manager ----------
const fresh = () => ({
  version: 'V3.42',
  policy: 'stable-comfyui',
  security: 'normal',
  packs: {
    a: { id: 'a', title: 'Alpha Pack', state: 'enabled', 'update-state': 'true' },
    b: { id: 'b', title: 'Beta Pack', state: 'enabled', 'update-state': 'false' },
    c: { id: 'c', title: 'Not Here', state: 'not-installed', 'update-state': 'true' },
    'comfyui-manager': { id: 'comfyui-manager', title: 'ComfyUI-Manager', state: 'enabled', 'update-state': 'true' }
  },
  versions: { versions: ['nightly', 'v0.44.2', 'v0.44.1'], current: 'v0.44.1' },
  comfyQueue: { queue_running: [], queue_pending: [] },
  managerBusy: false,
  processingPolls: 0, // how many queue/status polls report is_processing after the queue starts
  snapshots: ['2026-11-05_05-13-03_autosave'],
  comfyuiVersion: '0.44.2',
  calls: [],
  bodies: {}
})
let state = fresh()
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    const route = req.url.split('?')[0]
    state.calls.push(`${req.method} ${route}`)
    if (body) state.bodies[`${req.method} ${route}`] = JSON.parse(body)
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': typeof data === 'string' ? 'text/plain' : 'application/json' })
      res.end(data === undefined ? '' : typeof data === 'string' ? data : JSON.stringify(data))
    }
    const guarded = ['/manager/queue/update_all', '/manager/queue/update', '/snapshot/restore', '/manager/reboot']
    if (guarded.includes(route) && !['weak', 'normal', 'normal-'].includes(state.security)) return send(403, 'A security error has occurred.')
    if (route === '/manager/version') return state.version ? send(200, state.version) : send(404, 'Not Found')
    if (route === '/manager/policy/update') return send(200, state.policy)
    if (route === '/customnode/fetch_updates') return send(201)
    if (route === '/customnode/getlist') return send(200, { channel: 'default', node_packs: state.packs })
    if (route === '/comfyui_manager/comfyui_versions') return send(200, state.versions)
    if (route === '/queue') return send(200, state.comfyQueue)
    if (route === '/system_stats') return send(200, { system: { comfyui_version: state.comfyuiVersion, os: 'win32' } })
    if (route === '/manager/queue/status') {
      const started = state.calls.includes('POST /manager/queue/start')
      const processing = state.managerBusy || (started && state.processingPolls-- > 0)
      return send(200, { total_count: 3, done_count: processing ? 1 : 3, in_progress_count: processing ? 1 : 0, is_processing: processing })
    }
    if (route === '/snapshot/getlist') return send(200, { items: [...state.snapshots].sort().reverse() })
    if (route === '/snapshot/save') return state.snapshots.push('2026-11-06_12-00-00_snapshot'), send(200)
    if (route === '/manager/queue/update_all') return state.managerBusy ? send(401) : send(200)
    if (['/manager/queue/reset', '/manager/queue/update_comfyui', '/manager/queue/start', '/snapshot/restore', '/manager/reboot'].includes(route)) return send(200)
    send(404, 'Not Found')
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const comfy = new Comfy(`http://127.0.0.1:${server.address().port}`)
const finished = (nodepack_result) => () => ({ done: Promise.resolve({ nodepack_result }), close() {} })

try {
  // ---------- Task 1: info and the check ----------
  await ok('managerInfo reads Manager’s version and update policy', async () => {
    assert.deepEqual(await managerInfo(comfy), { present: true, version: 'V3.42', policy: 'stable-comfyui' })
    state.version = null
    assert.deepEqual(await managerInfo(comfy), { present: false, version: null, policy: null })
    state = fresh()
  })

  await ok('latestStable picks the highest vX.Y.Z, not nightly', () => {
    assert.equal(latestStable(['nightly', 'v0.44.1', 'v0.44.10', 'v0.44.2']), 'v0.44.10')
    assert.equal(latestStable(['nightly']), null)
  })

  await ok('checkUpdates fetches, then counts installed packs with updates and compares ComfyUI versions', async () => {
    const r = await checkUpdates(comfy)
    assert.equal(state.calls.find((c) => c.startsWith('POST')), 'POST /customnode/fetch_updates', 'the fetch comes before reading the list')
    assert.ok(state.calls.indexOf('POST /customnode/fetch_updates') < state.calls.indexOf('GET /customnode/getlist'))
    assert.equal(r.packs.installed, 3)
    assert.deepEqual(r.packs.withUpdates.map((p) => p.id), ['a', 'comfyui-manager'])
    assert.deepEqual(r.comfyui, { current: 'v0.44.1', latest: 'v0.44.2', behind: true })
    assert.equal(r.manager.version, 'V3.42')
    assert.equal(r.desktop, false)
    state.versions = { versions: ['nightly', 'v0.44.2'], current: 'nightly' }
    assert.equal((await checkUpdates(comfy)).comfyui.behind, false, 'a nightly ComfyUI is not behind a tag')
    state = fresh()
  })

  await ok('checkUpdates without Manager says so', async () => {
    state.version = null
    await assert.rejects(checkUpdates(comfy), (e) => e.code === 'missing')
    state = fresh()
  })

  await ok('a Manager security level that blocks updates is a security error', async () => {
    state.security = 'high'
    await assert.rejects(managerReq(comfy, '/manager/queue/update_all', { method: 'POST', json: {} }), (e) => e.code === 'security' && /security_level = normal/.test(e.message))
    state = fresh()
  })

  // ---------- Task 2: the update ----------
  await ok('update: snapshot, then reset, update all, update ComfyUI, start; per-pack results', async () => {
    state.processingPolls = 2
    const seen = []
    const r = await update(comfy, { onProgress: (u) => seen.push(u.phase), listen: finished({ a: 'success', b: 'skip', comfyui: 'success-stable-v0.44.2', bad: 'git pull failed' }), every: 10 })
    const order = ['POST /snapshot/save', 'POST /manager/queue/reset', 'POST /manager/queue/update_all', 'POST /manager/queue/update_comfyui', 'POST /manager/queue/start']
    const at = order.map((c) => state.calls.indexOf(c))
    assert.ok(at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1])), `call order: ${state.calls.join(', ')}`)
    assert.equal(r.snapshot, '2026-11-06_12-00-00_snapshot')
    const by = Object.fromEntries(r.results.map((x) => [x.pack, x]))
    assert.deepEqual(by.bad, { pack: 'bad', ok: false, status: 'failed', message: 'git pull failed' })
    assert.equal(by.a.status, 'updated')
    assert.equal(by.b.status, 'current')
    assert.equal(by.comfyui.status, 'updated')
    assert.equal(seen[0], 'snapshot')
    assert.ok(seen.includes('updating'))
    state = fresh()
  })

  await ok('update under ComfyUI Desktop updates the nodes only', async () => {
    await update(comfy, { desktop: true, listen: finished({}), every: 10 })
    assert.ok(!state.calls.includes('POST /manager/queue/update_comfyui'))
    state = fresh()
  })

  await ok('update refuses while ComfyUI renders, before saving anything', async () => {
    state.comfyQueue.queue_pending = [[1, 'p1', {}, {}, []]]
    await assert.rejects(update(comfy, { listen: finished({}), every: 10 }), (e) => e.code === 'rendering')
    assert.ok(!state.calls.includes('POST /snapshot/save'))
    state = fresh()
  })

  await ok('update refuses while Manager is busy', async () => {
    state.managerBusy = true
    await assert.rejects(ensureIdle(comfy), (e) => e.code === 'busy')
    state = fresh()
  })

  await ok('saveSnapshot names the snapshot Manager just saved', async () => {
    assert.equal(await saveSnapshot(comfy), '2026-11-06_12-00-00_snapshot')
    state = fresh()
  })

  // ---------- Task 3: restart, record, undo ----------
  await ok('restart: Manager restarts ComfyUI, IV Studio waits for it to go down and come back', async () => {
    let answers = [true, false]
    const r = await restart(comfy, { up: async () => answers.shift() ?? false, wait: async () => ({ seconds: 1 }), every: 5 })
    assert.ok(state.calls.includes('POST /manager/reboot'))
    assert.equal(r.version, '0.44.2')
    state = fresh()
  })

  await ok('restart that never goes down is an error', async () => {
    await assert.rejects(restart(comfy, { up: async () => true, wait: async () => ({}), downTimeoutMs: 50, every: 5 }), /didn’t restart/)
    state = fresh()
  })

  await ok('the last-update record and the snapshot copy', () => {
    const data = tmp()
    const root = tmp()
    const name = '2026-11-06_12-00-00_snapshot'
    fs.mkdirSync(path.join(root, 'user', '__manager', 'snapshots'), { recursive: true })
    fs.writeFileSync(path.join(root, 'user', '__manager', 'snapshots', `${name}.json`), '{"comfyui":"abc"}')
    const copy = copySnapshot(data, root, name)
    assert.equal(fs.readFileSync(copy, 'utf8'), '{"comfyui":"abc"}')
    assert.equal(copySnapshot(data, root, 'missing'), null)
    assert.equal(readRecord(data), null)
    writeRecord(data, { snapshot: name, snapshotCopy: copy })
    assert.equal(readRecord(data).snapshot, name)
  })

  await ok('undo with ComfyUI up asks Manager to restore the snapshot', async () => {
    const r = await undo(comfy, { snapshot: 'snap1', snapshotCopy: null }, { comfyRoot: tmp(), up: async () => true })
    assert.deepEqual(r, { via: 'api' })
    assert.deepEqual(state.bodies['POST /snapshot/restore'], { target: 'snap1' })
    state = fresh()
  })

  await ok('undo with ComfyUI down puts the snapshot where Manager restores it at startup', async () => {
    const data = tmp()
    const root = tmp()
    fs.mkdirSync(path.join(root, 'user', '__manager'), { recursive: true })
    const copy = path.join(data, 'snap1.json')
    fs.writeFileSync(copy, '{"comfyui":"old"}')
    const r = await undo(comfy, { snapshot: 'snap1', snapshotCopy: copy }, { comfyRoot: root, up: async () => false })
    assert.deepEqual(r, { via: 'file' })
    assert.equal(fs.readFileSync(path.join(root, 'user', '__manager', 'startup-scripts', 'restore-snapshot.json'), 'utf8'), '{"comfyui":"old"}')
    await assert.rejects(undo(comfy, { snapshot: 'snap1', snapshotCopy: copy }, { comfyRoot: tmp(), up: async () => false }), /Start ComfyUI first/)
  })

  await ok('Manager’s answers per pack, as Matthew’s ComfyUI gave them on 2026-11-06', () => {
    assert.equal(resultOf('x', 'skip').status, 'current')
    assert.equal(resultOf('comfyui', 'success-stable-v0.44.1').status, 'updated')
    const plain = resultOf('ComfyUI-IV-Studio', 'Path not found: F:\\ComfyUI\\custom_nodes\\ComfyUI-IV-Studio')
    assert.equal(plain.status, 'unmanaged')
    assert.equal(plain.ok, true, 'a plain folder Manager can’t update is not a failure')
    assert.equal(resultOf('y', 'Failed to update').ok, false)
  })

  await ok('Undo switches back on the packs Manager’s restore put in .disabled, and only those', () => {
    const cn = tmp()
    for (const d of ['git-pack', 'ComfyUI-IV-Studio', '__pycache__', '.disabled']) fs.mkdirSync(path.join(cn, d))
    const enabled = packFolders(cn)
    assert.deepEqual(enabled, ['ComfyUI-IV-Studio', 'git-pack'], 'switched-on folders only')
    // Manager's restore moves the plain folder (and a registry pack, as name@version) into .disabled
    fs.renameSync(path.join(cn, 'ComfyUI-IV-Studio'), path.join(cn, '.disabled', 'ComfyUI-IV-Studio'))
    fs.mkdirSync(path.join(cn, '.disabled', 'reg-pack@1_2_3'))
    fs.mkdirSync(path.join(cn, '.disabled', 'switched-off-by-me'))
    fs.mkdirSync(path.join(cn, '.disabled', 'git-pack'))
    const moved = reenable(cn, [...enabled, 'reg-pack'])
    assert.deepEqual(moved.sort(), ['ComfyUI-IV-Studio', 'reg-pack'])
    assert.ok(fs.existsSync(path.join(cn, 'ComfyUI-IV-Studio')) && fs.existsSync(path.join(cn, 'reg-pack')))
    assert.ok(fs.existsSync(path.join(cn, '.disabled', 'switched-off-by-me')), 'a pack that was off before stays off')
    assert.ok(fs.existsSync(path.join(cn, '.disabled', 'git-pack')), 'a name already in custom_nodes is not overwritten')
    assert.deepEqual(reenable(tmp(), ['x']), [], 'no .disabled folder: nothing to do')
  })

  await ok('undo without an update to undo', async () => {
    await assert.rejects(undo(comfy, null, { comfyRoot: tmp() }), /no update to undo/)
  })

  // ---------- Task 4: studio refuses a ComfyUI that isn't on this PC ----------
  await ok('Studio: updates run on this PC’s ComfyUI only', async () => {
    const studio = new Studio({ dataDir: tmp(), resourcesDir: path.resolve('resources'), comfyUrl: 'http://127.0.0.1:8188', comfyToken: 'x' })
    for (const fn of ['comfyUpdates', 'updateComfy', 'undoComfyUpdate', 'installManager']) await assert.rejects(studio[fn](), /this PC’s ComfyUI only/, fn)
  })
} finally {
  server.close()
}
console.log(`\n${n} checks passed`)
