# Shared by Start-WoWForever.ps1 and Notify-Back.ps1. ASCII only: Windows PowerShell 5.1 reads a file with no BOM as ANSI.
$script:Product = 'wow_classic_beta'
$script:WowRoot = 'D:\Games\World of Warcraft'
$script:GameExe = Join-Path $script:WowRoot '_classic_beta_\WowB.exe'
$script:Shortcut = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\WoW Forever.lnk'
$script:DotIcon = Join-Path $PSScriptRoot 'WowB-dot.ico'
$script:BattleNet = 'C:\Program Files (x86)\Battle.net\Battle.net Launcher.exe'
$script:Launcher = 'C:\Users\levik\Documents\Codex\2026-10-09\can-x20\outputs\Launch-WoW-Steam.ps1'
# Updates the CurseForge addons and closes CurseForge again; last line OK, NOTHING or FAILED: <why>.
$script:CurseForgeUpdater = Join-Path $PSScriptRoot 'Update-CurseForgeAddons.ps1'
# Seconds the updater gets before the game starts without it (the update itself took 21 s for 7 addons on 2026-10-17).
$script:CurseForgeTimeoutSec = 240
# Past that, the updater still closes CurseForge; this many seconds more and the launcher stops both itself.
$script:CurseForgeGraceSec = 30
# Tests set WOWFOREVER_TEST_DIR: build files, shortcut, launcher and CurseForge updater are then read from that folder,
# the build list from its "versions" file, and Battle.net is never started.
$script:TestDir = $env:WOWFOREVER_TEST_DIR
if ($script:TestDir) {
    $script:WowRoot = $script:TestDir
    $script:Shortcut = Join-Path $script:TestDir 'WoW Forever.lnk'
    $script:DotIcon = Join-Path $script:TestDir 'WowB-dot.ico'
    $script:Launcher = Join-Path $script:TestDir 'launcher.ps1'
    $script:CurseForgeUpdater = Join-Path $script:TestDir 'curseforge.ps1'
    if ($env:WOWFOREVER_CF_TIMEOUT) { $script:CurseForgeTimeoutSec = [int]$env:WOWFOREVER_CF_TIMEOUT; $script:CurseForgeGraceSec = 2 }
}
$script:BetaDir = Join-Path $script:WowRoot '_classic_beta_'
$script:TaintLevel = 2       # 1 = blocked actions only, 2 = also who tainted what (needed to find the addon behind a hang)
$script:TaintLogsKept = 10
# Memory Windows must still be able to hand out before the game starts. On 2026-10-17 it crashed out of memory a
# minute in with 2.4 GB free (the Claude app had grown to 19.5 GB), and it takes about 6.6 GB within minutes.
$script:MinFreeGB = 10
# While the game is open, Watch-Memory.ps1 quietly asks the Claude app to archive its finished sessions below this
# much free, at most once every so many minutes. Nothing is shown for that.
$script:WarnFreeGB = 5
$script:WarnEveryMinutes = 15
# Only below this much free does it show a notification (the game crashed at 2.4 GB on 2026-10-17): once per low
# spell, again only when another $ToastWorseGB GB is gone, and it takes itself off the screen after $ToastSeconds.
# Levi, 2026-10-19: the old one came back every 15 minutes at 4.9 GB and stayed until he dismissed it.
$script:ToastFreeGB = 3
$script:ToastWorseGB = 1
$script:ToastSeconds = 20
# ..\patch-day\patch_day.py writes this file while Claude fixes the addons for a new patch. A file older than this
# many minutes is a run that died; it never holds the game back.
$script:PatchCheck = Join-Path $env:LOCALAPPDATA 'PulseAgent\wow-patch-day-running.txt'
if ($script:TestDir) { $script:PatchCheck = Join-Path $script:TestDir 'patch-check.txt' }
$script:PatchCheckMinutes = 90
# How he left the "Updating your addons through CurseForge" window last time: Minimized or Normal. Minimized, it opens
# minimized on the taskbar the next time (Levi, 2026-10-20: "If I minimize this, remember it the next time it goes").
$script:CurseForgeWindowFile = Join-Path $env:LOCALAPPDATA 'PulseAgent\wow-forever-curseforge-window.txt'
if ($script:TestDir) { $script:CurseForgeWindowFile = Join-Path $script:TestDir 'curseforge-window.txt' }

