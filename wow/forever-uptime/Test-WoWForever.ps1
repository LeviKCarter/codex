# Tests for Start-WoWForever.ps1 on a made-up game folder (WOWFOREVER_TEST_DIR): nothing real is started or changed.
# The out-of-date cases open the real wait window for a few seconds. Exit code 1 on any failure. ASCII only.
$ErrorActionPreference = 'Stop'
$dir = Join-Path ([IO.Path]::GetTempPath()) ("wowforever-test-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $dir | Out-Null
$env:WOWFOREVER_TEST_DIR = $dir
$env:WOWFOREVER_GIVE_UP = '5'
$start = Join-Path $PSScriptRoot 'Start-WoWForever.ps1'
$ps = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$old = '0' * 31 + '1'
$new = '0' * 31 + '2'
$failed = 0

function Set-Installed($key, $version) {
    Set-Content -LiteralPath "$dir\.build.info" -Value @(
        'Branch!STRING:0|Active!DEC:1|Build Key!HEX:16|CDN Key!HEX:16|Version!STRING:0|Product!STRING:0',
        "us|1|ffffffffffffffffffffffffffffffff|aa|9.9.9.1|wow",
        "us|1|$key|aa|$version|wow_classic_beta")
}
function Set-Blizzard($key, $version) {
    Set-Content -LiteralPath "$dir\versions" -Value @(
        'Region!STRING:0|BuildConfig!HEX:16|CDNConfig!HEX:16|KeyRing!HEX:16|BuildId!DEC:4|VersionsName!String:0|ProductConfig!HEX:16',
        '## seqn = 1', "us|$key|cc||1|$version|dd", "eu|$key|cc||1|$version|dd")
}
function Reset-Case {
    Remove-Item "$dir\launched.txt", "$dir\battlenet-started.txt", "$dir\said-out-of-date.txt" -ErrorAction SilentlyContinue
}
function Check($name, $ok) {
    if ($ok) { Write-Output "ok   $name" } else { Write-Output "FAIL $name"; $script:failed++ }
}
function Run-Start { Start-Process -FilePath $ps -ArgumentList "-NoProfile -STA -ExecutionPolicy Bypass -File `"$start`"" -WindowStyle Hidden -PassThru }

try {
    Set-Content -LiteralPath "$dir\launcher.ps1" -Value "Set-Content -LiteralPath '$dir\launched.txt' -Value 'yes'"
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut("$dir\WoW Forever.lnk")
    $link.TargetPath = $ps
    $link.Save()

    Set-Installed $old '1.60.1.1'; Set-Blizzard $old '1.60.1.1'; Reset-Case
    $out = & $start -Check
    Check 'check says CURRENT when the builds match' ($out -like 'CURRENT: installed 1.60.1.1, Blizzard has 1.60.1.1*')
    Check 'check starts nothing' (!(Test-Path "$dir\launched.txt"))
    Set-Blizzard $new '1.60.1.2'
    Check 'check says OUT OF DATE when they differ' ((& $start -Uri 'wowforever://check/') -like 'OUT OF DATE: installed 1.60.1.1, Blizzard has 1.60.1.2*')
    Set-Content -LiteralPath "$dir\versions" -Value 'Service Unavailable'
    Check 'check says UNKNOWN when the build list is no list' ((& $start -Check) -like 'UNKNOWN*')

    Reset-Case
    $p = Run-Start; $p.WaitForExit(20000) | Out-Null
    Check 'no build list: the game starts as before' ($p.HasExited -and (Test-Path "$dir\launched.txt") -and !(Test-Path "$dir\battlenet-started.txt"))

    Set-Blizzard $old '1.60.1.1'; Reset-Case
    . (Join-Path $PSScriptRoot 'ForeverCommon.ps1')
    Set-ShortcutDot $true
    Check 'the dot goes on the shortcut' ((New-Object -ComObject WScript.Shell).CreateShortcut("$dir\WoW Forever.lnk").IconLocation -eq "$dir\WowB-dot.ico,0")
    $p = Run-Start; $p.WaitForExit(20000) | Out-Null
    Check 'up to date: the game starts, Battle.net is left alone' ($p.HasExited -and (Test-Path "$dir\launched.txt") -and !(Test-Path "$dir\battlenet-started.txt"))
    Check 'starting takes the dot off' ((New-Object -ComObject WScript.Shell).CreateShortcut("$dir\WoW Forever.lnk").IconLocation -eq "$script:GameExe,0")

    Set-Blizzard $new '1.60.1.2'; Reset-Case
    $p = Run-Start
    foreach ($i in 1..40) { if (Test-Path "$dir\battlenet-started.txt") { break }; Start-Sleep -Milliseconds 250 }
    Start-Sleep -Seconds 1
    Check 'out of date: it waits, Battle.net is started, the game is not' (!$p.HasExited -and (Test-Path "$dir\battlenet-started.txt") -and !(Test-Path "$dir\launched.txt"))
    Set-Installed $new '1.60.1.2'
    $p.WaitForExit(20000) | Out-Null
    Check 'the game starts once the update is in' ($p.HasExited -and (Test-Path "$dir\launched.txt"))
    Check 'a finished update is never called out of date' (!(Test-Path "$dir\said-out-of-date.txt"))

    Set-Installed $old '1.60.1.1'; Reset-Case
    $p = Run-Start
    Start-Sleep -Seconds 14
    Check 'no update after the wait: it says out of date and still does not start the game' (!$p.HasExited -and (Test-Path "$dir\said-out-of-date.txt") -and !(Test-Path "$dir\launched.txt"))
    Set-Installed $new '1.60.1.2'
    $p.WaitForExit(20000) | Out-Null
    Check 'a late update still starts the game' ($p.HasExited -and (Test-Path "$dir\launched.txt"))
    if (!$p.HasExited) { $p.Kill() }
} finally {
    $env:WOWFOREVER_TEST_DIR = $null
    $env:WOWFOREVER_GIVE_UP = $null
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}
if ($failed) { Write-Output "$failed failed"; exit 1 }
Write-Output 'all passed'
