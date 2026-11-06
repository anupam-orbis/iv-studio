# Update ComfyUI, node packs and ComfyUI-Manager from IV Studio: implementation plan

**Goal:** From Setup and over MCP, check for and apply updates to the person's own ComfyUI (every custom node pack, ComfyUI-Manager, ComfyUI to the newest stable), restart it automatically, and undo the last update.

**Source:** `docs/superpowers/specs/2026-11-06-comfy-updates-design.md` (approved by Matthew 2026-11-06).

**Current state (verified 2026-11-06):**

- IV Studio installs missing node packs at pinned versions (`src/service/nodepacks.js` `installPacks`, `comfyPlace`), never touches existing pack folders, and can start ComfyUI with the person's launcher (`main/index.js` `startComfy`, `launcherOf`; `comfylauncher.js` `launch`, `waitUp`, `comfyUp`) but cannot update or restart it.
- `Comfy.req` (`src/service/comfy.js`) JSON-parses every response, so it can't read Manager's plain-text `GET /manager/policy/update`.
- Matthew's ComfyUI: portable, git checkout, 0.44.1, at `F:\ComfyUI-cu130-v0.30.0\ComfyUI`; ComfyUI-Manager V3.42 (git, commit `4c50a2bc8b9e684d8a85930567957470b952bebe`) in `custom_nodes/ComfyUI-Manager`; Manager config `user/__manager/config.ini` has `security_level = normal`, `update_policy = stable-comfyui`; snapshots in `user/__manager/snapshots/`.
- Manager V3.42 responses (read live): `/customnode/getlist?mode=cache&skip_update=true` → `{ channel, node_packs: { <id>: { id, title, state: 'enabled'|'disabled'|'not-installed', version, 'update-state': 'true'|'false'|'fail' } } }`; `/comfyui_manager/comfyui_versions` → `{ versions: ['nightly','v0.44.1',...], current: 'v0.44.1' }`; `/manager/queue/status` → `{ total_count, done_count, in_progress_count, is_processing }`; `/snapshot/getlist` → `{ items: ['2026-11-06_05-39-21_autosave', ...] }` newest first; `/manager/version` → `V3.42` (text). Update/restore/reboot return 403 unless `security_level` is `weak|normal|normal-`; `update_all` returns 401 while Manager's queue runs. Per-pack results come only in the `cm-queue-status` websocket message with `status: 'done'` and `nodepack_result: { <id>: 'success' | <error text> }`, broadcast to all clients, after which Manager forgets them.
- Comfy Registry's newest ComfyUI-Manager is 3.0.1 (2024), far behind V3.42, so Manager is pinned by GitHub commit.

**Architecture:** One new service module, `src/service/comfyupdate.js`, wraps Manager's HTTP API with its own small request helper and keeps every dependency injectable (the `Comfy` client, `waitUp`/`comfyUp`, the websocket listener, the data folder). `studio.js` adds thin methods that find the ComfyUI folder and the record file; `main/index.js`, `preload`, a new `ComfyUpdates.jsx` and three MCP tools call those methods. This follows the existing nodepacks.js → studio.js → IPC/MCP split.

**Tech stack:** Electron 44, electron-vite 6, React 19, Node 24 (global `fetch` and `WebSocket`), `@modelcontextprotocol/sdk` 1.32.1 with zod 3. Tests are plain Node scripts with `node:assert/strict` in `test/*.mjs`, run one at a time with `node test/<name>.mjs`.

## Constraints and acceptance criteria

- Only a ComfyUI on this PC (`isLocalUrl(comfy.url)` and not `comfy.remote`). Remote or cloud: methods throw "Updates run on this PC's ComfyUI only." and Setup shows no Updates row.
- Never change Manager's settings. A nightly `update_policy` is reported, not overridden.
- Never start an update while ComfyUI's `/queue` has running or pending prompts, or while Manager's queue `is_processing`.
- Every update saves a Manager snapshot first; IV Studio records its name and keeps a copy of the file.
- After an update or undo, ComfyUI restarts through `POST /manager/reboot`; IV Studio waits for it to go down (up to 60 s) and come back (`waitUp`, 6 min), then refreshes `studio.capabilities(true)`.
- Undo works with ComfyUI down by copying the snapshot to `<comfyRoot>/user/__manager/startup-scripts/restore-snapshot.json`.
- ComfyUI Desktop (launcher basename `ComfyUI.exe` or `ComfyUI.app`): node updates only; no ComfyUI update queued.
- The real update of Matthew's ComfyUI runs only after he says go.
- No commits unless Matthew asks.

