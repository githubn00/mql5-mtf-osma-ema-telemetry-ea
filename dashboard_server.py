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

        if (
            best_state is None
            or updated_at > best_updated_at
            or (updated_at == best_updated_at and mtime > best_mtime)
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

        if (dist / "index.html").is_file() and path not in {"/api/state", "/api/telemetry", "/api/actions"}:
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
            self._send_json(200, out)
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
    args = parser.parse_args()

    global JSON_FILE_PATH
    global PREFER_FILE
    global WEB_DIST_DIR
    global ACTION_LOG_PATH

    JSON_FILE_PATH = args.json_file
    PREFER_FILE = args.prefer_file
    WEB_DIST_DIR = os.path.abspath(args.web_dist)
    ACTION_LOG_PATH = os.path.abspath(args.action_log)

    load_action_log(ACTION_LOG_PATH)

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"listening on http://{args.host}:{args.port}")
    print(f"json_file={os.path.abspath(JSON_FILE_PATH) if JSON_FILE_PATH else '<auto>'} prefer_file={PREFER_FILE}")
    print(f"web_dist={WEB_DIST_DIR} ({'found' if os.path.isdir(WEB_DIST_DIR) else 'missing'})")
    print(f"action_log={ACTION_LOG_PATH} loaded_actions={len(ACTIONS)}")
    server.serve_forever()


if __name__ == "__main__":
    main()
