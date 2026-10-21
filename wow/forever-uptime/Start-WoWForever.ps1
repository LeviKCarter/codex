# What the taskbar shortcut and the "back up" notification run: take the red dot off, make sure the game is on
# Blizzard's current build (wait for Battle.net to finish, or say the game is out of date), wait for enough free
# memory and for a running patch-day addon check (..\patch-day), let CurseForge update the addons it manages and close
# it again (Update-CurseForgeAddons.ps1), keep the last session's
# taint log, take addons' hooks off Blizzard's frame methods, let Claude fix any new addon code that breaks the
# controller (..\addon-guard), then start the game through the Steam launcher.
# ASCII only.
param([string]$Uri = '', [switch]$Check)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ForeverCommon.ps1')
$launcher = $script:Launcher
$giveUpAfter = if ($env:WOWFOREVER_GIVE_UP) { [int]$env:WOWFOREVER_GIVE_UP } else { 180 }   # seconds with no update started before the window says "out of date"

# -Check, or the notification link wowforever://check: report and start nothing.
if ($Check -or $Uri -match '^wowforever:/*check') {
    $have = Get-InstalledBuild
    $want = Get-CurrentBuild
    $state = if (!$want) { 'UNKNOWN' } elseif ($want.Key -eq $have.Key) { 'CURRENT' } else { 'OUT OF DATE' }
    $mem = Get-MemoryState
    $memText = if ($mem) { '{0:N1} GB free ({1} needed; biggest {2})' -f $mem.FreeGB, $script:MinFreeGB, (Format-MemoryTop $mem) } else { 'not read' }
    $line = "{0}: installed {1}, Blizzard has {2}; launcher {3}; uri '{4}'; memory {5}" -f $state, $have.Version, $(if ($want) { $want.Version } else { 'no answer' }), $(if (Test-Path -LiteralPath $launcher) { 'found' } else { 'MISSING' }), $Uri, $memText
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'last-check.txt'), $line)
    Write-Output $line
    return
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
try { Set-ShortcutDot $false } catch { }

# $true = start the game, $false = he closed the window.
function Wait-ForUpdate($have, $want) {
    Start-BattleNet
    $form = New-Object Windows.Forms.Form
    $form.Text = 'WoW Forever'
    $form.ClientSize = New-Object Drawing.Size(470, 150)
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.TopMost = $true
    $form.Font = New-Object Drawing.Font('Segoe UI', 10)
    $label = New-Object Windows.Forms.Label
    $label.SetBounds(18, 15, 434, 80)
    $label.Text = "Updating: you have $($have.Version), Blizzard has $($want.Version).`nBattle.net is doing the update. The game starts when it is finished."
    $anyway = New-Object Windows.Forms.Button
    $anyway.Text = 'Launch anyway'
    $anyway.SetBounds(197, 105, 135, 32)
    $anyway.DialogResult = [Windows.Forms.DialogResult]::Yes
    $cancel = New-Object Windows.Forms.Button
    $cancel.Text = 'Cancel'
    $cancel.SetBounds(342, 105, 110, 32)
    $cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
    $form.Controls.AddRange(@($label, $anyway, $cancel))
    $form.CancelButton = $cancel
    $started = [DateTime]::UtcNow
    $timer = New-Object Windows.Forms.Timer
    $timer.Interval = 3000
    $timer.Add_Tick({
        $now = $null
        try { $now = Get-InstalledBuild } catch { }
        $latest = Get-CurrentBuild
        if ($now -and $latest -and $now.Key -eq $latest.Key) {
            $form.DialogResult = [Windows.Forms.DialogResult]::OK
            $form.Close()
        } elseif (([DateTime]::UtcNow - $started).TotalSeconds -gt $giveUpAfter -and $now -and $now.Key -eq $have.Key) {
            if ($script:TestDir) { Set-Content -LiteralPath (Join-Path $script:TestDir 'said-out-of-date.txt') -Value $form.Visible }
            $label.Text = "Game out of date: you have $($have.Version), Blizzard has $($want.Version).`nBattle.net has not updated it. Press Update in Battle.net; the game starts here when it is finished."
        }
    })
    try {
        $timer.Start()
        $answer = $form.ShowDialog()
    } finally {
        $timer.Dispose()
        $form.Dispose()
    }
    return $answer -ne [Windows.Forms.DialogResult]::Cancel
}

