import { contextBridge, ipcRenderer, webUtils } from 'electron'

// Every call resolves to its value or throws the service's error message.
const call =
  (channel) =>
  async (...args) => {
    const r = await ipcRenderer.invoke(channel, ...args)
    if (!r.ok) throw Object.assign(new Error(r.error), { errors: r.errors })
    return r.value
  }
const on = (channel) => (cb) => {
  const listener = (_e, payload) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('ivstudio', {
  app: { info: call('app:info') },
  learn: { openGuide: call('learn:openGuide') },
  update: { state: call('update:state'), check: call('update:check'), install: call('update:install'), onChange: on('update:changed') },
  incognito: { set: call('incognito:set') },
  queue: { list: call('queue:list'), cancel: call('queue:cancel') },
  // Projects: a short film from script to rough cut (src/service/productions.js)
  productions: {
    list: call('productions:list'),
    get: call('productions:get'),
    create: call('productions:create'),
    update: call('productions:update'),
    delete: call('productions:delete'),
    setScript: call('productions:setScript'),
    writeScript: call('productions:writeScript'),
    sketch: call('productions:sketch'),
    breakDown: call('productions:breakDown'),
    writePrompt: call('productions:writePrompt'),
    editShot: call('productions:editShot'),
    speak: call('productions:speak'),
    render: call('productions:render'),
    renderScene: call('productions:renderScene'),
    finish: call('productions:finish'),
    roughCut: call('productions:roughCut'),
    animatic: call('productions:animatic'),
    useRecording: call('productions:useRecording'),
    drawFace: call('productions:drawFace'),
    useFace: call('productions:useFace'),
    drawAngles: call('productions:drawAngles'),
    onChanged: on('productions:changed')
  },
  settings: { get: call('settings:get'), set: call('settings:set'), setComfyKey: call('settings:setComfyKey'), setCivitaiKey: call('settings:setCivitaiKey') },
  // pathFor: the path of a file dropped on the window.
  replace: {
    meta: call('replace:meta'),
    check: call('replace:check'),
    run: call('replace:run'),
    history: call('replace:history'),
    characterFaces: call('replace:characterFaces'),
    toEdit: call('replace:toEdit')
  },
  remake: {
    meta: call('remake:meta'),
    check: call('remake:check'),
    prepare: call('remake:prepare'),
    get: call('remake:get'),
    paint: call('remake:paint'),
    usePicture: call('remake:usePicture'),
    setKeyframe: call('remake:setKeyframe'),
    write: call('remake:write'),
    setPrompt: call('remake:setPrompt'),
    render: call('remake:render'),
    faces: call('remake:faces'),
    onProgress: on('remake:progress')
  },
  sizzle: {
    meta: call('sizzle:meta'),
    list: call('sizzle:list'),
    create: call('sizzle:create'),
    get: call('sizzle:get'),
    savePlan: call('sizzle:savePlan'),
    approve: call('sizzle:approve'),
    makeAssets: call('sizzle:makeAssets'),
    toShinobi: call('sizzle:toShinobi'),
    firstCut: call('sizzle:firstCut'),
    delete: call('sizzle:delete'),
    onLog: on('sizzle:log')
  },
  shinobi: {
    status: call('shinobi:status'),
    install: call('shinobi:install'),
    faceModels: call('shinobi:faceModels'),
    projects: call('shinobi:projects'),
    delete: call('shinobi:delete'),
    project: call('shinobi:project'),
    create: call('shinobi:create'),
    saveBrief: call('shinobi:saveBrief'),
    importFiles: call('shinobi:importFiles'),
    importRender: call('shinobi:importRender'),
    importAudioOf: call('shinobi:importAudioOf'),
    presets: call('shinobi:presets'),
    call: call('shinobi:call'),
    tools: call('shinobi:tools'),
    addToEdit: call('shinobi:addToEdit'),
    onLog: on('shinobi:log'),
    onFaceProgress: on('shinobi:faceProgress')
  },
  training: {
    meta: call('training:meta'),
    list: call('training:list'),
    create: call('training:create'),
    get: call('training:get'),
    save: call('training:save'),
    delete: call('training:delete'),
    designFaces: call('training:designFaces'),
    pickFace: call('training:pickFace'),
    designScenes: call('training:designScenes'),
    rerollStill: call('training:rerollStill'),
    pickStill: call('training:pickStill'),
    addStills: call('training:addStills'),
    addClips: call('training:addClips'),
    setCaption: call('training:setCaption'),
    removeItem: call('training:removeItem'),
    makeClips: call('training:makeClips'),
    keepClip: call('training:keepClip'),
    remakeClips: call('training:remakeClips'),
    rank: call('training:rank'),
    estimate: call('training:estimate'),
    openDataset: call('training:openDataset'),
    start: call('training:start'),
    check: call('training:check'),
    stop: call('training:stop'),
    checkpoints: call('training:checkpoints'),
    fetch: call('training:fetch'),
    test: call('training:test'),
    adopt: call('training:adopt'),
    onLog: on('training:log'),
    onChanged: on('training:changed')
  },
  media: { probe: call('media:probe'), prepare: call('media:prepare'), pathFor: (file) => webUtils.getPathForFile(file) },
  agents: {
    info: call('agents:info'),
    installSkill: call('agents:installSkill')
  },
  reels: {
    make: call('reels:make')
  },
  cutouts: {
    make: call('cutouts:make')
  },
  reframes: {
    make: call('reframes:make')
  },
  edits: {
    meta: call('edits:meta'),
    list: call('edits:list'),
    get: call('edits:get'),
    create: call('edits:create'),
    save: call('edits:save'),
    delete: call('edits:delete'),
    pickFiles: call('edits:pickFiles'),
    library: call('edits:library'),
    addOutput: call('edits:addOutput'),
    export: call('edits:export'),
    cancelExport: call('edits:cancelExport'),
    filmstrip: call('edits:filmstrip'),
    peaks: call('edits:peaks'),
    fullScreen: call('window:fullScreen'),
    onProgress: on('edits:progress'),
    onChanged: on('edits:changed'),
    // new footage made inside the edit
    gens: call('editgen:list'),
    prepareGen: call('editgen:prepare'),
    generate: call('editgen:start'),
    pickGen: call('editgen:pick'),
    cancelGen: call('editgen:cancel'),
    onGens: on('editgen:changed')
  },
  cloud: {
    status: call('cloud:status'),
    install: call('cloud:install'),
    signIn: call('cloud:signIn'),
    deploy: call('cloud:deploy'),
    fetchModels: call('cloud:fetchModels'),
    uploadCharacters: call('cloud:uploadCharacters'),
    provider: call('cloud:provider'),
    runpodKey: call('cloud:runpodKey'),
    runpodCatalog: call('cloud:runpodCatalog'),
    runpodSetUp: call('cloud:runpodSetUp'),
    comfyCloudKey: call('cloud:comfyCloudKey'),
    comfyCloudCheck: call('cloud:comfyCloudCheck'),
    use: call('cloud:use'),
    wake: call('cloud:wake'),
    stop: call('cloud:stop'),
    usage: call('cloud:usage'),
    onLog: on('cloud:log')
  },
  prompts: { status: call('prompts:status'), write: call('prompts:write'), story: call('prompts:story'), pull: call('prompts:pull'), onPull: on('prompts:pull') },
  setup: {
    check: call('setup:check'),
    installNodes: call('setup:installNodes'),
    onNodes: on('setup:nodes'),
    updates: { check: call('setup:updates:check'), run: call('setup:updates:run'), undo: call('setup:updates:undo'), installManager: call('setup:updates:installManager'), onProgress: on('setup:updates') }
  },
  comfy: { launcher: call('comfy:launcher'), chooseLauncher: call('comfy:chooseLauncher'), chooseFolder: call('comfy:chooseFolder'), start: call('comfy:start'), onState: on('comfy:state') },
  h3Models: call('models:h3'),
  models: { status: call('models:status'), download: call('models:download'), cancel: call('models:cancel'), onUpdate: on('models:update') },
  voices: {
    status: call('voices:status'),
    setup: call('voices:setup'),
    onLog: on('voices:log'),
    list: call('voices:list'),
    design: call('voices:design'),
    create: call('voices:create'),
    update: call('voices:update'),
    delete: call('voices:delete'),
    speak: call('voices:speak'),
    lines: call('voices:lines'),
    deleteLine: call('voices:deleteLine'),
    transcribe: call('voices:transcribe')
  },
  music: {
    meta: call('music:meta'),
    status: call('music:status'),
    create: call('music:create'),
    list: call('music:list'),
    get: call('music:get'),
    rename: call('music:rename'),
    cancel: call('music:cancel'),
    delete: call('music:delete'),
    toEdit: call('music:toEdit')
  },
  images: {
    status: call('images:status'),
    create: call('images:create'),
    list: call('images:list'),
    get: call('images:get'),
    cancel: call('images:cancel'),
    delete: call('images:delete'),
    toEdit: call('images:toEdit')
  },
  library: { all: call('library:all'), toEdit: call('library:toEdit') },
  loras: {
    meta: call('loras:meta'),
    search: call('loras:search'),
    model: call('loras:model'),
    download: call('loras:download'),
    downloads: call('loras:downloads'),
    yours: call('loras:yours'),
    identify: call('loras:identify'),
    prefs: call('loras:prefs'),
    onProgress: on('loras:progress')
  },
  characters: { list: call('characters:list'), save: call('characters:save'), catalog: call('characters:catalog'), install: call('characters:install'), loras: call('characters:loras'), onProgress: on('characters:progress') },
  projects: { list: call('projects:list'), get: call('projects:get'), rename: call('projects:rename'), delete: call('projects:delete') },
  sequences: {
    list: call('sequences:list'),
    get: call('sequences:get'),
    create: call('sequences:create'),
    save: call('sequences:save'),
    delete: call('sequences:delete'),
    take: call('sequences:take'),
    retake: call('sequences:retake'),
    renderOut: call('sequences:renderOut'),
    huntShot: call('sequences:huntShot'),
    finishShot: call('sequences:finishShot')
  },
  system: { stats: call('system:stats'), free: call('system:free') },
  rank: { job: call('rank:job'), learn: call('rank:learn') },
  review: { take: call('review:take') },
  previs: { make: call('previs:make') },
  cast: { list: call('cast:list'), places: call('cast:places'), savePlace: call('cast:savePlace'), deletePlace: call('cast:deletePlace') },
  render: { plan: call('render:plan'), planFinish: call('render:planFinish'), previews: call('render:previews'), finish: call('render:finish'), enhance: call('render:enhance') },
  jobs: { watch: call('jobs:watch'), cancel: call('jobs:cancel'), onUpdate: on('jobs:update'), onLive: on('jobs:live') },
  files: { pick: call('files:pick'), reveal: call('files:reveal') },
  links: { open: call('links:open') }
})
