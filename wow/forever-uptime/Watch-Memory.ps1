# While WoW Forever is open, warns before Windows runs out of memory to hand out. Start-WoWForever.ps1 only checks
# before the game starts; on 2026-10-17 the Claude app grew to 19.5 GB over a day, and memory that runs out while
# the game is open crashes it ("ERROR #8 Out of Memory"). Below $WarnFreeGB free: a Windows notification naming the
# biggest program other than the game, at most once every $WarnEveryMinutes minutes. It stays until there is room
# again or the game closes, then goes by itself (nothing to dismiss with the controller). Silent while the game is
# closed. Run by the scheduled task "WoW Forever Memory Watch" (register_memory_watch_task.ps1).
# -Once: one check, print what it did. -WarnBelowGB: another limit (to see the real notification). ASCII only.
param([switch]$Once, [double]$WarnBelowGB = 0)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ForeverCommon.ps1')
if ($WarnBelowGB -le 0) { $WarnBelowGB = $script:WarnFreeGB }
$checkSeconds = 30
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
# Tests: the warning time and the notification are files in the test folder, and nothing is shown.
if ($script:TestDir) {
    $warnedFile = Join-Path $script:TestDir 'memory-warned.txt'
    $saidFile = Join-Path $script:TestDir 'said-memory-warning.txt'
    $logFile = $null
} else {
    $warnedFile = Join-Path $env:LOCALAPPDATA 'PulseAgent\wow-forever-memory-warned.txt'
    $saidFile = $null
    $logFile = Join-Path $env:LOCALAPPDATA 'PulseAgent\logs\wow-forever-memory.log'
}
$script:ToastUp = $false

function Write-Log($text) {
    $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $text
    if (!$logFile) { Write-Output $line; return }
    try {
        New-Item -ItemType Directory -Path (Split-Path $logFile) -Force | Out-Null
        if ((Test-Path -LiteralPath $logFile) -and (Get-Item -LiteralPath $logFile).Length -gt 1MB) { Move-Item -LiteralPath $logFile -Destination "$logFile.1" -Force }
        Add-Content -LiteralPath $logFile -Value $line
    } catch { }
}

# "the Claude app (19.5 GB)": the program to restart, never the game itself.
function Get-Culprit($mem) {
    $top = $mem.Top | Where-Object { $_.Name -ne 'WowB' } | Select-Object -First 1
    if (!$top) { return $null }
    $name = if ($top.Name -eq 'claude') { 'the Claude app' } else { $top.Name }
    return '{0} ({1:N1} GB)' -f $name, $top.GB
}

function Show-Warning($title, $text) {
    if ($saidFile) { Add-Content -LiteralPath $saidFile -Value "$title / $text"; return }
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
    $t = [Security.SecurityElement]::Escape($title)
    $b = [Security.SecurityElement]::Escape($text)
    # A reminder gets through the "do not disturb while playing a game" rule, and stays until it is taken back.
    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml("<toast scenario='reminder'><visual><binding template='ToastGeneric'><text>$t</text><text>$b</text></binding></visual><actions><action content='Dismiss' arguments='dismiss' activationType='system'/></actions><audio src='ms-winsoundevent:Notification.Reminder'/></toast>")
    $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
    $toast.Tag = 'memory'
    $toast.Group = 'wowforever'
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
    $script:ToastUp = $true
}

# Takes the warning back once it no longer holds.
function Clear-Warning {
    if ($saidFile) { Remove-Item -LiteralPath $saidFile -ErrorAction SilentlyContinue; return }
    if (!$script:ToastUp) { return }
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.UI.Notifications.ToastNotificationManager]::History.Remove('memory', 'wowforever', $appId)
    $script:ToastUp = $false
}

# One check: 'no game', 'not read', 'ok', 'warned already' or 'warned: <text>'.
function Invoke-MemoryCheck {
    if (!(Test-GameRunning)) { Clear-Warning; return 'no game' }
    $mem = $null
    try { $mem = Get-MemoryState } catch { }
    if (!$mem) { return 'not read' }
    if ($mem.FreeGB -ge $WarnBelowGB) {
        # 1 GB of slack so a reading that wobbles around the limit does not flash the warning on and off.
        if ($mem.FreeGB -ge $WarnBelowGB + 1) { Clear-Warning }
        return 'ok'
    }
    if (Test-Path -LiteralPath $warnedFile) {
        $last = [DateTime]::Parse((Get-Content -LiteralPath $warnedFile -Raw).Trim(), $null, 'RoundtripKind')
        if (([DateTime]::UtcNow - $last).TotalMinutes -lt $script:WarnEveryMinutes) { return 'warned already' }
    }
    $culprit = Get-Culprit $mem
    $restart = if ($culprit) { "Restart $culprit now, before the game runs out and crashes." } else { 'Close something big now, before the game runs out and crashes.' }
    $text = "Only {0:N1} GB of memory left. {1} Biggest: {2}." -f $mem.FreeGB, $restart, (Format-MemoryTop $mem)
    Show-Warning 'WoW Forever: memory almost gone' $text
    New-Item -ItemType Directory -Path (Split-Path $warnedFile) -Force | Out-Null
    Set-Content -LiteralPath $warnedFile -Value ([DateTime]::UtcNow.ToString('o'))
    return "warned: $text"
}

# Also keeps each session's taint log (ForeverCommon.ps1, Copy-LiveTaintLog): every $copySeconds while the game is
# open, so a /reload, which empties the log, loses at most that much of it.
$copySeconds = 2
$taintState = @{}
function Invoke-TaintCopy {
    if (Test-GameRunning) { try { Copy-LiveTaintLog $taintState } catch { } }
}

if ($Once) { Invoke-TaintCopy; Write-Output (Invoke-MemoryCheck); return }

Write-Log "watching memory while WowB is open: warn below $WarnBelowGB GB, at most every $script:WarnEveryMinutes minutes"
$was = ''
$waited = $checkSeconds
while ($true) {
    Invoke-TaintCopy
    if ($waited -ge $checkSeconds) {
        $waited = 0
        try {
            $now = Invoke-MemoryCheck
            if ($now -like 'warned:*' -or ($now -ne $was -and $now -ne 'warned already')) { Write-Log $now }
            $was = $now
        } catch { Write-Log "check failed: $($_.Exception.Message)" }
    }
    Start-Sleep -Seconds $copySeconds
    $waited += $copySeconds
}
