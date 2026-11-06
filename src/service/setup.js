// Readiness check: is ComfyUI up, is there a capable GPU, are the node packs and models IV Studio needs there?
// Everything is read from ComfyUI itself (/system_stats and /object_info), so it works with any install.

const TEMPLATE_SKIP = new Set(['PixaromaGroupSwitch', 'PixaromaLabel', 'MarkdownNote', 'Note'])

export function comboOptions(info, cls, input) {
  const spec = info[cls]?.input?.required?.[input] || info[cls]?.input?.optional?.[input]
  if (!spec) return null
  return Array.isArray(spec[0]) ? spec[0] : spec[1]?.options || []
}

const base = (o) => o.replace(/\\/g, '/').split('/').pop()
// Which workflows each model's pick in Settings → Models covers (plan.js: text, frames and continue run fl2va).
const PICKS = { fl2va: ['text', 'frames', 'continue'], ref2va: ['reference', 'take', 'retake'] }

// The file this ComfyUI has for a model: IV Studio's own build (match, alt), else another version of the same
// model (accept: patterns, like the fp8 or NVFP4 build ComfyUI's templates download), else the one picked in
// Settings → Models. { file, how: 'exact' | 'version' | 'picked' } or null. Files in subfolders keep their path.
export function resolveModel(m, opts, chosen = {}) {
  const names = [m.match, ...(m.alt || [])]
  const exact = opts.find((o) => names.includes(base(o)))
  if (exact) return { file: exact, how: 'exact' }
  const version = (m.accept || []).map((a) => new RegExp(a, 'i')).reduce((hit, re) => hit || opts.find((o) => re.test(base(o))), null)
  if (version) return { file: version, how: 'version' }
  const pick = (PICKS[m.id] || []).map((k) => chosen[k]).find((f) => f && opts.includes(f))
  return pick ? { file: pick, how: 'picked' } : null
}

// The files ComfyUI lists for a model: its loader's, and altLoader's (the latent upscaler is read by the LBH node
// pack or, on ComfyUI 0.44+, by ComfyUI's own loader, from the same folder). null when neither loader is there.
export function modelOptions(info, m) {
  const lists = [m.loader, m.altLoader].filter(Boolean).map((l) => comboOptions(info, ...l.split('.'))).filter(Boolean)
  return lists.length ? [...new Set(lists.flat())] : null
}

// IV Studio's graphs name its own builds at the top of each models folder; for every required model this ComfyUI
// has in another version or in a subfolder, the name to use instead (Comfy.submit swaps it into every graph).
// info needs only the models' loader nodes.
export function modelFileMap(manifest, info, chosen = {}) {
  const map = {}
  for (const m of manifest.models) {
    if (m.optional) continue
    const opts = modelOptions(info, m) || []
    if (opts.includes(m.match)) continue
    const r = resolveModel(m, opts, chosen)
    if (r) map[m.match] = r.file
  }
  return map
}

