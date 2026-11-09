import { useEffect, useState } from 'react'
import { SetCard, SetField, Pill } from './SettingsKit'
import { NEWS } from '../news'

// IV Studio's own updates: the main process checks GitHub on launch and every six hours and downloads a
// new version in the background. These show where it's at, and install it with one click.
export function useUpdate() {
  const [state, setState] = useState(null)
  useEffect(() => {
    window.ivstudio.update.state().then(setState)
    return window.ivstudio.update.onChange(setState)
  }, [])
  return state
}

const install = (notify) => window.ivstudio.update.install().catch((err) => notify(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))

// In the sidebar's foot, in place of the version number.
export function UpdateButton({ notify }) {
  const u = useUpdate()
  if (u?.status === 'ready')
    return (
      <button className="nav-update ready" onClick={() => install(notify)} title={`IV Studio ${u.available} is downloaded. Restart to install it; anything open is saved.`}>
        ↻ Update to {u.available}
      </button>
    )
  if (u?.status === 'available')
    return (
      <button className="nav-update ready" onClick={() => install(notify)} title={u.portable ? `IV Studio ${u.available} is out. Opens its download page: unzip the new portable zip over this folder; the data folder stays.` : `IV Studio ${u.available} is out. Opens its download page: install it over this copy.${u.why ? ` ${u.why}` : ''}`}>
        ↓ Get {u.available}
      </button>
    )
  if (u?.status === 'downloading')
    return (
      <span className="nav-update" title="Downloading in the background">
        Updating to {u.available} · {Math.round(u.percent || 0)}%
      </span>
    )
  return <span>v{u?.version}</span>
}

const when = (iso) => (iso ? new Date(iso).toLocaleString() : null)

export function UpdateSettings({ notify, n }) {
  const u = useUpdate()
  const [checking, setChecking] = useState(false)
  if (!u) return null
  const line = {
    dev: 'This is a development copy; the installed app checks for updates.',
    idle: 'Checks GitHub for a new version on launch and every six hours.',
    checking: 'Checking for a new version…',
    current: `You have the newest version.${u.checkedAt ? ` Checked ${when(u.checkedAt)}.` : ''}`,
    available: u.portable
      ? `IV Studio ${u.available} is out. This portable copy doesn't update itself: download IV-Studio-Portable-win-x64.zip and unzip it over this folder. Your data folder beside IV Studio.exe stays as it is.`
      : u.why
        ? `IV Studio ${u.available} is out, but this copy can't install it itself. ${u.why}`
        : `IV Studio ${u.available} is out. Download it and install it over this copy.`,
    downloading: `Downloading IV Studio ${u.available}… ${Math.round(u.percent || 0)}%`,
    ready: `IV Studio ${u.available} is downloaded. Restart to install it, or it installs when you next quit.`,
    error: `Couldn't check for updates: ${u.error}`
  }[u.status]
  async function check() {
    setChecking(true)
    try {
      await window.ivstudio.update.check()
    } finally {
      setChecking(false)
    }
  }
  const tone = { current: 'ok', ready: 'ok', available: 'warn', error: 'warn' }[u.status] || ''
  const pill = { current: 'Up to date', ready: 'Ready to install', available: `${u.available} is out`, downloading: `Downloading ${Math.round(u.percent || 0)}%`, checking: 'Checking', error: 'Check failed', dev: 'Development copy' }[u.status]
  const button =
    u.status === 'ready' ? (
      <button className="btn btn-small btn-primary" onClick={() => install(notify)}>
        Restart to update
      </button>
    ) : u.status === 'available' ? (
      <button className="btn btn-small btn-primary" onClick={() => install(notify)}>
        Download {u.available}
      </button>
    ) : (
      <button className="btn btn-small" disabled={u.status === 'dev' || u.status === 'downloading' || checking || u.status === 'checking'} onClick={check}>
        {checking || u.status === 'checking' ? 'Checking…' : 'Check for updates'}
      </button>
    )
  return (
    <SetCard id="updates" n={n} title="Updates" sub={u.portable ? 'Portable copy: IV Studio tells you when a new version is out.' : u.manual ? 'IV Studio tells you when a new version is out.' : 'New versions download in the background and install with one click.'} aside={pill && <Pill tone={tone}>{pill}</Pill>}>
      <SetField label="This version" hint={line}>
        <div className="set-inline">
          <span className="set-big mono">v{u.version}</span>
          {button}
        </div>
      </SetField>
      {NEWS.slice(0, 4).map((v) => (
        <SetField key={v.version} label={v.version === u.version ? 'What’s new' : `In ${v.version}`} tag={v.version === u.version ? v.version : null}>
          <ul className="set-news">
            {v.items.map((n) => (
              <li key={n.text}>{n.text}</li>
            ))}
          </ul>
        </SetField>
      ))}
    </SetCard>
  )
}
