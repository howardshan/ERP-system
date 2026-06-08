#!/usr/bin/env powershell
# Remove the ERP print bridge Scheduled Task.

$TaskName = 'eee-print-bridge'

Stop-ScheduledTask      -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Write-Host "OK  Print bridge task removed. The bridge will no longer start automatically."