## File map

| File | Action | Responsibility |
| --- | --- | --- |
| `src/service/comfyupdate.js` | Create | Manager API: info, check, update, restart, undo, last-update record, `MANAGER_PACK`. |
| `test/comfy-updates.mjs` | Create | Fake-Manager tests for every path in comfyupdate.js. |
| `src/service/comfylauncher.js` | Modify | Add `launcherFor(settings)` (moved from main) and `isDesktopLauncher(file)`. |
| `src/main/index.js` | Modify | Use `launcherFor`; IPC handlers for updates; progress channel `setup:updates`. |
| `src/service/studio.js` | Modify | `comfyUpdates`, `updateComfy`, `undoComfyUpdate`, `installManager`. |
| `src/preload/index.js` | Modify | Expose `setup.updates.{check, run, undo, installManager, onProgress}`. |
| `src/renderer/src/components/ComfyUpdates.jsx` | Create | The Updates row in Setup. |
| `src/renderer/src/components/Setup.jsx` | Modify | Render `ComfyUpdates` in the "ComfyUI and GPU" group. |
| `src/mcp/server.js` | Modify | `check_comfy_updates`, `update_comfy`, `undo_comfy_update`. |

### Task 1: Manager info and update check

**Files:** Create `src/service/comfyupdate.js`, `test/comfy-updates.mjs`.

**Interfaces:**

- Consumes: a `Comfy` instance's `url` and `headers()` (comfy.js).
- Produces:
  - `export const MANAGER_PACK = { label: 'ComfyUI-Manager', dir: 'ComfyUI-Manager', url: 'https://github.com/Comfy-Org/ComfyUI-Manager', git: 'https://github.com/Comfy-Org/ComfyUI-Manager', commit: '4c50a2bc8b9e684d8a85930567957470b952bebe', for: 'Updates' }`
  - `export async function managerReq(comfy, route, { method = 'GET', json, timeout = 15000, text = false } = {})`: `fetch(comfy.url + route, { headers: comfy.headers(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ... })`. Returns parsed JSON, or the body text when `text`. Errors carry `.code`: 403 → `'security'` with message "ComfyUI-Manager's security level blocks updates. Set security_level = normal in ComfyUI's user/__manager/config.ini, then restart ComfyUI."; 401 → `'busy'` "ComfyUI-Manager is already working on something. Try again when it's done."; 404 → `'missing'`; connection refused → `'down'` "ComfyUI isn't running."; other non-2xx → `'http'` with the status and the first 300 characters of the body.
  - `export async function managerInfo(comfy)` → `{ present: boolean, version: string|null, policy: string|null }` (`present` false on `'missing'`).
  - `export function latestStable(versions)` → the highest `vX.Y.Z` in the list, or `null`.
  - `export async function checkUpdates(comfy, { desktop = false } = {})` → `{ manager, comfyui: { current, latest, behind }, packs: { installed, withUpdates: [{ id, title }] }, desktop }`. Calls `POST /customnode/fetch_updates` `{ mode: 'cache' }` (timeout 300000; 200 or 201 both fine), then `GET /customnode/getlist?mode=cache&skip_update=true`, then `GET /comfyui_manager/comfyui_versions`. `installed` counts `state === 'enabled'`; `withUpdates` are enabled packs with `'update-state' === 'true'`, sorted by title. `behind` is true when `latest` is set and differs from `current` and `current !== 'nightly'`. Throws `'missing'` when Manager isn't there.

**Acceptance check:** `node test/comfy-updates.mjs` passes the info and check cases below.

