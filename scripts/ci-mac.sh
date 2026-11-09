#!/usr/bin/env bash
# The macOS checks GitHub runs after building the app (.github/workflows/mac.yml), on Apple Silicon and Intel. Each
# check's output goes to ci-out/<name>.log; a summary prints at the end and the script fails if any check failed.
set -u
OUT="$PWD/ci-out"
mkdir -p "$OUT"
FFMPEG="$(node -p "require('ffmpeg-ffprobe-static').ffmpegPath")"
APP="$(ls -d dist/mac*/IV\ Studio.app | head -n 1)"
results=()
# macOS has no `timeout`: perl's alarm does the same
tmo() { local s="$1"; shift; perl -e 'alarm shift; exec @ARGV' "$s" "$@"; }
run() {
  local name="$1"; shift
  echo "::group::$name"
  if "$@" >"$OUT/$name.log" 2>&1; then results+=("ok   $name"); else results+=("FAIL $name"); fi
  tail -n 25 "$OUT/$name.log"
  echo "::endgroup::"
}

# the app bundle: the right architecture, ad-hoc signed, and carrying the GPL ffmpeg (never a nonfree build)
run app-arch bash -c "file '$APP/Contents/MacOS/IV Studio' | grep -q '$(uname -m)'"
run app-signature codesign --verify --deep --strict "$APP"
BUNDLED_FFMPEG="$(find "$APP/Contents/Resources/app.asar.unpacked" -name ffmpeg -type f | head -n 1)"
run ffmpeg-gpl bash -c "'$BUNDLED_FFMPEG' -hide_banner -version | tee /dev/stderr | grep -q -- '--enable-gpl' && ! '$BUNDLED_FFMPEG' -hide_banner -version | grep -q -- '--enable-nonfree'"

# the parts that need no GPU and no ComfyUI
for t in cast cutout directing editgen news tours lint productions reel screenplay sizzle-cut staging timeline-tracks private-outputs comfylauncher comfy-busy ranking prompt-guide ollama-address nodepacks model-versions remake comfycloud image-families refmods hardware training-recipe training-runpod sampler-choice sequence-links music-remix modal-account setup-progress effects comfy-address mac-update; do
  run "test-$t" node "test/$t.mjs"
done
python3 -m venv "$OUT/pyenv" && "$OUT/pyenv/bin/pip" install -q aiohttp
run test-runpod node test/runpod.mjs "$OUT/pyenv/bin/python"

# test media made with the bundled ffmpeg (the Mac build), then an edit export and a Shinobi render with Chrome
# (Shinobi installs with uv, so this also checks the pinned Mac uv build)
M="$OUT/media"; mkdir -p "$M"
"$FFMPEG" -v error -y -f lavfi -i testsrc2=size=1280x720:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 4 -c:v libx264 -pix_fmt yuv420p -c:a aac "$M/a.mp4"
"$FFMPEG" -v error -y -f lavfi -i smptebars=size=1280x720:rate=24 -f lavfi -i sine=frequency=660:sample_rate=48000 -t 4 -c:v libx264 -pix_fmt yuv420p -c:a aac "$M/b.mp4"
"$FFMPEG" -v error -y -f lavfi -i "sine=frequency=220:sample_rate=48000:beep_factor=4" -t 12 -c:a libmp3lame "$M/music.mp3"
run test-edit-export node test/edit-export.mjs "$M/a.mp4" "$M/b.mp4"
# a real website over the network: one retry if the connection drops
run test-site-capture bash -c "node test/site-capture.mjs https://infinitevariance.ai || node test/site-capture.mjs https://infinitevariance.ai"
run test-shinobi node test/shinobi.mjs "$M/a.mp4" "$M/b.mp4" "$M/music.mp3"

# the MCP server from the built code
npx electron-vite build >/dev/null 2>&1
run mcp-dev node test/mcp-smoke.mjs

# the window: every sidebar page, from the built app, with a picture of each
export IV_STUDIO_USER_DATA="$OUT/userdata" IV_STUDIO_DATA="$OUT/data"
pages_ok() { node -e "const s=require('$OUT/window/smoke.json');if(s.pages.length<8||s.pages.some(p=>p.text<20))process.exit(1)" 2>/dev/null; }
for try in 1 2; do
  rm -rf "$OUT/window"
  # the real screen a few seconds in: the native traffic lights and the title bar as macOS draws them
  (sleep 9; screencapture -x "$OUT/screen-$try.png" 2>/dev/null) &
  run window env IV_STUDIO_SMOKE="$OUT/window" ELECTRON_ENABLE_LOGGING=1 bash -c "$(declare -f tmo); env | grep -i '^electron' ; date; tmo 180 '$APP/Contents/MacOS/IV Studio' --enable-logging; echo \"exit \$?\"; date"
  cat "$OUT/window.log"
  [ -f "$OUT/window/smoke.json" ] && cat "$OUT/window/smoke.json"
  if pages_ok; then break; fi
  echo "window pass $try didn't open every page"
