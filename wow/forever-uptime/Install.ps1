# One-time setup, run from the folder the scripts will stay in: registers the wowforever: link the notification
# opens, and points the taskbar shortcut at Start-WoWForever.ps1 (its first version is kept beside this file).
# Run it outside the Claude app's shell: that shell's registry writes do not reach the real registry. ASCII only.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ForeverCommon.ps1')
$start = Join-Path $PSScriptRoot 'Start-WoWForever.ps1'
$ps = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$run = "-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$start`""

$key = 'HKCU:\Software\Classes\wowforever'
New-Item -Path "$key\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path $key -Name '(Default)' -Value 'URL:WoW Forever'
Set-ItemProperty -Path $key -Name 'URL Protocol' -Value ''
Set-ItemProperty -Path "$key\shell\open\command" -Name '(Default)' -Value "`"$ps`" $run -Uri `"%1`""

$backup = Join-Path $PSScriptRoot 'WoW Forever.lnk.before'
if (!(Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $script:Shortcut -Destination $backup }
$link = (New-Object -ComObject WScript.Shell).CreateShortcut($script:Shortcut)
$link.TargetPath = $ps
$link.Arguments = $run
$link.Save()
Write-Output "protocol: $((Get-ItemProperty "$key\shell\open\command").'(default)')"
Write-Output "shortcut: $($link.TargetPath) $($link.Arguments) | icon $($link.IconLocation)"
