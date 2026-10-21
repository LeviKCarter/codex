# Moves the WoW tools to one client: forever (_forever_\Wow.exe, the 2026-10-21 stress test and the 2026-11-04
# launch) or beta (_classic_beta_\WowB.exe, until it closes on 2026-10-23).
#   powershell -File Set-WoWClient.ps1 forever|beta [-Check]
# It writes %LOCALAPPDATA%\PulseAgent\wow-client.txt, which ForeverCommon.ps1 and ..\wow_client.py read (the taskbar
# shortcut, CurseForge, the addon guard, hook patches and patch day follow it), and points Steam's non-Steam shortcut
# "WowB" at that client's program. The shortcut keeps its name and app id, so the Steam launcher's rungameid and the
# controller layout Steam keeps for it stay as they are. Steam rewrites shortcuts.vdf when it quits, so a running Steam
# is shut down first (never while the game is open); a copy of the file is kept beside it as shortcuts.vdf.<time>.bak.
# -Check says what it would change and changes nothing. ASCII only.
param([Parameter(Mandatory = $true)][ValidateSet('forever', 'beta')][string]$Client, [switch]$Check)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ForeverCommon.ps1')
# Tests (WOWFOREVER_TEST_DIR): Steam is the Steam folder in there, and no program is asked about or shut down.
$steamDir = if ($script:TestDir) { Join-Path $script:TestDir 'Steam' } else { 'C:\Program Files (x86)\Steam' }
$appName = 'WowB'

$want = $script:Clients[$Client]
$exe = Join-Path $script:WowRoot (Join-Path $want.Dir $want.Exe)
if (!(Test-Path -LiteralPath $exe)) { throw "Not installed: $exe" }
$wantStart = (Join-Path $script:WowRoot $want.Dir) + '\'

# Every Steam user's shortcuts.vdf that has the "WowB" shortcut. The file is binary: each text field is
# 0x01 name 0x00 value 0x00, so a field is changed by putting the new text between those bytes.
$latin = [Text.Encoding]::GetEncoding(28591)
$field = [string][char]1 + 'AppName' + [char]0 + $appName + [char]0
$changes = @()
foreach ($f in @(Get-ChildItem -Path (Join-Path $steamDir 'userdata\*\config\shortcuts.vdf') -ErrorAction SilentlyContinue)) {
    $text = $latin.GetString([IO.File]::ReadAllBytes($f.FullName))
    $at = $text.IndexOf($field, [StringComparison]::Ordinal)
    if ($at -lt 0) { continue }
    $end = $text.IndexOf([string][char]8 + [char]8, $at, [StringComparison]::Ordinal)
    if ($end -lt 0) { $end = $text.Length }
    $entry = $text.Substring($at, $end - $at)
    $new = [regex]::Replace($entry, '(\x01Exe\x00)[^\x00]*(\x00)', ('$1"' + $exe.Replace('$', '$$') + '"$2'))
    $new = [regex]::Replace($new, '(\x01StartDir\x00)[^\x00]*(\x00)', ('${1}' + $wantStart.Replace('$', '$$') + '$2'))
    if ($new -ne $entry) { $changes += [pscustomobject]@{ File = $f.FullName; Text = $text.Substring(0, $at) + $new + $text.Substring($end) } }
}

$was = Get-WoWClientName $script:WowRoot $script:ClientFile
if ($Check) {
    Write-Output ("now {0}; {1} -> {2}; Steam shortcuts to change: {3}" -f $was, $Client, $exe, $(if ($changes.Count) { ($changes.File -join ', ') } else { 'none' }))
    return
}

if ($changes.Count) {
    if (!$script:TestDir -and (Get-Process -Name Wow, WowB -ErrorAction SilentlyContinue)) { throw 'WoW is open. Close it first: Steam would put the shortcut back when it quits.' }
    if (!$script:TestDir -and (Get-Process -Name steam -ErrorAction SilentlyContinue)) {
        Start-Process -FilePath (Join-Path $steamDir 'steam.exe') -ArgumentList '-shutdown'
        $until = (Get-Date).AddSeconds(60)
        while ((Get-Process -Name steam -ErrorAction SilentlyContinue) -and (Get-Date) -lt $until) { Start-Sleep -Milliseconds 500 }
        if (Get-Process -Name steam -ErrorAction SilentlyContinue) { throw 'Steam did not quit within a minute; nothing was changed.' }
    }
    foreach ($c in $changes) {
        Copy-Item -LiteralPath $c.File -Destination ('{0}.{1:yyyyMMdd-HHmmss}.bak' -f $c.File, (Get-Date))
        [IO.File]::WriteAllBytes($c.File, $latin.GetBytes($c.Text))
        Write-Output "steam: $($c.File) -> $exe"
    }
}
$dir = Split-Path -Parent $script:ClientFile
if (!(Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
[IO.File]::WriteAllText($script:ClientFile, $Client)
Write-Output "client: $Client ($exe)"
