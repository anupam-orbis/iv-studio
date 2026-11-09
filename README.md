<p align="center">
  <img src="docs/images/banner.png" alt="IV Studio: AI films with recurring actors, on your own PC" width="100%">
</p>

<p align="center">
  <a href="https://github.com/hollisorg/iv-studio/releases/latest/download/IV-Studio-Setup.exe"><b>Download for Windows</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/hollisorg/iv-studio/releases/latest/download/IV-Studio-mac-arm64.dmg"><b>Mac (Apple Silicon)</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/hollisorg/iv-studio/releases/latest/download/IV-Studio-mac-x64.dmg"><b>Mac (Intel)</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/hollisorg/iv-studio/releases/latest/download/IV-Studio.AppImage"><b>Linux (AppImage)</b></a>
  &nbsp;·&nbsp;
  <a href="#what-you-need">What you need</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/hollisorg/iv-studio/releases/latest">Release notes</a>
  &nbsp;·&nbsp;
  <a href="https://infinitevariance.ai">Infinite Variance</a>
</p>

# IV Studio

A free Infinite Variance desktop app for making short films with
[MiniMax H3](https://huggingface.co/MiniMaxAI/MiniMax-H3) on your own PC. Give a recurring actor a face
and a voice, write a shot, hunt a few quick previews and finish the best one at full size. Make
pictures, songs and spoken lines, cut it all together and export. IV Studio drives your own
[ComfyUI](https://github.com/comfyanonymous/ComfyUI); nothing leaves your machine unless you choose the
cloud. No strong graphics card? Shots can also render on a GPU in your own [RunPod](https://www.runpod.io) or
[Modal](https://modal.com) account, billed by the second, or on Comfy Cloud (see [Cloud](#cloud)).

**This is IV Studio 1.0.** Every page now walks you through itself (**How it works**), a two-minute tour shows
the whole app, **Check my PC** sets it up for your computer, and characters train free on your own graphics
card. See [what's new in 1.0](#whats-new-in-10).

<p align="center">
  <img src="docs/images/create.png" alt="Create: Tess picked, Write it for me with the idea, the H3 prompt, and the pinned Your shot card with Hunt 3 previews" width="100%">
</p>

## What's new in 1.0

- **Help on every page.** A **How it works** button on every page lights up its real controls one at a time
  with a line on each. The welcome wizard offers a full tour of the app, and Settings → About takes it again.
- **Check my PC.** On first launch IV Studio reads your graphics card, memory, processor and drives (nothing
  leaves your PC), says plainly what it can do, and sets previews, finals, the prompt writer and downloads to
  suit. A guided cloud setup connects RunPod, Modal or Comfy Cloud in a few steps.
- **Redesigned.** Create (video and image), Settings, Characters, Voices, Lines and Music are numbered step
  cards. The Workflows tools (Sizzle, Reel, Sequences, Shinobi and Replace) open on animated stages with their
  main bar centered.
- **Find anything.** Shots, Projects and the Library group your work by day and filter it by when, kind of
  shot, who's in it and shape, in a panel that folds away. Long histories open at once: tiles load as you
  scroll.
- **Train characters anywhere.** Free on your own graphics card (Fizgig), or on your RunPod or Modal account,
  with presets, a spending cap, **Train more** and likeness scoring. Or make a **RefMod** character from a few
  pictures in seconds.
- **More control.** Pick a shot's sampler and scheduler, and keep a resizable live preview of any render
  floating over every page.

## What it does

- **Dashboard.** IV Studio opens on one-click starts for everything it makes, your latest renders and
  your cast. Every page has its own banner art and its own **How it works** tour.
- **Projects.** A short film as a six-step wizard for anyone: an idea, a script (written for you or your
  own), the cast and places, a storyboard of drawn sketches you can play as an animatic, filming every
  panel, and the finished film. Faces and rooms stay the same from shot to shot.
- **Shots.** Write a shot (or type the idea in plain words and let **Write it for me** write the H3
  prompt; it looks at your reference pictures and videos first), hunt one to three quick previews, pick
  one and finish it at 1 to 2 MP with DLSS, an RTX 2× upscale and frame generation, or with SeedVR2. Four
  modes: text, reference pictures, video and audio, first and last frame, and continuing a video. Create
  lays it out as numbered steps beside a pinned **Your shot** card.
- **Directing.** A prompt checker that catches H3 mistakes before you spend a render, @ mentions for your
  cast and places, live step pictures while takes render (also in a floating preview over every page),
  takes ranked by words heard, likeness and sharpness, side-by-side Compare, a **Review** that names each
  problem with its seconds and one fix, and a top-down staging board that becomes exact screen directions
  or a moving grey previs.
- **Images.** Create switches between **Video** and **Image**: make or edit pictures with eight image
  model families (Flux.2 Klein, Flux 3 Klein, Krea 2, Moss, Qwen Image 2.1, Z-Image Turbo, SDXL and H3
  stills with your H3 characters), then use one as a shot's first frame.
- **LoRAs.** Browse Civitai's MiniMax H3 LoRAs as tall picture cards whose clips play on hover, open one
  for a full-size gallery of its examples, and download it straight into ComfyUI. Your own LoRAs show as
  pictures too, and Create's LoRA tray adds them to a shot with a strength slider.
- **Characters.** Recurring actors as trained H3 LoRAs with a trigger word, or as RefMods made from a few
  pictures in seconds. Use the ready-made Tess and Theo, add a LoRA or RefMod you have, or design, clip and
  train your own: free on your graphics card, or on your RunPod or Modal account.
- **Voices.** Give each character a voice: design one from a description, or save one from a recording.
  Type a line and **Speak it**: the character says it on screen, lip-synced. Runs on your PC with
  VoxCPM2 and Whisper.
- **Music.** Songs with sung lyrics, or instrumentals, from a style and lyrics: MiniMax Music 3 for full
  songs up to five minutes, ACE-Step 1.5 for a draft in seconds. Put a song under an edit, or have a
  character sing it.
- **Edit.** A Premiere-style editor with a full-screen workspace: project bin, source and program
  monitors, as many video and audio tracks as you need, filmstrips and waveforms, markers, J/K/L,
  insert and overwrite, razor, ripple and rolling trims, and MP4 export at 1080p, 4K, vertical or square
  at a set loudness. Right-click to make new footage on the timeline (extend, bridge, fill a gap, retake a
  stretch), cut out a person or thing with see-through edges, or reframe a shot to a new shape with H3
  drawing what lies beyond its edges.
- **Workflows.** Five tools, each opening on its own animated stage. **Sequences:** several shots as one
  continuous video. **Sizzle** turns a website into a promo film: your agent storyboards it from the real
  site, then H3 shots, pictures, music and the site's own screens are cut together on the beat. **Reel**
  cuts pictures or clips to a song's beat. **Replace** swaps a person or changes the scene in a video while
  the camera, motion and sound stay. **Shinobi** lets an agent cut a whole edit in code.
- **Library and Queue.** Every shot, sequence, picture, export, song and spoken line in one place, a day at a
  time, filtered by when, where it came from, kind, who and shape. Above it, the render queue shows what's
  rendering and what waits.
- **Help.** **How it works** on every page, a full tour from the welcome wizard, What's new after every
  update, and the PDF guide.
- **Check my PC.** Reads your hardware on first launch and sets IV Studio up to suit it.
- **Cloud.** Render shots and sequences on your own RunPod or Modal account, or on Comfy Cloud, set up with a
  guided wizard, with a running time and cost meter in the title bar and a **Shut down GPU** button.
- **Incognito.** A private space whose work never shows in the normal app.
- **Agents.** A local MCP server with 154 tools and a start menu gives Claude Code or any MCP client nearly
  everything a person can do in the window.
- **Updates.** IV Studio updates itself: one click installs a new version and reopens.

<table>
  <tr>
    <td width="50%"><img src="docs/images/dashboard.png" alt="Dashboard: what's new in 1.0, quick-start cards and recent renders"></td>
    <td width="50%"><img src="docs/images/tour.png" alt="How it works: the Create tour lighting up What happens, with its card and Next"></td>
  </tr>
  <tr>
    <td align="center"><sub>Start anything from the Dashboard</sub></td>
    <td align="center"><sub>How it works: every page walks you through itself</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/welcome.png" alt="Check my PC: this PC can do everything, with the graphics card, memory, processor, free space and prompt writer rated"></td>
    <td width="50%"><img src="docs/images/hunt.png" alt="A Dry Seat shot: two preview takes of Tess at a rainy bus stop, ready to pick, and the final below"></td>
  </tr>
  <tr>
    <td align="center"><sub>Check my PC sets IV Studio up for your computer</sub></td>
    <td align="center"><sub>Hunt a few takes, pick one, finish it at full size</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/shots.png" alt="Shots: filters for status, when, kind, who and shape, and The Seed's shots under their day"></td>
    <td width="50%"><img src="docs/images/projects.png" alt="Projects: seven short films as cards, filtered by where each one is"></td>
  </tr>
  <tr>
    <td align="center"><sub>Every shot, a day at a time, with filters</sub></td>
    <td align="center"><sub>A short film, step by step</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/image.png" alt="Create in Image mode: Generate or Edit, and eight image model families"></td>
    <td width="50%"><img src="docs/images/staging-board.png" alt="The staging board on Create: Tess and a second person on a top-down floor, a wide lens and an arcing camera, and the staging words it writes"></td>
  </tr>
  <tr>
    <td align="center"><sub>Pictures too: generate or edit on eight model families</sub></td>
    <td align="center"><sub>Stage the shot on a board; it becomes exact directions or a previs clip</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/characters.png" alt="Characters: Tess and Theo, and Train your own with Train a LoRA (free on your PC) and Make a RefMod"></td>
    <td width="50%"><img src="docs/images/training.png" alt="Training a character: the recipe presets, and where it trains: free on this PC, RunPod or Modal"></td>
  </tr>
  <tr>
    <td align="center"><sub>Recurring characters, ready-made or your own</sub></td>
    <td align="center"><sub>Train free on your PC, or rent a cloud GPU</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/loras.png" alt="LoRAs: a Civitai search for painting styles, shown as tall picture cards under the page's own banner"></td>
    <td width="50%"><img src="docs/images/lora-details.png" alt="A LoRA's pop-up: its example clips, maker, trigger words, licence, file and tags"></td>
  </tr>
  <tr>
    <td align="center"><sub>Find H3 LoRAs on Civitai</sub></td>
    <td align="center"><sub>Every LoRA's examples, trigger words and licence</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/voices.png" alt="Voices: Tess's and Theo's voices with their waveforms, each given to a character, and a voice designer"></td>
    <td width="50%"><img src="docs/images/music.png" alt="Music: MiniMax Music 3 or ACE-Step, a style and lyrics with sections"></td>
  </tr>
  <tr>
    <td align="center"><sub>A voice for every character</sub></td>
    <td align="center"><sub>Songs and scores, made on your PC</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/edit.png" alt="Edit: project bin, source and program monitors, effect controls, and a timeline with filmstrips and titles"></td>
    <td width="50%"><img src="docs/images/library.png" alt="Library: everything you made with filters for when, where from, kind, who and shape"></td>
  </tr>
  <tr>
    <td align="center"><sub>A Premiere-style editor, with your agent cutting alongside</sub></td>
    <td align="center"><sub>Everything you've made, in one place</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/workflows.png" alt="Workflows: Sequences, Sizzle, Reel, Shinobi and Replace as cards with their own art"></td>
    <td width="50%"><img src="docs/images/sizzle.png" alt="Sizzle: a wall of flames behind the web address bar, centered on its stage"></td>
  </tr>
  <tr>
    <td align="center"><sub>Five tools for after a render</sub></td>
    <td align="center"><sub>Sizzle: a website, made into a promo film</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/reel.png" alt="Reel: beat bars and a drop bar for pictures and a song, then numbered steps and the Your reel card"></td>
    <td width="50%"><img src="docs/images/cloud.png" alt="Cloud: render on this PC or the cloud, RunPod, Modal or Comfy Cloud, and the RunPod account step"></td>
  </tr>
  <tr>
    <td align="center"><sub>Reel: pictures and a song, cut to the beat</sub></td>
    <td align="center"><sub>No big GPU? Render on your own cloud account</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/settings.png" alt="Settings: a section index and cards for the prompt writer, Civitai and agents"></td>
    <td width="50%"><img src="docs/images/setup.png" alt="Settings → Setup: ComfyUI and the GPU ready, and every model checked"></td>
  </tr>
  <tr>
    <td align="center"><sub>Settings, one card per topic</sub></td>
    <td align="center"><sub>Setup checks and downloads what ComfyUI needs</sub></td>
  </tr>
</table>

## What you need

- **Windows 10 or 11** (64-bit), **64-bit Linux** (the AppImage, from 0.2.8; see [Linux](#linux)), or a **Mac**
  with macOS 12 or newer, Apple Silicon or Intel (from 0.3.2; it renders in the cloud, see [Mac](#mac)).
- **An NVIDIA GPU, or the cloud.** 24 GB of VRAM is what IV Studio is tested on (an RTX 4090); 16 GB works
  with smaller previews and finals. 64 GB of system RAM is recommended. Without a suitable card, shots and
  sequences can render on a cloud GPU in your own RunPod or Modal account; pictures, music and voices still need a
  local NVIDIA GPU (see [Cloud](#cloud)).
- **[ComfyUI](https://github.com/comfyanonymous/ComfyUI)**, version 0.33 or newer, running on the same PC.
  IV Studio talks to it at `http://127.0.0.1:8188` (change it in Settings → ComfyUI; `localhost:8000` for the
  ComfyUI Desktop app is fine, and Check my PC finds a ComfyUI on another usual port by itself). It can start ComfyUI for you: it
  finds your ComfyUI shortcut, the ComfyUI Desktop app or a portable install's `run_nvidia_gpu.bat` (or you pick one
  in Settings → ComfyUI, or pick your ComfyUI folder and the start file in it), starts it when IV Studio opens, and
  offers **Start ComfyUI** whenever it isn't running.
- **Disk space.** About 60 GB for the H3 models. Music adds about 14 GB (MiniMax Music 3) or 10 GB
  (ACE-Step); voices add about 12 GB. Each is a one-click download inside the app.
- **Optional:** [Ollama](https://ollama.com) for the free local prompt writer;
  [Fizgig](https://github.com/shootthesound/Fizgig) to train characters on your own graphics card (16 GB or more);
  and a [RunPod](https://www.runpod.io) or [Modal](https://modal.com) account for cloud rendering and training.

## Install

1. [Download `IV-Studio-Setup.exe`](https://github.com/hollisorg/iv-studio/releases/latest/download/IV-Studio-Setup.exe)
   (about 180 MB).
2. Run it. The installer isn't code-signed yet, so Windows may show **"Windows protected your PC"**.
   Click **More info → Run anyway**. It installs for your user only; no admin rights needed.
3. Open IV Studio. On first launch **Check my PC** reads your graphics card, memory and drives (nothing
   leaves your PC), says what it can do, and sets previews, finals, the prompt writer and the downloads to
   suit; it ends by offering a two-minute tour of the app. IV Studio starts ComfyUI for you when it can.
4. **Settings → Setup** checks ComfyUI, your GPU, the node packs and every
   model, installs missing node packs into ComfyUI with one click (restart ComfyUI afterwards), and
   downloads missing models straight into ComfyUI's models folder (each checked against the SHA-256 its
   host publishes). Its **Updates** row keeps ComfyUI, its node packs and ComfyUI-Manager up to date.
5. For voices, open **Audio → Voices** and press **Set up voices** once. For music, open
   **Audio → Music** and download the engine you want.

Your projects, voices and songs are kept in `%APPDATA%\IV Studio`; renders are saved in ComfyUI's
output folder under `H3\`.

### Linux

1. [Download `IV-Studio.AppImage`](https://github.com/hollisorg/iv-studio/releases/latest/download/IV-Studio.AppImage)
   (about 240 MB), make it executable (`chmod +x IV-Studio.AppImage`) and run it. AppImages need FUSE
   (`libfuse2`, called `libfuse2t64` on Ubuntu 24.04).
2. IV Studio finds a ComfyUI folder in your home folder (or pick it in Settings → ComfyUI) and starts it with
   a `.sh` script beside it, or with its `main.py` and the folder's own `venv` Python. ComfyUI's output goes to
   `comfyui.log` in IV Studio's data folder, `~/.config/IV Studio`.
3. Saving API keys (Civitai, RunPod, Comfy.org) needs a keyring (GNOME Keyring or KWallet).
4. Shinobi, previs and website capture use Google Chrome, Chromium or Microsoft Edge.

What's different: DLSS 5 is Windows-only, so finals use a 2× AI upscale (Real-ESRGAN) and RIFE frame
interpolation when those are installed in your ComfyUI, as in the cloud. The Linux build is built and checked on
GitHub's Ubuntu machines (every page, the agent server, Shinobi and website capture); renders on a Linux GPU
haven't been tried yet. In Settings → Agents, the command for Claude Code or Codex runs a small script that opens
the AppImage, so it keeps working after updates.

### Mac

A Mac has no NVIDIA graphics card, and MiniMax H3 needs one, so on a Mac IV Studio is the studio and the cloud is
the GPU: shots, hunts, finishes and sequences render on your own [RunPod](#on-runpod) or [Modal](#on-modal)
account, or on [Comfy Cloud](#on-comfy-cloud).

1. Download the `.dmg` for your Mac: [Apple Silicon (M1 and newer)](https://github.com/hollisorg/iv-studio/releases/latest/download/IV-Studio-mac-arm64.dmg)
   or [Intel](https://github.com/hollisorg/iv-studio/releases/latest/download/IV-Studio-mac-x64.dmg). Open it and drag
   IV Studio into Applications.
2. The app isn't signed with an Apple Developer ID yet, so the first time macOS says it can't check it. Open
   **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to IV Studio (once).
3. Open the **Cloud** page (the Dashboard and the title bar point there) and set up RunPod, Modal or Comfy Cloud.

What's different on a Mac:

- **Renders:** in the cloud. Finals there use a 2× AI upscale (Real-ESRGAN) and RIFE frame interpolation in place
  of DLSS 5, which is Windows-only.
- **Pictures and music** need a ComfyUI with their models: Comfy Cloud, or a ComfyUI on your Mac (IV Studio
  finds and starts the ComfyUI Desktop app, `ComfyUI.app`, or a ComfyUI folder in your home folder). Note that
  the ComfyUI Desktop app listens on port 8000: set `http://127.0.0.1:8000` in Settings if you use it.
- **Voices** run on your Mac's processor, not a GPU, so they're slow; not yet tried on a real Mac.
- **Updates:** IV Studio installs its own updates on a Mac too. macOS's built-in updater needs a paid Apple
  signature, so IV Studio downloads the new version itself, checks it against the release's checksum, swaps it in
  when you click **Restart to update** (or quit) and opens again. That needs IV Studio in your Applications folder:
  a copy opened straight from the `.dmg` or from Downloads says so and opens the download page instead.
  Copies before 1.1 still open the download page once.
- **Keys** (RunPod, Civitai, Comfy.org) are kept in the macOS Keychain.
- **Your data** is kept in `~/Library/Application Support/IV Studio`; exported edits go to `Movies/IV Studio`.
- **ffmpeg** in the Mac app is Martin Riedl's GPL static build of FFmpeg 9.0.2 (the npm package's Mac builds are
  made with `--enable-nonfree` and can't be shared).

The Mac app is built and checked on GitHub's Apple Silicon and Intel machines (every page, the agent server,
edit export, Shinobi and website capture with Chrome). It hasn't been tried on a person's Mac yet.

**Updates.** From 0.2.1 on, IV Studio checks for a new version when it starts and every six hours, and
downloads it in the background. Click **↻ Update to …** at the bottom of the sidebar (or **Restart to
update** in Settings → Updates) to install it and reopen; otherwise it installs the next time you quit.
It waits while an edit is exporting or models are downloading. Coming from 0.2.0 or older, install 0.2.1
by hand once.

<p align="center">
  <img src="docs/images/setup.png" alt="Settings → Setup" width="100%">
</p>

## Dashboard

IV Studio opens on the **Dashboard**: one-click starts for a shot, a picture, a short film, an edit, a song,
a voice line, a website film or a new character; your most recent renders; and your cast, each with their
face, their voice, and **New shot** to start a shot with them already picked. After an update, a strip at the
top says what's new in that version (Settings → Updates keeps the last few).

Every page opens on its own banner, drawn in the Infinite Variance eye style: a clapperboard for Shots,
scissors for Edit, a storm cloud for Cloud, a record player for Music, and so on. On wide windows the art
stays against the right edge.

## How a shot works

1. **Create.** Pick a mode, a character and write the shot.
   - **Text:** just the prompt.
   - **References:** pictures, videos or audio guide the shot (`<Picture 1>`, `<Video 1>`, `<Audio 1>`).
     Click a reference to crop or trim it; videos snap to H3's lengths. **Size: Fit for H3** resizes a
     picture or video to H3's own sizes (about 0.5, 1 or 2 MP, both sides on a 32-pixel grid, video at
     24 fps), which some modes, like Retake, need.
   - **First / last frame:** the clip opens on a picture and can end on a second one.
   - **Continue a video:** carries a clip on from its last frames.

   Create is laid out as numbered steps (what kind of shot, who's in it, what it builds on, what happens,
   shape and size) beside a pinned **Your shot** card that shows the frame in its shape and the Hunt button.
   Set the aspect, length, preview size and how many previews to hunt (1 to 3). Optional extras: a voice
   line to lip-sync, RefMods and LoRAs (both in **Who's in it**), and under **Advanced** the steps, sampler and
   scheduler (from your ComfyUI's own lists; er_sde and beta by default).
2. **Hunt.** IV Studio queues the previews on ComfyUI and shows them as they finish.
3. **Pick and finish.** Choose a preview and set the final size (1, 1.5 or 2 MP), the enhancer and the
   sound source. The finish starts from the preview's own latent, so the motion stays the same.
   - **DLSS 5** (the default): RTX 2× upscale and frame generation (30/50/60/120 fps), seconds per shot.
   - **SeedVR2** (3B): restores face, eye and hair detail and upscales to 1080p, 1440p or 2160p, on any
     NVIDIA card. **Enhance** runs either one again on a finished shot.
4. **Shots.** Every shot keeps its runs, previews and finals. **Show in folder** opens the file. The Shots page
   groups them by the day you last worked on them (older ones by month; each day's heading stays at the top as
   you scroll and folds away with a click) and filters them by status, when, kind of shot, who's in it and
   shape, in a panel that folds away. Tiles load their video only as they come near the screen, so a long
   history opens at once.

### Before and after a render

- **Prompt checker.** Before a hunt, IV Studio checks the prompt the way H3 reads it: the real length on
  H3's frame grid, blank fields, the opening line a mode needs, cut times, too many words for the seconds,
  quotes and speaker names around spoken lines, references named but not attached, a LoRA character's face
  described in words, filler words and unknown @ names. Most findings have a **Fix**; errors hold the hunt
  until you fix them or choose **Render anyway**.
- **@ mentions.** Type @ for your cast and places. The picked character becomes `{char}`; anyone else with a
  picture is attached as a reference, and a text shot switches to References mode by itself.
- **Draft or Standard.** Draft previews take 4 steps instead of 8, roughly 40% faster, for hunting ideas.
- **Live previews.** Each take's step pictures stream to the page while it renders (H3's tiny decoder
  through KJNodes), so a bad take shows itself in about 20 seconds. **Live preview** (above the Library
  button) floats the running render over every page: drag it to any corner, resize it, or fold it to a pill.
- **Ranked takes.** When a run finishes, the takes are scored: the spoken words Whisper hears back, likeness
  to the character (InsightFace), no frozen stretches and sharpness. The best is marked only when it clearly
  leads, with the reasons in words, and every pick you make tunes the weights.
- **Runs as versions, and Compare.** Each run shows what changed since the last, the prompt as written and as
  rendered, and a word diff. **Compare** plays two takes side by side or as a wipe, in step. **Edit and run
  again** renders into the same shot.
- **Review a take.** Your prompt writer watches six frames of a take (and reads what Whisper heard), names
  each problem with its seconds, says what works and picks one fix: revise the prompt, change a reference,
  split the action, use a clean stretch, or fix it in the edit. It remembers the shot's earlier reviews, so
  a problem that came back after a rewrite gets a different kind of fix.
- **Staging board.** A top-down floor with up to four people (where they face, who they look at, where they
  walk) and the camera (lens, height, ten moves). It becomes exact screen-side directions in the prompt, and
  warns when a cut crosses the 180-degree line. For arcing moves, **Make a previs clip** renders the board in
  motion as a grey clip that H3 follows as `<Video 1>`.

The directing rules the writers and the review follow (purpose first, staging by screen side, no padding,
frame the action) are Matthew Hollis's own method, built into `src/service/directing.js`.

### Write it for me

You don't need to know H3's prompt format. Type the idea in plain words, for example "Tess in a parked
car at night admits she kept the letter", and press **Write my prompt**. You get a finished H3 prompt
back to edit, keep or undo. It always uses your mode, length, aspect, character and media. Choose the
writer under **Settings → Prompt writer**:

- **Local (free):** a model in Ollama on your PC with IV Studio's H3 rule sheet. The recommended model is
  `huihui_ai/qwen3-vl-abliterated:8b-instruct` (about 6 GB, one click to install), huihui-ai's uncensored
  copy of Qwen3-VL 8B Instruct (Apache-2.0), so it doesn't refuse mature ideas. Any other Ollama model works
  too, including the original `qwen3-vl:8b-instruct`. While ComfyUI is rendering it runs on the CPU, so it
  never takes H3's VRAM. Ollama somewhere else (another container or PC) works too: set **Ollama address**
  in Settings → Prompt writer (or `OLLAMA_HOST`), like `192.168.1.20:11434` or `http://ollama:11434`.

  **It looks before it writes.** Add your references first: the writer is shown your reference pictures,
  two frames of each reference video, your first and last frames, and the last frame of a video you're
  continuing (up to six images, labelled `<Picture 1>`, `<Video 1>` and so on), and writes what it sees.
  It tells you what it will look at, or that the model you chose can't see pictures.
- **Claude Code or Codex:** if you have either installed and signed in, it writes with your own login,
  headless and with no tools but reading your reference pictures. It gets MiniMax's own H3 prompt guide
  (downloaded from MiniMax on first use, not shipped) and the full directing method.
- **MiniMax Context IR:** MiniMax's own prompt rewriter through ComfyUI, paid through your Comfy.org
  account (about $0.02 to $0.11 a prompt). Your API key is stored encrypted on your PC.

## Projects: a short film in six steps

**Projects** turns an idea into a finished short film, one step at a time, with a storyboard you can see.

1. **Idea.** What it's about, the format (16:9, vertical or square) and the length.
2. **Story.** **Write it for me** drafts a script from the idea, cast and length with the local writer, or
   write it in plain words, or bring a `.txt` or `.fountain` screenplay.
3. **Cast and places.** Speakers are played by your characters. Someone you made up gets a face drawn from
   their description, or from your own picture, and keeps it in every shot. Places get a description and a
   picture (drawn for you if you have none), plus **More angles** (a quarter turn, the side and a wide view,
   drawn with the QMA camera-angles LoRA for Qwen Image 2.1). Pick the film's look from six styles or your
   own words and LoRAs.
4. **Storyboard.** The writer plans each scene into 3 to 10 second shots with staging and where each one
   ends, writes each H3 prompt, and every panel gets a sketch that keeps your characters' faces and the
   room. Open a panel to change the action, camera, speaker, line or length, draw it on the staging board,
   use a recording of the line, or carry straight on from the shot before in one take. **Play the
   animatic** shows the whole film as sketches with the lines spoken.
5. **Film it.** Every panel is filmed from its sketch (2 or 3 takes), in References mode with the place's
   picture and the faces on screen, so the room and the people hold. Lines are spoken first in each
   character's own voice and read back with Whisper until the words match. Pick a take, and it finishes at
   2 MP.
6. **Watch.** The takes play in order; **Save the film as a video** exports the rough cut, and **Fine-tune in
   the editor** opens it in Edit.

## Images

**Create** switches between **Video** (a shot) and **Image** at the top. Image makes pictures on your PC with
the image models you have in ComfyUI:

| Family | Generate | Edit | Licence |
|---|---|---|---|
| Flux.2 Klein 9B | ✓ | ✓ several reference pictures | FLUX Non-Commercial (9B) |
| Flux 3 Klein | ✓ | ✓ | FLUX Kommunity |
| Krea 2 | ✓ | ✓ with the Krea 2 Identity Edit LoRA and the comfyui-krea2edit nodes | see Krea 2's model page |
| Moss | ✓ | needs a newer ComfyUI | Apache-2.0 |
| Qwen Image 2.1 | ✓ | ✓ up to three references | Apache-2.0 |
| Z-Image Turbo | ✓ | ✗ | Apache-2.0 |
| SDXL (and any SDXL fine-tune: Juggernaut, RealVis, Pony, Illustrious…) | ✓ | ✗ | CreativeML Open RAIL++-M (base); fine-tunes have their own |
| MiniMax H3 (a still) | ✓ with your H3 character LoRAs | ✗ | MiniMax H3 Community License |

SDXL checkpoints go in ComfyUI's `models/checkpoints`; Setup offers SDXL base 1.0 as an optional download. An
H3 still is one frame from the middle of a very short H3 render (8 steps with the turbo LoRA), so it has the
look of your shots and can star your trained characters; it uses the H3 models you already have.

Pick **Generate** or **Edit**; Edit lists only the families that can. Pick a family and one of its
checkpoints (your fine-tunes are there too), add that family's LoRAs from the same picker as Video's, then
the size, how many (1 to 4) and a seed. Each graph follows ComfyUI's official template for its model.

Finished pictures appear under the form and in the **Library**. Open one to **Use in a shot** (it becomes the
shot's first frame), **Edit this**, **Add to edit**, **Make more like this** or **Show file**. Agents use
`list_image_models` and `make_image`.

## Characters

A character is a trained MiniMax H3 LoRA plus its trigger word, or a RefMod; write `{char}` in the prompt
where the character goes. On the **Characters** page:

- **Your characters:** portrait cards; click one for its trigger, strength, LoRA or RefMod (checked against
  ComfyUI) and voice. **Add from a LoRA or RefMod** adds one you already have.
- **Ready-made:** IV Studio's own invented characters, Tess Marlow and Theo Lindqvist. Download one and
  its LoRA (about 150 MB, from this repo's `characters-v1` release, checked against its SHA-256) goes into
  ComfyUI, and their bundled voice comes with them.
- **Make a RefMod:** up to six pictures (and a voice clip) become a RefMod character on your PC in seconds,
  with no training (ComfyUI-MiniMaxH3Mod's RefMod extractor). It works in Create's shots.
- **Train a LoRA,** the method that made Tess, for the best likeness:
  1. **Design:** describe the face; Z-Image Turbo renders four candidates on your PC. The one you pick is
     rendered in eight scenes on the same seed. Or add your own pictures, only of an invented person or
     someone who agreed.
  2. **Clips:** H3 renders talking clips from the stills and the character's voice, or you add your own.
     Everything is fitted to Fizgig's rules (24 fps, 17n+5 frames, 32 kHz stereo).
  3. **Train:** with [Fizgig](https://github.com/shootthesound/Fizgig), where you choose:
     - **This PC, free:** on your own NVIDIA card with 16 GB or more. A Standard run is a few hours; when
       Check my PC finds a card that can, the page says **Free on your PC** and the Train step starts there.
     - **RunPod or Modal:** your own account, by the second, with the minutes and dollars shown first. Theo
       took 56 minutes and about $4.10 on an H200. On RunPod, IV Studio makes an 80 GB storage volume (kept
       for later runs) and a training pod that deletes itself when the run is done.

     The recipe: Quick, Standard or Thorough; look and voice, or look only; normal or fine detail; the person
     or their whole look; how many checkpoints; and, under Advanced, rank, epochs, seed, caption dropout,
     schedule and base precision. A **spending cap** stops a cloud run at your budget and keeps what it saved.
     **Train more** carries a finished run on from its last saved state.
  4. **Pick:** checkpoints are rendered side by side on one seed, and **Score them for likeness** marks the
     closest; the one you choose becomes a character, keeping the voice its clips were made with.

  **Likeness:** with InsightFace's face models (a one-time 289 MB download; non-commercial licence), IV
  Studio scores every still and clip against the picked face and can keep the closest of each scene.

## LoRAs

**LoRAs** (on the Visual side) changes how H3 looks and moves: styles, motion, camera, speed.

- **Discover** searches [Civitai](https://civitai.com)'s MiniMax H3 LoRAs: tall cards whose preview fills
  the card and plays on hover, filters (style, concept, cinematic, motion, camera, effect, speed, tool) and
  sorting. Open one for a pop-up with a gallery of up to 16 examples (click one for a full-size view with
  its generation prompt and settings, when Civitai has them), the maker, versions, trigger words to copy,
  the licence (whether commercial use is allowed), tags and the maker's notes, then **Download**: the file
  goes into ComfyUI's `loras\Civitai\<model>\` folder, checked against the
  SHA-256 Civitai publishes. Downloading needs your own free Civitai API key (**Settings → Civitai**; it's
  stored encrypted on your PC). Searching doesn't.
- **Yours** shows the LoRAs already in ComfyUI, grouped by folder, H3 ones first. **Find on Civitai** looks
  each one up by its file's SHA-256 for its name, trigger words and a preview. Star your favourites.
- **Create's LoRA tray** shows the LoRAs in a shot as pictures with a strength slider; **+ Add LoRA** opens
  the same browser. A LoRA's trigger words go into the prompt when you add it.
- **Mature LoRAs** are off. **Settings → Civitai → Show mature LoRAs (18+)** switches to civitai.red, with
  previews blurred until clicked; a second box, **Show mature previews without the blur**, drops the blur.
  LoRAs of real people and anything involving minors are never shown, in either mode.

## Voices

**Audio → Voices** keeps a voice for every character, and **Audio → Lines** says anything in any of them.

- **Design a voice** from a description ("a woman in her forties from Glasgow, low, warm and a little
  gravelly"): three takes to choose from.
- **From a recording:** a clean 10 to 20 seconds of one person talking. Only your own voice, an invented
  one, or someone who agreed, and IV Studio asks you to confirm.
- **Speak it:** in **Create**, a character with a voice gets a **Speak it** box. Type the line; it becomes
  the shot's voice line, and the same words go into the prompt so H3 lip-syncs them.
- **Lines** keeps every line you've spoken, ready to use in a shot or drop on an edit. A new seed gives a
  new read of the same words.

The speaking runs on your PC in IV Studio's own Python environment (set up once, about 12 GB):
[VoxCPM2](https://huggingface.co/openbmb/VoxCPM2) (OpenBMB, Apache-2.0) designs, clones and speaks, and
[Whisper large-v3 turbo](https://huggingface.co/openai/whisper-large-v3-turbo) (OpenAI, MIT) reads the
words in a recording. A line takes about 4 seconds once the model is loaded. The voice engine is stopped
before every render, so it never shares the GPU with H3.

## Music

**Audio → Music** makes songs and instrumentals on your PC through ComfyUI's own nodes:

- **MiniMax Music 3:** full songs up to five minutes with the clearest sung words of the open models.
  Describe the style and write lyrics with `[Verse]`, `[Chorus]` and other section tags; the song's length
  follows the lyrics. About a minute or two per song on an RTX 4090.
- **ACE-Step 1.5 Turbo:** a song in seconds, with tempo, key, time signature and language. Best for drafts,
  background music and instrumentals.

Every song is kept in IV Studio's music folder. **Add to edit** puts it on A1 of a new or existing edit;
**Use in a shot** makes it the voice line, so a character sings it (trim it to the shot first).

## Sequences

Several shots that play as one continuous video.

- **One take:** every shot renders together in one seamless take through
  [H3 Multishot](https://github.com/jlucasmcrell/ComfyUI-H3-Multishot)'s sampler, so there are no cuts,
  colour shifts or breaks in the sound.
- **Shot by shot:** hunt and pick each shot in turn; each carries on from the end of the one before.
- **Retake:** mark a stretch of any version and redo the picture and sound, the picture only, or the sound
  only. Everything around it stays.
- **Render out:** optional colour smoothing across the joins, then DLSS with RTX 2× and frame generation.

Shots are 10 or 15 seconds, the lengths H3 Multishot is tested at.

## Edit

An editor laid out like Adobe Premiere for cutting shots, sequences, songs and lines together. **Full
screen** (or F11) hides IV Studio's sidebar and gives the whole screen to the edit; Esc brings it back.

- **Panels.** Project bin, Source monitor, Program monitor and Effect controls on top, the timeline below.
  Drag any border to resize; the layout is remembered.
- **Project bin.** Thumbnails, search, and Video, Pictures and Sound bins. Its Library tab holds every IV
  Studio render, song and line, one click from the edit.
- **Source monitor.** Click a bin item to open it, mark In (I) and Out (O), then press , to insert it at the
  playhead (everything after moves right) or . to overwrite. Or drag the picture onto a track.
- **Timeline.** As many video and audio tracks as you need (a higher V track plays over a lower one), plus
  titles. Each track can be targeted (click its name), hidden, locked, muted or soloed. Video clips show a
  filmstrip and their sound's waveform; sound clips show a waveform. Markers sit on the ruler.
- **Tools.** Select (V), Razor (C, click to cut), Ripple trim (B, the rest of the track follows) and Rolling
  edit (N, moves a cut between two clips). Each clip has fades and volume; titles have their own text,
  size, colour, position and box.
- **Export MP4** renders the timeline at 1080p, 4K, vertical or square, 24/30/60 fps, into
  `Videos\IV Studio\Edits`. Hidden tracks stay out of the picture and muted ones out of the sound.

Keys, as in Premiere: Space play · J K L shuttle (press again to go faster) · ← → one frame (Shift: one
second) · ↑ ↓ previous / next edit · I O mark · , insert · . overwrite · S split · Ctrl+K split every track ·
Q W ripple trim to the playhead · Delete, Shift+Delete ripple delete · M marker, Shift+M next marker ·
\ fit · = − zoom · Ctrl+Z / Ctrl+Y · F11 full screen, Esc back.

**Make new footage on the timeline.** Right-click a clip or a gap:

- **Extend…** carries a clip on 5, 10 or 15 seconds from its last frames.
- **Bridge to the next clip…** makes a new shot from one clip's last frame to the next one's first.
- **Fill this gap…** does the same across a gap.
- **Retake this stretch…** redoes part of a clip: picture and sound, picture only, or sound only.

Each one starts from the clip's own shot when IV Studio made it (its character, LoRAs and look), and
**Write it for me** looks at the frames it starts from. A striped placeholder shows where the footage will
land and how far it has got. Bridges and fills offer three takes to pick from; the result lands as a
normal clip you can undo.

**More on the right-click menu:**

- **Cut out…** keeps only who or what you name ("the bluebird", "the man in the hat"). SAM 3.1 tracks it,
  and the clip comes back with see-through edges on the track above, sound kept.
- **Reframe to 9:16 / 1:1 / 4:5 / 16:9…** fits a shot or picture into the edit's shape and draws what lies
  beyond its edges: H3's masked video edit for clips (the original picture and sound are kept), Qwen Image
  2.1 with an outpaint LoRA for pictures.

**Loudness.** Exports come out at Online loudness (about -14 LUFS, the default), TV (-23) or as mixed, under
a -2 dBFS peak limit.

**With an agent.** Your agent edits the same timeline through IV Studio's MCP server. Its changes appear
at once with a strip saying what it did and a one-click Undo, and tracks you lock are off limits to it.
It can make new footage on the timeline too.

## Library

The **Library** button above the Visual | Audio switch opens everything you've made: shot finals and
previews, sequences, Replace runs, pictures, Edit exports, songs and spoken lines, newest first. A shot's
previews and finals are one tile with an "N versions" badge; click it to watch every version in a large
viewer and step through them with the arrow keys. Everything sits under the day it was made (older work by
month), filtered by type (videos, images, music, voice lines), when, where it came from (Shots, Sequences,
Replace, Edit exports, Images, Music, Voice lines) and, for shots, their kind, who's in them and their shape;
sort by newest, oldest, name or most versions. Then add any of them to an edit or use a sound as a shot's
voice line.

Above it, the **Queue** shows what ComfyUI is rendering and what waits, on every page: each render's name,
its step and time, a click to open its page, and × to cancel one of IV Studio's own. Renders an agent
started show as rendering with their time, without the step count.

## Accessibility

**Settings → Accessibility** makes IV Studio easier to read and use, and each change applies at once:
**Text size** (Normal, Large, Larger: everything scales, like browser zoom), **Higher contrast text** (grey
secondary text close to white, stronger lines; also offered on Check my PC's first page), **Reduce motion**
(no animations, and the Workflows stages stand still; your system's own setting is followed too), **Clear
focus outlines** (a thick yellow ring on whatever the keyboard is on) and **Underline links**.

## Incognito

The **Incognito** switch in the title bar restarts IV Studio into a separate, private space, and the eye
closes. Shots, sequences, edits, songs, voices and lines, characters, trainings, Shinobi films, sizzles and
exports made there are kept apart (in `%APPDATA%\IV Studio\incognito`, exports in its `videos` folder) and
never show in the normal app; nothing normal shows there. Your characters and saved voices come along, and
settings, keys and models are shared. ComfyUI saves Incognito renders into its `output\IV Private` folder
(uploads into `input\IV Private`), and leaving Incognito clears them from ComfyUI's history. Switch back
the same way.

**Settings → Folders → Finished videos** picks where exported films and edits, and cloud renders brought to
this PC, go: any folder on any drive (`Videos\IV Studio` unless you change it; Check my PC asks too).
It also picks where in ComfyUI's output folder renders save, one folder for normal renders
(straight into `output` unless you name one) and one for Incognito (`IV Private` unless you change it). They
can't be the same folder, and they always stay inside ComfyUI's folders.

Incognito keeps things out of IV Studio's normal views. It isn't encryption: the files are on your PC, in
the folders above, and LoRAs trained in Incognito land in ComfyUI's LoRAs folder like any other.

## Workflows

Five tools for what comes after a render. Each opens on its own animated stage with its main bar centered (a
wall of fire for Sizzle, a beat for Reel, running film for Sequences, blade cuts for Shinobi, a scanning swap
for Replace), then works in numbered steps; the stages pause when they're off screen and stay still if your
system asks for reduced motion. Sequences is described [above](#sequences).

### Sizzle

Put in a web address and get a short promo film for it.

1. **Capture.** IV Studio opens the site in your PC's Edge or Chrome (hidden) and saves what people see: a
   screenshot of every screen down the page, the phone layout and the logo, plus the site's words, colours,
   fonts and pictures. Cookie banners are hidden, never accepted.
2. **Storyboard.** Your agent writes the scenes from the capture: the site's own screens, H3 shots,
   Z-Image pictures, titles from the site's copy, music and an optional voice-over. Nothing renders until you
   approve it.
3. **Pieces.** H3 shots (previewed, then finished at 1 MP), pictures, music and the voice-over are made on
   your PC: about 3-5 minutes per H3 shot.
4. **The film.** **Cut it for me** puts everything in a Shinobi project and cuts a first version: cuts on
   the music's beat, the site's screens with slow push-ins, two-tone titles in its colours, and an end card
   on the logo, the main button's words and the web address, ending where the music ends. It renders in
   about 2-3 minutes. Your agent can then refine it in Shinobi (the site's own fonts, pans, effects).

The Sizzle page shows the capture, the storyboard with each scene's piece, and the finished film, with a
message to paste into your agent. Agents use the `sizzle_*` tools.

### Reel

Pictures or clips plus a song become a new edit cut to the beat: a whole number of beats per picture (calm,
normal or fast), cuts counted in bars from the first beat, a slow push, drift or pull on each picture, in
16:9, 9:16 or square. The beat is found with the bundled FFmpeg alone, within a few milliseconds on click
tracks.

### Replace

Puts your characters into a video, or changes the scene around the people in it, while the camera, cuts,
motion and soundtrack stay:

- **Swap people:** one or two characters (your presets, Tess and Theo, or any picture) take the place of
  whoever you describe: face, hair, body and clothes. A preset's LoRA can join the run.
- **Change the scene:** in plain words: remove or add things, or change the weather, light, setting or style
  ("a snowy winter evening", "remove the wind turbines").
- **Finish:** redraw small faces at close-up size, or soften H3's look.

It runs on [Viggle Remake](https://huggingface.co/Viggle/Viggle-Remake), two LoRAs on MiniMax H3 (swap and
edit), up to 14 s at a time. IV Studio does the parts Viggle leaves to a person:
1. it puts the source on Remake's canvas (24 fps, its own shape, the frame count H3 needs) and finds the shots;
2. it paints a frame of each shot the way the result should look, with Qwen Image 2.1 edit on your PC. A swap's
   frames are checked with the face model (nobody added, and it looks like your character) and painted again
   when they fail; then you check them (paint one again, use your own picture, or leave one out);
3. your prompt writer (local, Claude Code or Codex) writes Remake's six-section prompt from the source and the
   painted frames, following Viggle's own guide, and IV Studio checks it;
4. Remake renders 1 to 3 takes (about 2.5 minutes for 5 s on an RTX 4090), trimmed back to the source.

In the editor, right-click a clip → **Remake this clip…**. Setup downloads the two Remake files (21 GB each)
and installs Viggle's nodes. Powered by Viggle Remake; the weights are under the MiniMax H3 Community License.

The old engine, [OpenJutsu](https://github.com/D3voz/openjutsu)'s mask workflows (MIT, commit `47c3724`), is
still there behind **Use the old engine** at the foot of the page for one more version; it runs Finish.

### Shinobi

IV Studio's agent-driven editor. Where **Edit** is cut by hand, Shinobi lets an agent (or a one-click recipe
from 12 styles) author the whole edit in code: cuts on the beat, speed ramps, punch-ins, typography, masks,
captions from speech and sound cues. It renders on your PC with the Edge or Chrome you already have.
Shinobi's engine is [OpenKatana](https://github.com/rk0neki/OpenKatana) (Apache-2.0), installed unmodified;
Shinobi isn't affiliated with OpenKatana or with Higgsfield, whose Katana inspired it.

## Help on every page

<p align="center">
  <img src="docs/images/tour.png" alt="How it works: the Create tour lighting up What happens, with its card and Next" width="100%">
</p>

Every page has a **How it works** button by its title (and in the editor's top bar). Click it and the page
walks you through itself: each part lights up in turn with a line about it, and Next, Back, the arrow keys or
Esc move through it. The button glows until you've taken that page's tour once. Steps follow the page as it
is, so Create's tour includes the reference step only in the modes that take references.

The welcome wizard (**Check my PC**) ends by offering a **full tour**: about two minutes across the whole app,
ending on the How it works button. Take it again from Settings → About, where the PDF guide is too. After an
update, **What's new** shows on the Dashboard once.

## How IV Studio uses ComfyUI

IV Studio is a front end for your own ComfyUI; every picture, video and song is a ComfyUI job.

- **The API.** It queues graphs with ComfyUI's HTTP API (`/prompt`, `/upload/image`, `/history`, `/view`,
  `/object_info`, `/free`) and follows progress on its websocket, including KJNodes' live step previews.
  Before a render it checks `/object_info` for every node and model the graph needs.
- **Graphs built in code.** Each workflow is assembled per job from the user's choices in `src/service/`
  (`studio.js` for shots, `images.js`, `music.js`, `reframe.js`, `editgen.js`, `productions.js` and more),
  following ComfyUI's official templates for each model. The H3 hunting graph is checked against its
  ComfyUI GUI export in 32 switch states (`test/graph-parity.mjs`).
- **Workflow files.** `resources/workflows/iv_studio_api.json` is the full IV Studio H3 workflow in API
  form (with `iv_studio_api.groups.json`, its switch groups), and `resources/workflows/replace/` holds the
  Replace's old-engine workflows from OpenJutsu. Load them in ComfyUI to see the graphs IV Studio drives.
  Remake's graph is Viggle's own workflow (`src/service/remake.js` builds it per take).
- **Node packs.** **Settings → Setup → Install missing node packs** adds every pack IV Studio uses to your
  ComfyUI's `custom_nodes` in one go: its own small pack (`resources/comfy-nodes/ComfyUI-IV-Studio`) is
  copied, the others are downloaded at the versions below (the list lives in `resources/models.json`), and
  their requirements are installed with ComfyUI's own Python (never the torch family, which ComfyUI already
  has). A folder that's already there is left alone. Restart ComfyUI afterwards. Agents can do the same
  with `install_node_packs`. Replace and Cut out also use SAM 3, which recent ComfyUI has built in.
- **Updates.** **Settings → Setup → Updates** checks ComfyUI against its newest stable release and counts
  the custom node packs with updates. **Update everything** saves a ComfyUI-Manager snapshot, updates every
  pack (Manager included) and ComfyUI through Manager, then restarts ComfyUI and waits for it; nothing runs
  while ComfyUI is rendering. **Undo last update** restores the snapshot, and switches back on the plain-folder
  packs (IV Studio's own among them) that Manager's restore switches off. It needs ComfyUI-Manager (Setup
  offers to install it) and a ComfyUI on this PC; under the ComfyUI Desktop app, which updates ComfyUI itself,
  it updates the node packs. Agents: `check_comfy_updates`, `update_comfy`, `undo_comfy_update`.
- **The latent upscaler.** ComfyUI 0.44 and newer have the H3 latent upscaler built in; there, finishes use
  ComfyUI's own (same model and size) and the LBH node pack below isn't needed.

  | Pack | Used for | Version |
  | --- | --- | --- |
  | [ComfyUI-MiniMaxH3Mod (RefMods)](https://github.com/Luisacaotica/ComfyUI-MiniMaxH3Mod) | Shots | Comfy Registry 0.2.9 |
  | [Fantastic MiniMaxH3 PromptBuilder (media loader)](https://github.com/Adudeguyman/ComfyUI-Fantastic-MiniMaxH3-PromptBuilder) | Shots | commit `22e719f` |
  | [MiniMax H3 latent upscaler](https://github.com/LBH-123-AI/Comfyui_Minimax_h3_latent_Upscaler) | Shots (ComfyUI before 0.44) | commit `40316cf` |
  | [VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) | Shots | commit `4d907be` |
  | [DLSS5 Enhancer v15 (Strix-3D)](https://github.com/Strix-3D/ComfyUI-DLSS5-Enhancer-v15) | Shots (Windows only) | Comfy Registry 1.3.1 |
  | [rgthree-comfy](https://github.com/rgthree/rgthree-comfy) | Shots | commit `d7297b4` |
  | [Impact Pack](https://github.com/ltdrdata/ComfyUI-Impact-Pack) | Shots | Comfy Registry 8.28.3 |
  | [Pixaroma (LoRA loader)](https://github.com/pixaroma/ComfyUI-Pixaroma) | Shots | commit `30d4d94` |
  | [Easy-Use (seed)](https://github.com/yolain/ComfyUI-Easy-Use) | Shots | commit `b0b47ca` |
  | [comfyui_essentials (math)](https://github.com/cubiq/ComfyUI_essentials) | Shots | Comfy Registry 1.1.0 |
  | [KJNodes](https://github.com/kijai/ComfyUI-KJNodes) | Shots | commit `37ca7af` |
  | [IV Studio nodes (latent cache, shot list)](https://github.com/hollisorg/iv-studio/tree/main/resources/comfy-nodes/ComfyUI-IV-Studio) | Shots | bundled with IV Studio |
  | [H3 Multishot](https://github.com/jlucasmcrell/ComfyUI-H3-Multishot) | Sequences | Comfy Registry 2.7.2 |
  | [MiniMax H3 Context Loop](https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop) | Replace and Reframe | Comfy Registry 0.7.3 |
  | [H3 One-Click Swap](https://github.com/D3voz/comfyui-h3-oneclick-swap) | Replace | commit `e44a56e` |
  | [H3 Face Refine](https://github.com/Carasibana/ComfyUI-H3-FaceRefine) | Replace | commit `d8521d1` |
  | [Image Detail Contrast](https://github.com/D3voz/comfyui-image-detail-contrast) | Replace | commit `485a5e2` |
  | [Orion4D FXMax](https://github.com/orion4d/Orion4D_FXMax) | Replace | commit `7048e84` |
  | [Spectrum for MiniMax H3](https://github.com/xmarre/ComfyUI-Spectrum-MiniMax-H3) | Replace | commit `806fe49` |
  | [SeedVR2 Video Upscaler](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler) | SeedVR2 finishing | Comfy Registry 2.5.24 |
  | [Frame Interpolation (RIFE)](https://github.com/Fannovel16/ComfyUI-Frame-Interpolation) | Finals on Linux (Linux only) | Comfy Registry 1.0.11 |

- **Memory.** One model family at a time (below): IV Studio calls `/free` when the next job needs a
  different family.

## Models and the GPU

- **Free** (next to the GPU and RAM readout in the title bar) unloads everything from the GPU and RAM now:
  ComfyUI's models, IV Studio's voice engine and the prompt writer's Ollama model. A render that's running
  keeps its memory until it finishes.

- **Settings → Models** picks the main H3 model for each workflow from the ones your ComfyUI has, so a
  fine-tune that suits realism or animation can be used where it fits.
- **One model family at a time.** Before every job, IV Studio stops its own voice engine and, when the job
  before used a different family (H3 video, music or design pictures), asks ComfyUI to unload first. Jobs
  of the same family keep their models loaded.

## Cloud

No strong graphics card, or want your PC back while it renders? The **Cloud** page renders on a GPU in your
own [RunPod](https://www.runpod.io) or [Modal](https://modal.com) account instead: your account, billed to
you by them. Or use [Comfy Cloud](https://www.comfy.org/cloud), Comfy's own hosted ComfyUI. Pick one on the
page, or press **Guided setup** for a few steps: pick a service, connect your account, choose a GPU and when it
shuts off, set it up, switch it on. Check my PC offers the same wizard when it recommends the cloud.

### On Comfy Cloud

1. **Comfy account.** Paste a Comfy API key from [platform.comfy.org](https://platform.comfy.org/profile/api-keys)
   (the Comfy.org key you saved for the paid prompt writer works too). Comfy Cloud's API needs a paid Comfy
   Cloud plan; runs are billed to your Comfy account, and nothing runs between renders.
2. **What works there.** Comfy Cloud runs ComfyUI's own nodes and a fixed set of node packs that Comfy
   maintains, with its own model library; you can't install node packs there. So IV Studio asks it (free, no
   render) and lists what works: pictures and music use ComfyUI's own nodes, while video shots need IV
   Studio's node packs and run only if Comfy Cloud offers them. Check again any time; Comfy adds models and
   packs.

### On RunPod

1. **RunPod account.** Paste an API key from RunPod's Settings → API Keys page (read/write). It is checked
   with RunPod, then stored encrypted on your PC, and used only to make your storage volume and to start and
   stop your own pods.
2. **GPU and shut-off.** Pick an L40S or RTX 6000 Ada (48 GB), A100 or H100 (80 GB), RTX 5090 (32 GB) or RTX 4090 (24 GB). The
   page shows RunPod's live hourly price and whether each is free right now; billing is by the second.
3. **Set up.** IV Studio makes a 100 GB network volume in a RunPod data center that has your GPU and starts a
   pod from RunPod's official PyTorch image with this version's `resources/cloud` folder. The first pod installs
   ComfyUI and the same pinned node packs as Modal onto the volume, downloads the H3 models (each checked
   against its published SHA-256) and receives your character LoRAs, so later pods start in a few minutes.

RunPod pods don't sleep by themselves, so the pod's gate (`resources/cloud/gate.py`, which also asks for IV
Studio's token on every request) deletes the pod after your idle time with an empty queue. The volume keeps
ComfyUI, the models and every render. The next render starts a new pod; if your GPU is taken in that data
center, IV Studio starts the next H3-ready one that's free. The volume is billed by RunPod while it exists
(about $7 a month for 100 GB); delete it on RunPod's Storage page when you're done with the cloud.

### On Modal

1. **Cloud tools.** IV Studio installs a private copy of Modal's client in its own folder (about 100 MB).
2. **Modal account.** Sign in on Modal's own page; signing up is free.
3. **GPU and shut-off.** Pick an L40S (48 GB, recommended), A100 or H100 (80 GB), and how long it waits
   with nothing to do before it switches off (3, 5, 10 or 20 minutes). The Cloud page shows each GPU's
   hourly price; billing is by the second, only while the GPU is on.
4. **Set up.** IV Studio deploys its ComfyUI app to your account and copies the H3 models into a Modal
   volume (about 60 GB) once.

### Either way

Then switch **This PC / Cloud**. While you're on the cloud, the title bar shows **GPU on/off · time · $**:
the GPU time and estimated cost since IV Studio opened, at the chosen GPU's list price. Click it for the
Cloud page, where **Shut down GPU** stops it at once instead of waiting for the idle shut-off. The next
render wakes it again (about 1 to 3 minutes on Modal, 2 to 5 on RunPod). The Cloud page estimates a 10-second 2 MP shot at roughly 3 to
5 minutes of GPU, about $0.13 on an L40S.

**What runs in the cloud:** Create's video shots (hunting previews and finishing), Sequences, and the
characters you already have. Finals use a 2× AI upscale (Real-ESRGAN) and RIFE frame interpolation (48, 72
or 120 fps) in place of DLSS, which needs an NVIDIA card on Windows.

**On Comfy Cloud** the check above decides it: Images and Music run there when Comfy Cloud has their models.

**What still needs a local NVIDIA GPU (on RunPod and Modal):** Images, Music, Voices (and **Speak it**), designing a new
character's stills and clips, and Replace. LoRAs you download from Civitai go into your local ComfyUI, so
cloud renders don't see them yet. Training a character runs on your PC, RunPod or Modal, whichever renders.

## Agents (MCP)

IV Studio includes a local MCP server (stdio) with 154 tools. It uses the same projects, characters, voices
and songs as the window, so Claude Code or any MCP client can render shots and sequences, make pictures,
speak lines, make music, cut them together and export. **Settings → Agents** has the command for your
install, a message to paste into any agent, and a button that adds the IV Studio skill to Claude Code.

**Start menu.** When a chat opens without a request, the agent offers IV Studio's menu as one
multiple-choice question: a shot, a picture, a longer scene, a spoken line, music, an edit, a website film,
a swap, a new character or a tour. Each choice comes with what to do next (`get_menu`). The same choices,
plus `start`, are MCP prompts, so Claude Code lists them as slash commands (`/mcp__iv-studio__…`).

For a development checkout:

```
claude mcp add iv-studio -e ELECTRON_RUN_AS_NODE=1 -- "<checkout>\node_modules\electron\dist\electron.exe" "<checkout>\out\main\mcp.js"
```

Agents learn how to use it from `resources/agent-guide.md`: the server's instructions on connect, the
`get_guide` tool, and the Claude Code skill ([`skills/iv-studio/SKILL.md`](skills/iv-studio/SKILL.md)).

<details>
<summary>All tools</summary>

- **Guide and start menu:** `get_guide`, `get_menu`.
- **Images:** `list_image_models`, `make_image`, `list_images`, `get_image`, `cancel_image`, `delete_image`.
- **This PC:** `scan_hardware` (what Check my PC sees and recommends), `free_memory`.
- **Shots:** `check_setup`, `install_node_packs`, `check_comfy_updates`, `update_comfy`, `undo_comfy_update`, `list_characters`, `list_projects`, `plan_render`, `check_prompt`,
  `list_samplers`, `generate_previews`, `finish_candidate`, `enhance_final`, `rank_takes`, `review_take`, `make_previs`.
- **Cast and places:** `list_cast`, `save_place`.
- **Projects (short films):** `list_films`, `create_film`, `get_film`, `update_film`, `set_film_script`,
  `write_film_script`, `break_down_film`, `sketch_film_shots`, `edit_film_shot`, `write_film_shot_prompt`,
  `speak_film_line`, `use_film_recording`, `draw_film_face`, `use_film_face`, `draw_place_angles`,
  `make_animatic`, `render_film_shot`, `render_film_scene`, `finish_film_shot`, `build_rough_cut`.
- **Sequences:** `list_sequences`, `get_sequence`, `save_sequence`, `render_take`, `hunt_shot`,
  `finish_shot`, `retake`, `render_out`.
- **Prompt writing:** `write_prompt`, `write_shots_from_story`.
- **Jobs:** `get_job`, `cancel_job`, `get_outputs`.
- **References:** `prepare_media` (crop a picture, trim and crop a video or sound, or fit it to H3's sizes).
- **Library:** `list_renders`, `rename_project`, `delete_project`, `delete_sequence`.
- **Edit:** `list_edits`, `get_edit`, `create_edit`, `set_edit_settings`, `delete_edit`, `add_media`,
  `edit_timeline` (add, insert, overwrite, move, trim, split, ripple delete, fades, volume, titles, tracks
  and their hide/lock/mute/solo, markers, all checked before anything changes), `grab_frame`, `export_edit`,
  `get_edit_export`, `cancel_edit_export`.
- **New footage on the timeline:** `generate_in_edit` (extend, bridge, fill or retake), `list_generations`,
  `pick_generation`, `cancel_generation`, `cut_out`, `reframe`, `make_reel`.
- **Voices:** `voice_status`, `setup_voices`, `list_voices`, `design_voice`, `create_voice`, `update_voice`,
  `delete_voice`, `speak_line`, `list_lines`, `delete_line`, `release_voice_engine`.
- **Music:** `music_status`, `make_music`, `list_music`, `get_music`, `cancel_music`, `rename_music`,
  `delete_music`.
- **LoRAs:** `search_loras`, `get_lora`, `download_lora` (needs `CIVITAI_API_KEY` in the server's
  environment), `list_my_loras`, `identify_lora`.
- **Characters:** `list_ready_characters`, `install_ready_character`, `save_character`, `delete_character`,
  `list_choices` (LoRAs and RefMods), `make_refmod_character`.
- **Character training:** `list_character_trainings`, `get_character_training`,
  `create_character_training`, `update_character_training`, `design_faces`, `pick_face`, `design_scenes`,
  `pick_still`, `make_training_clips`, `set_training_item`, `add_training_files`, `rank_likeness`,
  `estimate_training` and `start_training` (on this PC, RunPod or Modal, with the recipe options and `more` to
  carry a run on; a paid run needs the person's OK and `confirm_cost`), `stop_training`, `test_checkpoints`,
  `score_checkpoints`, `adopt_checkpoint`.
- **Replace:** `replace_check`, `replace_video`, `replace_history`, `remake_paint`, `remake_use_picture`, `remake_render`.
- **Shinobi:** `shinobi_status`, `shinobi_setup`, `shinobi_tools`, `shinobi`, `shinobi_project`.
- **Sizzle:** `sizzle_capture`, `view_sizzle_capture`, `list_sizzles`, `get_sizzle`, `save_sizzle_plan`,
  `approve_sizzle_plan`, `make_sizzle_assets`, `sizzle_first_cut`, `sizzle_to_shinobi`, `delete_sizzle`.
- **Models:** `list_h3_models`, `set_workflow_model`.

An edit open in the window reloads when an agent changes it; a strip says what changed, with a one-click
Undo, and tracks the person locks refuse the agent.
The MCP server always renders on the local ComfyUI.

</details>

## Use it well

- **Model licences.** IV Studio doesn't bundle any model weights; each one downloads from its own host under
  its own licence, linked from Setup. Read them before commercial work. In particular:
  - **MiniMax H3** is under the MiniMax H3 Community Licence, which covers use worldwide *except* the EU,
    the UK, South Korea and the USA. Use in those places needs a licence from MiniMax.
  - **MiniMax Music 3** is under the MiniMax-Music3 Community Licence: commercial use is allowed if the
    product shows "MiniMax-Music3", with MiniMax's written permission above $20M a year.
  - **ACE-Step 1.5**, **VoxCPM2** and **Qwen3-VL** are Apache-2.0; **Whisper** is MIT.
  - **InsightFace's** face models (only for likeness scoring) are for non-commercial research use.
- **People.** Characters and voices must be invented, your own, or of someone who agreed. Don't make a real
  person say or do things without their consent, and don't clone a voice from a recording you found.
- **Music.** Write your own lyrics and describe a style rather than imitating a named artist.

---

## Develop

```
npm install
node node_modules/electron/install.js   # npm 11 skips Electron's install script
npm run build
"Start IV Studio (dev).bat"
npm run dist                           # unsigned NSIS installer in dist/
```

Tests are in `test/`:

- `graph-parity.mjs`: the headless graph matches the ComfyUI GUI export for 32 switch states.
- `service-e2e.mjs`: renders previews and a finish on a live ComfyUI.
- `mcp-smoke.mjs`, `mcp-tools.mjs`, `mcp-live.mjs`: the MCP server over stdio, every editor, library,
  model and character tool, and an agent's edit reloading in an open dev window.
- `mcp-voices.mjs`: every voice tool against a set-up voice engine (pass its folder).
- `mcp-music.mjs`: every music tool against the local ComfyUI (`--minimax` adds a MiniMax song).
- `mcp-loras.mjs`: the LoRA tools against live Civitai and the local ComfyUI (downloads nothing).
- `civitai-download.mjs`: Civitai downloads against a mock Civitai (checksum, missing key, real-person refusal).
- `edit-export.mjs`: exports a five-clip edit with the bundled ffmpeg.
- `replace.mjs`, `shinobi.mjs`, `training-local.mjs`, `sequence-graphs.mjs`: Replace, Shinobi, character
  design and sequences on real hardware (the last one queues GPU renders).
- `media-prepare.mjs`, `models-download.mjs`, `prompt-writer.mjs`: media trims, checked downloads and the
  local prompt writer.
- `tours.mjs`: every How it works tour exists, reads well, and points only at parts the window still has.
- `hardware.mjs`, `training-recipe.mjs`, `training-runpod.mjs`, `sampler-choice.mjs`, `refmods.mjs`,
  `news.mjs`: Check my PC's advice, the training recipe and its spending cap, RunPod training against a mock,
  the sampler choice, RefMod characters and What's new.

## Licences

IV Studio is MIT-licensed (see [LICENSE](LICENSE)); the Infinite Variance eye artwork is Infinite Variance's
own and isn't covered by the MIT licence. Third-party notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The bundled FFmpeg build is GPL.

Screenshots show Tess Marlow and Theo Lindqvist, invented IV Studio characters, and other shots, pictures and
songs made with IV Studio. The LoRA previews in the LoRAs screenshots are by their makers on Civitai.
