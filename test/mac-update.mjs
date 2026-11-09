// The Mac updater's parts (src/service/macupdate.js): the feed, the zip for each chip, the checksum, the download,
// unpacking and checking the bundle (macOS tools stood in), and the script that swaps the bundle, run for real with sh.
// The whole update, on a real Mac copy, is checked by scripts/ci-mac.sh (mac-update-selftest).
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { appBundleOf, cannotReplace, checkFile, download, feedUrls, installScript, newer, parseFeed, pickFile, stage } from '../src/service/macupdate.js'

let n = 0
const ok = async (name, fn) => (await fn(), n++, console.log('ok ', name))
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ivmac-'))
const sha = (buf) => crypto.createHash('sha512').update(buf).digest('base64')

// the 1.0.8 release's own latest-mac.yml
const FEED = `version: 1.0.8
files:
  - url: IV-Studio-mac-arm64.zip
    sha512: xax+zOqtIkMn5Vv2ai07W+d20lDeq2m2oB+SsA8032arHoYm1gRVIV5c98K3t7OEoQbLpgmJPMChjqmvpLvrfw==
    size: 212093489
  - url: IV-Studio-mac-arm64.dmg
    sha512: 1jTVRD+D4UDit+kB2JMomkC1L895n2mz9Tshdr3DG34skUjUNaJwF8uVeZW2rz0eFYoXHFlf3pLdwjdU3DJUWQ==
    size: 216516067
  - url: IV-Studio-mac-x64.zip
    sha512: Ged5gfHDCaEur8Fdj/tnBZAVqaiVGZ2oilLkq5kEoBUh/QLMLHXLKAYzwQR3D5yZqlLACznSAQGBJl+WLdkQMg==
    size: 228568186
  - url: IV-Studio-mac-x64.dmg
    sha512: TbkmvZEFcIarUQjwI3+osBCuAGgiqiXs8cjhiZNSZwVQU/UPim6oexPiu3jBVK+6IZ8N1oP+WBSr+nvvdDvl9w==
    size: 232936948
path: IV-Studio-mac-arm64.zip
sha512: xax+zOqtIkMn5Vv2ai07W+d20lDeq2m2oB+SsA8032arHoYm1gRVIV5c98K3t7OEoQbLpgmJPMChjqmvpLvrfw==
releaseDate: '2026-11-09T15:08:54.196Z'
`

await ok('versions compare', () => {
  assert.equal(newer('1.1.0', '1.0.8'), true)
  assert.equal(newer('1.0.10', '1.0.9'), true)
  assert.equal(newer('v1.0.8', '1.0.8'), false)
  assert.equal(newer('1.0.7', '1.0.8'), false)
  assert.equal(newer('1.0.8', '1.0.8-beta'), true)
  assert.equal(newer('1.0.8-beta', '1.0.8'), false)
  assert.equal(newer('nonsense', '1.0.8'), false)
})

await ok('the feed, and the zip for each chip', () => {
  const f = parseFeed(FEED)
  assert.equal(f.version, '1.0.8')
  assert.equal(f.files.length, 4)
  assert.equal(pickFile(f.files, 'arm64').url, 'IV-Studio-mac-arm64.zip')
  assert.equal(pickFile(f.files, 'x64').url, 'IV-Studio-mac-x64.zip')
  assert.equal(pickFile(f.files, 'x64').size, 228568186)
  assert.equal(pickFile([{ url: 'IV-Studio-mac-x64.zip', sha512: 'x' }], 'arm64'), null, 'an Apple Silicon copy never takes the Intel zip')
  assert.throws(() => parseFeed('files: []'))
})

await ok('where the feed is', () => {
  const g = feedUrls()
  assert.equal(g.feed, 'https://github.com/hollisorg/iv-studio/releases/latest/download/latest-mac.yml')
  assert.equal(g.file('IV-Studio-mac-arm64.zip', '1.1.0'), 'https://github.com/hollisorg/iv-studio/releases/download/v1.1.0/IV-Studio-mac-arm64.zip')
  const t = feedUrls('http://127.0.0.1:9/feed/')
  assert.equal(t.feed, 'http://127.0.0.1:9/feed/latest-mac.yml')
  assert.equal(t.file('IV Studio.zip'), 'http://127.0.0.1:9/feed/IV%20Studio.zip')
})

await ok('which copies can replace themselves', () => {
  assert.equal(appBundleOf('/Applications/IV Studio.app/Contents/MacOS/IV Studio'), '/Applications/IV Studio.app')
  assert.equal(appBundleOf('/usr/local/bin/node'), null)
  const fine = () => {}
  assert.equal(cannotReplace('/Applications/IV Studio.app', { access: fine }), null)
  assert.match(cannotReplace('/private/var/folders/x/AppTranslocation/ABC/d/IV Studio.app', { access: fine }), /Applications folder/)
  assert.match(cannotReplace('/Volumes/IV Studio 1.0.8/IV Studio.app', { access: fine }), /disk image/)
  assert.match(
    cannotReplace('/Applications/IV Studio.app', {
      access: () => {
        throw new Error('EACCES')
      }
    }),
    /can’t change \/Applications/
  )
  assert.match(cannotReplace(null), /app bundle/)
})

