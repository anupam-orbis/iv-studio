#!/usr/bin/env bash
# The Linux checks GitHub runs after building the AppImage (.github/workflows/linux.yml). Each check's output goes to
# ci-out/<name>.log; a summary prints at the end and the script fails if any check failed.
set -u
OUT="$PWD/ci-out"
mkdir -p "$OUT"
FFMPEG="$(node -p "require('ffmpeg-ffprobe-static').ffmpegPath")"
results=()
run() {
  local name="$1"; shift
  echo "::group::$name"
  if "$@" >"$OUT/$name.log" 2>&1; then results+=("ok   $name"); else results+=("FAIL $name"); fi
  tail -n 25 "$OUT/$name.log"
  echo "::endgroup::"
}

# the parts that need no GPU and no ComfyUI
for t in cast cutout directing editgen news tours lint productions reel screenplay sizzle-cut staging timeline-tracks private-outputs comfylauncher comfy-busy ranking prompt-guide ollama-address nodepacks model-versions remake comfycloud image-families refmods hardware training-recipe training-runpod sampler-choice sequence-links music-remix modal-account setup-progress effects comfy-address mac-update; do
  run "test-$t" node "test/$t.mjs"
done
run test-runpod node test/runpod.mjs python3

# test media made with the bundled ffmpeg (Linux build), then an edit export and a Shinobi render with Chrome
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

# the window: every sidebar page under a virtual display, from the AppImage, with a picture of each
APPIMAGE_FILE="$PWD/dist/IV-Studio.AppImage"
chmod +x "$APPIMAGE_FILE"
export IV_STUDIO_USER_DATA="$OUT/userdata" IV_STUDIO_DATA="$OUT/data"
# (a screenshot under Xvfb now and then fails in Chromium's compositor, so the whole pass gets up to 3 tries)
pages_ok() { node -e "const s=require('$OUT/window/smoke.json');if(s.pages.length<8||s.pages.some(p=>p.text<20))process.exit(1)" 2>/dev/null; }
for try in 1 2 3; do
  rm -rf "$OUT/window"
  run window env IV_STUDIO_SMOKE="$OUT/window" timeout 180 xvfb-run -a -s "-screen 0 1600x1000x24" "$APPIMAGE_FILE"
  [ -f "$OUT/window/smoke.json" ] && cat "$OUT/window/smoke.json"
  if pages_ok; then break; fi
  echo "window pass $try didn't open every page"
done
pages_ok && results+=("ok   window-pages") || results+=("FAIL window-pages")

# the MCP server from the AppImage, with the exact command the app gives agents (Settings -> Agents)
MCP_CMD="$(node -p "require('$OUT/window/smoke.json').mcp.command" 2>/dev/null)"
MCP_ARGS_JSON="$(node -p "JSON.stringify(require('$OUT/window/smoke.json').mcp.args)" 2>/dev/null)"
cat "$OUT/data/mcp-start.sh" 2>/dev/null
run mcp-appimage env MCP_COMMAND="$MCP_CMD" MCP_ARGS="$MCP_ARGS_JSON" timeout 120 node test/mcp-smoke.mjs
sleep 2
if mount | grep -q "IV-Stu"; then results+=("FAIL mcp-appimage-unmounted"); else results+=("ok   mcp-appimage-unmounted"); fi

# the Linux updater (electron-updater's AppImage path, as Windows uses its own), end to end: a copy of the AppImage in a
# temporary folder finds a 9.9.9 on a local feed (this code built again with that version), downloads and checks it,
# replaces its own file and opens again. Its own virtual display, so the copy that reopens still has one.
linux_update_selftest() {
  local U="$OUT/update" PORT=8766 i ok=1 HTTP XV
  rm -rf "$U"; mkdir -p "$U/app" "$U/feed" "$U/keep"
  cp dist/IV-Studio.AppImage "$U/app/IV-Studio.AppImage"; chmod +x "$U/app/IV-Studio.AppImage"
  cp package.json package-lock.json "$U/keep/"
  npm version --no-git-tag-version --allow-same-version 9.9.9 >/dev/null
  npx electron-builder --linux --x64 --publish never -c.directories.output="$U/build" >"$U/build.log" 2>&1
  local built=$?
  cp "$U/keep/package.json" "$U/keep/package-lock.json" .
  [ $built -eq 0 ] || { tail -n 30 "$U/build.log"; return 1; }
  cp "$U/build/IV-Studio.AppImage" "$U/build/latest-linux.yml" "$U/feed/"
  cat "$U/feed/latest-linux.yml"
  python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$U/feed" >"$U/http.log" 2>&1 &
  HTTP=$!
  Xvfb :97 -screen 0 1600x1000x24 >/dev/null 2>&1 &
  XV=$!
  for i in $(seq 1 30); do curl -sf "http://127.0.0.1:$PORT/latest-linux.yml" >/dev/null && break; sleep 1; done
  DISPLAY=:97 IV_STUDIO_UPDATE_FEED="http://127.0.0.1:$PORT" IV_STUDIO_UPDATE_SELFTEST=1 IV_STUDIO_USER_DATA="$U/userdata" IV_STUDIO_DATA="$U/data" \
    "$U/app/IV-Studio.AppImage" --no-sandbox >"$U/app.log" 2>&1 &
  for i in $(seq 1 120); do
    if cmp -s "$U/app/IV-Studio.AppImage" "$U/feed/IV-Studio.AppImage" && pgrep -f "$U/app/IV-Studio.AppImage" >/dev/null; then ok=0; break; fi
    sleep 2
  done
  echo "after $i checks"
  cmp -s "$U/app/IV-Studio.AppImage" "$U/feed/IV-Studio.AppImage" && echo "the AppImage is now the 9.9.9 build" || echo "the AppImage wasn't replaced"
  pgrep -af "$U/app/IV-Studio.AppImage" || echo "nothing running from it"
  grep -iE "update|error" "$U/app.log" | tail -n 20
  pkill -f "$U/app/IV-Studio.AppImage" 2>/dev/null
  kill "$HTTP" "$XV" 2>/dev/null
  # the build artifact keeps the logs, not three more AppImages
  rm -rf "$U/build" "$U/feed" "$U/app"
  return $ok
}
run linux-update-selftest linux_update_selftest

echo
printf '%s\n' "${results[@]}" | tee "$OUT/summary.txt"
! grep -q '^FAIL' "$OUT/summary.txt"
