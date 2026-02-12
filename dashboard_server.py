#!/usr/bin/env python3
import argparse
import glob
import json
import os
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse


STATE_LOCK = threading.Lock()
LATEST_STATE = {}
JSON_FILE_PATH = None
PREFER_FILE = False


HTML_PAGE = """<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MTF OsMA EMA Telemetry</title>
  <style>
    :root {
      --bg: #f4f7fa;
      --ink: #1c2430;
      --muted: #556377;
      --card: #ffffff;
      --ok: #0b8f55;
      --bad: #b42318;
      --line: #d8e0ea;
      --accent: #0057b8;
    }
    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, sans-serif;
      background: radial-gradient(circle at 10% -20%, #dde9fb 0%, var(--bg) 45%);
      color: var(--ink);
    }
    .wrap { max-width: 1100px; margin: 20px auto; padding: 0 16px 24px; }
    .head { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; margin-bottom: 16px; }
    h1 { margin: 0 0 8px; font-size: 22px; }
    .meta { color: var(--muted); font-size: 14px; display: flex; gap: 16px; flex-wrap: wrap; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; border-bottom: 1px solid var(--line); padding: 8px 6px; }
    th { color: var(--muted); font-weight: 600; }
    td.num { font-family: ui-monospace, "Cascadia Code", monospace; }
    .up { color: var(--ok); font-weight: 600; }
    .down { color: var(--bad); font-weight: 600; }
    .pill { border-radius: 999px; padding: 2px 8px; border: 1px solid var(--line); font-size: 12px; }
    .ok { border-color: #8fd5b7; color: var(--ok); background: #ebfaf2; }
    .bad { border-color: #f3adad; color: var(--bad); background: #fff1f1; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="head">
      <h1>MTF OsMA EMA Telemetry Dashboard</h1>
      <div class="meta">
        <div id="symbol">Symbol: -</div>
        <div id="updated">Updated: -</div>
        <div id="rec">Recommendation: -</div>
      </div>
    </div>
    <div class="card">
      <table>
        <thead>
          <tr>
            <th>TF</th>
            <th>Direction</th>
            <th>Phase</th>
            <th>Stabilized</th>
            <th>EMA Score</th>
            <th>OsMA Score</th>
            <th>Cross1334 Age</th>
            <th>Cross150/200 Age</th>
            <th>Extremum1334</th>
            <th>ExtBar</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
    <div class="head" style="margin-top:16px;">
      <div class="meta">
        <div id="sig-osma">OsMA Buy/Sell: -</div>
        <div id="sig-ema">EMA Buy/Sell: -</div>
        <div id="sig-strong">Strong: -</div>
      </div>
    </div>
  </div>
  <script>
    function fmtTime(epochSeconds) {
      if (!epochSeconds) return "-";
      return new Date(epochSeconds * 1000).toLocaleString();
    }
    function clsForDir(dir) {
      if (dir === "Up") return "up";
      if (dir === "Down") return "down";
      return "";
    }
    function ynPill(v) {
      const c = v ? "ok" : "bad";
      const t = v ? "YES" : "NO";
      return `<span class="pill ${c}">${t}</span>`;
    }
    function render(state) {
      const meta = state.meta || {};
      document.getElementById("symbol").textContent = "Symbol: " + (meta.symbol || "-");
      document.getElementById("updated").textContent = "Updated: " + fmtTime(meta.updatedAt);
      document.getElementById("rec").textContent = "Recommendation: " + (meta.recommendation || "-");

      const tf = (((state.live || {}).per_tf_state) || {});
      const tfs = Object.keys(tf);
      const rows = tfs.map(name => {
        const r = tf[name] || {};
        return `<tr>
          <td>${name}</td>
          <td class="${clsForDir(r.direction)}">${r.direction || "-"}</td>
          <td>${r.phase || "-"}</td>
          <td>${ynPill(!!r.directionStabilized)}</td>
          <td class="num">${(r.ema1334AboutScore ?? 0).toFixed(4)}</td>
          <td class="num">${(r.osmaAboutScore ?? 0).toFixed(4)}</td>
          <td class="num">${r.barsAfterCross1334 ?? "-"}</td>
          <td class="num">${r.barsAfterCross150200 ?? "-"}</td>
          <td>${r.extremum1334 || "-"}</td>
          <td class="num">${(r.extremumBar1334 ?? -1) >= 0 ? r.extremumBar1334 : "-"}</td>
        </tr>`;
      }).join("");
      document.getElementById("rows").innerHTML = rows || "<tr><td colspan='10'>No telemetry yet</td></tr>";

      const sig = (state.live || {}).signals || {};
      const aligned = sig.aligned || {};
      const strong = sig.strong || {};
      document.getElementById("sig-osma").textContent = `OsMA Buy/Sell: ${aligned.osmaBuy ?? 0} / ${aligned.osmaSell ?? 0}`;
      document.getElementById("sig-ema").textContent = `EMA Buy/Sell: ${aligned.emaBuy ?? 0} / ${aligned.emaSell ?? 0}`;
      document.getElementById("sig-strong").textContent =
        `Strong: osmaBuy=${!!strong.osmaBuy} osmaSell=${!!strong.osmaSell} emaBuy=${!!strong.emaBuy} emaSell=${!!strong.emaSell}`;
    }
    async function tick() {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        render(data);
      } catch (_) {}
    }
    setInterval(tick, 1000);
    tick();
  </script>
</body>
</html>
"""


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

        # Prefer newer state.updatedAt, then newer file mtime.
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

    def do_OPTIONS(self):
        self._send(204, "text/plain; charset=utf-8", b"")

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/":
            self._send(200, "text/html; charset=utf-8", HTML_PAGE.encode("utf-8"))
            return
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
            data = json.dumps(out).encode("utf-8")
            self._send(200, "application/json; charset=utf-8", data)
            return
        self._send(404, "application/json; charset=utf-8", b'{"error":"not found"}')

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/api/telemetry":
            self._send(404, "application/json; charset=utf-8", b'{"error":"not found"}')
            return
        size = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(size)
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            msg = json.dumps({"ok": False, "error": str(exc)}).encode("utf-8")
            self._send(400, "application/json; charset=utf-8", msg)
            return
        with STATE_LOCK:
            global LATEST_STATE
            LATEST_STATE = data
            LATEST_STATE["_receivedAt"] = datetime.now(timezone.utc).isoformat()
        self._send(200, "application/json; charset=utf-8", b'{"ok":true}')

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
    args = parser.parse_args()

    global JSON_FILE_PATH
    global PREFER_FILE
    JSON_FILE_PATH = args.json_file
    PREFER_FILE = args.prefer_file

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"listening on http://{args.host}:{args.port}")
    print(f"json_file={os.path.abspath(JSON_FILE_PATH)} prefer_file={PREFER_FILE}")
    server.serve_forever()


if __name__ == "__main__":
    main()
