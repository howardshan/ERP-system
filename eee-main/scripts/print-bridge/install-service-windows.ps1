# ─────────────────────────────────────────────────────────────────────────────
# Install ERP print bridge as a Windows Task Scheduler task.
# Runs at every login, restarts automatically on failure.
#
# Usage (run as Administrator):
#   powershell -ExecutionPolicy Bypass -File install-service-windows.ps1
#   $env:PRINTER_NAME="Gprinter_GP_1324D"; powershell -ExecutionPolicy Bypass -File install-service-windows.ps1
#
# To uninstall:
#   powershell -ExecutionPolicy Bypass -File uninstall-service-windows.ps1
# ─────────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = 'Stop'
$TaskName  = 'eee-print-bridge'
$BridgeDir = $PSScriptRoot

# ── Resolve node binary ──────────────────────────────────────────────────────
try {
    $NodeBin = (Get-Command node -ErrorAction Stop).Source
} catch {
    Write-Error "ERROR: node not found. Install Node.js (https://nodejs.org) and retry."
    exit 1
}

# ── Resolve printer name ─────────────────────────────────────────────────────
$PrinterName = if ($env:PRINTER_NAME) { $env:PRINTER_NAME } else { '' }

# ── Ensure dependencies are installed ───────────────────────────────────────
if (-not (Test-Path "$BridgeDir\node_modules")) {
    Write-Host "Installing npm dependencies..."
    Push-Location $BridgeDir
    npm install --silent
    Pop-Location
}

# ── Create log directory ─────────────────────────────────────────────────────
$LogDir = "$env:APPDATA\eee-print-bridge\logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# ── Build the scheduled task ─────────────────────────────────────────────────
$EnvBlock = if ($PrinterName) { "PRINTER_NAME=$PrinterName; " } else { '' }
$CmdLine  = "$EnvBlock`"$NodeBin`" `"$BridgeDir\server.js`""

$Action   = New-ScheduledTaskAction `
    -Execute    'cmd.exe' `
    -Argument   "/c `"$CmdLine >> `"$LogDir\out.log`" 2>> `"$LogDir\err.log`"`"" `
    -WorkingDirectory $BridgeDir

$Trigger  = New-ScheduledTaskTrigger -AtLogOn

$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit  (New-TimeSpan -Days 3650) `
    -RestartCount        10 `
    -RestartInterval     (New-TimeSpan -Minutes 1) `
    -MultipleInstances   IgnoreNew

# Remove old task if present
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName  $TaskName `
    -Action    $Action `
    -Trigger   $Trigger `
    -Settings  $Settings `
    -RunLevel  Highest `
    -Force | Out-Null

# ── Start it now ─────────────────────────────────────────────────────────────
Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "OK  Print bridge installed as Scheduled Task"
Write-Host "    Node    : $NodeBin"
Write-Host "    Printer : $(if ($PrinterName) { $PrinterName } else { '(system default)' })"
Write-Host "    Logs    : $LogDir\"
Write-Host ""
Write-Host "The bridge starts automatically on every login."
Write-Host "To check:     Get-ScheduledTask -TaskName eee-print-bridge"
Write-Host "To tail logs: Get-Content `"$LogDir\out.log`" -Wait"
Write-Host "To uninstall: powershell -ExecutionPolicy Bypass -File `"$BridgeDir\uninstall-service-windows.ps1`""
