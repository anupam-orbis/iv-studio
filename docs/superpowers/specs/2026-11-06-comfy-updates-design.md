# Update ComfyUI, its node packs and ComfyUI-Manager from IV Studio

Date: 2026-11-06. Status: design approved by Matthew, not built.

## Goal

From Setup (and over MCP), check for and apply updates to the person's own ComfyUI: every custom node pack, ComfyUI-Manager itself, and ComfyUI. Restart ComfyUI automatically afterwards, and offer an Undo that restores the state before the update.

## Decisions

| Question | Decision |
|---|---|
| What node packs move to | The newest version of **every** custom node in that ComfyUI (Manager's Update All), not IV Studio's pinned versions. |
| What ComfyUI moves to | The newest **stable** release, through Manager's own ComfyUI update. If Manager's `update_policy` is nightly, IV Studio follows it and says so; it never changes that setting. |
| After an update | Restart ComfyUI automatically through Manager's restart (it keeps the launch flags), wait until it answers, re-run Setup's check. |
| Rollback | Save a Manager snapshot before each update; an **Undo last update** button restores it and restarts. |
| How | Drive ComfyUI-Manager's HTTP API while ComfyUI runs. No git or pip of IV Studio's own. |
| Agents | Three MCP tools: `check_comfy_updates`, `update_comfy`, `undo_comfy_update`. |
| Where | A ComfyUI on this PC only (`isLocalUrl`). No Updates row for a remote or cloud ComfyUI. |

Facts this rests on (ComfyUI-Manager V3.42, read from its source and the running install on 2026-11-06):

- Routes: `GET /manager/version`, `GET /manager/policy/update`, `POST /customnode/fetch_updates`, `GET /customnode/getlist`, `GET /comfyui_manager/comfyui_versions`, `POST /manager/queue/reset`, `POST /manager/queue/update_all`, `POST /manager/queue/update_comfyui`, `POST /manager/queue/start`, `GET /manager/queue/status`, `POST /snapshot/save`, `GET /snapshot/getlist`, `POST /snapshot/restore`, `POST /manager/reboot`.
- Update, restore and restart need Manager's security level `weak`, `normal` or `normal-` (403 otherwise). Update All answers 401 while Manager's queue is running.
- `update_all` already covers `comfyui-manager` itself, except under ComfyUI Desktop (`__COMFYUI_DESKTOP_VERSION__`), where the app updates ComfyUI and Manager.
- `/snapshot/restore` only copies the snapshot to `user/__manager/startup-scripts/restore-snapshot.json`; Manager applies it at the next start.
- Per-pack results arrive in Manager's `cm-queue-status` websocket message (`status: 'done'`, `nodepack_result`), broadcast to every client.

## What the person sees

Setup → **ComfyUI and GPU** gets an **Updates** row (local ComfyUI only):

- **Check for updates**: ComfyUI current → newest stable (e.g. 0.44.1 → 0.44.2), and how many custom nodes have updates, Manager included. Notes when Manager's policy is nightly.
- **Update everything** (one button):
  1. Refuses while ComfyUI is rendering or has queued prompts, while IV Studio has jobs running, or while Manager's queue is busy, and says why.
  2. Saves a Manager snapshot and records which one it is.
  3. Queues Update All (Manager included) and the ComfyUI update, starts Manager's queue.
  4. Shows progress ("Updating 7 of 31…") and, at the end, each pack that failed with Manager's message.
  5. Restarts ComfyUI, waits until it answers, re-runs the check.
- **Undo last update**: restores that snapshot and restarts the same way. Shows the snapshot's date.

Other cases:

- **No Manager**: "Install ComfyUI-Manager to update from here", using the existing node-pack installer (`installPacks`) with Manager pinned in `comfyupdate.js` as `MANAGER_PACK` (GitHub `Comfy-Org/ComfyUI-Manager`, commit `4c50a2bc`, V3.42). It isn't added to `models.json`: Manager registers no ComfyUI nodes, so Setup's node check can't detect it; `/manager/version` does. Then a one-time restart.
- **ComfyUI Desktop**: node updates only; the row says the desktop app updates ComfyUI and Manager.
- **Remote or cloud ComfyUI**: no Updates row.

## Components

### `src/service/comfyupdate.js` (new)

Talks only to Manager's HTTP API through IV Studio's `Comfy` client (`comfy.req`). Every function takes its dependencies as arguments and returns plain data, so a fake Manager can test it.

- `managerInfo(comfy)`: `{ present, version, policy, desktop }`. `present` is false when `/manager/version` 404s. `desktop` is true when the launcher picked in Settings → ComfyUI is the ComfyUI Desktop app (comfylauncher.js kind `desktop app`).
- `checkUpdates(comfy)`: `POST /customnode/fetch_updates`, then `/customnode/getlist` to count packs with an update; `/comfyui_manager/comfyui_versions` for the current version and the newest `vX.Y.Z` tag. Returns `{ comfyui: { current, latest }, packs: { withUpdates, names }, policy, desktop }`.
- `update(comfy, { onProgress, waitDone })`: the guard (ComfyUI `/queue` empty, `/manager/queue/status` not processing), snapshot (`/snapshot/getlist` before and after `/snapshot/save` gives its name), then `queue/reset`, `queue/update_all`, `queue/update_comfyui` (skipped under Desktop), `queue/start`. Polls `queue/status` every 2 s for `{ done, total }` progress; `waitDone` resolves with the `cm-queue-status` done message for per-pack results. Returns `{ snapshot, results: [{ pack, ok, message }] }`.
- `restart(comfy, { waitUp })`: `POST /manager/reboot`, wait until ComfyUI stops answering, then `waitUp` (comfylauncher.js, 6 min). Returns the new `comfyui_version`.
- `undo(comfy, record, { comfyRoot })`: with ComfyUI up, `POST /snapshot/restore` then `restart`. With ComfyUI down, copy the saved snapshot to `<comfyRoot>/user/__manager/startup-scripts/restore-snapshot.json` (what Manager's restore does) and leave starting to the caller (the launcher). That folder is Manager V3's layout; when it isn't there, Undo says to start ComfyUI first and uses the API path.

### The last-update record

`<IV Studio data>/comfy-updates.json`: `{ snapshot, at, comfyuiBefore, comfyuiAfter, results, snapshotCopy }`. `snapshotCopy` is IV Studio's own copy of the snapshot file, taken right after saving it, so Undo works even if Manager's folder is gone or ComfyUI won't start.

### `src/service/studio.js`

Thin methods `checkComfyUpdates()`, `updateComfy({ onProgress })` and `undoComfyUpdate({ onProgress })`. They refuse while IV Studio's own jobs are running, use `comfyPlace` (nodepacks.js) for the ComfyUI folder, write the record, refresh `capabilities(true)` after a restart, and use the existing websocket (studio.js) to catch `cm-queue-status`.

### App, renderer, MCP

- `main/index.js` + `preload`: `setup:checkUpdates`, `setup:updateComfy`, `setup:undoUpdate`, with a `setup:updates` progress channel like `setup:nodes`.
- `src/renderer/src/components/ComfyUpdates.jsx` (new), placed in Setup's "ComfyUI and GPU" group. Uses the existing `StartComfy` button when ComfyUI doesn't come back.
- `src/mcp/server.js`: `check_comfy_updates`, `update_comfy` (waits for the restart, returns per-pack results), `undo_comfy_update`.
- `src/service/comfylauncher.js`: `launcherFor(settings)` (moved from `main/index.js`) and `isDesktopLauncher(file)`, so the app and the MCP server pick the same launcher and spot ComfyUI Desktop the same way.

## Errors

| Case | What IV Studio does |
|---|---|
| Manager answers 403 | Says the security level in `user/__manager/config.ini` (or listening on the network) blocks updates and what to set. Changes nothing. |
| Manager queue busy (401), or a render is running or queued | "Wait until ComfyUI finishes, then try again." Queues nothing. |
| Manager policy is nightly | The check says so; ComfyUI follows it. |
| Some packs fail | Listed with Manager's message; the restart still happens; Undo offered. |
| ComfyUI doesn't come back within 6 min | Shows where its log is, the Start ComfyUI button, and Undo (the copy-to-startup-scripts path). |
| Network error while checking | Shown as it is; nothing changed. |

## Testing

- `test/comfy-updates.mjs`: a fake Manager (Node `http` server) for the full run, busy 401, 403, a failed pack, the restart wait (down then up), Undo through the API, and Undo with ComfyUI down (checks the copied file).
- Live, read-only against the running ComfyUI: Manager version, update count, ComfyUI versions.
- The real **Update everything** on Matthew's ComfyUI only on his go-ahead, as it changes his install; then Setup must come back clean.

## Out of scope

Choosing versions per pack; moving packs to IV Studio's pinned versions; updating a remote or cloud ComfyUI; changing Manager's settings; updating Python, torch or CUDA.
