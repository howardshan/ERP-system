#!/usr/bin/env python3
"""
Local label-print proxy for the ERP web app.
Listens on http://127.0.0.1:6543 and forwards PNG print jobs to CUPS via `lp`.

Usage:
    python3 print_server.py              # default port 6543
    python3 print_server.py --port 7000  # custom port

Auto-start on macOS login:
    Copy the plist below to ~/Library/LaunchAgents/com.erp.printserver.plist
    then run: launchctl load ~/Library/LaunchAgents/com.erp.printserver.plist
"""

import argparse
import base64
import json
import os
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 6543

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


class PrintHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # suppress default access log spam
        print(f"[print_server] {fmt % args}")

    def _send_cors(self):
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)

    def do_OPTIONS(self):
        """Pre-flight CORS request from browser."""
        self.send_response(200)
        self._send_cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({"ok": True}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._send_cors()
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/printers":
            try:
                out = subprocess.run(["lpstat", "-e"], capture_output=True, text=True)
                names = [l.strip() for l in out.stdout.splitlines() if l.strip()]
            except Exception as e:
                names = []
                print(f"[print_server] lpstat error: {e}")
            body = json.dumps(names).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._send_cors()
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path != "/print":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", 0))
        try:
            data = json.loads(self.rfile.read(length))
        except Exception:
            self._respond(400, {"error": "invalid JSON"})
            return

        png_b64 = data.get("png", "")
        printer = data.get("printer", "").strip() or None
        media   = data.get("media", "w4h6")

        try:
            img_bytes = base64.b64decode(png_b64)
        except Exception:
            self._respond(400, {"error": "invalid base64"})
            return

        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".png")
        try:
            with os.fdopen(tmp_fd, "wb") as f:
                f.write(img_bytes)

            # Tag physical size (101 DPI matches frontend PRINT_DPI)
            subprocess.run(
                ["sips", "-s", "dpiWidth", "101", "-s", "dpiHeight", "101", tmp_path],
                capture_output=True,
            )

            cmd = [
                "lp",
                "-o", f"media={media}",
                "-o", "fit-to-page=false",
                "-o", "print-scaling=none",
            ]
            if printer:
                cmd += ["-d", printer]
            cmd.append(tmp_path)

            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                err = result.stderr.strip() or result.stdout.strip()
                print(f"[print_server] lp failed: {err}")
                self._respond(500, {"error": err})
            else:
                print(f"[print_server] sent to printer '{printer or 'default'}': {result.stdout.strip()}")
                self._respond(200, {"ok": True})
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    def _respond(self, code: int, payload: dict):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self._send_cors()
        self.end_headers()
        self.wfile.write(body)


# ──────────────────────────────────────────────────────────────────────────────
# LaunchAgent plist (copy to ~/Library/LaunchAgents/ for auto-start on login)
# ──────────────────────────────────────────────────────────────────────────────
PLIST_TEMPLATE = """\
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>com.erp.printserver</string>
  <key>ProgramArguments</key>
  <array>
    <string>{python}</string>
    <string>{script}</string>
  </array>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <true/>
  <key>StandardOutPath</key>   <string>{home}/Library/Logs/erp_print_server.log</string>
  <key>StandardErrorPath</key> <string>{home}/Library/Logs/erp_print_server.log</string>
</dict>
</plist>
"""


def print_plist():
    import sys
    home   = os.path.expanduser("~")
    script = os.path.abspath(__file__)
    python = sys.executable
    print(PLIST_TEMPLATE.format(python=python, script=script, home=home))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ERP label print proxy")
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--plist", action="store_true", help="Print LaunchAgent plist and exit")
    args = parser.parse_args()

    if args.plist:
        print_plist()
    else:
        server = HTTPServer(("127.0.0.1", args.port), PrintHandler)
        print(f"[print_server] listening on http://127.0.0.1:{args.port}")
        print(f"[print_server] endpoints: GET /health  GET /printers  POST /print")
        print(f"[print_server] auto-start plist: python3 {__file__} --plist")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n[print_server] stopped.")