# 'Minimized' when he left that window minimized, else 'Normal' (no file, an unreadable one, or anything else in it).
function Get-WindowMemory([string]$Path) {
    try {
        if ((Test-Path -LiteralPath $Path) -and ([IO.File]::ReadAllText($Path).Trim() -eq 'Minimized')) { return 'Minimized' }
    } catch { }
    return 'Normal'
}

# Keeps Minimized or Normal; any other state (Maximized) is not his choice to remember. Never in the way of the game.
function Save-WindowMemory([string]$Path, [string]$State) {
    if ($State -ne 'Minimized' -and $State -ne 'Normal') { return }
    if ((Get-WindowMemory $Path) -eq $State -and (Test-Path -LiteralPath $Path)) { return }
    try {
        $parent = Split-Path -Parent $Path
        if ($parent -and !(Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        [IO.File]::WriteAllText($Path, $State)
    } catch { }
}

# The patch check that is running now: Label (the build) and Started, or $null.
function Get-PatchCheck {
    if (!(Test-Path -LiteralPath $script:PatchCheck)) { return $null }
    $item = Get-Item -LiteralPath $script:PatchCheck
    if (((Get-Date) - $item.LastWriteTime).TotalMinutes -gt $script:PatchCheckMinutes) { return $null }
    $cells = ([IO.File]::ReadAllText($item.FullName)).Trim().Split('|')
    $started = $item.LastWriteTime
    if ($cells.Count -gt 1) { try { $started = [DateTime]::Parse($cells[1]) } catch { } }
    return [pscustomobject]@{ Label = $cells[0]; Started = $started }
}

# $true while the game is open; its files are only touched when it is not. Tests: a game-running.txt in the folder.
function Test-GameRunning {
    if ($script:TestDir) { return (Test-Path -LiteralPath (Join-Path $script:TestDir 'game-running.txt')) }
    return [bool](Get-Process -Name WowB -ErrorAction SilentlyContinue)
}

# The game empties Logs\taint.log when it starts, so the log of a hang was gone by the time anyone read it.
# Copies the last session's log to Logs\taint-kept, named by when it was last written, and keeps the newest few.
function Save-TaintLog {
    $log = Join-Path $script:BetaDir 'Logs\taint.log'
    if (!(Test-Path -LiteralPath $log)) { return }
    $item = Get-Item -LiteralPath $log
    if ($item.Length -eq 0) { return }
    $kept = Join-Path $script:BetaDir 'Logs\taint-kept'
    New-Item -ItemType Directory -Path $kept -Force | Out-Null
    $copy = Join-Path $kept ('taint-{0:yyyy-MM-dd_HH.mm.ss}.log' -f $item.LastWriteTime)
    if (!(Test-Path -LiteralPath $copy)) { Copy-Item -LiteralPath $log -Destination $copy }
    Get-ChildItem -LiteralPath $kept -Filter 'taint-*.log' | Sort-Object Name -Descending |
        Select-Object -Skip $script:TaintLogsKept | Remove-Item -Force
}

# Turns the game's taint log on in WTF\Config.wtf (the game writes the file itself when it closes, so only while
# it is closed). Every other line is left as it is.
function Set-TaintLogging {
    $config = Join-Path $script:BetaDir 'WTF\Config.wtf'
    if (!(Test-Path -LiteralPath $config)) { return }
    $want = 'SET taintLog "{0}"' -f $script:TaintLevel
    $text = [IO.File]::ReadAllText($config)
    if ($text -match ('(?m)^' + [regex]::Escape($want) + '\r?$')) { return }
    if ($text -match '(?m)^SET taintLog ') {
        $text = [regex]::Replace($text, '(?m)^SET taintLog "[^"]*"', $want)
    } else {
        $nl = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
        if ($text.Length -and !$text.EndsWith("`n")) { $text += $nl }
        $text += $want + $nl
    }
    [IO.File]::WriteAllText($config, $text, (New-Object Text.UTF8Encoding $false))
}

# An addon update puts back the hooks on Blizzard's frame methods that ..\addon-hook-patches takes out, so the
# patcher runs before every launch. Returns its report when an addon no longer fits its patches (said once per
# version of the file), else nothing.
function Repair-AddonHooks {
    $patcher = Join-Path $PSScriptRoot '..\addon-hook-patches\patch_addon_hooks.py'
    $python = (Get-Command python -ErrorAction SilentlyContinue).Source
    if (!$python -or !(Test-Path -LiteralPath $patcher)) { return }
    $report = & $python $patcher --addons (Join-Path $script:BetaDir 'Interface\AddOns')
    if ($LASTEXITCODE -eq 2) { return ($report -join "`n") }
}

# ..\addon-guard\addon_guard.py: --scan finds addon code an update brought in that breaks the controller, or blocked
# controller calls from the last sessions, and exits 3 when there is something new; --fix then has Claude fix it,
# writing the patch-check file while it works. Returns $true once that fix is running (Get-PatchCheck sees it).
# Tests: guard.ps1 in the test folder stands in for both (-Mode scan / -Mode fix); without it nothing runs.
function Start-AddonGuard {
    $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if ($script:TestDir) {
        $guard = Join-Path $script:TestDir 'guard.ps1'
        if (!(Test-Path -LiteralPath $guard)) { return $false }
        & $ps -NoProfile -ExecutionPolicy Bypass -File $guard -Mode scan | Out-Null
        if ($LASTEXITCODE -ne 3) { return $false }
        Start-Process -FilePath $ps -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "{0}" -Mode fix' -f $guard) -WindowStyle Hidden | Out-Null
    } else {
        $guard = Join-Path $PSScriptRoot '..\addon-guard\addon_guard.py'
        $python = (Get-Command python -ErrorAction SilentlyContinue).Source
        if (!$python -or !(Test-Path -LiteralPath $guard)) { return $false }
        & $python $guard --scan | Out-Null
        if ($LASTEXITCODE -ne 3) { return $false }
        Start-Process -FilePath $python -ArgumentList ('"{0}" --fix' -f $guard) -WindowStyle Hidden | Out-Null
    }
    # The fix writes the patch-check file as it starts; one that never does is not waited for.
    foreach ($i in 1..40) {
        if (Get-PatchCheck) { return $true }
        Start-Sleep -Milliseconds 250
    }
    return $false
}

# The game empties Logs\taint.log at every login and /reload, so a session's log is gone before anyone reads it.
# While the game is open, Watch-Memory.ps1 calls this on each check: the log is copied to Logs\taint-live whenever it
# grew, one file per session (a shorter log than last time is a new session), newest $script:TaintLogsKept kept.
# $State is a hashtable the caller keeps between calls.
function Copy-LiveTaintLog($State) {
    $log = Join-Path $script:BetaDir 'Logs\taint.log'
    if (!(Test-Path -LiteralPath $log)) { return }
    $size = (Get-Item -LiteralPath $log).Length
    $last = if ($State.ContainsKey('Size')) { $State.Size } else { 0 }
    if ($size -lt $last -or !$State.ContainsKey('File')) {
        $State.File = 'taint-live-{0:yyyy-MM-dd_HH.mm.ss}.log' -f (Get-Date)
    }
    $State.Size = $size
    if ($size -eq 0 -or $size -eq $last) { return }
    $live = Join-Path $script:BetaDir 'Logs\taint-live'
    New-Item -ItemType Directory -Path $live -Force | Out-Null
    Copy-Item -LiteralPath $log -Destination (Join-Path $live $State.File) -Force
    Get-ChildItem -LiteralPath $live -Filter 'taint-live-*.log' | Sort-Object Name -Descending |
        Select-Object -Skip $script:TaintLogsKept | Remove-Item -Force
}

# The build Battle.net last finished installing: the product's row in the game folder's .build.info.
function Get-InstalledBuild {
    $lines = Get-Content -LiteralPath (Join-Path $script:WowRoot '.build.info')
    $names = $lines[0].Split('|') | ForEach-Object { $_.Split('!')[0] }
    foreach ($line in $lines | Select-Object -Skip 1) {
        $cells = $line.Split('|')
        if ($cells[[Array]::IndexOf($names, 'Product')] -eq $script:Product) {
            return [pscustomobject]@{ Key = $cells[[Array]::IndexOf($names, 'Build Key')]; Version = $cells[[Array]::IndexOf($names, 'Version')] }
        }
    }
    throw "No $script:Product row in .build.info."
}

# The build Blizzard is serving now (the same list Battle.net reads). $null when it can't be reached.
function Get-CurrentBuild {
    try {
        if ($script:TestDir) { $text = Get-Content -LiteralPath (Join-Path $script:TestDir 'versions') -Raw }
        else { $text = (Invoke-WebRequest "http://us.patch.battle.net:1119/$script:Product/versions" -UseBasicParsing -TimeoutSec 10).Content }
        if ($text -is [byte[]]) { $text = [Text.Encoding]::ASCII.GetString($text) }
        $row = ($text -split "`n" | Where-Object { $_ -like 'us|*' } | Select-Object -First 1).Trim().Split('|')
        if ($row.Count -lt 6 -or $row[1].Length -ne 32) { return $null }
        return [pscustomobject]@{ Key = $row[1]; Version = $row[5] }
    } catch { return $null }
}

# How much memory Windows can still hand out (committed memory: RAM plus page file), and the three programs holding
# the most. Tests: a "memory" file, first line the free GB, then one "name GB" line per program; none = $null.
function Get-MemoryState {
    if ($script:TestDir) {
        $path = Join-Path $script:TestDir 'memory'
        if (!(Test-Path -LiteralPath $path)) { return $null }
        $lines = @(Get-Content -LiteralPath $path)
        $top = $lines | Select-Object -Skip 1 | ForEach-Object { $cells = $_.Split(' '); [pscustomobject]@{ Name = $cells[0]; GB = [double]$cells[1] } }
        return [pscustomobject]@{ FreeGB = [double]$lines[0]; Top = @($top) }
    }
    $os = Get-CimInstance Win32_OperatingSystem
    $top = Get-Process | Group-Object Name |
        ForEach-Object { [pscustomobject]@{ Name = $_.Name; GB = ($_.Group | Measure-Object PagedMemorySize64 -Sum).Sum / 1GB } } |
        Sort-Object GB -Descending | Select-Object -First 3
    return [pscustomobject]@{ FreeGB = $os.FreeVirtualMemory / 1MB; Top = @($top) }
}

# "claude 19.5 GB, chrome 4.7 GB, SignalRgb 4.6 GB"
function Format-MemoryTop($state) {
    return (($state.Top | ForEach-Object { '{0} {1:N1} GB' -f $_.Name, $_.GB }) -join ', ')
}

# Closes CurseForge and its mods agent (Curse.Agent.Host). Tests: a curseforge-stopped.txt in the folder.
function Stop-CurseForge {
    if ($script:TestDir) { Add-Content -LiteralPath (Join-Path $script:TestDir 'curseforge-stopped.txt') -Value 'stopped'; return }
    Get-Process -Name CurseForge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    # The agent stops by itself once the app is gone, and the app's helper processes take a moment to go: give them
    # the time to, then stop what is left.
    $until = (Get-Date).AddSeconds(15)
    while ((Get-Process -Name CurseForge, Curse.Agent.Host -ErrorAction SilentlyContinue) -and (Get-Date) -lt $until) { Start-Sleep -Milliseconds 500 }
    Get-Process -Name CurseForge, Curse.Agent.Host -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

function Start-BattleNet {
    if ($script:TestDir) { Add-Content -LiteralPath (Join-Path $script:TestDir 'battlenet-started.txt') -Value 'started'; return }
    if (Get-Process -Name 'Battle.net' -ErrorAction SilentlyContinue) { return }
    if (Test-Path -LiteralPath $script:BattleNet) { Start-Process -FilePath $script:BattleNet }
}

function Add-Native {
    if ('WoWForever.Native' -as [type]) { return }
    Add-Type -Namespace WoWForever -Name Native -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode)]
public static extern uint PrivateExtractIcons(string file, int index, int cx, int cy, IntPtr[] icons, uint[] ids, uint count, uint flags);
[DllImport("user32.dll")]
public static extern bool DestroyIcon(IntPtr handle);
[DllImport("shell32.dll", CharSet = CharSet.Unicode)]
public static extern void SHChangeNotify(int eventId, uint flags, string item1, IntPtr item2);
[DllImport("shell32.dll")]
public static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);
'@
}

