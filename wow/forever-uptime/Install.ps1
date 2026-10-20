# One-time setup, run from the folder the scripts will stay in: registers the wowforever: link the notification
# opens, and points the taskbar shortcut and its Start menu copy at Start-WoWForever.ps1 (the first version of the
# taskbar one is kept beside this file).
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

Write-Output "protocol: $((Get-ItemProperty "$key\shell\open\command").'(default)')"

$backup = Join-Path $PSScriptRoot 'WoW Forever.lnk.before'
if (!(Test-Path -LiteralPath $backup) -and (Test-Path -LiteralPath $script:Shortcut)) {
    Copy-Item -LiteralPath $script:Shortcut -Destination $backup
}
# The same shortcut in the Start menu is the copy to pin again from (Start, "WoW Forever", right-click, Pin to taskbar)
# when the taskbar pin is lost, as it was on 2026-10-19. Windows lets no script pin, so that step stays by hand, and a
# lost pin is only reported here: a .lnk written into the pinned folder does not put it back on the taskbar.
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\WoW Forever.lnk'
foreach ($path in @($script:Shortcut, $startMenu)) {
    if ($path -eq $script:Shortcut -and !(Test-Path -LiteralPath $path)) {
        Write-Output "shortcut: not pinned ($path missing): pin it from the Start menu"
        continue
    }
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut($path)
    $link.TargetPath = $ps
    $link.Arguments = $run
    $link.WorkingDirectory = $PSScriptRoot
    if (!$link.IconLocation -or $link.IconLocation -eq ',0') { $link.IconLocation = "$script:GameExe,0" }
    $link.Description = 'Launch WoW Forever through Steam with a Windows-encrypted saved login'
    $link.WindowStyle = 7
    $link.Save()
    Write-Output "shortcut: $path -> $($link.TargetPath) $($link.Arguments) | icon $($link.IconLocation)"
}
