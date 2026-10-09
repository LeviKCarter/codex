# Registers (or replaces) the scheduled task that keeps answer_lookups.py running, then starts it.
# The script watches for ever, so the task has no time limit; it is started at logon and looked at again
# every 10 minutes, and a start while it is running is ignored, so there is only ever one.
# Run it again after answer_lookups.py changes: the running copy is stopped and the new one started.
param(
    [string]$Script = "C:\Users\levik\Documents\Codex\wow\afp-lookup\answer_lookups.py",
    [string]$TaskName = "WoW Item Lookup Answers"
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path $Script)) { throw "Not found: $Script" }
$runner = "C:\Users\levik\Documents\Codex\PulseAgent\run_logged.vbs"
if (-not (Test-Path $runner)) { throw "Not found: $runner" }

$action = New-ScheduledTaskAction -Execute "C:\Windows\System32\wscript.exe" -Argument "`"$runner`" afp-lookup `"$Script`""
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$again = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 10)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName
    # Stopping the task ends wscript, not the Python it started.
    Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" |
        Where-Object { $_.CommandLine -like "*answer_lookups.py*" -and $_.CommandLine -notlike "*--once*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $logon, $again -Settings $settings `
    -Principal $principal -Force -Description "Answers the item lookups asked for in WoW (Ctrl + right-click): reads Wowhead, Claude writes the line, ItemNotes.lua gets it." | Out-Null
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State
