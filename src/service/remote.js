// Adapts a graph to the ComfyUI it will run on. IV Studio's graphs are made on Windows, so on a Linux
// ComfyUI (the cloud) model names need forward slashes, and the DLSS 5 finishing pass, which is
// Windows-only (Direct3D 12), is replaced with what Linux can do: an optional 2x AI upscale
// (Real-ESRGAN) and optional frame interpolation (RIFE), then a normal save.

export const DLSS_FPS = [0, 30, 50, 60, 120] // what the DLSS program accepts
export const CLOUD_FPS = [0, 48, 72, 120] // RIFE multiplies 24 fps by a whole number
export const CLOUD_UPSCALER = 'RealESRGAN_x2plus.pth'

const isLink = (v) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string'
const MODEL_FILE = /\.(safetensors|gguf|sft|pth|pt|ckpt|bin)$/i

// What the target ComfyUI has, from /object_info and /system_stats.
export function capabilities(objectInfo, systemStats) {
  const spec = objectInfo.UpscaleModelLoader?.input?.required?.model_name
  const upscalers = (Array.isArray(spec?.[0]) ? spec[0] : spec?.[1]?.options) || [] // old and new combo formats
  return {
    // ComfyUI reports Python's os.name ('nt') on some versions and sys.platform ('win32') on others
    posix: !['nt', 'win32'].includes(systemStats?.system?.os),
    dlss: !!objectInfo.DLSS5_Enhance_Video,
    rife: !!objectInfo['RIFE VFI'],
    upscale2x: !!objectInfo.DLSS5_Enhance_Video || upscalers.includes(CLOUD_UPSCALER),
    fps: objectInfo.DLSS5_Enhance_Video ? DLSS_FPS : objectInfo['RIFE VFI'] ? CLOUD_FPS : [0],
    // ComfyUI 0.44+ has the H3 latent upscaler built in (the same LBH weights, from models/latent_upscale_models)
    coreUpscaler: !!(objectInfo.MiniMaxH3LatentUpscaleWithModel && objectInfo.LatentUpscaleModelLoader),
    // KJNodes' per-step preview with H3's tiny VAE (models/vae_approx/taeh3.safetensors), for live previews
    livePreview: comboOptions(objectInfo.ModelPreviewOverrideKJ?.input?.optional?.tiny_vae).includes(LIVE_TAE)
  }
}
const comboOptions = (spec) => (Array.isArray(spec?.[0]) ? spec[0] : spec?.[1]?.options) || []

// Live previews: the model that feeds the preview samplers (the preview guider, node 14) is wrapped in KJNodes'
// ModelPreviewOverrideKJ, which sends a small picture of each step over ComfyUI's websocket (kj_preview_override)
// to the client that queued the prompt. Only previews; the finishing pass is left as it is.
export const LIVE_TAE = 'taeh3.safetensors'
export const LIVE_NODE = 'iv_live'
export function withLivePreview(graph, { guider = '14', size = 448 } = {}) {
  const g = structuredClone(graph)
  const model = g[guider]?.inputs?.model
  if (!model || g[LIVE_NODE]) return g
  g[LIVE_NODE] = { class_type: 'ModelPreviewOverrideKJ', inputs: { model, max_resolution: size, jpeg_quality: 72, suppress_default_preview: true, preview_frames: 1, preview_fps: 12, tiny_vae: LIVE_TAE } }
  g[guider].inputs.model = [LIVE_NODE, 0]
  return g
}

function slashes(v) {
  return typeof v === 'string' && MODEL_FILE.test(v) ? v.replace(/\\/g, '/') : v
}

function fixLoraState(v) {
  try {
    const s = JSON.parse(v)
    if (!Array.isArray(s.loras)) return v
    s.loras = s.loras.map((l) => ({ ...l, name: slashes(l.name) }))
    return JSON.stringify(s)
  } catch {
    return v
  }
}