# Too little memory left: the game would crash out of memory soon after it starts. Says who holds the most and
# starts the game by itself once there is room. $true = start the game, $false = he closed the window.
function Wait-ForMemory($mem) {
    $form = New-Object Windows.Forms.Form
    $form.Text = 'WoW Forever'
    $form.ClientSize = New-Object Drawing.Size(470, 170)
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.TopMost = $true
    $form.Font = New-Object Drawing.Font('Segoe UI', 10)
    $label = New-Object Windows.Forms.Label
    $label.SetBounds(18, 15, 434, 100)
    $say = {
        param($m)
        $label.Text = "Low memory: {0:N1} GB free, the game needs {1} GB or it crashes.`nBiggest: {2}.`nRestart the biggest one; the game starts here when there is room." -f $m.FreeGB, $script:MinFreeGB, (Format-MemoryTop $m)
        if ($script:TestDir) { Set-Content -LiteralPath (Join-Path $script:TestDir 'said-low-memory.txt') -Value $label.Text }
    }
    & $say $mem
    $anyway = New-Object Windows.Forms.Button
    $anyway.Text = 'Launch anyway'
    $anyway.SetBounds(197, 125, 135, 32)
    $anyway.DialogResult = [Windows.Forms.DialogResult]::Yes
    $cancel = New-Object Windows.Forms.Button
    $cancel.Text = 'Cancel'
    $cancel.SetBounds(342, 125, 110, 32)
    $cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
    $form.Controls.AddRange(@($label, $anyway, $cancel))
    $form.CancelButton = $cancel
    $timer = New-Object Windows.Forms.Timer
    $timer.Interval = 3000
    $timer.Add_Tick({
        $now = $null
        try { $now = Get-MemoryState } catch { }
        if (!$now) { return }
        if ($now.FreeGB -ge $script:MinFreeGB) {
            $form.DialogResult = [Windows.Forms.DialogResult]::OK
            $form.Close()
        } else { & $say $now }
    })
    try {
        $timer.Start()
        $answer = $form.ShowDialog()
    } finally {
        $timer.Dispose()
        $form.Dispose()
    }
    return $answer -ne [Windows.Forms.DialogResult]::Cancel
}

# A patch check is running (..\patch-day): says so and starts the game by itself once it is done.
# $true = start the game, $false = he closed the window.
function Wait-ForPatchCheck($patch) {
    $form = New-Object Windows.Forms.Form
    $form.Text = 'WoW Forever'
    $form.ClientSize = New-Object Drawing.Size(470, 150)
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.TopMost = $true
    $form.Font = New-Object Drawing.Font('Segoe UI', 10)
    $label = New-Object Windows.Forms.Label
    $label.SetBounds(18, 15, 434, 80)
    $what = if ($patch.Label -like 'addons:*') { "what an addon update broke ($($patch.Label.Substring(7).Trim()))" } else { "your addons for patch $($patch.Label)" }
    $label.Text = "Claude is fixing $what (started {0:h:mm tt}).`nThe game starts when it is done, so the fixes load with it." -f $patch.Started
    if ($script:TestDir) { Set-Content -LiteralPath (Join-Path $script:TestDir 'said-patch-check.txt') -Value $label.Text }
    $anyway = New-Object Windows.Forms.Button
    $anyway.Text = 'Launch anyway'
    $anyway.SetBounds(197, 105, 135, 32)
    $anyway.DialogResult = [Windows.Forms.DialogResult]::Yes
    $cancel = New-Object Windows.Forms.Button
    $cancel.Text = 'Cancel'
    $cancel.SetBounds(342, 105, 110, 32)
    $cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
    $form.Controls.AddRange(@($label, $anyway, $cancel))
    $form.CancelButton = $cancel
    $timer = New-Object Windows.Forms.Timer
    $timer.Interval = 3000
    $timer.Add_Tick({
        $now = $patch
        try { $now = Get-PatchCheck } catch { }
        if (!$now) {
            $form.DialogResult = [Windows.Forms.DialogResult]::OK
            $form.Close()
        }
    })
    try {
        $timer.Start()
        $answer = $form.ShowDialog()
    } finally {
        $timer.Dispose()
        $form.Dispose()
    }
    return $answer -ne [Windows.Forms.DialogResult]::Cancel
}