done
pages_ok && results+=("ok   window-pages") || results+=("FAIL window-pages")

# the MCP server from the app, with the exact command the app gives agents (Settings -> Agents)
MCP_CMD="$(node -p "require('$OUT/window/smoke.json').mcp.command" 2>/dev/null)"
MCP_ARGS_JSON="$(node -p "JSON.stringify(require('$OUT/window/smoke.json').mcp.args)" 2>/dev/null)"
# without the window's answer, the same command it gives: the app's own binary on its bundled mcp.js
[ -n "$MCP_CMD" ] || { MCP_CMD="$APP/Contents/MacOS/IV Studio"; MCP_ARGS_JSON="$(node -p "JSON.stringify([process.argv[1]])" "$APP/Contents/Resources/app.asar/out/main/mcp.js")"; }
echo "MCP: $MCP_CMD $MCP_ARGS_JSON"
run mcp-app env MCP_COMMAND="$MCP_CMD" MCP_ARGS="$MCP_ARGS_JSON" bash -c "$(declare -f tmo); tmo 120 node test/mcp-smoke.mjs"

# the Mac updater (src/main/macupdater.js), end to end: a copy of the app in a temporary folder finds a 9.9.9 on a
# local feed (this build with its version changed, signed again ad hoc), downloads and checks it, swaps itself and
# opens again. The 9.9.9 copy that opens is stopped afterwards.
mac_update_selftest() {
  local U="$OUT/update" W="${TMPDIR:-/tmp}/iv-studio-update" ARCH ZIP PORT=8765 SHA SIZE HTTP i v ok=1
  rm -rf "$U" "$W"; mkdir -p "$U/apps" "$U/feed" "$U/new"
  ARCH=$( [ "$(uname -m)" = arm64 ] && echo arm64 || echo x64 )
  ditto "$APP" "$U/apps/IV Studio.app"
  ditto "$APP" "$U/new/IV Studio.app"
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString 9.9.9" -c "Set :CFBundleVersion 9.9.9" "$U/new/IV Studio.app/Contents/Info.plist"
  codesign --force --deep -s - "$U/new/IV Studio.app"
  ZIP="IV-Studio-mac-$ARCH.zip"
  (cd "$U/new" && ditto -c -k --keepParent "IV Studio.app" "$U/feed/$ZIP")
  SHA=$(openssl dgst -sha512 -binary "$U/feed/$ZIP" | base64 | tr -d '\n')
  SIZE=$(stat -f%z "$U/feed/$ZIP")
  printf 'version: 9.9.9\nfiles:\n  - url: %s\n    sha512: %s\n    size: %s\npath: %s\nsha512: %s\nreleaseDate: "2026-01-01T00:00:00.000Z"\n' "$ZIP" "$SHA" "$SIZE" "$ZIP" "$SHA" > "$U/feed/latest-mac.yml"
  cat "$U/feed/latest-mac.yml"
  python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$U/feed" >"$U/http.log" 2>&1 &
  HTTP=$!
  for i in $(seq 1 30); do curl -sf "http://127.0.0.1:$PORT/latest-mac.yml" >/dev/null && break; sleep 1; done
  IV_STUDIO_UPDATE_FEED="http://127.0.0.1:$PORT" IV_STUDIO_UPDATE_SELFTEST=1 IV_STUDIO_USER_DATA="$U/userdata" IV_STUDIO_DATA="$U/data" \
    "$U/apps/IV Studio.app/Contents/MacOS/IV Studio" >"$U/app.log" 2>&1 &
  for i in $(seq 1 120); do
    v=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$U/apps/IV Studio.app/Contents/Info.plist" 2>/dev/null)
    if [ "$v" = 9.9.9 ] && pgrep -f "$U/apps/IV Studio.app/Contents/MacOS/IV Studio" >/dev/null; then ok=0; break; fi
    sleep 2
  done
  echo "after $i checks: version ${v:-none}"
  cat "$W/update.log" 2>/dev/null
  [ -e "$U/apps/IV Studio.app.iv-old" ] && { echo "the old copy was left behind"; ok=1; }
  grep -q 'installed$' "$W/update.log" 2>/dev/null || { echo "no 'installed' in the log"; ok=1; }
  grep -q 'opened$' "$W/update.log" 2>/dev/null || { echo "no 'opened' in the log"; ok=1; }
  codesign --verify --deep --strict "$U/apps/IV Studio.app" || ok=1
  pkill -f "$U/apps/IV Studio.app/Contents/MacOS/IV Studio" 2>/dev/null
  kill "$HTTP" 2>/dev/null
  return $ok
}
run mac-update-selftest mac_update_selftest

echo
printf '%s\n' "${results[@]}" | tee "$OUT/summary.txt"
! grep -q '^FAIL' "$OUT/summary.txt"
