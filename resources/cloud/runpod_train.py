"""IV Studio character training on the user's own RunPod account.

A pod from Fizgig's own image (ghcr.io/shootthesound/fizgig) with the "iv-studio-train" network volume at
/workspace runs this script (packed into IV_BUNDLE by IV Studio, like the render pod's runpod_boot.py). It is
the pod's only way in, on port 8189, and asks for IV Studio's token on everything but /iv/health:

  GET  /iv/health                 the stage: waiting, setup, models, training, done, failed, stopped (no token)
  PUT  /iv/upload?path=&offset=   a dataset or run file in chunks (RunPod's proxy refuses bodies over 100 MB)
  POST /iv/upload?path=&sha256=   checks the whole file against its SHA-256 and keeps it
  POST /iv/start                  Fizgig at the pinned commit, the H3 training files (once, kept on the volume),
                                  then bash train/<run>/train.sh into train/<run>/train.log
  GET  /iv/log?offset=            the log from a byte offset
  GET  /iv/list?path=             a folder's names (the run's loras/, with the saved states)
  GET  /iv/file?path=             a file (a checkpoint), streamed
  POST /iv/stop                   stops the training (what was saved stays)
  POST /iv/done                   deletes the pod now

With nothing asked for IV_IDLE_SECONDS once training has ended (or nothing started), the pod deletes itself, so
the GPU stops billing; the volume keeps the models, the dataset and every checkpoint. IV_MODE=serve starts it
just to hand over files (a later download, after the training pod has gone).
Paths are under IV_WORKSPACE (/workspace); IV_TRAIN_CMD and IV_SKIP_SETUP are for tests.
"""
import hashlib
import hmac
import json
import os
import shlex
import shutil
import signal
import subprocess
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

TOKEN = os.environ["IV_TOKEN"]
RUN = os.environ.get("IV_RUN", "")
MODE = os.environ.get("IV_MODE", "train")
WS = Path(os.environ.get("IV_WORKSPACE", "/workspace"))
IDLE = int(os.environ.get("IV_IDLE_SECONDS", "1800"))
START_LIMIT = int(os.environ.get("IV_START_LIMIT", "1800"))  # nothing started this long after boot: gone
MAX_HOURS = float(os.environ.get("IV_MAX_HOURS", "12"))  # a stuck run still ends
# the commit comes from IV Studio (FIZGIG in src/service/training.js); this default is only for running it by hand
FIZGIG_COMMIT = os.environ.get("IV_FIZGIG_COMMIT", "8630fca0c5d7932d73fe7387fd7c8a4dc99d9467")
FIZGIG = Path(os.environ.get("IV_FIZGIG_DIR", "/opt/Fizgig"))
MODELS = {
    "minimax_h3_fl2va_pruned_int8_convrot.safetensors": 20_970_379_616,
    "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors": 15_687_142_551,
    "minimax_h3_video_vae_fp16.safetensors": 5_207_808_496,
    "minimax_h3_audio_vae_fp32.safetensors": 605_254_808,
    "minimax_h3_image_training_adapter.safetensors": 620_284_872,
}
UPLOAD_EXT = (".png", ".jpg", ".jpeg", ".webp", ".mp4", ".txt", ".toml", ".sh", ".wav", ".flac")

state = {"stage": "waiting" if MODE == "train" else "ready", "detail": "Ready for the dataset" if MODE == "train" else "Serving files", "started": None}
last_seen = time.time()
booted = time.time()
proc = None
lock = threading.Lock()


def set_stage(stage, detail=""):
    state.update(stage=stage, detail=detail)
    print(f"[iv] {stage}: {detail}", flush=True)


def inside(rel, roots):
    """The path under the workspace a request names, or None when it leaves the allowed folders."""
    rel = (rel or "").replace("\\", "/").lstrip("/")
    if ".." in rel.split("/") or not any(rel == r.rstrip("/") or rel.startswith(r) for r in roots):
        return None
    return WS / rel


def run_log(cmd, log, env=None, cwd=None):
    global proc
    with open(log, "a", encoding="utf-8") as fh:
        fh.write(f"$ {cmd}\n")
        fh.flush()
        proc = subprocess.Popen(cmd, shell=True, cwd=cwd, env=env, stdout=fh, stderr=subprocess.STDOUT, start_new_session=True)
        code = proc.wait()
        proc = None
        return code


def missing_models():
    d = WS / "models"
    return [f for f, size in MODELS.items() if not ((d / f).exists() and (d / f).stat().st_size == size)]


