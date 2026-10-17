# Registers (or replaces) the scheduled task that keeps Watch-Memory.ps1 running, then starts it. ASCII only.
# Its own task rather than part of watch_beta.py: the memory reading and the notification are PowerShell
# (ForeverCommon.ps1), and the forum watch going wrong must not stop this one, or the other way round.
# The script watches for ever, so the task has no time limit; it is started at logon and looked at again every
# 10 minutes, and a start while it is running is ignored, so there is only ever one. conhost --headless runs it
# with no window at all. Run it again after Watch-Memory.ps1 changes: the running copy is stopped, the new one started.
param(
    [string]$Script = "C:\Users\levik\Documents\Codex\wow\forever-uptime\Watch-Memory.ps1",
    [string]$TaskName = "WoW Forever Memory Watch"
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path $Script)) { throw "Not found: $Script" }
$ps = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"

$action = New-ScheduledTaskAction -Execute "C:\Windows\System32\conhost.exe" -Argument "--headless `"$ps`" -NoProfile -ExecutionPolicy Bypass -File `"$Script`""
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$again = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 10)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName
}
# Stopping the task ends conhost, not always the PowerShell it started.
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object { $_.CommandLine -like "*forever-uptime*Watch-Memory.ps1*" -and $_.CommandLine -notlike "*-Once*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $logon, $again -Settings $settings `
    -Principal $principal -Force -Description "While WoW Forever (WowB.exe) is open, a Windows notification when free memory drops below 5 GB, naming the program to restart before the game crashes out of memory. Watch-Memory.ps1." | Out-Null
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State