await ok('the download, then its size and checksum', async () => {
  const dir = tmp()
  const body = crypto.randomBytes(300_000)
  const server = http.createServer((req, res) => {
    if (req.url !== '/IV-Studio-mac-arm64.zip') return res.writeHead(404).end()
    res.writeHead(200, { 'content-length': body.length })
    res.end(body)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const seen = []
  const file = await download(`${base}/IV-Studio-mac-arm64.zip`, path.join(dir, 'u', 'a.zip'), { onProgress: (p) => seen.push(p) })
  assert.equal(fs.readFileSync(file).length, body.length)
  assert.equal(seen.at(-1), 100)
  assert.equal(fs.existsSync(`${file}.part`), false)
  assert.equal(await checkFile(file, { sha512: sha(body), size: body.length }), true)
  await assert.rejects(checkFile(file, { sha512: sha(Buffer.from('other')), size: body.length }), /checksum/)
  await assert.rejects(checkFile(file, { sha512: sha(body), size: 5 }), /not 5/)
  await assert.rejects(download(`${base}/missing.zip`, path.join(dir, 'b.zip')), /404/)
  server.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

// a stand-in for ditto, PlistBuddy, codesign and xattr: "unzips" by writing a bundle with the given version
function fakeTools({ version = '1.1.0', signed = true, apps = 1 } = {}) {
  const calls = []
  const run = async (cmd, args) => {
    calls.push(path.basename(cmd))
    if (cmd.endsWith('ditto')) {
      for (let i = 0; i < apps; i++) {
        const b = path.join(args[3], i ? `Other ${i}.app` : 'IV Studio.app', 'Contents')
        fs.mkdirSync(path.join(b, 'MacOS'), { recursive: true })
        fs.writeFileSync(path.join(b, 'Info.plist'), version)
      }
      return { code: 0 }
    }
    if (cmd.endsWith('PlistBuddy')) return { code: 0, stdout: `${fs.readFileSync(args[2], 'utf8')}\n` }
    if (cmd.endsWith('codesign')) return signed ? { code: 0 } : { code: 1, stderr: 'invalid signature (code or signature have been modified)' }
    return { code: 0 }
  }
  return { run, calls }
}

await ok('unpacking checks the version and the signature', async () => {
  const dir = tmp()
  const t = fakeTools()
  const app = await stage('x.zip', path.join(dir, 's'), { version: '1.1.0', run: t.run })
  assert.equal(path.basename(app), 'IV Studio.app')
  assert.deepEqual(t.calls, ['ditto', 'PlistBuddy', 'codesign', 'xattr'])
  await assert.rejects(stage('x.zip', path.join(dir, 's'), { version: '1.2.0', run: fakeTools().run }), /says it is 1\.1\.0, not 1\.2\.0/)
  await assert.rejects(stage('x.zip', path.join(dir, 's'), { version: '1.1.0', run: fakeTools({ signed: false }).run }), /signature/)
  await assert.rejects(stage('x.zip', path.join(dir, 's'), { version: '1.1.0', run: fakeTools({ apps: 2 }).run }), /one app/)
  fs.rmSync(dir, { recursive: true, force: true })
})

// the swap script, run with sh when there is one (macOS, Linux, Git Bash on Windows)
const sh = spawnSync('sh', ['-c', 'echo yes'], { encoding: 'utf8' }).stdout?.trim() === 'yes'
await ok(`the swap script${sh ? '' : ' (written only: no sh here)'}`, () => {
  const dir = tmp().replace(/\\/g, '/')
  const bundle = `${dir}/Applications/IV Studio.app`
  const staged = `${dir}/stage/IV Studio.app`
  for (const [b, v] of [
    [bundle, 'old'],
    [staged, 'new']
  ]) {
    fs.mkdirSync(`${b}/Contents`, { recursive: true })
    fs.writeFileSync(`${b}/Contents/v`, v)
  }
  const log = `${dir}/update.log`
  // a pid that has already ended, so it doesn't wait
  const script = installScript({ pid: 999999, bundle, staged, log, relaunch: false })
  assert.match(script, /^#!\/bin\/sh/)
  assert.match(script, /mv '.*IV Studio\.app' '.*IV Studio\.app\.iv-old'/)
  assert.ok(installScript({ pid: 1, bundle: "/A/It's.app", staged: '/s', log: '/l' }).includes(`'/A/It'\\''s.app'`), 'quotes are escaped')
  if (!sh) return
  fs.writeFileSync(`${dir}/install.sh`, script)
  execFileSync('sh', [`${dir}/install.sh`])
  assert.equal(fs.readFileSync(`${bundle}/Contents/v`, 'utf8'), 'new', 'the new copy is in place')
  assert.equal(fs.existsSync(`${bundle}.iv-old`), false, 'the old copy is gone')
  assert.equal(fs.existsSync(staged), false)
  assert.match(fs.readFileSync(log, 'utf8'), /installed/)
  // when the new copy can't be moved in, the old one is put back
  fs.mkdirSync(`${dir}/stage2`, { recursive: true })
  fs.writeFileSync(`${dir}/install2.sh`, installScript({ pid: 999999, bundle, staged: `${dir}/stage2/missing.app`, log, relaunch: false }))
  execFileSync('sh', [`${dir}/install2.sh`])
  assert.equal(fs.readFileSync(`${bundle}/Contents/v`, 'utf8'), 'new', 'the old copy is back')
  assert.match(fs.readFileSync(log, 'utf8'), /putting the old one back/)
  fs.rmSync(dir, { recursive: true, force: true })
})

console.log(`\n${n} passed`)
