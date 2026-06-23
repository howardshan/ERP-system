@echo off
chcp 65001 >nul 2>&1
rem ─────────────────────────────────────────────────────────────────────────
rem  ERP 标签打印助手 — Windows 一键安装
rem  双击本文件即可安装。安装后打印助手会在每次登录时自动后台静默运行。
rem  首次运行时 Windows SmartScreen 可能弹出提示 → 点「更多信息」→「仍要运行」。
rem  无需管理员权限。
rem ─────────────────────────────────────────────────────────────────────────
setlocal
set "APPDIR=%LOCALAPPDATA%\ERPPrintBridge"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SRC=%~dp0"

if not exist "%SRC%erp-print-bridge-win-x64.exe" (
  echo 错误：找不到 erp-print-bridge-win-x64.exe，请确认已完整解压安装包。
  pause
  exit /b 1
)

if not exist "%APPDIR%" mkdir "%APPDIR%"
copy /Y "%SRC%erp-print-bridge-win-x64.exe" "%APPDIR%\erp-print-bridge.exe" >nul
rem SumatraPDF 用于静默打印 PDF（与桥同目录）
if exist "%SRC%SumatraPDF.exe" copy /Y "%SRC%SumatraPDF.exe" "%APPDIR%\SumatraPDF.exe" >nul

rem 解除「来自互联网」的标记（Mark of the Web），否则隐藏启动时会被 SmartScreen 拦截
rem 报错 800704C7「操作已被用户取消」。Unblock-File 删除 Zone.Identifier 数据流即可放行。
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%APPDIR%' -Filter *.exe | Unblock-File" >nul 2>&1

rem 在「启动」文件夹放一个 VBS，登录时以隐藏窗口方式启动打印助手
> "%STARTUP%\erp-print-bridge.vbs" echo CreateObject("WScript.Shell").Run """%APPDIR%\erp-print-bridge.exe""", 0, False

rem 立即启动一次（隐藏窗口）
wscript "%STARTUP%\erp-print-bridge.vbs"

echo.
echo ✓ 打印助手已安装并启动（每次登录自动运行）。
echo   程序: %APPDIR%\erp-print-bridge.exe
echo.
echo 接下来：到「设置 - 蓝牙和设备 - 打印机和扫描仪」里把这台标签机的默认纸张设为 4x3 英寸，
echo 然后在 ERP 右上角的打印机设置里搜索并选择本机打印机即可。
echo.
pause
