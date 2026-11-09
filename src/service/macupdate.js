// IV Studio's own updater for a Mac. Apple's updater (Squirrel.Mac, which electron-updater uses there) only installs
// into an app signed with a paid Apple Developer ID, and IV Studio's Mac build is ad-hoc signed. So a Mac copy reads
// the same latest-mac.yml the release carries, downloads the zip for its own chip, checks it against the feed's
// SHA-512 and size, unpacks it with ditto (which keeps the bundle's signature and links), checks the new bundle's
// version and signature, and after IV Studio quits a small shell script swaps the bundle in place and opens it again.
// Nothing here needs Electron, so the parts are tested on any OS (test/mac-update.mjs); the steps that need macOS
// tools (ditto, codesign, PlistBuddy) take a runner so the test can stand them in.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'

export const RELEASES = 'https://github.com/hollisorg/iv-studio/releases'

// "1.2.3" (a leading v and a -tag are allowed) -> [1, 2, 3, pre]; a later version is newer, a -tag is older than none
function parts(v) {
  const m = String(v || '').trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/)
  return m ? [+m[1], +m[2], +m[3], m[4] || null] : null
}
export function newer(a, b) {
  const x = parts(a)
  const y = parts(b)
  if (!x || !y) return false
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  if (x[3] === y[3]) return false
  if (!x[3]) return true // 1.2.3 is newer than 1.2.3-beta
  if (!y[3]) return false
  return x[3] > y[3]
}

// latest-mac.yml -> { version, files: [{ url, sha512, size }], releaseDate }
export function parseFeed(text) {
  const doc = yaml.load(text)
  if (!doc || typeof doc !== 'object' || !parts(doc.version)) throw new Error('The update feed has no version.')
  const files = (doc.files || []).filter((f) => f && f.url && f.sha512).map((f) => ({ url: String(f.url), sha512: String(f.sha512), size: Number(f.size) || null }))
  return { version: String(doc.version).replace(/^v/, ''), files, releaseDate: doc.releaseDate || null }
}

// the zip for this chip: IV-Studio-mac-arm64.zip on Apple Silicon, IV-Studio-mac-x64.zip on Intel (and under Rosetta,
// where an Intel copy keeps running as Intel)
export function pickFile(files, arch) {
  const zips = files.filter((f) => /\.zip$/i.test(f.url))
  const want = arch === 'arm64' ? /arm64/i : /(x64|x86_64|intel)/i
  return zips.find((f) => want.test(f.url)) || (arch === 'arm64' ? null : zips.find((f) => !/arm64/i.test(f.url))) || null
}

// where the feed and its files are: GitHub's newest release, or a test feed (a folder URL)
export function feedUrls(testFeed) {
  if (testFeed) {
    const base = testFeed.replace(/\/+$/, '')
    return { feed: `${base}/latest-mac.yml`, file: (name) => `${base}/${encodeURIComponent(name)}` }
  }
  return { feed: `${RELEASES}/latest/download/latest-mac.yml`, file: (name, version) => `${RELEASES}/download/v${version}/${encodeURIComponent(name)}` }
}

// /Applications/IV Studio.app/Contents/MacOS/IV Studio -> /Applications/IV Studio.app
export function appBundleOf(execPath) {
  const m = String(execPath).match(/^(.*?\.app)\/Contents\/MacOS\/[^/]+$/)
  return m ? m[1] : null
}

