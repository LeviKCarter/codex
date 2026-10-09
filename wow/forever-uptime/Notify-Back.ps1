# Run when the WoW Forever beta is back: a Windows notification that starts the game when clicked, a red dot on
# the taskbar shortcut, and Battle.net opened if the game needs an update. ASCII only.
param([string]$Text = '', [switch]$Test)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ForeverCommon.ps1')

$have = Get-InstalledBuild
$want = Get-CurrentBuild
$stale = $want -and $want.Key -ne $have.Key
if (!$Text) {
    $Text = if ($stale) { "Updating to $($want.Version) now. Click to start the game when the update is done." } else { 'Your game is up to date. Click to start it.' }
}
$link = if ($Test) { 'wowforever://check' } else { 'wowforever://launch' }
$title = if ($Test) { 'WoW Forever watch (test)' } else { 'WoW Forever is back up' }

if (!$Test) {
    if ($stale) { Start-BattleNet }
    try { Set-ShortcutDot $true } catch { Write-Output "dot failed: $($_.Exception.Message)" }
}

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$t = [Security.SecurityElement]::Escape($title)
$b = [Security.SecurityElement]::Escape($Text)
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast scenario='reminder' activationType='protocol' launch='$link'><visual><binding template='ToastGeneric'><text>$t</text><text>$b</text></binding></visual><actions><action content='Play' arguments='$link' activationType='protocol'/><action content='Dismiss' arguments='dismiss' activationType='system'/></actions><audio src='ms-winsoundevent:Notification.Reminder'/></toast>")
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
Write-Output "shown: $title / $Text (stale=$stale)"
