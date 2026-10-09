# Shared by Start-WoWForever.ps1 and Notify-Back.ps1. ASCII only: Windows PowerShell 5.1 reads a file with no BOM as ANSI.
$script:Product = 'wow_classic_beta'
$script:WowRoot = 'D:\Games\World of Warcraft'
$script:GameExe = Join-Path $script:WowRoot '_classic_beta_\WowB.exe'
$script:Shortcut = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\WoW Forever.lnk'
$script:DotIcon = Join-Path $PSScriptRoot 'WowB-dot.ico'
$script:BattleNet = 'C:\Program Files (x86)\Battle.net\Battle.net Launcher.exe'
$script:Launcher = 'C:\Users\levik\Documents\Codex\2026-10-09\can-x20\outputs\Launch-WoW-Steam.ps1'
# Tests set WOWFOREVER_TEST_DIR: build files, shortcut and launcher are then read from that folder, the build list
# from its "versions" file, and Battle.net is never started.
$script:TestDir = $env:WOWFOREVER_TEST_DIR
if ($script:TestDir) {
    $script:WowRoot = $script:TestDir
    $script:Shortcut = Join-Path $script:TestDir 'WoW Forever.lnk'
    $script:DotIcon = Join-Path $script:TestDir 'WowB-dot.ico'
    $script:Launcher = Join-Path $script:TestDir 'launcher.ps1'
}
$script:BetaDir = Join-Path $script:WowRoot '_classic_beta_'
$script:TaintLevel = 2       # 1 = blocked actions only, 2 = also who tainted what (needed to find the addon behind a hang)
$script:TaintLogsKept = 10

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