// Why this copy can't replace itself, or null when it can. A copy opened straight from the .dmg, or one macOS runs
// from a random read-only spot because it was never moved out of Downloads ("App Translocation"), has to be moved
// into Applications first; a folder the person can't write to (a standard account with the app in /Applications)
// needs the download page.
export function cannotReplace(bundle, { access = fs.accessSync } = {}) {
  if (!bundle) return 'IV Studio isn’t running from an app bundle.'
  if (/\/AppTranslocation\//.test(bundle)) return 'macOS is running IV Studio from a temporary read-only copy. Drag IV Studio into your Applications folder and open it from there, then it can update itself.'
  if (/^\/Volumes\//.test(bundle)) return 'IV Studio is running from its disk image or another drive. Drag it into your Applications folder and open it from there, then it can update itself.'
  try {
    access(path.dirname(bundle), fs.constants.W_OK)
    access(bundle, fs.constants.W_OK)
  } catch {
    return `This account can’t change ${path.dirname(bundle)}. Download the new version and drag it into Applications, or update from an administrator account.`
  }
  return null
}

// a downloaded file against the feed: its size, then its SHA-512 (base64, as electron-builder writes it)
export async function checkFile(file, want) {
  const st = fs.statSync(file)
  if (want.size && st.size !== want.size) throw new Error(`The download is ${st.size} bytes, not ${want.size}.`)
  const hash = crypto.createHash('sha512')
  await new Promise((resolve, reject) => fs.createReadStream(file).on('data', (d) => hash.update(d)).on('end', resolve).on('error', reject))
  const got = hash.digest('base64')
  if (got !== want.sha512) throw new Error('The download doesn’t match the update feed’s checksum, so it wasn’t used.')
  return true
}

// Download url to file with progress (0-100). Resumes nothing: a failed download starts again next time.
export async function download(url, file, { onProgress = () => {}, fetchImpl = fetch, signal } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const res = await fetchImpl(url, { redirect: 'follow', signal })
  if (!res.ok || !res.body) throw new Error(`The download failed (${res.status}).`)
  const total = Number(res.headers.get('content-length')) || 0
  const part = `${file}.part`
  const out = fs.createWriteStream(part)
  let got = 0
  let last = -1
  try {
    for await (const chunk of res.body) {
      got += chunk.length
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
      const pct = total ? Math.floor((got / total) * 100) : 0
      if (pct !== last) onProgress(pct, got, total)
      last = pct
    }
  } finally {
    await new Promise((r) => out.end(r))
  }
  fs.renameSync(part, file)
  return file
}

// Unpack the zip and check the bundle inside: one .app, its version is the feed's, and its signature holds.
// run(cmd, args) -> { code, stdout, stderr } runs a macOS tool (stood in by the test).
export async function stage(zip, dir, { version, run }) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const unzip = await run('/usr/bin/ditto', ['-x', '-k', zip, dir])
  if (unzip.code !== 0) throw new Error(`Couldn’t unpack the update: ${(unzip.stderr || '').trim().split('\n')[0]}`)
  const apps = fs.readdirSync(dir).filter((n) => n.endsWith('.app'))
  if (apps.length !== 1) throw new Error('The update didn’t hold one app.')
  const bundle = path.join(dir, apps[0])
  const plist = path.join(bundle, 'Contents', 'Info.plist')
  if (!fs.existsSync(plist)) throw new Error('The update’s app has no Info.plist.')
  const v = await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist])
  const got = (v.stdout || '').trim()
  if (v.code !== 0 || got !== version) throw new Error(`The update’s app says it is ${got || 'no version'}, not ${version}.`)
  const sig = await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle])
  if (sig.code !== 0) throw new Error(`The update’s app failed its signature check: ${(sig.stderr || '').trim().split('\n')[0]}`)
  // a download made by this process carries no quarantine flag, but clear any so macOS doesn't stop the new copy
  await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', bundle])
  return bundle
}

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`

// The script that swaps the bundle once IV Studio (pid) has quit: the old copy moves aside, the new one takes its
// place, and the old one is removed only when that worked (else it's put back). Then IV Studio opens again.
export function installScript({ pid, bundle, staged, log, relaunch = true }) {
  const old = `${bundle}.iv-old`
  return [
    '#!/bin/sh',
    `# IV Studio update: swap ${bundle}`,
    `exec >>${q(log)} 2>&1`,
    `echo "$(date) waiting for IV Studio (pid ${pid}) to quit"`,
    'n=0',
    `while kill -0 ${pid} 2>/dev/null; do n=$((n+1)); [ $n -gt 600 ] && { echo "it didn't quit"; exit 1; }; sleep 0.2; done`,
    `rm -rf ${q(old)}`,
    `if ! mv ${q(bundle)} ${q(old)}; then echo "couldn't move the old copy aside"; exit 1; fi`,
    `if mv ${q(staged)} ${q(bundle)}; then`,
    `  rm -rf ${q(old)}`,
    '  echo "installed"',
    'else',
    `  echo "couldn't put the new copy in place; putting the old one back"`,
    `  mv ${q(old)} ${q(bundle)}`,
    'fi',
    `/usr/bin/xattr -dr com.apple.quarantine ${q(bundle)} 2>/dev/null`,
    relaunch ? `/usr/bin/open ${q(bundle)} && echo "opened"` : 'echo "not reopening"',
    ''
  ].join('\n')
}
