#!/usr/bin/env python3
import argparse
import glob
import json
import mimetypes
import os
import threading
import uuid
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


STATE_LOCK = threading.Lock()
LATEST_STATE = {}
JSON_FILE_PATH = None
PREFER_FILE = False
WEB_DIST_DIR = None
ACTION_LOG_PATH = None
ACTIONS = deque(maxlen=500)
CHART_REQUEST_LOCK = threading.Lock()
CHART_REQUEST_PATH = None
DEFAULT_CHART_BARS = 120
CHART_REQUEST_STATE = {"updatedAt": 0, "globalBars": DEFAULT_CHART_BARS, "perTfBars": {}}
VALID_TFS = ("M1", "M5", "M15", "H1", "H4", "D1")
MIN_CHART_BARS = 50
MAX_CHART_BARS = 20000


HTML_PAGE = """<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MTF OsMA EMA Telemetry (Legacy)</title>
  <style>
    body { font-family: Segoe UI, sans-serif; margin: 24px; background:#f4f7fa; color:#1c2430; }
    .card { background:#fff; border:1px solid #d8e0ea; border-radius:12px; padding:16px; max-width:900px; }
    a { color:#0057b8; }
    code { background:#eef3f8; padding:2px 6px; border-radius:6px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Legacy Dashboard Fallback</h2>
    <p>React build not found at <code>web/dist</code>.</p>
    <p>Build it with:</p>
    <pre>cd web && npm install && npm run build</pre>
    <p>Telemetry API is available at <a href="/api/state">/api/state</a>.</p>
  </div>
</body>
</html>
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def now_unix() -> int:
    return int(datetime.now(timezone.utc).timestamp())


def clamp_chart_bars(value):
    try:
        bars = int(value)
    except Exception:
        return None
    if bars < MIN_CHART_BARS:
        bars = MIN_CHART_BARS
    if bars > MAX_CHART_BARS:
        bars = MAX_CHART_BARS
    return bars


def default_chart_request_path() -> str:
    appdata = os.environ.get("APPDATA", "")
    if appdata:
        return os.path.join(
            appdata,
            "MetaQuotes",
            "Terminal",
            "Common",
            "Files",
            "ea_multitf_chart_request.json",
        )
    return os.path.abspath("ea_multitf_chart_request.json")


def sanitize_chart_request(raw):
    state = {"updatedAt": now_unix(), "globalBars": DEFAULT_CHART_BARS, "perTfBars": {}}
    if not isinstance(raw, dict):
        return state

    global_bars = clamp_chart_bars(raw.get("globalBars", state["globalBars"]))
    if global_bars is not None:
        state["globalBars"] = global_bars

    per = raw.get("perTfBars", {})
    if isinstance(per, dict):
        clean = {}
        for tf, bars in per.items():
            name = str(tf).strip().upper()
            if name not in VALID_TFS:
                continue
            val = clamp_chart_bars(bars)
            if val is not None:
                clean[name] = val
        state["perTfBars"] = clean

    updated_at = raw.get("updatedAt", 0)
    try:
        updated_at = int(updated_at)
    except Exception:
        updated_at = 0
    if updated_at > 0:
        state["updatedAt"] = updated_at

    return state


def load_chart_request(path: str):
    if not path or not os.path.isfile(path):
        return sanitize_chart_request({})
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return sanitize_chart_request(data)
    except Exception:
        return sanitize_chart_request({})


def save_chart_request(path: str, state):
    if not path:
        return
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
    except Exception:
        pass
    try:
        payload = sanitize_chart_request(state)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=True, separators=(",", ":"))
    except Exception:
        pass


def snapshot_chart_request():
    with CHART_REQUEST_LOCK:
        return {
            "updatedAt": int(CHART_REQUEST_STATE.get("updatedAt", 0)),
            "globalBars": int(CHART_REQUEST_STATE.get("globalBars", DEFAULT_CHART_BARS)),
            "perTfBars": dict(CHART_REQUEST_STATE.get("perTfBars", {})),
        }


def merge_chart_request(payload):
    global CHART_REQUEST_STATE

    if not isinstance(payload, dict):
        return None, "payload must be object"

    with CHART_REQUEST_LOCK:
        next_state = {
            "updatedAt": int(CHART_REQUEST_STATE.get("updatedAt", 0)),
            "globalBars": int(CHART_REQUEST_STATE.get("globalBars", DEFAULT_CHART_BARS)),
            "perTfBars": dict(CHART_REQUEST_STATE.get("perTfBars", {})),
        }

        if payload.get("reset", False):
            next_state["perTfBars"] = {}

        global_bars = payload.get("globalBars", None)
        if global_bars is not None:
            clamped = clamp_chart_bars(global_bars)
            if clamped is None:
                return None, "globalBars must be an integer"
            next_state["globalBars"] = clamped

        tf = str(payload.get("tf", "")).strip().upper()
        bars = payload.get("bars", None)
        if tf:
            if tf not in VALID_TFS:
                return None, f"tf must be one of {','.join(VALID_TFS)}"
            if bars is None:
                return None, "bars is required when tf is provided"
            clamped = clamp_chart_bars(bars)
            if clamped is None:
                return None, "bars must be an integer"
            per = dict(next_state.get("perTfBars", {}))
            per[tf] = clamped
            next_state["perTfBars"] = per

        per_tf_bars = payload.get("perTfBars", None)
        if per_tf_bars is not None:
            if not isinstance(per_tf_bars, dict):
                return None, "perTfBars must be an object"
            per = dict(next_state.get("perTfBars", {}))
            for k, v in per_tf_bars.items():
                name = str(k).strip().upper()
                if name not in VALID_TFS:
                    continue
                clamped = clamp_chart_bars(v)
                if clamped is not None:
                    per[name] = clamped
            next_state["perTfBars"] = per

        next_state["updatedAt"] = now_unix()
        CHART_REQUEST_STATE = sanitize_chart_request(next_state)
        save_chart_request(CHART_REQUEST_PATH, CHART_REQUEST_STATE)
        return {
            "updatedAt": int(CHART_REQUEST_STATE.get("updatedAt", 0)),
            "globalBars": int(CHART_REQUEST_STATE.get("globalBars", DEFAULT_CHART_BARS)),
            "perTfBars": dict(CHART_REQUEST_STATE.get("perTfBars", {})),
        }, ""


def read_state_from_file(path: str):
    if not path:
        return None
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def state_updated_at(state):
    if not isinstance(state, dict):
        return 0
    meta = state.get("meta", {})
    if not isinstance(meta, dict):
        return 0
    try:
        return int(meta.get("updatedAt", 0))
    except Exception:
        return 0


def discover_json_candidates(configured_path: str):
    paths = []
    seen = set()

    def add_path(p):
        if not p:
            return
        norm = os.path.normpath(p)
        if norm in seen:
            return
        seen.add(norm)
        paths.append(norm)

    if configured_path and os.path.isabs(configured_path):
        add_path(configured_path)

    appdata = os.environ.get("APPDATA", "")
    if appdata:
        common_path = os.path.join(
            appdata, "MetaQuotes", "Terminal", "Common", "Files", "ea_multitf_state.json"
        )
        add_path(common_path)

        tester_pattern = os.path.join(
            appdata,
            "MetaQuotes",
            "Tester",
            "*",
            "Agent-*",
            "MQL5",
            "Files",
            "ea_multitf_state.json",
        )
        for p in glob.glob(tester_pattern):
            add_path(p)

    return paths


def freshest_file_state(configured_path: str):
    best_state = None
    best_path = ""
    best_updated_at = 0
    best_mtime = 0

    for p in discover_json_candidates(configured_path):
        if not os.path.isfile(p):
            continue
        state = read_state_from_file(p)
        if not isinstance(state, dict):
            continue
        updated_at = state_updated_at(state)
        try:
            mtime = int(os.path.getmtime(p))
        except Exception:
            mtime = 0

        # Prioritize the most recently written file so tester/live sessions with
        # different market-time epochs don't pin the dashboard to stale data.
        if (
            best_state is None
            or mtime > best_mtime
            or (mtime == best_mtime and updated_at > best_updated_at)
        ):
            best_state = state
            best_path = p
            best_updated_at = updated_at
            best_mtime = mtime

    return best_state, best_path, best_updated_at, best_mtime


def parse_action_payload(data):
    if not isinstance(data, dict):
        return None, "payload must be object"

    action = str(data.get("action", "")).strip().lower()
    symbol = str(data.get("symbol", "")).strip()
    source = str(data.get("source", "web_ui")).strip() or "web_ui"
    ts = data.get("ts", 0)
    meta = data.get("meta", {})

    allowed = {"buy", "sell", "close_all"}
    if action not in allowed:
        return None, "action must be buy/sell/close_all"
    if not symbol:
        return None, "symbol is required"
    if not isinstance(meta, dict):
        return None, "meta must be object"

    try:
        ts = int(ts)
    except Exception:
        ts = 0

    rec = {
        "id": str(uuid.uuid4()),
        "action": action,
        "symbol": symbol,
        "source": source,
        "ts": ts,
        "meta": meta,
        "acceptedAt": now_iso(),
    }
    return rec, ""


def append_action_log(rec):
    ACTIONS.append(rec)
    if not ACTION_LOG_PATH:
        return
    try:
        with open(ACTION_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=True) + "\n")
    except Exception:
        pass


def load_action_log(path: str):
    ACTIONS.clear()
    if not path or not os.path.isfile(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                    if isinstance(rec, dict):
                        ACTIONS.append(rec)
                except Exception:
                    continue
    except Exception:
        pass


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, content_type: str, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status: int, obj):
        self._send(status, "application/json; charset=utf-8", json.dumps(obj).encode("utf-8"))

    def _read_json_body(self):
        size = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(size)
        return json.loads(raw.decode("utf-8"))

    def _try_serve_static(self, path: str) -> bool:
        if not WEB_DIST_DIR:
            return False

        dist = Path(WEB_DIST_DIR)
        req = path.lstrip("/")
        if req == "":
            target = dist / "index.html"
        else:
            target = (dist / req).resolve()
            if not str(target).startswith(str(dist.resolve())):
                return False

        if target.is_file():
            ctype, _ = mimetypes.guess_type(str(target))
            if not ctype:
                ctype = "application/octet-stream"
            self._send(200, f"{ctype}; charset=utf-8" if ctype.startswith("text/") else ctype, target.read_bytes())
            return True

        if (dist / "index.html").is_file() and path not in {"/api/state", "/api/telemetry", "/api/actions", "/api/chart-request"}:
            self._send(200, "text/html; charset=utf-8", (dist / "index.html").read_bytes())
            return True

        return False

    def do_OPTIONS(self):
        self._send(204, "text/plain; charset=utf-8", b"")

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/state":
            with STATE_LOCK:
                mem_state = dict(LATEST_STATE)
            file_state, file_path, file_u, file_mtime = freshest_file_state(JSON_FILE_PATH)
            mem_u = state_updated_at(mem_state)

            if PREFER_FILE and file_state:
                out = file_state
                out["_source"] = "file"
            elif mem_state and (mem_u >= file_u or not file_state):
                out = mem_state
                out["_source"] = "http"
            elif file_state:
                out = file_state
                out["_source"] = "file"
            else:
                out = {}

            out["_stateUpdatedAt"] = state_updated_at(out)
            out["_fileUpdatedAt"] = file_u
            out["_httpUpdatedAt"] = mem_u
            out["_fileMtime"] = file_mtime
            out["_selectedFile"] = file_path
            req = snapshot_chart_request()
            out["_chartRequest"] = req
            if isinstance(out.get("live"), dict):
                if not isinstance(out["live"].get("chartRequest"), dict):
                    out["live"]["chartRequest"] = req
            self._send_json(200, out)
            return

        if path == "/api/chart-request":
            self._send_json(200, {"ok": True, "request": snapshot_chart_request()})
            return

        if path == "/api/actions":
            q = parse_qs(parsed.query)
            try:
                limit = int((q.get("limit") or ["50"])[0])
            except Exception:
                limit = 50
            if limit < 1:
                limit = 1
            if limit > 500:
                limit = 500
            items = list(ACTIONS)[-limit:]
            self._send_json(200, {"items": items, "count": len(items)})
            return

        if path == "/":
            if self._try_serve_static(path):
                return
            self._send(200, "text/html; charset=utf-8", HTML_PAGE.encode("utf-8"))
            return

        if self._try_serve_static(path):
            return

        self._send_json(404, {"error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path

        if path == "/api/telemetry":
            try:
                data = self._read_json_body()
            except Exception as exc:
                self._send_json(400, {"ok": False, "error": str(exc)})
                return
            with STATE_LOCK:
                global LATEST_STATE
                LATEST_STATE = data
                LATEST_STATE["_receivedAt"] = now_iso()
            self._send_json(200, {"ok": True})
            return

        if path == "/api/actions":
            try:
                data = self._read_json_body()
            except Exception as exc:
                self._send_json(400, {"ok": False, "error": str(exc)})
                return

            rec, err = parse_action_payload(data)
            if err:
                self._send_json(400, {"ok": False, "error": err})
                return

            append_action_log(rec)
            self._send_json(200, {"ok": True, "id": rec["id"], "acceptedAt": rec["acceptedAt"]})
            return

        if path == "/api/chart-request":
            try:
                data = self._read_json_body()
            except Exception as exc:
                self._send_json(400, {"ok": False, "error": str(exc)})
                return

            req, err = merge_chart_request(data)
            if err:
                self._send_json(400, {"ok": False, "error": err})
                return

            self._send_json(200, {"ok": True, "request": req})
            return

        self._send_json(404, {"error": "not found"})

    def log_message(self, fmt, *args):
        return


def main():
    parser = argparse.ArgumentParser(description="MTF OsMA EMA telemetry dashboard server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--json-file",
        default="",
        help="Telemetry JSON file path (recommended: MT5 Common/Files/ea_multitf_state.json)",
    )
    parser.add_argument(
        "--prefer-file",
        action="store_true",
        help="Prefer file data over HTTP payload (useful in Strategy Tester)",
    )
    parser.add_argument(
        "--web-dist",
        default="web/dist",
        help="React build directory to serve from /",
    )
    parser.add_argument(
        "--action-log",
        default="action_log.jsonl",
        help="Path to action log JSONL file",
    )
    parser.add_argument(
        "--chart-request-file",
        default="",
        help="Path to chart request JSON file consumed by EA (defaults to MT5 Common/Files)",
    )
    args = parser.parse_args()

    global JSON_FILE_PATH
    global PREFER_FILE
    global WEB_DIST_DIR
    global ACTION_LOG_PATH
    global CHART_REQUEST_PATH
    global CHART_REQUEST_STATE

    JSON_FILE_PATH = args.json_file
    PREFER_FILE = args.prefer_file
    WEB_DIST_DIR = os.path.abspath(args.web_dist)
    ACTION_LOG_PATH = os.path.abspath(args.action_log)
    CHART_REQUEST_PATH = os.path.abspath(args.chart_request_file) if args.chart_request_file else default_chart_request_path()

    load_action_log(ACTION_LOG_PATH)
    CHART_REQUEST_STATE = load_chart_request(CHART_REQUEST_PATH)
    save_chart_request(CHART_REQUEST_PATH, CHART_REQUEST_STATE)

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"listening on http://{args.host}:{args.port}")
    print(f"json_file={os.path.abspath(JSON_FILE_PATH) if JSON_FILE_PATH else '<auto>'} prefer_file={PREFER_FILE}")
    print(f"web_dist={WEB_DIST_DIR} ({'found' if os.path.isdir(WEB_DIST_DIR) else 'missing'})")
    print(f"action_log={ACTION_LOG_PATH} loaded_actions={len(ACTIONS)}")
    print(f"chart_request_file={CHART_REQUEST_PATH} request={CHART_REQUEST_STATE}")
    server.serve_forever()


if __name__ == "__main__":
    main()
