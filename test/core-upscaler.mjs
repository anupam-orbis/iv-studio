// ComfyUI 0.44+'s built-in H3 latent upscaler (remote.js adaptGraph, plan.js upscaleSize, setup.js builtIn/altLoader):
// a finish on a ComfyUI that has it uses ComfyUI's own nodes at the same size; an older ComfyUI keeps the LBH node.
//   node test/core-upscaler.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPrompt, checkPrompt } from '../src/service/graph.js'
import { planFinish, planPreviews, resolveFinalSize } from '../src/service/plan.js'
import { adaptGraph, capabilities } from '../src/service/remote.js'
import { checkSetup, modelFileMap, modelOptions } from '../src/service/setup.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'))
const template = read('resources', 'workflows', 'iv_studio_api.json')
const meta = read('resources', 'workflows', 'iv_studio_api.groups.json')
const manifest = read('resources', 'models.json')
const upscalerModel = manifest.models.find((m) => m.id === 'upscaler')
const FILE = upscalerModel.match

let n = 0
const ok = async (name, fn) => {
  await fn()
  n++
  console.log(`ok  ${name}`)
}
const combo = (files) => ({ input: { required: { model_name: [files] } } })
const WIN = { system: { os: 'win32', comfyui_version: '0.44.0' } }
const LINUX = { system: { os: 'posix', comfyui_version: '0.44.0' } }
const DLSS = { DLSS5_Enhance_Video: { input: { required: {} } } } // a Windows ComfyUI with DLSS 5, so only the upscaler changes
const NEW = { ...DLSS, MiniMaxH3LatentUpscaleWithModel: { input: { required: {} } }, LatentUpscaleModelLoader: combo([FILE]) }
const OLD = { ...DLSS, MinimaxH3LatentUpscaler3D: combo([FILE]) }

const preview = planPreviews({ prompt: 'a fox in the snow', character: 'none', aspect: '16:9', megapixels: 0.4 }, [])
const finish = planFinish(preview, { candidate: 2, megapixels: 2 })
const built = buildPrompt(template, meta, finish.groups, finish.values)
const upscalers = (g) => Object.entries(g).filter(([, v]) => /LatentUpscale/i.test(v.class_type))

await ok('ComfyUI 0.44+ reports the built-in upscaler; an older one does not', () => {
  assert.equal(capabilities(NEW, WIN).coreUpscaler, true)
  assert.equal(capabilities(OLD, WIN).coreUpscaler, false)
  assert.equal(capabilities({ ...DLSS, MiniMaxH3LatentUpscaleWithModel: {} }, WIN).coreUpscaler, false, 'needs the loader too')
})

await ok('a finish plan carries the latent upscaler size (the LBH node’s own megapixels result); a single pass has none', () => {
  const { width, height } = preview.resolved
  assert.deepEqual(finish.resolved.upscaleSize, resolveFinalSize(width, height, 2))
  assert.equal(finish.resolved.upscaleSize.width % 32, 0)
  const cont = planPreviews({ mode: 'continue', prompt: 'carry on', character: 'none', media: [{ kind: 'video', file: 'clip.mp4' }] }, [])
  assert.equal(planFinish(cont, {}).resolved.upscaleSize, undefined)
})

await ok('on ComfyUI 0.44+ the LBH upscaler becomes ComfyUI’s loader + MiniMaxH3LatentUpscaleWithModel, wired the same way', () => {
  const before = upscalers(built)
  assert.deepEqual(before.map(([, v]) => v.class_type), ['MinimaxH3LatentUpscaler3D'])
  const [id, lbh] = before[0]
  const g = adaptGraph(built, capabilities(NEW, WIN), { upscaleSize: finish.resolved.upscaleSize })
  assert.deepEqual(checkPrompt(g), [])
  assert.equal(g[id].class_type, 'MiniMaxH3LatentUpscaleWithModel')
  assert.deepEqual(g[id].inputs, { model: [`${id}_core_load`, 0], samples: lbh.inputs.latent, width: finish.resolved.upscaleSize.width, height: finish.resolved.upscaleSize.height })
  assert.deepEqual(g[`${id}_core_load`], { class_type: 'LatentUpscaleModelLoader', inputs: { model_name: lbh.inputs.model_name } })
  // everything that read the LBH node's output still reads the same node id
  const readers = (graph) => Object.entries(graph).filter(([, v]) => Object.values(v.inputs).some((x) => Array.isArray(x) && x[0] === id)).map(([k]) => k).sort()
  assert.deepEqual(readers(g), readers(built))
  // nothing else changed
  for (const k of Object.keys(built)) if (k !== id) assert.deepEqual(g[k], built[k], k)
})

await ok('an older ComfyUI, or a graph without a size, keeps the LBH node untouched', () => {
  assert.deepEqual(adaptGraph(built, capabilities(OLD, WIN), { upscaleSize: finish.resolved.upscaleSize }), built)
  assert.deepEqual(adaptGraph(built, capabilities(NEW, WIN)), built)
})

await ok('on a Linux ComfyUI the swapped loader gets forward slashes like every other model name', () => {
  const g0 = structuredClone(built)
  const [id] = upscalers(g0)[0]
  g0[id].inputs.model_name = 'MiniMax H3\\' + FILE
  const g = adaptGraph(g0, { ...capabilities(NEW, LINUX), dlss: true }, { upscaleSize: finish.resolved.upscaleSize })
  assert.equal(g[`${id}_core_load`].inputs.model_name, 'MiniMax H3/' + FILE)
})

await ok('setup finds the upscaler model through ComfyUI’s own loader, and maps a renamed one', () => {
  assert.deepEqual(modelOptions(NEW, upscalerModel), [FILE])
  assert.deepEqual(modelOptions({ ...OLD, ...NEW }, upscalerModel), [FILE])
  assert.equal(modelOptions({}, upscalerModel), null)
  const other = 'minimax_h3_latent_upscaler_3d_conv_v1_bf16.safetensors'
  assert.equal(modelFileMap({ models: [upscalerModel] }, { LatentUpscaleModelLoader: combo([other]) })[FILE], other)
})

await ok('setup: with the built-in upscaler the LBH node pack is not needed; without it, it still is', async () => {
  const everything = Object.fromEntries([...new Set(Object.values(template).map((v) => v.class_type))].map((c) => [c, { input: { required: {} } }]))
  const run = async (info) => {
    const comfy = { url: 'http://127.0.0.1:8188', systemStats: async () => ({ ...WIN, devices: [{ type: 'cuda', name: 'cuda:0 RTX', vram_total: 24 * 1024 ** 3 }] }), objectInfo: async () => info }
    const r = await checkSetup({ comfy, template, manifest, characters: [] })
    return { pack: r.items.find((i) => i.id === 'pack:MiniMax H3 latent upscaler'), model: r.items.find((i) => i.id === 'model:upscaler'), other: r.items.find((i) => i.id === 'pack:other') }
  }
  const { MinimaxH3LatentUpscaler3D, ...noLbh } = everything
  const core = await run({ ...noLbh, ...NEW })
  assert.equal(core.pack.status, 'ok')
  assert.match(core.pack.detail, /Built into this ComfyUI \(0\.44\.0\)/)
  assert.equal(core.model.status, 'ok')
  assert.equal(core.other, undefined)
  const old = await run(noLbh)
  assert.equal(old.pack.status, 'missing')
  assert.equal(old.model.status, 'missing')
})

console.log(`\n${n} checks passed`)
