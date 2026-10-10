# What the taskbar shortcut and the "back up" notification run: take the red dot off, make sure the game is on
# Blizzard's current build (wait for Battle.net to finish, or say the game is out of date), keep the last session's
# taint log, take addons' hooks off Blizzard's frame methods, then start the game through the Steam launcher.
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
    $line = "{0}: installed {1}, Blizzard has {2}; launcher {3}; uri '{4}'" -f $state, $have.Version, $(if ($want) { $want.Version } else { 'no answer' }), $(if (Test-Path -LiteralPath $launcher) { 'found' } else { 'MISSING' }), $Uri
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
    & $launcher
}
