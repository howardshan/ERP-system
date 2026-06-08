#!/usr/bin/env bash
# Remove the ERP print bridge LaunchAgent.
set -euo pipefail

LABEL="com.eee.print-bridge"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"

echo "✓ Print bridge service removed. The bridge will no longer start automatically."