- [ ] Write `test/comfy-updates.mjs` with a fake Manager: `http.createServer` on port 0 with a mutable `state` object (`version`, `policy`, `packs`, `versions`, `queue`, `comfyQueue`, `snapshots`, `security`, `calls`), routing exactly the Manager routes listed in "Current state" plus ComfyUI's `/queue` and `/system_stats`. Record every request in `state.calls` as `"METHOD /route"`. Build the client with `new Comfy('http://127.0.0.1:<port>')`. Cases:
  - `managerInfo` → `{ present: true, version: 'V3.42', policy: 'stable-comfyui' }`; with the version route removed → `present: false`.
  - `latestStable(['nightly','v0.44.1','v0.44.10','v0.44.2'])` → `'v0.44.10'`; `latestStable(['nightly'])` → `null`.
  - `checkUpdates` with packs `{ a: enabled/'true', b: enabled/'false', c: 'not-installed'/'true', 'comfyui-manager': enabled/'true' }` and versions `{ versions: ['nightly','v0.44.2','v0.44.1'], current: 'v0.44.1' }` → `installed: 3`, `withUpdates` ids `['a','comfyui-manager']` (by title), `comfyui: { current: 'v0.44.1', latest: 'v0.44.2', behind: true }`, and `calls` begins with `POST /customnode/fetch_updates`.
  - `managerReq` with `state.security = 'high'` on a POST update route → rejects with `code: 'security'`.
- [ ] Run `node test/comfy-updates.mjs`; expect it to fail with `ERR_MODULE_NOT_FOUND` for `src/service/comfyupdate.js`.
- [ ] Implement the Task 1 exports in `src/service/comfyupdate.js`, with a header comment in the repository's style (what the module does and why it drives Manager rather than git).
- [ ] Run `node test/comfy-updates.mjs`; expect every Task 1 case to print `ok`.

### Task 2: Run an update with a snapshot and per-pack results

**Files:** Modify `src/service/comfyupdate.js`, `test/comfy-updates.mjs`.

**Interfaces:**

- Produces:
  - `export async function ensureIdle(comfy)`: throws `.code = 'rendering'` ("ComfyUI is rendering or has jobs queued. Update when it's done.") if `GET /queue` has entries in `queue_running` or `queue_pending`; throws `'busy'` if `/manager/queue/status` has `is_processing`.
  - `export async function saveSnapshot(comfy)` → the new snapshot name: `/snapshot/getlist` before, `POST /snapshot/save` `{}`, `/snapshot/getlist` after; the name is the first item not in the earlier list. Throws `'http'` "ComfyUI-Manager didn't save a snapshot." if there is none.
  - `export function listenQueueDone(comfy, { clientId = 'iv-studio-updates' } = {})` → `{ done: Promise<{ nodepack_result }>, close() }`. Opens `new WebSocket(comfy.url.replace(/^http/, 'ws') + '/ws?clientId=' + clientId)` and resolves on the first message with `type === 'cm-queue-status'` and `data.status === 'done'`.
  - `export async function update(comfy, { desktop = false, onProgress = () => {}, listen = listenQueueDone, every = 2000, timeoutMs = 60 * 60 * 1000 } = {})` → `{ snapshot, results: [{ pack, ok, message }] }`. Order: `ensureIdle`, `onProgress({ phase: 'snapshot' })`, `saveSnapshot`, `listen(comfy)` (before queueing, because Manager forgets results when it finishes), `POST /manager/queue/reset`, `POST /manager/queue/update_all` `{ mode: 'cache' }`, `POST /manager/queue/update_comfyui` `{}` unless `desktop`, `POST /manager/queue/start` `{}`. Then poll `/manager/queue/status` every `every` ms, sending `onProgress({ phase: 'updating', done: done_count, total: total_count })`, until `is_processing` is false and the listener's `done` has resolved, or `timeoutMs` passes (then reject `'http'` "ComfyUI-Manager didn't finish within an hour."). `results` comes from `nodepack_result`: `ok` when the value is `'success'` or an object with `msg === 'success'`, `message` otherwise. Always `close()` the listener.