def train():
    """Fizgig, the models, then the run. Ends with TRAINING DONE (or a failure) in the log."""
    run_dir = WS / "train" / RUN
    log = run_dir / "train.log"
    env = dict(os.environ, PYTHONPATH=str(FIZGIG / "src"), PYTHONUNBUFFERED="1")
    try:
        if os.environ.get("IV_TRAIN_CMD"):
            set_stage("training", "Training")
            code = run_log(os.environ["IV_TRAIN_CMD"], log, env=env, cwd=str(run_dir))
        else:
            if not os.environ.get("IV_SKIP_SETUP"):
                if not (FIZGIG / "src" / "fizgig").exists():
                    set_stage("setup", f"Getting Fizgig {FIZGIG_COMMIT}")
                    fizgig_q, commit_q = shlex.quote(str(FIZGIG)), shlex.quote(FIZGIG_COMMIT)
                    for c in (f"git clone https://github.com/shootthesound/Fizgig {fizgig_q}", f"cd {fizgig_q} && git checkout {commit_q}", f"cd {fizgig_q} && python3 uv_install_deps.py requirements.txt $VIRTUAL_ENV"):
                        if run_log(c, log, env=env):
                            raise RuntimeError(f"setting up Fizgig failed: {c}")
                bad = missing_models()
                if bad:
                    set_stage("models", f"Downloading the H3 training files into your volume (about 42 GB, the first time only): {', '.join(bad)}")
                    (WS / "models").mkdir(parents=True, exist_ok=True)
                    if run_log(f"python3 -m fizgig.scripts.fetch_models --family minimax --models-dir {shlex.quote(str(WS / 'models'))}", log, env=env, cwd=str(FIZGIG)) or missing_models():
                        raise RuntimeError("the H3 training files didn't download completely")
            set_stage("training", "Training")
            code = run_log(f"bash {shlex.quote(str(run_dir / 'train.sh'))}", log, env=env, cwd=str(run_dir))
        if state["stage"] == "stopped":
            return
        if code:
            raise RuntimeError(f"training stopped with an error ({code})")
        with open(run_dir / "loras" / "SHA256SUMS", "w") as sums:
            for f in sorted((run_dir / "loras").glob("*.safetensors")):
                h = hashlib.sha256()
                with open(f, "rb") as fh:
                    while b := fh.read(1 << 22):
                        h.update(b)
                sums.write(f"{h.hexdigest()}  {f.name}\n")
        with open(log, "a", encoding="utf-8") as fh:
            fh.write("[runpod] TRAINING DONE\n")
        set_stage("done", "Training finished")
    except Exception as e:  # noqa: BLE001 - every failure ends the run the same way
        with open(log, "a", encoding="utf-8") as fh:
            fh.write(f"[runpod] TRAINING FAILED: {e}\n")
        set_stage("failed", str(e))


def delete_self():
    """Deletes this pod with the pod's own RunPod key (runpodctl, then REST, then GraphQL)."""
    pod, key = os.environ.get("RUNPOD_POD_ID"), os.environ.get("RUNPOD_API_KEY")
    if not pod:
        print("[iv] would delete this pod now (not on RunPod)", flush=True)
        return True
    print(f"[iv] deleting pod {pod} so the GPU stops billing", flush=True)
    try:
        if shutil.which("runpodctl") and subprocess.run(["runpodctl", "remove", "pod", pod], timeout=60).returncode == 0:
            return True
    except (OSError, subprocess.SubprocessError):
        pass
    if not key:
        return False
    for r in (
        urllib.request.Request(f"https://api.runpod.io/v2/pods/{pod}", method="DELETE", headers={"Authorization": f"Bearer {key}"}),
        urllib.request.Request(f"https://api.runpod.io/graphql?api_key={key}", data=json.dumps({"query": f'mutation {{ podTerminate(input: {{podId: "{pod}"}}) }}'}).encode(), headers={"Content-Type": "application/json"}),
    ):
        try:
            with urllib.request.urlopen(r, timeout=60) as res:
                if res.status < 300:
                    return True
        except Exception as e:  # noqa: BLE001
            print(f"[iv] could not delete the pod that way: {e}", flush=True)
    return False


def watch():
    while True:
        time.sleep(30)
        st = state["stage"]
        now = time.time()
        if st == "waiting" and now - booted > START_LIMIT:
            set_stage("failed", "Nothing was started; the pod removes itself")
            delete_self() and os._exit(0)
        if st in ("setup", "models", "training") and state["started"] and now - state["started"] > MAX_HOURS * 3600:
            stop("Stopped at the longest run IV Studio allows")
        if st in ("done", "failed", "stopped", "ready") and now - last_seen > IDLE:
            delete_self() and os._exit(0)


