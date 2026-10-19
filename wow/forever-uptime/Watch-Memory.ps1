# While WoW Forever is open, keeps Windows from running out of memory to hand out. Start-WoWForever.ps1 only checks
# before the game starts; on 2026-10-17 the Claude app grew to 19.5 GB over a day, and memory that runs out while
# the game is open crashes it ("ERROR #8 Out of Memory").
# Below $WarnFreeGB free it asks for the archiver, quietly, at most once every $WarnEveryMinutes minutes: it writes
# $archiveFile, and the Claude app's scheduled task "archive-on-low-memory" (every 10 minutes) runs /archive-finished
# when the file is there and deletes it. Only the app can archive sessions (its session tools exist nowhere else), and
# each finished session still open holds ~0.55 GB.
# Below $ToastFreeGB free, where the game is close to crashing, a Windows notification also names the biggest program
# other than the game: once per low spell, again only if another $ToastWorseGB GB is gone. It takes itself off the
# screen after $ToastSeconds and out of the list once there is room again or the game closes (nothing to dismiss with
# the controller). Silent while the game is closed. Run by the scheduled task "WoW Forever Memory Watch"
# (register_memory_watch_task.ps1); it stops when this file or ForeverCommon.ps1 changes, and the task starts the new
# one within 10 minutes.
# -Once: one check, print what it did. -WarnBelowGB / -ToastBelowGB: other limits (to see the real notification).
# ASCII only.
param([switch]$Once, [double]$WarnBelowGB = 0, [double]$ToastBelowGB = 0)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ForeverCommon.ps1')
if ($WarnBelowGB -le 0) { $WarnBelowGB = $script:WarnFreeGB }
if ($ToastBelowGB -le 0) { $ToastBelowGB = $script:ToastFreeGB }
$checkSeconds = 30
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
# Tests: the archive time, the notification and what it was shown at are files in the test folder, and nothing is shown.
if ($script:TestDir) {
    $warnedFile = Join-Path $script:TestDir 'memory-warned.txt'
    $toastFile = Join-Path $script:TestDir 'memory-toasted.txt'
    $saidFile = Join-Path $script:TestDir 'said-memory-warning.txt'
    $archiveFile = Join-Path $script:TestDir 'archive-requested.txt'
    $logFile = $null
} else {
    $warnedFile = Join-Path $env:LOCALAPPDATA 'PulseAgent\wow-forever-memory-warned.txt'
    $toastFile = Join-Path $env:LOCALAPPDATA 'PulseAgent\wow-forever-memory-toasted.txt'
    $saidFile = $null
    $archiveFile = Join-Path $env:LOCALAPPDATA 'PulseAgent\wow-forever-archive-requested.txt'
    $logFile = Join-Path $env:LOCALAPPDATA 'PulseAgent\logs\wow-forever-memory.log'
}
$script:Toast = $null
$script:ToastShown = [DateTime]::MinValue

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
    # A reminder gets through the "do not disturb while playing a game" rule (it needs a button to count as one), here
    # with no sound; Hide-Warning takes it off the screen after $ToastSeconds, so the button never has to be pressed.
    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml("<toast scenario='reminder'><visual><binding template='ToastGeneric'><text>$t</text><text>$b</text></binding></visual><actions><action content='OK' arguments='dismiss' activationType='system'/></actions><audio silent='true'/></toast>")
    $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
    $toast.Tag = 'memory'
    $toast.Group = 'wowforever'
    # Out of the notification list by itself too, should this watch stop before it takes it back.
    $toast.ExpirationTime = [DateTimeOffset]::Now.AddMinutes(30)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
    $script:Toast = $toast
    $script:ToastShown = [DateTime]::UtcNow
}

# Off the screen, still in the notification list.
function Hide-Warning {
    if (!$script:Toast) { return }
    try { [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Hide($script:Toast) } catch { }
    $script:Toast = $null
}

# Room again or the game closed: the notification goes from the list too, and the next low spell starts afresh.
function Clear-Warning {
    $shown = $script:Toast -or (Test-Path -LiteralPath $toastFile)
    Remove-Item -LiteralPath $toastFile -ErrorAction SilentlyContinue
    if ($saidFile) { Remove-Item -LiteralPath $saidFile -ErrorAction SilentlyContinue; return }
    if (!$shown) { return }
    Hide-Warning
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.UI.Notifications.ToastNotificationManager]::History.Remove('memory', 'wowforever', $appId)
    } catch { }
}

