import { useEffect, useState } from 'react'
import Hero from './Hero'
import { SettingsTabs } from './Settings'
import StartComfy from './StartComfy'
import ComfyUpdates from './ComfyUpdates'

const ICON = { ok: '●', warn: '▲', missing: '✕' }
const GROUPS = [
  ['ComfyUI and GPU', (i) => i.id === 'comfyui' || i.id === 'gpu'],
  ['Models', (i) => i.kind === 'model'],
  ['Node packs', (i) => i.kind === 'node_pack'],
  ['Characters', (i) => i.kind === 'character']
]
const GB = (b) => `${(b / 1024 ** 3).toFixed(1)} GB`
const ACTIVE = ['queued', 'downloading', 'verifying']

function ModelAction({ item, dl }) {
  if (item.status === 'ok') return item.size ? <span className="mono dim">{GB(item.size)}</span> : <span />
  const s = dl[item.model]
  if (s && ACTIVE.includes(s.status)) {
    const pct = s.total ? Math.floor((s.received / s.total) * 100) : null
    return (
      <div className="dl">
        <div className="bar">
          <span style={{ width: `${pct ?? 6}%` }} className={pct == null ? 'indeterminate' : ''} />
        </div>
        <span className="mono dim">{s.status === 'queued' ? 'Queued' : s.status === 'verifying' ? 'Checking…' : `${pct}% of ${GB(s.total)}`}</span>
        <button className="link-btn mono" onClick={() => window.ivstudio.models.cancel(item.model)}>
          Pause
        </button>
      </div>
    )
  }
  return (
    <div className="dl">
      {s?.status === 'paused' && <span className="mono dim">Paused</span>}
      <button className="btn btn-small" onClick={() => window.ivstudio.models.download([item.model])}>
        {s?.status === 'paused' ? 'Resume' : 'Download'}
        {item.size ? ` · ${GB(item.size)}` : ''}
      </button>
    </div>
  )
}

const STEP = { copying: 'Copying', downloading: 'Downloading', unpacking: 'Unpacking', requirements: 'Installing its requirements', done: 'Installed', skipped: 'Left alone', failed: 'Failed' }