**Acceptance check:** the update cases pass and the fake records the exact call order.

- [ ] Add cases to `test/comfy-updates.mjs`, passing `listen: () => ({ done: Promise.resolve({ nodepack_result: { a: 'success', comfyui: 'success', bad: 'git pull failed' } }), close() {} })` and `every: 10`. The fake's `/manager/queue/status` reports `is_processing: true` for the first two polls, then false.
  - Normal run: `calls` contains, in order, `POST /snapshot/save`, `POST /manager/queue/reset`, `POST /manager/queue/update_all`, `POST /manager/queue/update_comfyui`, `POST /manager/queue/start`; result `snapshot` equals the name the fake added; `results` has `bad` with `ok: false, message: 'git pull failed'`; `onProgress` saw `snapshot` then at least one `updating`.
  - `desktop: true`: no `update_comfyui` call.
  - `comfyQueue.queue_pending` non-empty → rejects `code: 'rendering'`, and no `POST /snapshot/save` was made.
  - Manager queue `is_processing: true` before the start → rejects `code: 'busy'`.
- [ ] Run `node test/comfy-updates.mjs`; expect the new cases to fail (functions not exported).
- [ ] Implement the Task 2 functions.
- [ ] Run `node test/comfy-updates.mjs`; expect all cases `ok`.

### Task 3: Restart, last-update record and undo

**Files:** Modify `src/service/comfyupdate.js`, `test/comfy-updates.mjs`.

**Interfaces:**

- Consumes: `comfyUp(url, timeoutMs)` and `waitUp(url, opts)` from `src/service/comfylauncher.js` (default arguments; tests inject fakes).
- Produces:
  - `export async function restart(comfy, { up = comfyUp, wait = waitUp, downTimeoutMs = 60000, every = 1000 } = {})` → `{ version }`. `POST /manager/reboot` (the connection may drop mid-request; ignore network errors on this call only), wait until `up(comfy.url)` is false (if it never goes down within `downTimeoutMs`, reject `'http'` "ComfyUI didn't restart."), then `wait(comfy.url)`, then return `system_stats.system.comfyui_version`.
  - `export const recordPath = (dataDir) => path.join(dataDir, 'comfy-updates.json')`
  - `export function readRecord(dataDir)` → the record or `null`; `export function writeRecord(dataDir, record)`.
  - `export function copySnapshot(dataDir, comfyRoot, name)` → the copy's path under `<dataDir>/comfy-snapshots/<name>.json`, copied from `<comfyRoot>/user/__manager/snapshots/<name>.json`; `null` if the source isn't there.
  - `export async function undo(comfy, record, { comfyRoot, up = comfyUp } = {})` → `{ via: 'api' | 'file' }`. ComfyUI up: `POST /snapshot/restore` `{ target: record.snapshot }`, `{ via: 'api' }` (the caller then restarts). ComfyUI down: requires `record.snapshotCopy` and an existing `<comfyRoot>/user/__manager/startup-scripts` parent `user/__manager`; creates `startup-scripts` if needed and copies the snapshot to `restore-snapshot.json`; `{ via: 'file' }` (the caller then starts ComfyUI). Neither possible: rejects "Start ComfyUI first, then Undo." Throws "There's no update to undo." when `record` is null.
  - Record shape: `{ snapshot, snapshotCopy, at (ISO), comfyuiBefore, comfyuiAfter, results }`.

**Acceptance check:** restart and both undo paths pass against the fake and a temporary folder.

- [ ] Add cases:
  - `restart` with `up` returning `true` once then `false`, and `wait` resolving `{ seconds: 1 }` → `POST /manager/reboot` was called and `version` equals the fake's `comfyui_version`.
  - `restart` whose `up` never returns false, with `downTimeoutMs: 50` → rejects "ComfyUI didn't restart."
  - `copySnapshot` and `writeRecord`/`readRecord` round trip in `fs.mkdtempSync` folders.
  - `undo` with `up` true → `POST /snapshot/restore` with `{ target }` and `{ via: 'api' }`.
  - `undo` with `up` false → `<comfyRoot>/user/__manager/startup-scripts/restore-snapshot.json` has the copy's bytes, `{ via: 'file' }`.
  - `undo(comfy, null)` → rejects "There's no update to undo."
