import { useEffect, useState } from 'react'
import { ask } from './Confirm'
import StartComfy from './StartComfy'

// Setup → ComfyUI and GPU: updates this PC's ComfyUI, every custom node pack and ComfyUI-Manager through Manager
// (studio.js, comfyupdate.js). Nothing runs on its own: the check fetches every pack's remote, which takes a while.
const PHASE = { snapshot: 'Saving a snapshot…', restoring: 'Restoring the snapshot…', restarting: 'Restarting ComfyUI…', done: 'Done' }
const count = (results = [], status) => results.filter((r) => r.status === status).length
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '')

export default function ComfyUpdates({ notify, recheck }) {
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(null) // 'check' | 'update' | 'undo' | 'manager'
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [stuck, setStuck] = useState(false) // ComfyUI didn't come back: offer Start and Undo
  const [managerAdded, setManagerAdded] = useState(false)
  useEffect(() => window.ivstudio.setup.updates.onProgress(setProgress), [])

  async function check() {
    setBusy('check')
    setResult(null)
    try {
      setInfo(await window.ivstudio.setup.updates.check())
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(null)
    }
  }

  async function run() {
    const yes = await ask({
      title: 'Update ComfyUI and every custom node?',
      message: 'IV Studio saves a snapshot, updates every custom node pack (ComfyUI-Manager included) and ComfyUI, then restarts ComfyUI. Renders can’t run meanwhile. Undo last update puts it all back.',
      confirm: 'Update everything'
    })
    if (!yes) return
    setBusy('update')
    setResult(null)
    setStuck(false)
    setProgress(null)
    try {
      setResult({ kind: 'update', ...(await window.ivstudio.setup.updates.run()) })
      recheck()
      setInfo(null)
    } catch (err) {
      notify(err.message)
      setStuck(true)
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  async function undoLast() {
    const last = info?.last || (result?.kind === 'update' ? result : null)
    const yes = await ask({ title: 'Undo the last update?', message: `ComfyUI and its node packs go back to the snapshot from ${when(last?.at)}, then ComfyUI restarts.`, confirm: 'Undo', danger: true })
    if (!yes) return
    setBusy('undo')
    setProgress(null)
    try {
      setResult({ kind: 'undo', ...(await window.ivstudio.setup.updates.undo()) })
      setStuck(false)
      recheck()
      setInfo(null)
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  async function addManager() {
    setBusy('manager')
    try {
      const r = await window.ivstudio.setup.updates.installManager()
      const failed = r.results.find((x) => x.status === 'failed')
      if (failed) notify(failed.detail)
      else setManagerAdded(true)
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(null)
    }
  }

  const last = info?.last || (result?.kind === 'update' ? result : null)
  const packs = info?.packs
  const nothing = info?.manager?.present && !info.comfyui?.behind && !packs?.withUpdates.length
  const line = progress && (progress.phase === 'updating' ? `Updating ${progress.done ?? 0} of ${progress.total ?? '?'}…` : PHASE[progress.phase])
  const failed = result?.kind === 'update' ? (result.results || []).filter((r) => !r.ok) : []

  return (
    <div className="node-install comfy-updates">
      <div className="dim small">Updates</div>
      {info?.manager && !info.manager.present ? (
        <>
          <p className="dim small">Install ComfyUI-Manager to update ComfyUI and its node packs from here.</p>
          {!managerAdded && (
            <button className="btn btn-small" disabled={!!busy} onClick={addManager}>
              {busy === 'manager' ? 'Installing…' : 'Install ComfyUI-Manager'}
            </button>
          )}
          {managerAdded && <p className="notice">Restart ComfyUI to load ComfyUI-Manager (close its window, then press Start ComfyUI), then Check for updates.</p>}
        </>
      ) : (
        <>
          {info?.comfyui && (
            <p className="small">
              {info.desktop
                ? 'The ComfyUI Desktop app updates ComfyUI and ComfyUI-Manager itself; this updates the node packs.'
                : info.comfyui.behind
                  ? `ComfyUI ${info.comfyui.current} → ${info.comfyui.latest}`
                  : `ComfyUI ${info.comfyui.current} is ${info.comfyui.current === 'nightly' ? 'on nightly' : 'the newest stable release'}`}
              {info.manager?.policy?.startsWith('nightly') && <span className="dim"> · ComfyUI-Manager is set to nightly, so ComfyUI follows that</span>}
            </p>
          )}
          {packs && (
            <details className="small">
              <summary>
                {packs.withUpdates.length} of {packs.installed} custom node packs have updates
              </summary>
              <span className="dim">{packs.withUpdates.map((p) => p.title).join(', ') || 'None'}</span>
            </details>
          )}
          <div className="row-actions">
            <button className="btn btn-small" disabled={!!busy} onClick={check}>
              {busy === 'check' ? 'Checking… (a minute or two)' : 'Check for updates'}
            </button>
            {info?.manager?.present && (
              <button className="btn btn-small btn-primary" disabled={!!busy || nothing} onClick={run}>
                {busy === 'update' ? 'Updating…' : 'Update everything'}
              </button>
            )}
            {last?.snapshot && (
              <button className="link-btn mono" disabled={!!busy} onClick={undoLast}>
                {busy === 'undo' ? 'Undoing…' : `Undo last update · ${when(last.at)}`}
              </button>
            )}
          </div>
          {line && <p className="dim small">{line}</p>}
          {result?.kind === 'update' && (
            <p className="small">
              {result.comfyuiBefore && result.comfyuiAfter
                ? result.comfyuiBefore === result.comfyuiAfter
                  ? `ComfyUI ${result.comfyuiAfter} (no newer stable release), restarted.`
                  : `ComfyUI ${result.comfyuiBefore} → ${result.comfyuiAfter}, restarted.`
                : 'Updated and restarted.'}
              {result.reported ? (
                <span className="dim">
                  {' '}
                  {count(result.results, 'updated')} updated · {count(result.results, 'current')} already current
                  {count(result.results, 'unmanaged') ? ` · ${count(result.results, 'unmanaged')} plain folders ComfyUI-Manager can’t update` : ''}
                  {failed.length ? ` · ${failed.length} failed` : ''}
                </span>
              ) : (
                <span className="dim"> ComfyUI-Manager didn’t report each pack; its console has the details.</span>
              )}
            </p>
          )}
          {failed.length > 0 && (
            <ul className="checks node-lines">
              {failed.map((f) => (
                <li key={f.pack} className="missing">
                  <span className="check-icon">✕</span>
                  <div>
                    <div>{f.pack}</div>
                    <div className="dim small">{f.message}</div>
                  </div>
                  <span />
                </li>
              ))}
            </ul>
          )}
          {result?.kind === 'undo' && (
            <p className="small">
              {result.startNeeded
                ? 'The snapshot is set to restore: start ComfyUI, then press Undo last update again to finish.'
                : `Restored the snapshot${result.version ? `, ComfyUI ${result.version}` : ''}, restarted.`}
              {result.reenabled?.length > 0 && <span className="dim"> Switched back on {result.reenabled.join(', ')} (ComfyUI-Manager’s restore switches off packs a snapshot can’t track).</span>}
            </p>
          )}
          {stuck && (
            <p className="notice">
              If ComfyUI didn’t come back, start it again, or Undo last update. ComfyUI’s own window shows what went wrong. <StartComfy notify={notify} recheck={recheck} />
            </p>
          )}
        </>
      )}
    </div>
  )
}
