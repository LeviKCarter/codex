# The Windows notification for a WoW crash or hang report: a click opens the report. ASCII only.
param([Parameter(Mandatory)][string]$Title, [Parameter(Mandatory)][string]$Text, [Parameter(Mandatory)][string]$Open)
$ErrorActionPreference = 'Stop'

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$t = [Security.SecurityElement]::Escape($Title)
$b = [Security.SecurityElement]::Escape($Text)
$link = [Security.SecurityElement]::Escape(([Uri]$Open).AbsoluteUri)
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
# Short and dismissing itself (Levi, 2026-10-20: "auto-dismiss itself"): no 'reminder' scenario, which kept it on screen
# until a button was pressed. It slides away after a few seconds, waits in the notification center for a day, then goes.
$xml.LoadXml("<toast duration='short' activationType='protocol' launch='$link'><visual><binding template='ToastGeneric'><text>$t</text><text>$b</text></binding></visual><actions><action content='Read the report' arguments='$link' activationType='protocol'/></actions></toast>")
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
$toast.ExpirationTime = [DateTimeOffset]::Now.AddDays(1)
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
Write-Output "shown: $Title / $Text"