// A value or the value of the primitive node a link points at.
function resolve(g, v) {
  if (!isLink(v)) return v
  const n = g[v[0]]
  if (!n) return undefined
  const i = n.inputs
  return i.value ?? i.int ?? i.float ?? i.number ?? i.seed
}

// upscaleSize: a finish's size after the latent upscale (plan.js resolved.upscaleSize). With it, on a ComfyUI that
// has the built-in upscaler, the LBH node pack's upscaler becomes ComfyUI's own: the same model and size, faster,
// without its memory spikes. Without it, or on an older ComfyUI, the LBH node stays.
export function adaptGraph(graph, caps, { upscaleSize = null } = {}) {
  const g = structuredClone(graph)
  if (caps.coreUpscaler && upscaleSize) {
    for (const [id, node] of Object.entries(g)) {
      if (node.class_type !== 'MinimaxH3LatentUpscaler3D') continue
      const load = `${id}_core_load`
      g[load] = { class_type: 'LatentUpscaleModelLoader', inputs: { model_name: node.inputs.model_name } }
      g[id] = { class_type: 'MiniMaxH3LatentUpscaleWithModel', inputs: { model: [load, 0], samples: node.inputs.latent, width: upscaleSize.width, height: upscaleSize.height } }
    }
  }
  if (caps.posix) {
    for (const node of Object.values(g)) {
      for (const [k, v] of Object.entries(node.inputs)) {
        if (k === 'LoraLoaderState' && typeof v === 'string') node.inputs[k] = fixLoraState(v)
        else node.inputs[k] = slashes(v)
      }
    }
  }
  if (!caps.dlss) {
    for (const [id, node] of Object.entries(g)) {
      if (node.class_type !== 'DLSS5_Enhance_Video') continue
      const inp = node.inputs
      const scale = Number(resolve(g, inp.Scale)) || 1
      const fps = Number(resolve(g, inp['Target FPS'])) || 0
      const load = `${id}_cl_load`
      g[load] = { class_type: 'VHS_LoadVideoPath', inputs: { video: inp['Video Path'], force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1, format: 'AnimateDiff' } }
      let img = [load, 0]
      if (scale > 1 && caps.upscale2x) {
        g[`${id}_cl_upm`] = { class_type: 'UpscaleModelLoader', inputs: { model_name: CLOUD_UPSCALER } }
        g[`${id}_cl_up`] = { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: [`${id}_cl_upm`, 0], image: img } }
        img = [`${id}_cl_up`, 0]
      }
      let rate = 24
      if (fps > 24 && caps.rife) {
        const mult = Math.max(2, Math.round(fps / 24))
        g[`${id}_cl_rife`] = { class_type: 'RIFE VFI', inputs: { ckpt_name: 'rife47.pth', frames: img, clear_cache_after_n_frames: 10, multiplier: mult, fast_mode: true, ensemble: true, scale_factor: 1 } }
        img = [`${id}_cl_rife`, 0]
        rate = 24 * mult
      }
      g[`${id}_cl_name`] = { class_type: 'StringConcatenate', inputs: { string_a: `${inp['Output Directory'] || 'H3/final'}/`, string_b: inp['Filename Prefix'] ?? 'iv_studio', delimiter: '' } }
      g[`${id}_cl_save`] = {
        class_type: 'VHS_VideoCombine',
        inputs: { images: img, audio: [load, 2], frame_rate: rate, loop_count: 0, filename_prefix: [`${id}_cl_name`, 0], format: 'video/h264-mp4', pix_fmt: 'yuv420p', crf: 17, save_metadata: true, trim_to_audio: false, pingpong: false, save_output: true }
      }
      // The DLSS node's id now answers with the saved file's path, so everything after it is unchanged.
      g[id] = { class_type: 'VHS_SelectFilename', inputs: { filenames: [`${id}_cl_save`, 0], index: -1 } }
    }
  }
  return g
}
