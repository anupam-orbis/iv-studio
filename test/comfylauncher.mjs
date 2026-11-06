// Starting ComfyUI (src/service/comfylauncher.js): which launchers are found, in what order, and that only a
// ComfyUI on this PC can be started. Builds a fake home folder; starts nothing.
//   node test/comfylauncher.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findLaunchers, isComfyFolder, isDesktopLauncher, isLocalUrl, launch, launchable, launcherFor, launchersIn, linuxCommand } from '../src/service/comfylauncher.js'

let pass = 0
let fail = 0
const ok = (cond, what) => (cond ? (pass++, console.log(`  ok   ${what}`)) : (fail++, console.log(`  FAIL ${what}`)))
const touch = (p) => (fs.mkdirSync(path.dirname(p), { recursive: true }), fs.writeFileSync(p, ''))

ok(isLocalUrl('http://127.0.0.1:8188') && isLocalUrl('http://localhost:8188/') && isLocalUrl('http://[::1]:8188'), 'this PC: 127.0.0.1, localhost and ::1')
ok(!isLocalUrl('http://192.168.1.20:8188') && !isLocalUrl('https://pod-8189.proxy.runpod.net') && !isLocalUrl('not a url'), 'not this PC: another machine, the cloud, nonsense')

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-launcher-'))
const env = { USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), PUBLIC: path.join(home, 'Public') }
try {
  ok(findLaunchers({ env, drives: [], platform: 'win32' }).length === 0, 'nothing installed: nothing found')
  touch(path.join(home, 'ComfyUI_windows_portable', 'run_nvidia_gpu.bat'))
  touch(path.join(home, 'ComfyUI_windows_portable', 'run_cpu.bat'))
  touch(path.join(env.LOCALAPPDATA, 'Programs', '@comfyorgcomfyui-electron', 'ComfyUI.exe'))
  touch(path.join(home, 'Desktop', 'ComfyUI.lnk'))
  touch(path.join(home, 'Desktop', 'notes.txt'))
  touch(path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'ComfyUI', 'ComfyUI.lnk'))
  const found = findLaunchers({ env, drives: [], platform: 'win32' })
  const names = found.map((f) => path.relative(home, f.path))
  console.log('    found:', names.join(' | '))
  ok(found[0].path.endsWith(path.join('Desktop', 'ComfyUI.lnk')), 'a desktop shortcut comes first (it carries the person’s own flags)')
  ok(found.some((f) => f.kind === 'desktop app') && found.some((f) => f.kind === 'portable'), 'the ComfyUI Desktop app and a portable install are found too')
  ok(names.indexOf(path.join('ComfyUI_windows_portable', 'run_nvidia_gpu.bat')) < names.indexOf(path.join('ComfyUI_windows_portable', 'run_cpu.bat')), 'the GPU .bat before the CPU one')
  ok(!names.some((n) => n.endsWith('notes.txt')), 'only things that can start ComfyUI')
  let refused = 0
  for (const bad of [path.join(home, 'missing.bat'), path.join(home, 'Desktop', 'notes.txt')]) {
    try {
      launch(bad, { platform: 'win32' })
    } catch {
      refused++
    }
  }
  ok(refused === 2, 'a missing file or a non-launcher is refused, not run')

  // a picked ComfyUI folder (Settings → ComfyUI → ComfyUI folder)
  const portable = path.join(home, 'ComfyUI_windows_portable')
  touch(path.join(portable, 'ComfyUI', 'main.py'))
  touch(path.join(portable, 'run_nvidia_gpu_seedhunter.bat'))
  touch(path.join(portable, 'README_VERY_IMPORTANT.txt'))
  const app = path.join(env.LOCALAPPDATA, 'Programs', '@comfyorgcomfyui-electron')
  ok(isComfyFolder(portable) && isComfyFolder(app) && !isComfyFolder(path.join(home, 'Desktop')), 'a portable install and the Desktop app’s folder count as ComfyUI; the desktop doesn’t')
  const inFolder = launchersIn(portable, 'win32').map((f) => f.label)
  console.log('    in the folder:', inFolder.join(' | '))
  ok(inFolder[0] === 'run_nvidia_gpu.bat' && inFolder[1] === 'run_nvidia_gpu_seedhunter.bat' && inFolder.at(-1) === 'run_cpu.bat' && !inFolder.some((n) => n.endsWith('.txt')), 'its start files: run_nvidia_gpu.bat, then GPU variants, CPU last, nothing else')

  // Linux: ComfyUI folders in the home folder, their .sh scripts first, then main.py with the folder's own venv
  const lhome = path.join(home, 'linux-home')
  ok(findLaunchers({ platform: 'linux', home: lhome }).length === 0, 'Linux, nothing installed: nothing found')
  const comfy = path.join(lhome, 'ComfyUI')
  touch(path.join(comfy, 'main.py'))
  touch(path.join(comfy, 'venv', 'bin', 'python'))
  const lfound = findLaunchers({ platform: 'linux', home: lhome })
  ok(lfound.length === 1 && lfound[0].path === path.join(comfy, 'main.py'), 'Linux: a ComfyUI checkout in the home folder is found by its main.py')
  touch(path.join(comfy, 'run_cpu.sh'))
  touch(path.join(comfy, 'start_gpu.sh'))
  const lin = launchersIn(comfy, 'linux').map((f) => f.label)
  console.log('    Linux folder:', lin.join(' | '))
  ok(lin[0] === 'start_gpu.sh' && lin[1] === 'run_cpu.sh' && lin[2] === 'main.py', 'Linux: GPU script, then CPU script, then main.py')
  const [cmd, args] = linuxCommand(path.join(comfy, 'main.py'))
  ok(cmd === path.join(comfy, 'venv', 'bin', 'python') && args[0] === path.join(comfy, 'main.py'), 'Linux: main.py runs with the folder’s venv Python')
  ok(linuxCommand(path.join(lhome, 'x', 'main.py'))[0] === 'python3' && linuxCommand(path.join(comfy, 'start_gpu.sh'))[0] === 'bash', 'Linux: python3 without a venv, bash for a script')
  let lrefused = 0
  try {
    launch(path.join(comfy, 'venv', 'bin', 'python'), { platform: 'linux' })
  } catch {
    lrefused++
  }
  ok(lrefused === 1, 'Linux: something that isn’t a script or main.py is refused')
  if (process.platform === 'linux') {
    // a real start: a stand-in "ComfyUI" that writes a file, started in its own session with its output logged
    const fake = path.join(lhome, 'FakeComfy')
    const marker = path.join(fake, 'started.txt')
    fs.mkdirSync(fake, { recursive: true })
    fs.writeFileSync(path.join(fake, 'run_gpu.sh'), `echo started > "${marker}"
echo hello from comfy
`)
    const log = path.join(lhome, 'comfy.log')
    launch(path.join(fake, 'run_gpu.sh'), { platform: 'linux', logFile: log })
    for (let i = 0; i < 50 && !fs.existsSync(marker); i++) await new Promise((r) => setTimeout(r, 100))
    await new Promise((r) => setTimeout(r, 200))
    ok(fs.existsSync(marker) && /hello from comfy/.test(fs.readFileSync(log, 'utf8')), 'Linux: a script really starts, in its own folder, with its output in the log')
  }
  // a Mac: the ComfyUI Desktop app in ~/Applications comes first, then a ComfyUI folder like Linux
  const mhome = path.join(home, 'mac')
  fs.mkdirSync(path.join(mhome, 'Applications', 'ComfyUI.app', 'Contents'), { recursive: true })
  touch(path.join(mhome, 'ComfyUI', 'main.py'))
  const mfound = findLaunchers({ platform: 'darwin', home: mhome }).filter((f) => f.path.startsWith(mhome))
  ok(mfound[0]?.path === path.join(mhome, 'Applications', 'ComfyUI.app') && mfound[0].kind === 'desktop app' && mfound[1]?.label === 'main.py', 'Mac: ComfyUI.app first, then a ComfyUI folder’s main.py')
  ok(launchable('darwin').test('/Applications/ComfyUI.app') && launchable('darwin').test('run.sh') && !launchable('darwin').test('ComfyUI.exe') && !launchable('linux').test('ComfyUI.app'), 'Mac: an app, a script or main.py can start ComfyUI')
  let mrefused = 0
  try {
    launch(path.join(mhome, 'ComfyUI', 'notes.txt'), { platform: 'darwin' })
  } catch {
    mrefused++
  }
  touch(path.join(mhome, 'ComfyUI', 'notes.txt'))
  try {
    launch(path.join(mhome, 'ComfyUI', 'notes.txt'), { platform: 'darwin' })
  } catch (err) {
    mrefused += /ComfyUI\.app/.test(err.message) ? 1 : 0
  }
  ok(mrefused === 2, 'Mac: a missing file or something else is refused, naming ComfyUI.app')
} finally {
  fs.rmSync(home, { recursive: true, force: true })
}
ok(isDesktopLauncher('C:/Users/x/AppData/Local/Programs/@comfyorgcomfyui-electron/ComfyUI.exe') && isDesktopLauncher('/Applications/ComfyUI.app'), 'the ComfyUI Desktop app is spotted (it updates ComfyUI itself)')
ok(!isDesktopLauncher('F:/ComfyUI/run_nvidia_gpu.bat') && !isDesktopLauncher('C:/x/Desktop/ComfyUI.lnk') && !isDesktopLauncher(null), 'a portable .bat, a shortcut or nothing is not the Desktop app')
ok(launcherFor({ comfyLauncher: path.join(os.tmpdir(), 'no-such-launcher.bat'), comfyFolder: path.join(os.tmpdir(), 'no-such-folder') }) === (findLaunchers()[0]?.path || null), 'a picked launcher or folder that is gone falls back to the best one found')
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
