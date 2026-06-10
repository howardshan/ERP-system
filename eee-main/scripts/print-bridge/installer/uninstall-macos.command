#!/usr/bin/env bash
# 卸载 ERP 标签打印助手（macOS）。双击运行。
set -euo pipefail

LABEL="com.eee.print-bridge"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
APP_DIR="$HOME/Library/Application Support/ERPPrintBridge"

launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
rm -rf "$APP_DIR"

echo "✓ 打印助手已卸载，不再开机自启。"
read -r -p "按回车键关闭窗口…" _
