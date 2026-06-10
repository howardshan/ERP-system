#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ERP 标签打印助手 — macOS 一键安装
# 双击本文件即可安装。安装后打印助手会在每次登录时自动后台启动。
#
# 首次双击时 macOS 可能提示「无法验证开发者」——右键点本文件 → 打开 → 打开，
# 即可放行（本程序未做签名，属正常提示）。
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

LABEL="com.eee.print-bridge"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
APP_DIR="$HOME/Library/Application Support/ERPPrintBridge"
LOG_DIR="$HOME/Library/Logs/eee-print-bridge"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── 按 CPU 架构选择二进制 ─────────────────────────────────────────────────────
ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then
  BIN="erp-print-bridge-macos-arm64"      # Apple Silicon
else
  BIN="erp-print-bridge-macos-x64"        # Intel
fi

if [[ ! -f "$SRC_DIR/$BIN" ]]; then
  echo "错误：找不到 $BIN，请确认已完整解压安装包。"
  read -r -p "按回车键退出…" _
  exit 1
fi

# ── 安装二进制 ────────────────────────────────────────────────────────────────
mkdir -p "$APP_DIR" "$LOG_DIR"
cp "$SRC_DIR/$BIN" "$APP_DIR/erp-print-bridge"
chmod +x "$APP_DIR/erp-print-bridge"
# 去掉隔离标记，避免后台启动被 Gatekeeper 拦截
xattr -dr com.apple.quarantine "$APP_DIR/erp-print-bridge" 2>/dev/null || true

# ── 写入 LaunchAgent（开机自启 + 崩溃自动重启）────────────────────────────────
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
    <string>${APP_DIR}/erp-print-bridge</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${APP_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/err.log</string>
</dict>
</plist>
PLIST_EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load   "$PLIST"

echo ""
echo "✓ 打印助手已安装并启动（每次登录自动运行）"
echo "  程序 : $APP_DIR/erp-print-bridge"
echo "  日志 : $LOG_DIR/"
echo ""
echo "接下来：到操作系统「打印机与扫描仪」里把这台标签机的默认纸张设为 4×3 英寸，"
echo "然后在 ERP 右上角的打印机设置里搜索并选择本机打印机即可。"
echo ""
read -r -p "安装完成，按回车键关闭窗口…" _