# Updates the addons CurseForge manages (Update-CurseForgeAddons.ps1, which closes CurseForge when done) while a small
# window says so; it closes by itself, and opens minimized when he left it minimized last time. $null = start the game, else a short note on why the addons were not updated
# ($false = he pressed Cancel). Too slow: the updater and CurseForge are stopped and the game starts anyway.
function Wait-ForCurseForge {
    $result = Join-Path ([IO.Path]::GetTempPath()) ('wowforever-curseforge-{0}.txt' -f [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $argLine = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -TimeoutSec {1} -ResultPath "{2}"' -f $script:CurseForgeUpdater, $script:CurseForgeTimeoutSec, $result
    $child = Start-Process -FilePath $ps -ArgumentList $argLine -WindowStyle Hidden -PassThru
    $form = New-Object Windows.Forms.Form
    $form.Text = 'WoW Forever'
    $form.ClientSize = New-Object Drawing.Size(470, 150)
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.TopMost = $true
    $form.Font = New-Object Drawing.Font('Segoe UI', 10)
    $label = New-Object Windows.Forms.Label
    $label.SetBounds(18, 15, 434, 80)
    $label.Text = "Updating your addons through CurseForge.`nThe game starts when it is done, and CurseForge closes again."
    if ($script:TestDir) { Set-Content -LiteralPath (Join-Path $script:TestDir 'said-curseforge-wait.txt') -Value $label.Text }
    $anyway = New-Object Windows.Forms.Button
    $anyway.Text = 'Launch anyway'
    $anyway.SetBounds(197, 105, 135, 32)
    $anyway.DialogResult = [Windows.Forms.DialogResult]::Yes
    $cancel = New-Object Windows.Forms.Button
    $cancel.Text = 'Cancel'
    $cancel.SetBounds(342, 105, 110, 32)
    $cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
    $form.Controls.AddRange(@($label, $anyway, $cancel))
    $form.CancelButton = $cancel
    # He minimized it last time: it opens minimized on the taskbar. Minimizing or restoring it is kept for next time.
    if ((Get-WindowMemory $script:CurseForgeWindowFile) -eq 'Minimized') { $form.WindowState = [Windows.Forms.FormWindowState]::Minimized }
    $form.Add_Resize({ if ($form.Visible) { Save-WindowMemory $script:CurseForgeWindowFile "$($form.WindowState)" } })
    # The updater stops itself at its own timeout and still closes CurseForge; this is the backstop past that.
    $giveUp = (Get-Date).AddSeconds($script:CurseForgeTimeoutSec + $script:CurseForgeGraceSec)
    $timer = New-Object Windows.Forms.Timer
    $timer.Interval = 1000
    $timer.Add_Tick({
        if ($child.HasExited) {
            $form.DialogResult = [Windows.Forms.DialogResult]::OK
            $form.Close()
        } elseif ((Get-Date) -gt $giveUp) {
            $form.DialogResult = [Windows.Forms.DialogResult]::Abort
            $form.Close()
        }
    })
    try {
        $timer.Start()
        $answer = $form.ShowDialog()
    } finally {
        $timer.Dispose()
        $form.Dispose()
    }
    $lines = if (Test-Path -LiteralPath $result) { @(Get-Content -LiteralPath $result) } else { @() }
    Remove-Item -LiteralPath $result -ErrorAction SilentlyContinue
    if (!$child.HasExited) {
        try { Stop-Process -Id $child.Id -Force } catch { }
        Stop-CurseForge
    }
    $record = Join-Path $(if ($script:TestDir) { $script:TestDir } else { $PSScriptRoot }) 'last-curseforge.txt'
    try { [IO.File]::WriteAllLines($record, [string[]](@("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $answer) + $lines)) } catch { }
    if ($answer -eq [Windows.Forms.DialogResult]::Cancel) { return $false }
    if ($answer -eq [Windows.Forms.DialogResult]::Yes) { return 'You started the game before CurseForge finished' }
    if ($answer -eq [Windows.Forms.DialogResult]::Abort) { return "CurseForge took over $($script:CurseForgeTimeoutSec + $script:CurseForgeGraceSec) seconds" }
    $last = if ($lines.Count) { $lines[-1] } else { 'FAILED: the updater stopped without a result' }
    if ($last -like 'FAILED:*') { return $last.Substring(8).Trim() }
    return $null
}

# A note that does not stop anything: a Windows notification (tests: a file).
function Show-Note([string]$Text) {
    if ($script:TestDir) { Set-Content -LiteralPath (Join-Path $script:TestDir 'said-curseforge.txt') -Value $Text; return }
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
    $b = [Security.SecurityElement]::Escape($Text)
    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>Addons not updated</text><text>$b</text></binding></visual></toast>")
    $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show((New-Object Windows.UI.Notifications.ToastNotification $xml))
}

$go = $true
try {
    if (!(Test-GameRunning)) {
        $have = Get-InstalledBuild
        $want = Get-CurrentBuild
        # No answer from Blizzard's build list: nothing to compare, so start the game as before.
        if ($want -and $want.Key -ne $have.Key) { $go = Wait-ForUpdate $have $want }
    }
} catch {
    [Windows.Forms.MessageBox]::Show("Could not check for an update: $($_.Exception.Message)`nStarting the game anyway.", 'WoW Forever') | Out-Null
}
# Last, so the number is fresh: an update can take minutes. A failed read never stops the game.
try {
    if ($go -and !(Test-GameRunning)) {
        $mem = Get-MemoryState
        if ($mem -and $mem.FreeGB -lt $script:MinFreeGB) { $go = Wait-ForMemory $mem }
    }
} catch { }
# Claude is fixing the addons for a new patch: wait, so the game loads them finished. A failed read never stops it.
try {
    if ($go -and !(Test-GameRunning)) {
        $patch = Get-PatchCheck
        if ($patch) { $go = Wait-ForPatchCheck $patch }
    }
} catch { }
# CurseForge updates the addons it manages, then closes. Before the hook patcher below, which has to see the new
# files. A failure only says so in a notification once the game is starting.
$cfNote = $null
try {
    if ($go -and !(Test-GameRunning) -and (Test-Path -LiteralPath $script:CurseForgeUpdater)) {
        $cf = Wait-ForCurseForge
        if ($cf -eq $false) { $go = $false } elseif ($cf) { $cfNote = $cf }
    }
} catch { $cfNote = $_.Exception.Message }
if ($go) {
    # Keep the last session's taint log and leave the log on for this one. Never in the way of the game starting.
    try { if (!(Test-GameRunning)) { Save-TaintLog; Set-TaintLogging } } catch { }
    # Take the addons off Blizzard's frame methods again; say so when an update no longer fits the patches.
    try {
        $misfit = if (!(Test-GameRunning)) { Repair-AddonHooks }
        if ($misfit) {
            if ($script:TestDir) { Set-Content -LiteralPath (Join-Path $script:TestDir 'said-misfit.txt') -Value $misfit }
            else { [Windows.Forms.MessageBox]::Show("An addon update no longer fits its hook patch, so its hooks are back:`n`n$misfit`n`nThe game starts now. Ask Claude to update wow\addon-hook-patches.", 'WoW Forever') | Out-Null }
        }
    } catch { }
    # Addon code that breaks the controller (an update brought it in, or last session's blocked calls point at it):
    # Claude reports on it (..\addon-guard; it only fixes with --apply, and the game then waits). Never stops it otherwise.
    try {
        if (!(Test-GameRunning) -and (Start-AddonGuard)) {
            $patch = Get-PatchCheck
            if ($patch) { $go = Wait-ForPatchCheck $patch }
        }
    } catch { }
    if ($go) { & $launcher -GameExe $script:GameExe }
    if ($go -and $cfNote) { try { Show-Note ("{0}. The game started anyway." -f "$cfNote".TrimEnd('.')) } catch { } }
}
