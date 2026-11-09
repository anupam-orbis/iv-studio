// A Mac copy's updates (see src/service/macupdate.js for why it isn't electron-updater): the same states and the same
// { check, install } as updater.js, so Settings -> Updates and the sidebar work as on Windows. It checks on launch and
// every six hours, downloads the new zip in the background, and installs on "Restart to update" or when IV Studio
// quits. A copy that can't replace itself (run from the .dmg, from Downloads, or without write access) says why and
// offers the download page instead.
// IV_STUDIO_UPDATE_FEED points a test copy at a local feed; IV_STUDIO_UPDATE_SELFTEST=1 then installs as soon as
// the download is ready (the Mac CI's update check, on a copy of the app in a temporary folder).
import { app, shell } from 'electron'
import { spawn, execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RELEASES, appBundleOf, cannotReplace, checkFile, download, feedUrls, installScript, newer, parseFeed, pickFile, stage } from '../service/macupdate'

const SIX_HOURS = 6 * 60 * 60 * 1000
const RETRY = 5 * 60 * 1000 // a failed check (offline at launch, a dropped connection) tries again this soon
const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { maxBuffer: 4 << 20 }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))

export function initMacUpdater({ set, get, testFeed }) {
  const selftest = !!testFeed && process.env.IV_STUDIO_UPDATE_SELFTEST === '1'
  const urls = feedUrls(testFeed)
  const work = path.join(os.tmpdir(), 'iv-studio-update')
  const bundle = appBundleOf(process.execPath)
  let staged = null // { version, app }
  let busy = null
  let retry = null

  const log = (line) => {
    try {
      fs.mkdirSync(work, { recursive: true })
      fs.appendFileSync(path.join(work, 'update.log'), `${new Date().toISOString()} ${line}\n`)
    } catch {
      /* the log is only a help */
    }
  }

  async function fetchFeed() {
    const res = await fetch(`${urls.feed}${testFeed ? '' : `?t=${Date.now()}`}`, { redirect: 'follow' })
    if (res.status === 404) return null // no published release yet
    if (!res.ok) throw new Error(`GitHub answered ${res.status}.`)
    return parseFeed(await res.text())
  }

  async function checkNow() {
    set({ status: 'checking', error: null })
    const feed = await fetchFeed()
    const at = new Date().toISOString()
    if (!feed || !newer(feed.version, app.getVersion())) return set({ status: 'current', available: null, why: null, checkedAt: at })
    const file = pickFile(feed.files, process.arch)
    // no zip for this chip, or a copy that can't replace itself: say it's out, and the button opens the download page
    const why = !file ? `The update has no ${process.arch === 'arm64' ? 'Apple Silicon' : 'Intel'} zip.` : cannotReplace(bundle)
    if (why) {
      log(`${feed.version} is out; can't install here: ${why}`)
      return set({ status: 'available', available: feed.version, manual: true, why, percent: null, checkedAt: at })
    }
    if (staged?.version === feed.version && fs.existsSync(staged.app)) return set({ status: 'ready', available: feed.version, manual: false, why: null, percent: 100, checkedAt: at })
    set({ status: 'downloading', available: feed.version, manual: false, why: null, percent: 0, checkedAt: at })
    const zip = path.join(work, path.basename(file.url))
    log(`downloading ${file.url} (${feed.version})`)
    await download(urls.file(file.url, feed.version), zip, { onProgress: (p) => p !== get().percent && set({ percent: p }) })
    await checkFile(zip, file)
    const appPath = await stage(zip, path.join(work, `IV Studio ${feed.version}`), { version: feed.version, run })
    fs.rmSync(zip, { force: true })
    staged = { version: feed.version, app: appPath }
    log(`ready: ${appPath}`)
    set({ status: 'ready', available: feed.version, percent: 100 })
    if (selftest) install()
  }

  const check = async () => {
    const s = get().status
    if (busy || s === 'downloading' || s === 'ready') return get()
    busy = checkNow()
      .catch((err) => {
        log(`error: ${err.message}`)
        set({ status: 'error', error: String(err.message || err).split('\n')[0], percent: null })
        clearTimeout(retry)
        retry = setTimeout(check, selftest ? 3000 : RETRY)
      })
      .finally(() => (busy = null))
    await busy
    return get()
  }

  // hand the swap to a script that waits for this process to end
  function swap(relaunch) {
    const script = path.join(work, 'install.sh')
    fs.writeFileSync(script, installScript({ pid: process.pid, bundle, staged: staged.app, log: path.join(work, 'update.log'), relaunch }), { mode: 0o755 })
    const child = spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' })
    child.unref()
    log(`installing ${staged.version} over ${bundle}${relaunch ? ', then reopening' : ''}`)
  }

  function install() {
    const s = get()
    if (s.status === 'available') {
      shell.openExternal(`${RELEASES}/latest`)
      return true
    }
    if (s.status !== 'ready' || !staged) return false
    swap(true)
    staged = null
    app.quit()
    return true
  }

  // a downloaded update also installs when IV Studio quits, as on Windows (never from a test feed, except the selftest)
  app.on('will-quit', () => {
    if (!staged || get().status !== 'ready' || (testFeed && !selftest)) return
    try {
      swap(false)
      staged = null
    } catch (err) {
      log(`couldn't start the install on quit: ${err.message}`)
    }
  })

  setTimeout(check, selftest ? 1000 : 10_000)
  setInterval(check, SIX_HOURS)
  return { check, install }
}
