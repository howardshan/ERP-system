@echo off
rem 卸载 ERP 标签打印助手（Windows）。双击运行。无需管理员权限。
setlocal
set "APPDIR=%LOCALAPPDATA%\ERPPrintBridge"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

del /F /Q "%STARTUP%\erp-print-bridge.vbs" 2>nul
taskkill /IM erp-print-bridge.exe /F >nul 2>nul
rmdir /S /Q "%APPDIR%" 2>nul

echo ✓ 打印助手已卸载，不再开机自启。
pause