// Installs every missing node pack into this PC's ComfyUI (nodepacks.js), with a line per pack as it goes.
function NodeInstaller({ missing, recheck, notify }) {
  const [busy, setBusy] = useState(false)
  const [lines, setLines] = useState({})
  const [done, setDone] = useState(null)
  useEffect(() => window.ivstudio.setup.onNodes((u) => setLines((all) => ({ ...all, [u.dir]: u }))), [])
  async function install() {
    setBusy(true)
    setLines({})
    setDone(null)
    try {
      setDone(await window.ivstudio.setup.installNodes())
      recheck()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }
  const list = Object.values(lines)
  return (
    <div className="node-install">
      {((missing > 0 && !done?.restart) || busy) && (
        <button className="btn" disabled={busy} onClick={install}>
          {busy ? 'Installing…' : `Install ${missing} missing node pack${missing === 1 ? '' : 's'}`}
        </button>
      )}
      {missing > 0 && !busy && !done && <p className="dim small">IV Studio adds them to your ComfyUI’s custom_nodes at the versions it’s tested with, and installs their requirements with ComfyUI’s own Python. Packs you already have are left alone.</p>}
      {list.length > 0 && (
        <ul className="checks node-lines">
          {list.map((u) => (
            <li key={u.dir} className={u.step === 'failed' ? 'missing' : u.step === 'done' ? 'ok' : 'warn'}>
              <span className="check-icon">{u.step === 'failed' ? ICON.missing : u.step === 'done' ? ICON.ok : ICON.warn}</span>
              <div>
                <div>{u.label}</div>
                <div className="dim small">
                  {STEP[u.step] || u.step}
                  {u.detail ? ` · ${u.detail}` : ''}
                </div>
              </div>
              <span />
            </li>
          ))}
        </ul>
      )}
      {done?.restart && <p className="notice">Restart ComfyUI to load the new node packs (close its window, then press Start ComfyUI), then Check again.</p>}
    </div>
  )
}

export default function Setup({ setup, recheck, checking, remote, go, notify }) {
  const [dl, setDl] = useState({})
  const items = setup?.items || []

  useEffect(() => {
    window.ivstudio.models.status().then(setDl)
    return window.ivstudio.models.onUpdate((u) => {
      setDl((all) => ({ ...all, [u.id]: u }))
      if (u.status === 'done') recheck()
    })
  }, [recheck])

  const missingModels = remote ? [] : items.filter((i) => i.kind === 'model' && i.status !== 'ok' && !i.optional && !ACTIVE.includes(dl[i.model]?.status))
  const missingBytes = missingModels.reduce((n, i) => n + (i.size || 0), 0)
  const errors = Object.entries(dl).filter(([, s]) => s.status === 'error')

  return (
    <div className="setup">
      <Hero art="settings" title="Settings" kicker="Infinite Variance" />
      <SettingsTabs tab="setup" go={go} setup={setup} />
      <p className="lede">
        IV Studio drives your own ComfyUI. This checks it has everything the workflow needs.
        <span className="lede-small dim">Models download from their upstream hosts straight into ComfyUI's models folder and are checked against the SHA-256 the host publishes. A paused download picks up where it stopped. Node packs install with one click, each at the version IV Studio is tested with.</span>
      </p>
      <div className="setup-actions">
        <button className="btn btn-primary" disabled={checking} onClick={recheck}>
          {checking ? 'Checking…' : 'Check again'}
        </button>
        {missingModels.length > 0 && (
          <button className="btn" onClick={() => window.ivstudio.models.download(missingModels.map((i) => i.model))}>
            Download {missingModels.length} missing model{missingModels.length === 1 ? '' : 's'}
            {missingBytes ? ` · ${GB(missingBytes)}+` : ''}
          </button>
        )}
      </div>
      {errors.map(([id, s]) => (
        <p key={id} className="notice">
          {items.find((i) => i.model === id)?.label || id}: {s.error}
        </p>
      ))}
      {GROUPS.map(([title, test]) => {
        const list = items.filter(test)
        if (!list.length) return null
        return (
          <section key={title} className="group">
            <div className="group-head">
              <h2>{title}</h2>
              <p className="mono dim">
                {list.filter((i) => i.status === 'ok').length}/{list.length} ready
              </p>
            </div>
            <div className="group-body">
              {title === 'Node packs' && !remote && <NodeInstaller missing={list.filter((i) => i.status !== 'ok' && i.dir).length} recheck={recheck} notify={notify} />}
              {title === 'ComfyUI and GPU' && !remote && list.find((i) => i.id === 'comfyui')?.status === 'ok' && <ComfyUpdates notify={notify} recheck={recheck} />}
              <ul className="checks">
                {list.map((i) => (
                  <li key={i.id} className={i.status}>
                    <span className="check-icon">{ICON[i.status]}</span>
                    <div>
                      <div>
                        {i.label}
                        {i.for && i.for !== 'Shots' && <span className="dim small"> · for {i.for}</span>}
                      </div>
                      <div className="dim small">{i.detail}</div>
                      {i.fix && <div className="small pink">{i.fix}</div>}
                      {i.id === 'comfyui' && i.status !== 'ok' && !remote && <StartComfy notify={notify} recheck={recheck} />}
                      {i.status !== 'ok' && (i.url || i.page) && (
                        <button className="link-btn mono" onClick={() => window.ivstudio.links.open(i.url || i.page)}>
                          {i.url ? 'Open its GitHub page' : 'Model page and licence'}
                        </button>
                      )}
                    </div>
                    {i.kind === 'model' && !remote ? <ModelAction item={i} dl={dl} /> : <span />}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )
      })}
    </div>
  )
}
