// IV Studio updates itself from GitHub Releases (latest.yml is published next to the installer), the same
// way IV Downloader does: it checks on launch and every six hours, downloads a new version in the
// background, and installs it when the person clicks "Restart to update" or quits the app.
// IV_STUDIO_UPDATE_FEED (a URL with a latest.yml) points a test copy at a local feed; such a copy never
// installs on quit, so a test can't replace the installed app.
import { app, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { dataLocation } from '../service/paths'
import { initMacUpdater } from './macupdater'

const { autoUpdater } = electronUpdater
const SIX_HOURS = 6 * 60 * 60 * 1000
const TEST_FEED = process.env.IV_STUDIO_UPDATE_FEED
// macOS's own updater installs only into an app signed with an Apple Developer ID, so a Mac copy uses IV Studio's
// own (macupdater.js): the same download in the background and one-click install, swapping the app bundle itself.
// The portable copy (a "data" folder beside IV Studio.exe, see paths.js) is updated the same way: the installer
// would put a second copy in Program Files, so it says a new version is out and opens the release page, where the
// person downloads the new zip and unzips it over this folder (the data folder stays).
export const PORTABLE = dataLocation().source === 'portable'
export const MANUAL = PORTABLE
const MAC = process.platform === 'darwin' && !PORTABLE
const RELEASES = 'https://github.com/hollisorg/iv-studio/releases/latest'

let state = { status: 'idle', version: app.getVersion(), available: null, percent: null, error: null, checkedAt: null, manual: MANUAL, portable: PORTABLE, mac: MAC, why: null }
export const updateState = () => state

export function initUpdater(onChange) {
  const set = (patch) => {
    state = { ...state, ...patch }
    onChange(state)
  }

  // Development builds have no app-update.yml; only packaged builds check.
  if (!app.isPackaged) {
    set({ status: 'dev' })
    return { check: async () => state, install: () => false }
  }

  if (MAC) return initMacUpdater({ set, get: () => state, testFeed: TEST_FEED })

  if (TEST_FEED) autoUpdater.setFeedURL({ provider: 'generic', url: TEST_FEED })
  // the zip carries no installer's update settings, so name the releases it checks
  else if (PORTABLE) autoUpdater.setFeedURL({ provider: 'github', owner: 'hollisorg', repo: 'iv-studio' })
  autoUpdater.autoDownload = !MANUAL
  autoUpdater.autoInstallOnAppQuit = !TEST_FEED && !MANUAL

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }))
  autoUpdater.on('update-not-available', () => set({ status: 'current', available: null, checkedAt: new Date().toISOString() }))
  autoUpdater.on('update-available', (info) => set({ status: MANUAL ? 'available' : 'downloading', available: info.version, percent: MANUAL ? null : 0, checkedAt: new Date().toISOString() }))
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: p.percent }))
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', available: info.version, percent: 100 }))
  autoUpdater.on('error', (err) => {
    const message = String(err?.message || err)
    // With no published release yet (drafts only), GitHub has no "latest" to report.
    if (/Unable to find latest version/i.test(message)) return set({ status: 'current', error: null })
    set({ status: 'error', error: message.split('\n')[0] })
  })

  const check = async () => {
    if (state.status === 'downloading' || state.status === 'ready') return state
    try {
      await autoUpdater.checkForUpdates()
    } catch {
      /* reported through the error event */
    }
    return state
  }
  setTimeout(check, 10_000)
  setInterval(check, SIX_HOURS)

  return {
    check,
    // Silent install, then IV Studio opens again on the new version.
    install: () => {
      if (MANUAL) {
        if (state.status !== 'available') return false
        shell.openExternal(RELEASES)
        return true
      }
      if (state.status !== 'ready') return false
      autoUpdater.quitAndInstall(true, true)
      return true
    }
  }
}