# The game's own icon with a red dot in the top right corner, as a one-picture .ico.
function New-DotIcon {
    Add-Type -AssemblyName System.Drawing
    Add-Native
    $handles = New-Object IntPtr[] 1
    $ids = New-Object uint32[] 1
    if ([WoWForever.Native]::PrivateExtractIcons($script:GameExe, 0, 256, 256, $handles, $ids, 1, 0) -lt 1) { throw 'No icon in WowB.exe.' }
    $bmp = New-Object Drawing.Bitmap 256, 256
    $g = [Drawing.Graphics]::FromImage($bmp)
    try {
        $icon = [Drawing.Icon]::FromHandle($handles[0])
        $g.SmoothingMode = 'AntiAlias'
        $g.DrawIcon($icon, (New-Object Drawing.Rectangle 0, 0, 256, 256))
        $g.FillEllipse([Drawing.Brushes]::White, 134, 0, 122, 122)
        $g.FillEllipse((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(232, 17, 35))), 144, 10, 102, 102)
        $png = New-Object IO.MemoryStream
        $bmp.Save($png, [Drawing.Imaging.ImageFormat]::Png)
        $out = New-Object IO.MemoryStream
        $w = New-Object IO.BinaryWriter $out
        $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]1)
        $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0)
        $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$png.Length); $w.Write([uint32]22)
        $w.Write($png.ToArray())
        [IO.File]::WriteAllBytes($script:DotIcon, $out.ToArray())
    } finally {
        $g.Dispose(); $bmp.Dispose()
        [WoWForever.Native]::DestroyIcon($handles[0]) | Out-Null
    }
}

# Puts the red dot on the taskbar shortcut, or takes it off. Only the shortcut's icon changes.
function Set-ShortcutDot([bool]$On) {
    if (!(Test-Path -LiteralPath $script:Shortcut)) { return }
    if ($On -and !(Test-Path -LiteralPath $script:DotIcon)) { New-DotIcon }
    $want = if ($On) { "$script:DotIcon,0" } else { "$script:GameExe,0" }
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut($script:Shortcut)
    if ($link.IconLocation -eq $want) { return }
    $link.IconLocation = $want
    $link.Save()
    Add-Native
    [WoWForever.Native]::SHChangeNotify(0x2000, 0x0005, $script:Shortcut, [IntPtr]::Zero)
    [WoWForever.Native]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
}