export async function checkSetup({ comfy, template, manifest, characters, chosen = {} }) {
  const items = []
  let stats
  try {
    stats = await comfy.systemStats()
    items.push({ id: 'comfyui', label: 'ComfyUI', status: 'ok', detail: `Version ${stats.system?.comfyui_version || '?'} at ${comfy.url}` })
  } catch (err) {
    items.push({ id: 'comfyui', label: 'ComfyUI', status: 'missing', detail: err.message, fix: 'Start ComfyUI, or set its address in Settings.' })
    return { ready: false, items }
  }

  const gpu = stats.devices?.find((d) => d.type === 'cuda') || stats.devices?.[0]
  const vramGb = gpu ? gpu.vram_total / 1024 ** 3 : 0
  // Comfy Cloud reports no devices: it runs each job on one of Comfy's own GPUs
  if (comfy.hosted) items.push({ id: 'gpu', label: 'GPU', status: 'ok', detail: `Comfy Cloud's GPUs${stats.system?.cloud_version ? ` · cloud ${stats.system.cloud_version}` : ''}` })
  else items.push({
    id: 'gpu',
    label: 'GPU',
    status: !gpu || gpu.type !== 'cuda' ? 'missing' : vramGb < 15 ? 'warn' : 'ok',
    detail: gpu ? `${gpu.name.replace(/^cuda:\d+ /, '').replace(/ : \w+$/, '')} · ${vramGb.toFixed(0)} GB` : 'No GPU reported',
    fix: vramGb && vramGb < 15 ? 'Under 16 GB of VRAM: keep previews at 0.4 MP and finals at or below 1.5 MP.' : undefined
  })

  const info = await comfy.objectInfo()
  const needed = [...new Set(Object.values(template).map((n) => n.class_type))].filter((c) => !TEMPLATE_SKIP.has(c))
  const missingClasses = needed.filter((c) => !info[c])
  const linux = !['nt', 'win32'].includes(stats.system?.os)
  // Shots need the packs in the workflow; the others are for one feature each (Sequences, Replace, SeedVR2...).
  for (const pack of manifest.node_packs) {
    if ((linux && pack.windowsOnly) || (!linux && pack.linuxOnly)) {
      // DLSS is Windows-only; on Linux (the cloud) IV Studio finishes with its own upscale + RIFE instead.
      if (pack.windowsOnly && pack.classes.some((c) => missingClasses.includes(c))) items.push({ id: `pack:${pack.label}`, label: pack.label, status: 'warn', detail: 'Windows only. Finals here use a 2× AI upscale and RIFE frame interpolation instead.', kind: 'node_pack', for: pack.for })
      continue
    }
    const miss = pack.classes.filter((c) => (needed.includes(c) ? missingClasses.includes(c) : !info[c]))
    // a pack this ComfyUI now has built in (the H3 latent upscaler, ComfyUI 0.44+): IV Studio uses ComfyUI's own nodes
    if (miss.length && pack.builtIn?.every((c) => info[c])) {
      items.push({ id: `pack:${pack.label}`, label: pack.label, status: 'ok', detail: `Built into this ComfyUI${stats.system?.comfyui_version ? ` (${stats.system.comfyui_version})` : ''}, so the node pack isn't needed`, kind: 'node_pack', for: pack.for, dir: pack.dir })
      continue
    }
    const core = pack.classes.some((c) => needed.includes(c))
    const status = !miss.length ? 'ok' : core ? 'missing' : 'warn'
    items.push({ id: `pack:${pack.label}`, label: pack.label, status, detail: miss.length ? `Missing nodes: ${miss.join(', ')}` : 'Installed', fix: miss.length ? (core ? 'Needed for every shot. Install the missing node packs above, then restart ComfyUI.' : `Needed for ${pack.for}.`) : undefined, kind: 'node_pack', for: pack.for, dir: pack.dir, url: /^https:/.test(pack.url) ? pack.url : undefined })
  }
  const unknown = missingClasses.filter((c) => !manifest.node_packs.some((p) => p.classes.includes(c)))
  if (unknown.length) items.push({ id: 'pack:other', label: 'Other nodes', status: 'missing', detail: unknown.join(', '), kind: 'node_pack' })

  for (const m of manifest.models) {
    const opts = modelOptions(info, m) || []
    // optional: only for one tool, so missing is a warning; alt/accept: other names and versions that count as present
    const r = resolveModel(m, opts, chosen)
    const found = r?.file
    const detail = !r ? `Not found (${m.match})` : r.how === 'version' ? `${found} · another version of ${m.match}, used in its place` : r.how === 'picked' ? `${found} · your pick in Settings → Models` : found
    items.push({ id: `model:${m.id}`, label: m.optional ? `${m.label} · for ${m.optionalFor || 'optional tools'}` : m.label, status: found ? 'ok' : m.optional ? 'warn' : 'missing', detail, fix: found ? undefined : `Download into models/${m.folder}`, kind: 'model', model: m.id, size: m.size, optional: !!m.optional, page: m.url.match(/^https:\/\/huggingface\.co\/[^/]+\/[^/]+/)?.[0] })
  }

  const loras = comboOptions(info, 'LoraLoaderModelOnly', 'lora_name') || []
  for (const c of characters) {
    const ok = loras.some((l) => l.replace(/\\/g, '/') === c.lora.replace(/\\/g, '/'))
    items.push({ id: `character:${c.id}`, label: `Character: ${c.name}`, status: ok ? 'ok' : 'warn', detail: ok ? c.lora : `LoRA not found: ${c.lora}`, kind: 'character' })
  }

  const blocking = items.filter((i) => i.status === 'missing')
  return { ready: blocking.length === 0, items, refmods: comboOptions(info, 'MiniMaxH3RefModsLoader', 'mod_1')?.filter((m) => m !== '(none)') || [], loras }
}
