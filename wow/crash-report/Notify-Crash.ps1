# The Windows notification for a WoW crash or hang report: a click opens the report. ASCII only.
param([Parameter(Mandatory)][string]$Title, [Parameter(Mandatory)][string]$Text, [Parameter(Mandatory)][string]$Open)
$ErrorActionPreference = 'Stop'

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$t = [Security.SecurityElement]::Escape($Title)
$b = [Security.SecurityElement]::Escape($Text)
$link = [Security.SecurityElement]::Escape(([Uri]$Open).AbsoluteUri)
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast scenario='reminder' activationType='protocol' launch='$link'><visual><binding template='ToastGeneric'><text>$t</text><text>$b</text></binding></visual><actions><action content='Read the report' arguments='$link' activationType='protocol'/><action content='Dismiss' arguments='dismiss' activationType='system'/></actions><audio src='ms-winsoundevent:Notification.Reminder'/></toast>")
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
Write-Output "shown: $Title / $Text"