- [ ] Run `node test/comfy-updates.mjs`; expect the new cases to fail.
- [ ] Implement the Task 3 functions.
- [ ] Run `node test/comfy-updates.mjs`; expect all cases `ok`.

### Task 4: Studio methods and one launcher rule

**Files:** Modify `src/service/comfylauncher.js`, `src/main/index.js`, `src/service/studio.js`. Test: `test/comfy-updates.mjs`, `test/comfylauncher.mjs`.

**Interfaces:**

- Produces in `comfylauncher.js`:
  - `export function launcherFor(s)`: the body of `main/index.js`'s `launcherOf` (picked `comfyLauncher` if it exists, else the best in `comfyFolder`, else `findLaunchers()[0]`). `main/index.js` imports it and drops `launcherOf`.
  - `export const isDesktopLauncher = (file) => !!file && /^ComfyUI\.(exe|app)$/i.test(path.basename(file))`
- Produces in `studio.js` (each throws "Updates run on this PC's ComfyUI only." when `this.comfy.remote` or `!isLocalUrl(this.comfy.url)`):
  - `async comfyUpdates({ launcher = null } = {})` → `checkUpdates(this.comfy, { desktop: isDesktopLauncher(launcher) })` plus `last: readRecord(this.dataDir)`.
  - `async updateComfy({ folder = null, launcher = null, onProgress = () => {} } = {})`: `await this.beforeRender?.()` (frees the voice engine's GPU, as before renders), `const place = await comfyPlace(this.comfy, folder)`, `comfyRoot = path.dirname(place.customNodes)`, `before = (await this.comfy.systemStats()).system.comfyui_version`, `const { snapshot, results } = await update(this.comfy, { desktop, onProgress })`, `snapshotCopy = copySnapshot(this.dataDir, comfyRoot, snapshot)`, `onProgress({ phase: 'restarting' })`, `const { version } = await restart(this.comfy)`, `await this.capabilities(true)`, `writeRecord(...)` with all fields, `onProgress({ phase: 'done' })`. Returns the record. If the restart fails, write the record anyway (without `comfyuiAfter`) before rethrowing, so Undo stays possible.
  - `async undoComfyUpdate({ folder = null, start = null, onProgress = () => {} } = {})`: reads the record; `comfyRoot` from `comfyPlace` when ComfyUI is up, else from `folder` (the Settings ComfyUI folder: `path.join(folder, 'ComfyUI')` if that exists, else `folder`); `undo(...)`; for `'api'` then `restart`; for `'file'` then `start?.()` (main passes `startComfy`), or returns `{ via: 'file', startNeeded: true }` when `start` is null. Then `capabilities(true)` when ComfyUI is up, and returns `{ via, version }`.
  - `async installManager({ folder = null, onProgress } = {})`: `installPacks([MANAGER_PACK], { ...(await comfyPlace(this.comfy, folder)), resourcesDir: this.resourcesDir, onProgress })`, returns `{ results, restart: results.some((r) => r.status === 'installed') }`.

**Acceptance check:** studio methods refuse a remote ComfyUI; launcher tests still pass.

- [ ] Add to `test/comfylauncher.mjs`: `isDesktopLauncher('C:/x/ComfyUI.exe') === true`, `isDesktopLauncher('F:/c/run_nvidia_gpu.bat') === false`, `isDesktopLauncher(null) === false`.
- [ ] Add to `test/comfy-updates.mjs`: `new Studio({ dataDir: fs.mkdtempSync(...), resourcesDir: path.resolve('resources'), comfyUrl: 'http://127.0.0.1:8188', comfyToken: 'x' })` (a token makes it remote, comfy.js `remote`) → `updateComfy()`, `undoComfyUpdate()` and `comfyUpdates()` each reject "Updates run on this PC's ComfyUI only."
- [ ] Run both test files; expect the new cases to fail.
- [ ] Move `launcherOf` to `launcherFor` and add `isDesktopLauncher` in `comfylauncher.js`; update `main/index.js` to use them; add the four studio methods.
- [ ] Run `node test/comfylauncher.mjs` and `node test/comfy-updates.mjs`; expect all `ok`.

### Task 5: App wiring and the Updates row

**Files:** Modify `src/main/index.js`, `src/preload/index.js`, `src/renderer/src/components/Setup.jsx`. Create `src/renderer/src/components/ComfyUpdates.jsx`.

**Interfaces:**

- IPC in `main/index.js`, next to `setup:installNodes`, each with `const s = readSettings(BASE)`:
  - `handle('setup:updates:check', () => studio.comfyUpdates({ launcher: launcherFor(s) }))`
  - `handle('setup:updates:run', () => studio.updateComfy({ folder: s.comfyFolder || null, launcher: launcherFor(s), onProgress: (u) => send('setup:updates', u) }))`
  - `handle('setup:updates:undo', () => studio.undoComfyUpdate({ folder: s.comfyFolder || null, start: startComfy, onProgress: (u) => send('setup:updates', u) }))`
  - `handle('setup:updates:installManager', () => studio.installManager({ folder: s.comfyFolder || null, onProgress: (u) => send('setup:nodes', u) }))`
  - The voice engine's GPU memory is released inside `updateComfy` through the existing `studio.beforeRender` hook (Task 4), which `main/index.js` already sets to `() => voices?.release()`; the handlers add nothing for it.
- Preload: `setup: { ..., updates: { check: call('setup:updates:check'), run: call('setup:updates:run'), undo: call('setup:updates:undo'), installManager: call('setup:updates:installManager'), onProgress: on('setup:updates') } }`
- `ComfyUpdates({ notify, recheck })`:
  - Mount: nothing runs automatically (the check does a git fetch of every pack). A **Check for updates** button calls `check()`.
  - Manager missing (`err.code === 'missing'`, or `check` rejecting with that message): "Install ComfyUI-Manager to update from here" and an **Install ComfyUI-Manager** button → `installManager()`, then "Restart ComfyUI to load it (close its window, then press Start ComfyUI), then Check again." (Restarting through Manager isn't possible before Manager is loaded.)
  - After a check: "ComfyUI v0.44.1 → v0.44.2" (or "ComfyUI v0.44.1 is the newest stable release"), "N of M custom nodes have updates" with the names in a `<details>`, "Manager follows its nightly setting" when `policy` starts with `nightly`, "The ComfyUI Desktop app updates ComfyUI and Manager itself" when `desktop`.
  - **Update everything** (disabled when nothing has updates and ComfyUI isn't behind): the `Confirm` dialog (`Confirm.jsx`) with "IV Studio saves a snapshot, updates every custom node and ComfyUI, then restarts ComfyUI. Renders can't run meanwhile." On confirm, `run()`; progress lines from `onProgress`: "Saving a snapshot…", "Updating N of M…", "Restarting ComfyUI…". When it resolves: failed packs listed with their message, "ComfyUI v0.44.1 → v0.44.2, restarted", then `recheck()`. On rejection, `notify(err.message)`, show `StartComfy` and **Undo last update**.
  - **Undo last update · <date>** when `last` is set: `Confirm` first, then `undo()`, same progress and `recheck()`.
  - Buttons use the existing classes `btn btn-small` and `link-btn mono`; text sits in `dim small` lines like `NodeInstaller`.
- `Setup.jsx`: in the group body, `{title === 'ComfyUI and GPU' && !remote && list.find((i) => i.id === 'comfyui')?.status === 'ok' && <ComfyUpdates notify={notify} recheck={recheck} />}` before the checks list.

**Acceptance check:** `npm.cmd run build` succeeds; in the dev app, Setup shows the Updates row for the local ComfyUI, and **Check for updates** shows ComfyUI's current and latest versions and a count of packs with updates.

- [ ] Add the IPC handlers, preload entries, `ComfyUpdates.jsx` and the Setup line.
- [ ] Run `npm.cmd run build`; expect `✓ built`.
- [ ] Start the dev app (`Start IV Studio (dev).bat`), open Setup, press **Check for updates** only (read-only; it fetches but doesn't pull). Expect the version line and pack count. Capture a screenshot.
- [ ] Don't press **Update everything** yet (see Final verification).

### Task 6: MCP tools

**Files:** Modify `src/mcp/server.js`. Test: `test/mcp-smoke.mjs` (it lists tools).

**Interfaces:** registered with the existing `tool(name, description, shape, fn)`:

- `check_comfy_updates`, `{}` → `studio.comfyUpdates({ launcher: launcherFor(readSettings(BASE)) })`. Description: what it checks, read-only apart from Manager fetching update info.
- `update_comfy`, `{}` → `studio.updateComfy({ folder: readSettings(BASE).comfyFolder || null, launcher: launcherFor(readSettings(BASE)) })` (the voice engine is released through `studio.beforeRender`, which `src/mcp/server.js` already sets to `() => voices.release()`). Description: snapshot, update every custom node (Manager included) and ComfyUI to the newest stable (or Manager's nightly policy), restart; refuses while rendering; takes minutes; returns per-pack results and `undo_comfy_update` reverts it.
- `undo_comfy_update`, `{}` → `studio.undoComfyUpdate({ folder })` (no `start`); when it returns `startNeeded`, the text says to start ComfyUI to apply the restore.

**Acceptance check:** the three tools are listed with their descriptions.

- [ ] Add the three tools after `install_node_packs`.
- [ ] Run `npm.cmd run build`, then `node test/mcp-smoke.mjs` (it starts `out/main/mcp.js` with Electron and calls only read-only tools); expect the tool list to include `check_comfy_updates`, `update_comfy` and `undo_comfy_update`, and its existing checks to pass.

## Final verification

- [ ] `node test/comfy-updates.mjs`: every case `ok`.
- [ ] Regressions: `node test/graph-parity.mjs`, `node test/nodepacks.mjs`, `node test/comfylauncher.mjs`, `node test/model-versions.mjs`, `node test/core-upscaler.mjs`; each passes as it did before this work. (`test/sequence-graphs.mjs` queues real renders and `test/mcp-tools.mjs` needs media arguments; don't run them as regression checks.)
- [ ] `npm.cmd run build` succeeds.
- [ ] Live, read-only, against Matthew's ComfyUI: `checkUpdates` returns Manager `V3.42`, policy `stable-comfyui`, `current: 'v0.44.1'`, and a pack count matching Manager's own "Update" list.
- [ ] **Gated, needs Matthew's go-ahead:** press **Update everything** in the dev app with nothing rendering. Expect: a new snapshot in `user/__manager/snapshots/` and its copy in IV Studio's data `comfy-snapshots/`; progress through to "restarted"; ComfyUI answering with the new version; Setup's check clean (all node packs and models still ok, no new "Other nodes"). Then press **Undo last update** and expect ComfyUI back on v0.44.1 with the earlier pack commits, Setup clean. Record the before and after versions and any failed packs.

## Rollback and release boundary

- The code is local and uncommitted; reverting is deleting the two new files and reverting the seven modified ones (`git -c safe.directory=C:/Users/Matthew/iv-studio diff` shows them). Matthew's other uncommitted files (`Editor.jsx`, `reframe.js`, `test/reframe.mjs`) and the earlier upscaler change are not part of this plan and must stay as they are.
- A real update changes Matthew's ComfyUI install. Its rollback is **Undo last update**, or restoring the snapshot from ComfyUI-Manager's own Snapshot Manager.
- Committing, building an installer, publishing a release, or running the real update all need Matthew's separate say-so.

## Handoff

Start with Task 1. Tasks 1→3 depend only on each other; Task 4 needs 1–3; Tasks 5 and 6 need 4. Evidence to capture: each test run's output, the build result, the Task 5 screenshot, and for the gated run the snapshot name, versions before and after, and failed packs. Uncertain until tested live: how long `fetch_updates` takes across 43 packs (the 300 s timeout may need raising), and whether Manager's websocket `done` message always arrives before `is_processing` turns false.
