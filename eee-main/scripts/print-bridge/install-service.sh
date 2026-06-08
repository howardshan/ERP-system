#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Install ERP print bridge as a macOS LaunchAgent.
# After installation the bridge starts automatically on every login and
# restarts itself if it crashes.
#
# Usage:
#   bash install-service.sh
#   PRINTER_NAME=Gprinter_GP_1324D bash install-service.sh   # pin a printer
#
# To uninstall:
#   bash uninstall-service.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

LABEL="com.eee.print-bridge"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
BRIDGE_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$HOME/Library/Logs/eee-print-bridge"

# ── Resolve node binary ──────────────────────────────────────────────────────
# Check common Homebrew locations first, then fall back to PATH.
for candidate in \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    "$(which node 2>/dev/null || true)"; do
  if [[ -x "$candidate" ]]; then
    NODE_BIN="$candidate"
    break
  fi
done

if [[ -z "${NODE_BIN:-}" ]]; then
  echo "ERROR: node not found. Install Node.js (https://nodejs.org) and retry."
  exit 1
fi

# ── Resolve printer name ─────────────────────────────────────────────────────
# Use PRINTER_NAME env var if set; otherwise try CUPS default printer.
if [[ -z "${PRINTER_NAME:-}" ]]; then
  PRINTER_NAME="$(lpstat -d 2>/dev/null | awk '{print $NF}')" || true
fi
PRINTER_NAME="${PRINTER_NAME:-}"   # may remain empty — bridge uses CUPS default

# ── Ensure dependencies are installed ───────────────────────────────────────
if [[ ! -d "$BRIDGE_DIR/node_modules" ]]; then
  echo "Installing npm dependencies…"
  (cd "$BRIDGE_DIR" && npm install --silent)
fi

# ── Create log directory ─────────────────────────────────────────────────────
mkdir -p "$LOG_DIR"

# ── Write plist ──────────────────────────────────────────────────────────────
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${BRIDGE_DIR}/server.js</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${BRIDGE_DIR}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PRINTER_NAME</key>
    <string>${PRINTER_NAME}</string>
  </dict>

  <!-- Start on login and restart after crash -->
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>

  <!-- Throttle restarts: wait 5 s before restarting on crash -->
  <key>ThrottleInterval</key>
  <integer>5</integer>

  <key>StandardOutPath</key>
  <string>${LOG_DIR}/out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/err.log</string>
</dict>
</plist>
PLIST_EOF

# ── Load (or reload) the service ─────────────────────────────────────────────
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load   "$PLIST"

echo ""
echo "✓ Print bridge installed as LaunchAgent"
echo "  Node    : $NODE_BIN"
echo "  Printer : ${PRINTER_NAME:-'(CUPS default)'}"
echo "  Plist   : $PLIST"
echo "  Logs    : $LOG_DIR/"
echo ""
echo "The bridge starts automatically on every login."
echo "To check:     launchctl list | grep print-bridge"
echo "To tail logs: tail -f \"$LOG_DIR/out.log\""
echo "To uninstall: bash \"$BRIDGE_DIR/uninstall-service.sh\""