def stop(why="Stopped"):
    set_stage("stopped", why)
    p = proc
    if p and p.poll() is None:
        try:
            os.killpg(p.pid, signal.SIGINT)
            p.wait(120)
        except Exception:  # noqa: BLE001
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except Exception:  # noqa: BLE001
                p.kill()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        if code >= 400:  # a refused request may have left its body unread: don't reuse the connection
            self.send_header("Connection", "close")
            self.close_connection = True
        self.end_headers()
        self.wfile.write(data)

    def authed(self):
        global last_seen
        bearer = self.headers.get("Authorization", "")
        given = bearer[7:] if bearer.startswith("Bearer ") else ""
        if not hmac.compare_digest(given.encode(), TOKEN.encode()):
            self.send(401, {"error": "IV Studio token required"})
            return False
        last_seen = time.time()
        return True

    def q(self):
        u = urlparse(self.path)
        return u.path, {k: v[0] for k, v in parse_qs(u.query).items()}

    def do_GET(self):
        route, q = self.q()
        if route == "/iv/health":
            return self.send(200, {"gate": "ok", "platform": "runpod-train", "mode": MODE, "run": RUN, **{k: state[k] for k in ("stage", "detail")}})
        if not self.authed():
            return
        if route == "/iv/log":
            log = WS / "train" / RUN / "train.log"
            off = int(q.get("offset", "0"))
            data = b""
            size = log.stat().st_size if log.exists() else 0
            if size > off:
                with open(log, "rb") as fh:
                    fh.seek(off)
                    data = fh.read(min(size - off, 1 << 20))
            return self.send(200, {"offset": off + len(data), "size": size, "text": data.decode("utf-8", "replace")})
        if route == "/iv/list":
            d = inside(q.get("path", ""), ("train/",))
            if d is None:
                return self.send(400, {"error": "lists are of train/ folders"})
            return self.send(200, {"names": sorted(p.name for p in d.iterdir()) if d.is_dir() else []})
        if route == "/iv/file":
            f = inside(q.get("path", ""), ("train/",))
            if f is None or not f.is_file():
                return self.send(404, {"error": "no such file"})
            size = f.stat().st_size
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(size))
            self.end_headers()
            with open(f, "rb") as fh:
                shutil.copyfileobj(fh, self.wfile, 1 << 20)
            return
        self.send(404, {"error": "unknown"})

    def do_PUT(self):
        route, q = self.q()
        if not self.authed():
            return
        if route != "/iv/upload":
            return self.send(404, {"error": "unknown"})
        dest = inside(q.get("path", ""), (f"datasets/{RUN}/", f"train/{RUN}/"))
        if dest is None or not dest.name.lower().endswith(UPLOAD_EXT) or not RUN:
            return self.send(400, {"error": "uploads go into this run's datasets/ or train/ folder"})
        part = dest.with_name(dest.name + ".part")
        offset = int(q.get("offset", "0"))
        part.parent.mkdir(parents=True, exist_ok=True)
        if offset == 0:
            part.write_bytes(b"")
        elif not part.exists() or part.stat().st_size != offset:
            return self.send(409, {"error": "chunk out of order", "have": part.stat().st_size if part.exists() else 0})
        left = int(self.headers.get("Content-Length", "0"))
        with open(part, "ab") as fh:
            while left > 0:
                b = self.rfile.read(min(left, 1 << 20))
                if not b:
                    break
                fh.write(b)
                left -= len(b)
        return self.send(200, {"have": part.stat().st_size})

    def do_POST(self):
        route, q = self.q()
        if not self.authed():
            return
        n = int(self.headers.get("Content-Length", "0") or 0)
        if n:
            self.rfile.read(n)
        if route == "/iv/upload":
            dest = inside(q.get("path", ""), (f"datasets/{RUN}/", f"train/{RUN}/"))
            if dest is None:
                return self.send(400, {"error": "uploads go into this run's datasets/ or train/ folder"})
            part = dest.with_name(dest.name + ".part")
            if not part.exists():
                return self.send(404, {"error": "nothing was uploaded to that path"})
            h = hashlib.sha256()
            with open(part, "rb") as fh:
                while b := fh.read(1 << 22):
                    h.update(b)
            if q.get("sha256", "").lower() and h.hexdigest() != q["sha256"].lower():
                part.unlink()
                return self.send(422, {"error": "the upload did not match its checksum; it was removed"})
            part.replace(dest)
            return self.send(200, {"saved": dest.relative_to(WS).as_posix(), "sha256": h.hexdigest()})
        if route == "/iv/start":
            with lock:
                if MODE != "train" or state["stage"] != "waiting":
                    return self.send(409, {"error": f"can't start while {state['stage']}"})
                if not (WS / "train" / RUN / "train.sh").exists():
                    return self.send(400, {"error": "upload train.sh first"})
                state["started"] = time.time()
                set_stage("setup", "Starting")
                threading.Thread(target=train, daemon=True).start()
            return self.send(200, {"started": True})
        if route == "/iv/stop":
            stop()
            return self.send(200, {"stopped": True})
        if route == "/iv/done":
            self.send(200, {"deleting": True})
            threading.Thread(target=lambda: (time.sleep(1), delete_self() and os._exit(0)), daemon=True).start()
            return
        self.send(404, {"error": "unknown"})


def main():
    (WS / "train").mkdir(parents=True, exist_ok=True)
    threading.Thread(target=watch, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("IV_PORT", "8189"))), Handler).serve_forever()


if __name__ == "__main__":
    main()