# Asks the Claude app for the archiver unless it was asked within $WarnEveryMinutes; $true when it asked now.
function Request-Archive($mem) {
    if (Test-Path -LiteralPath $warnedFile) {
        $last = [DateTime]::Parse((Get-Content -LiteralPath $warnedFile -Raw).Trim(), $null, 'RoundtripKind')
        if (([DateTime]::UtcNow - $last).TotalMinutes -lt $script:WarnEveryMinutes) { return $false }
    }
    New-Item -ItemType Directory -Path (Split-Path $warnedFile) -Force | Out-Null
    Set-Content -LiteralPath $warnedFile -Value ([DateTime]::UtcNow.ToString('o'))
    New-Item -ItemType Directory -Path (Split-Path $archiveFile) -Force | Out-Null
    Set-Content -LiteralPath $archiveFile -Value ('{0} {1:N1} GB free' -f [DateTime]::UtcNow.ToString('o'), $mem.FreeGB)
    return $true
}

# One check: 'no game', 'not read', 'ok', 'archiving: <n> GB free', 'low', 'warned already' or 'warned: <text>'.
function Invoke-MemoryCheck {
    if (!(Test-GameRunning)) { Clear-Warning; return 'no game' }
    $mem = $null
    try { $mem = Get-MemoryState } catch { }
    if (!$mem) { return 'not read' }
    if ($mem.FreeGB -ge $WarnBelowGB) {
        # 1 GB of slack so a reading that wobbles around the limit does not start a new low spell each time.
        if ($mem.FreeGB -ge $WarnBelowGB + 1) { Clear-Warning }
        return 'ok'
    }
    $archiving = Request-Archive $mem
    $quiet = if ($archiving) { 'archiving: {0:N1} GB free' -f $mem.FreeGB } else { 'low' }
    if ($mem.FreeGB -ge $ToastBelowGB) { return $quiet }
    if (Test-Path -LiteralPath $toastFile) {
        $lastGB = [double]::Parse((Get-Content -LiteralPath $toastFile -Raw).Trim(), [Globalization.CultureInfo]::InvariantCulture)
        if ($mem.FreeGB -gt $lastGB - $script:ToastWorseGB) { if ($archiving) { return $quiet } else { return 'warned already' } }
    }
    $culprit = Get-Culprit $mem
    $restart = if ($culprit) { "If that is not enough, restart $culprit before the game runs out and crashes." } else { 'If that is not enough, close something big before the game runs out and crashes.' }
    $text = "Only {0:N1} GB of memory left. Finished Claude sessions are being archived. {1} Biggest: {2}." -f $mem.FreeGB, $restart, (Format-MemoryTop $mem)
    Show-Warning 'WoW Forever: memory almost gone' $text
    New-Item -ItemType Directory -Path (Split-Path $toastFile) -Force | Out-Null
    Set-Content -LiteralPath $toastFile -Value $mem.FreeGB.ToString([Globalization.CultureInfo]::InvariantCulture)
    return "warned: $text"
}

# Also keeps each session's taint log (ForeverCommon.ps1, Copy-LiveTaintLog): every $copySeconds while the game is
# open, so a /reload, which empties the log, loses at most that much of it.
$copySeconds = 2
$taintState = @{}
function Invoke-TaintCopy {
    if (Test-GameRunning) { try { Copy-LiveTaintLog $taintState } catch { } }
}

if ($Once) {
    Invoke-TaintCopy
    Write-Output (Invoke-MemoryCheck)
    if ($script:Toast) { Start-Sleep -Seconds $script:ToastSeconds; Hide-Warning }
    return
}

# This file and ForeverCommon.ps1 as they were at the start: a change stops this copy so the task starts the new one.
$sources = @($PSCommandPath, (Join-Path $PSScriptRoot 'ForeverCommon.ps1'))
function Get-SourceStamp { return (($sources | ForEach-Object { (Get-Item -LiteralPath $_).LastWriteTimeUtc.Ticks }) -join ',') }
$stamp = Get-SourceStamp

Write-Log "watching memory while WowB is open: archiver below $WarnBelowGB GB (at most every $script:WarnEveryMinutes minutes), notification below $ToastBelowGB GB"
$was = ''
$waited = $checkSeconds
while ($true) {
    Invoke-TaintCopy
    if ($script:Toast -and ([DateTime]::UtcNow - $script:ToastShown).TotalSeconds -ge $script:ToastSeconds) { Hide-Warning }
    if ($waited -ge $checkSeconds) {
        $waited = 0
        try {
            if ((Get-SourceStamp) -ne $stamp) { Write-Log 'the script changed: stopping so the scheduled task starts the new one'; Hide-Warning; return }
            $now = Invoke-MemoryCheck
            if ($now -like 'warned:*' -or $now -like 'archiving:*' -or ($now -ne $was -and $now -ne 'warned already' -and $now -ne 'low')) { Write-Log $now }
            $was = $now
        } catch { Write-Log "check failed: $($_.Exception.Message)" }
    }
    Start-Sleep -Seconds $copySeconds
    $waited += $copySeconds
}
