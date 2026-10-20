# Tests for Start-WoWForever.ps1 and Watch-Memory.ps1 on a made-up game folder (WOWFOREVER_TEST_DIR): nothing real is started or changed.
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
    Remove-Item "$dir\launched.txt", "$dir\battlenet-started.txt", "$dir\said-out-of-date.txt", "$dir\said-low-memory.txt", "$dir\said-patch-check.txt", "$dir\patch-check.txt" -ErrorAction SilentlyContinue
    Remove-Item "$dir\cf-ran.txt", "$dir\said-curseforge-wait.txt", "$dir\said-curseforge.txt", "$dir\curseforge-stopped.txt", "$dir\last-curseforge.txt" -ErrorAction SilentlyContinue
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

    # Memory: too little left and the game crashes soon after it starts (2026-10-17), so it waits for room.
    Set-Installed $new '1.60.1.2'; Set-Blizzard $new '1.60.1.2'; Reset-Case
    Set-Content -LiteralPath "$dir\memory" -Value '20'
    $p = Run-Start; $p.WaitForExit(20000) | Out-Null
    Check 'enough memory: the game starts and nothing is said' ($p.HasExited -and (Test-Path "$dir\launched.txt") -and !(Test-Path "$dir\said-low-memory.txt"))
    Reset-Case
    Set-Content -LiteralPath "$dir\memory" -Value @('2.4', 'claude 19.5', 'chrome 4.7', 'SignalRgb 4.6')
    $p = Run-Start
    foreach ($i in 1..40) { if (Test-Path "$dir\said-low-memory.txt") { break }; Start-Sleep -Milliseconds 250 }
    Start-Sleep -Seconds 1
    $said = if (Test-Path "$dir\said-low-memory.txt") { Get-Content "$dir\said-low-memory.txt" -Raw } else { '' }
    Check 'low memory: it waits and does not start the game' (!$p.HasExited -and !(Test-Path "$dir\launched.txt"))
    Check 'low memory: it says how much is free and who holds the most' ($said -like '*2.4 GB free, the game needs 10 GB*' -and $said -like '*Biggest: claude 19.5 GB, chrome 4.7 GB, SignalRgb 4.6 GB.*')
    Set-Content -LiteralPath "$dir\memory" -Value @('22.4', 'claude 1.8')
    $p.WaitForExit(20000) | Out-Null
    Check 'the game starts once there is room' ($p.HasExited -and (Test-Path "$dir\launched.txt"))
    if (!$p.HasExited) { $p.Kill() }
    Check 'check reports the memory' ((& $start -Check) -like '*; memory 22.4 GB free (10 needed; biggest claude 1.8 GB)')
    Set-Content -LiteralPath "$dir\memory" -Value 'not a number'; Reset-Case
    $p = Run-Start; $p.WaitForExit(20000) | Out-Null
    Check 'memory that cannot be read never stops the game' ($p.HasExited -and (Test-Path "$dir\launched.txt"))
    Remove-Item "$dir\memory"

    # Patch day: while Claude fixes the addons for a new patch the game waits, so it loads them finished.
    Reset-Case
    Set-Content -LiteralPath "$dir\patch-check.txt" -Value '1.60.2.71000|2026-10-20T08:41:00' -NoNewline
    $p = Run-Start
    foreach ($i in 1..40) { if (Test-Path "$dir\said-patch-check.txt") { break }; Start-Sleep -Milliseconds 250 }
    Start-Sleep -Seconds 1
    $said = if (Test-Path "$dir\said-patch-check.txt") { Get-Content "$dir\said-patch-check.txt" -Raw } else { '' }
    Check 'patch check running: it waits and does not start the game' (!$p.HasExited -and !(Test-Path "$dir\launched.txt"))
    Check 'patch check running: it names the patch and when the check started' ($said -like '*patch 1.60.2.71000 (started 8:41 AM)*')
    Remove-Item "$dir\patch-check.txt"
    $p.WaitForExit(20000) | Out-Null
    Check 'the game starts once the patch check is done' ($p.HasExited -and (Test-Path "$dir\launched.txt"))
    if (!$p.HasExited) { $p.Kill() }
    Reset-Case
    Set-Content -LiteralPath "$dir\patch-check.txt" -Value '1.60.2.71000|2026-10-20T08:41:00'
    (Get-Item "$dir\patch-check.txt").LastWriteTime = (Get-Date).AddHours(-2)
    $p = Run-Start; $p.WaitForExit(20000) | Out-Null
    Check 'a patch check that died never holds the game back' ($p.HasExited -and (Test-Path "$dir\launched.txt") -and !(Test-Path "$dir\said-patch-check.txt"))
    Reset-Case

    # Addon guard (..\addon-guard): addon code that breaks the controller is fixed before the game starts. The
    # stand-in guard.ps1 answers -Mode scan with guard-scan.txt's exit code; -Mode fix writes the patch-check file
    # for guard-fix.txt's seconds (no guard-fix.txt: it never writes it).
    Set-Content -LiteralPath "$dir\guard.ps1" -Value @(
        'param([string]$Mode)'
        "`$d = '$dir'"
        'Add-Content -LiteralPath "$d\guard-ran.txt" -Value $Mode'
        'if ($Mode -eq "scan") { exit [int](Get-Content -LiteralPath "$d\guard-scan.txt") }'
        'if (!(Test-Path -LiteralPath "$d\guard-fix.txt")) { exit 0 }'
        'Set-Content -LiteralPath "$d\patch-check.txt" -Value ("addons: Spoken_Quests|" + (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss")) -NoNewline'
        'Start-Sleep -Seconds ([int](Get-Content -LiteralPath "$d\guard-fix.txt"))'
        'Remove-Item -LiteralPath "$d\patch-check.txt"'
    )
    function Reset-Guard { Remove-Item "$dir\guard-ran.txt", "$dir\guard-fix.txt" -ErrorAction SilentlyContinue }
    Reset-Guard; Set-Content -LiteralPath "$dir\guard-scan.txt" -Value '0'
    $p = Run-Start; $p.WaitForExit(20000) | Out-Null
    Check 'guard: nothing new, the game starts without waiting' ($p.HasExited -and (Test-Path "$dir\launched.txt") -and !(Test-Path "$dir\said-patch-check.txt") -and @(Get-Content "$dir\guard-ran.txt") -join ',' -eq 'scan')
    Reset-Case; Reset-Guard; Set-Content -LiteralPath "$dir\guard-scan.txt" -Value '3'; Set-Content -LiteralPath "$dir\guard-fix.txt" -Value '5'
    $p = Run-Start
    foreach ($i in 1..60) { if (Test-Path "$dir\said-patch-check.txt") { break }; Start-Sleep -Milliseconds 250 }
    $said = if (Test-Path "$dir\said-patch-check.txt") { Get-Content "$dir\said-patch-check.txt" -Raw } else { '' }
    Check 'guard: a fix running, the game waits' (!(Test-Path "$dir\launched.txt"))
    Check 'guard: the window says it is fixing what an addon update broke' ($said -like '*Claude is fixing what an addon update broke (Spoken_Quests) (started*')
    $p.WaitForExit(30000) | Out-Null
    Check 'guard: the game starts once the fix is done' ($p.HasExited -and (Test-Path "$dir\launched.txt") -and @(Get-Content "$dir\guard-ran.txt") -join ',' -eq 'scan,fix')
    if (!$p.HasExited) { $p.Kill() }
    Reset-Case; Reset-Guard; Set-Content -LiteralPath "$dir\guard-scan.txt" -Value '3'
    $p = Run-Start; $p.WaitForExit(30000) | Out-Null
    Check 'guard: a fix that never starts does not hold the game back' ($p.HasExited -and (Test-Path "$dir\launched.txt") -and !(Test-Path "$dir\said-patch-check.txt"))
    Reset-Case; Reset-Guard; Remove-Item "$dir\guard.ps1", "$dir\guard-scan.txt"

    # CurseForge: it updates the addons it manages before the game starts, then closes. The stand-in updater does
    # what the files cf-sleep.txt (seconds), cf-result.txt (its lines) and cf-hook.txt (an addon file it writes) say.
    Set-Content -LiteralPath "$dir\curseforge.ps1" -Value @(
        'param([int]$TimeoutSec, [string]$ResultPath)'
        "`$d = '$dir'"
        'Set-Content -LiteralPath "$d\cf-ran.txt" -Value "$TimeoutSec|$(Test-Path "$d\launched.txt")"'
        'if (Test-Path "$d\cf-sleep.txt") { Start-Sleep -Seconds ([int](Get-Content "$d\cf-sleep.txt")) }'
        'if (Test-Path "$d\cf-hook.txt") { $h = @(Get-Content "$d\cf-hook.txt"); [IO.File]::WriteAllText($h[0], $h[1] + "`r`n") }'
        'if (Test-Path "$d\cf-result.txt") { Copy-Item "$d\cf-result.txt" $ResultPath }')
    function Set-CurseForge($sleep, [string[]]$result) {
        Remove-Item "$dir\cf-sleep.txt", "$dir\cf-result.txt", "$dir\cf-hook.txt" -ErrorAction SilentlyContinue
        if ($sleep) { Set-Content -LiteralPath "$dir\cf-sleep.txt" -Value $sleep }
        if ($result) { Set-Content -LiteralPath "$dir\cf-result.txt" -Value $result }
    }
    function Get-CurseForgeNote { if (Test-Path "$dir\said-curseforge.txt") { (Get-Content "$dir\said-curseforge.txt" -Raw).Trim() } else { '' } }
    Set-CurseForge 3 @('updated: MapUtils: MapUtils-v1.3.6-forever.zip -> MapUtils-v1.3.7-forever.zip', 'OK'); Reset-Case
    $p = Run-Start
    foreach ($i in 1..40) { if (Test-Path "$dir\cf-ran.txt") { break }; Start-Sleep -Milliseconds 250 }
    Start-Sleep -Milliseconds 500
    Check 'CurseForge: it updates before the game starts, and says so' (!$p.HasExited -and !(Test-Path "$dir\launched.txt") -and (Get-Content "$dir\cf-ran.txt") -eq '240|False' -and (Get-Content "$dir\said-curseforge-wait.txt" -Raw) -like 'Updating your addons through CurseForge.*')
    $p.WaitForExit(20000) | Out-Null
    $record = if (Test-Path "$dir\last-curseforge.txt") { @(Get-Content "$dir\last-curseforge.txt") } else { @() }
    Check 'CurseForge done: the game starts, no note' ($p.HasExited -and (Test-Path "$dir\launched.txt") -and !(Test-Path "$dir\said-curseforge.txt") -and !(Test-Path "$dir\curseforge-stopped.txt"))
    Check 'CurseForge done: what it updated is kept in last-curseforge.txt' ($record.Count -eq 3 -and $record[0] -like '* OK' -and $record[1] -like 'updated: MapUtils*' -and $record[2] -eq 'OK')
    Set-CurseForge 0 @('NOTHING'); Reset-Case
    $p = Run-Start; $p.WaitForExit(20000) | Out-Null
    Check 'CurseForge with nothing to update: the game starts, no note' ($p.HasExited -and (Test-Path "$dir\launched.txt") -and !(Test-Path "$dir\said-curseforge.txt"))
    Set-CurseForge 0 @('closing CurseForge failed: x', 'FAILED: CurseForge did not start'); Reset-Case
    $p = Run-Start; $p.WaitForExit(20000) | Out-Null
    Check 'CurseForge failed: the game starts anyway and a note says why' ($p.HasExited -and (Test-Path "$dir\launched.txt") -and (Get-CurseForgeNote) -eq 'CurseForge did not start. The game started anyway.')
    Set-CurseForge 0 $null; Reset-Case
    $p = Run-Start; $p.WaitForExit(20000) | Out-Null
    $ok = $p.HasExited -and (Test-Path "$dir\launched.txt") -and (Get-CurseForgeNote) -eq 'the updater stopped without a result. The game started anyway.'
    Check 'an updater that dies without a word: the game starts, a note says so' $ok
    if (!$ok) { Write-Output ("     exited {0}, launched {1}, note '{2}'" -f $p.HasExited, (Test-Path "$dir\launched.txt"), (Get-CurseForgeNote)) }
    $env:WOWFOREVER_CF_TIMEOUT = '1'
    Set-CurseForge 60 @('OK'); Reset-Case
    $p = Run-Start; $p.WaitForExit(25000) | Out-Null
    Check 'CurseForge too slow: it is stopped, the game starts, a note says so' ($p.HasExited -and (Test-Path "$dir\launched.txt") -and (Test-Path "$dir\curseforge-stopped.txt") -and (Get-CurseForgeNote) -eq 'CurseForge took over 3 seconds. The game started anyway.')
    $env:WOWFOREVER_CF_TIMEOUT = $null
    # The CurseForge window remembers being minimized (Levi, 2026-10-20): what is kept, then the real window.
    $winFile = "$dir\window-memory\curseforge-window.txt"
    Check 'window memory: nothing kept reads as Normal' ((Get-WindowMemory $winFile) -eq 'Normal')
    Save-WindowMemory $winFile 'Minimized'
    Check 'window memory: Minimized is kept, its folder made' ((Get-WindowMemory $winFile) -eq 'Minimized')
    Save-WindowMemory $winFile 'Maximized'
    Check 'window memory: Maximized is not kept' ((Get-WindowMemory $winFile) -eq 'Minimized')
    Save-WindowMemory $winFile 'Normal'
    Check 'window memory: Normal replaces Minimized' ((Get-WindowMemory $winFile) -eq 'Normal')
    Set-Content -LiteralPath $winFile -Value 'minimised please'
    Check 'window memory: anything else reads as Normal' ((Get-WindowMemory $winFile) -eq 'Normal')
    Remove-Item -LiteralPath "$dir\window-memory" -Recurse -Force
    # The window by its title among the start script's own windows. Not Process.MainWindowHandle: that skips hidden
    # and owned windows, and once the script has exited PowerShell reads it as $null (2026-10-20, first run on the PC).
    Add-Type -Namespace WoWForeverTest -Name Win -UsingNamespace System.Text -MemberDefinition @'
public delegate bool EnumProc(IntPtr h, IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
public static IntPtr Find(int pid, string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
        uint p;
        GetWindowThreadProcessId(h, out p);
        if (p != (uint)pid) return true;
        StringBuilder s = new StringBuilder(64);
        GetWindowText(h, s, 64);
        if (s.ToString() != title) return true;
        found = h;
        return false;
    }, IntPtr.Zero);
    return found;
}
'@
    # [IntPtr]::Zero when the window never came up; the wait after finding it lets the form finish showing itself.
    function Get-CurseForgeWindow($p) {
        foreach ($i in 1..40) {
            if ($p.HasExited) { break }
            $h = [WoWForeverTest.Win]::Find($p.Id, 'WoW Forever')
            if ($h -ne [IntPtr]::Zero) { Start-Sleep -Milliseconds 500; return $h }
            Start-Sleep -Milliseconds 250
        }
        return [IntPtr]::Zero
    }
    function Get-WindowFile { if (Test-Path "$dir\curseforge-window.txt") { (Get-Content "$dir\curseforge-window.txt" -Raw).Trim() } else { '' } }
    Remove-Item "$dir\curseforge-window.txt" -ErrorAction SilentlyContinue
    Set-CurseForge 5 @('OK'); Reset-Case
    $p = Run-Start; $w = Get-CurseForgeWindow $p
    Check 'CurseForge window: it opens on screen the first time' ($w -ne [IntPtr]::Zero -and ![WoWForeverTest.Win]::IsIconic($w))
    [WoWForeverTest.Win]::ShowWindow($w, 6) | Out-Null   # SW_MINIMIZE, as his click on the title bar does
    Start-Sleep -Milliseconds 500
    Check 'CurseForge window: minimizing it is kept' ((Get-WindowFile) -eq 'Minimized')
    $p.WaitForExit(20000) | Out-Null
    Check 'CurseForge window: minimized, the game still starts when it is done' ($p.HasExited -and (Test-Path "$dir\launched.txt"))
    Set-CurseForge 5 @('OK'); Reset-Case
    $p = Run-Start; $w = Get-CurseForgeWindow $p
    Check 'CurseForge window: the next one opens minimized' ($w -ne [IntPtr]::Zero -and [WoWForeverTest.Win]::IsIconic($w))
    [WoWForeverTest.Win]::ShowWindow($w, 9) | Out-Null   # SW_RESTORE, as his click on the taskbar button does
    Start-Sleep -Milliseconds 500
    Check 'CurseForge window: restoring it is kept' ((Get-WindowFile) -eq 'Normal')
    $p.WaitForExit(20000) | Out-Null
    Set-CurseForge 5 @('OK'); Reset-Case
    $p = Run-Start; $w = Get-CurseForgeWindow $p
    Check 'CurseForge window: after a restore it opens on screen again' ($w -ne [IntPtr]::Zero -and ![WoWForeverTest.Win]::IsIconic($w))
    $p.WaitForExit(20000) | Out-Null
    Remove-Item "$dir\curseforge-window.txt" -ErrorAction SilentlyContinue
    Set-CurseForge 0 @('OK'); Set-Content -LiteralPath "$dir\game-running.txt" -Value 'yes'; Reset-Case
    $p = Run-Start; $p.WaitForExit(20000) | Out-Null
    Check 'game open: CurseForge is not started' ((Test-Path "$dir\launched.txt") -and !(Test-Path "$dir\cf-ran.txt"))
    Remove-Item "$dir\game-running.txt"
    # The hook patcher runs after the update, so an update that puts a hook back is patched before the game starts.
    $cfAddon = "$dir\_classic_beta_\Interface\AddOns\DungeonJourney"
    New-Item -ItemType Directory -Path "$cfAddon\API" -Force | Out-Null
    Set-Content -LiteralPath "$cfAddon\DungeonJourney.toc" -Value '## Version: 8.8.8'
    [IO.File]::WriteAllText("$cfAddon\API\MapPins.lua", "local a = 1`r`n", (New-Object Text.UTF8Encoding $false))
    Set-CurseForge 0 @('updated: Forever: Dungeon Quest Journey', 'OK')
    Set-Content -LiteralPath "$dir\cf-hook.txt" -Value @("$cfAddon\API\MapPins.lua", '        if WorldMapFrame.SetMapID then pcall(hooksecurefunc,WorldMapFrame,"SetMapID",function() DJ.MapPins:Refresh() end) end'); Reset-Case
    $p = Run-Start; $p.WaitForExit(20000) | Out-Null
    $text = [IO.File]::ReadAllText("$cfAddon\API\MapPins.lua")
    Check 'a hook the CurseForge update puts back is taken out before the game starts' ((Test-Path "$dir\launched.txt") -and $text.Contains('Forever patch') -and !$text.Contains('hooksecurefunc,'))
    Remove-Item -LiteralPath "$dir\_classic_beta_" -Recurse -Force
    Remove-Item "$dir\curseforge.ps1"; Set-CurseForge 0 $null; Reset-Case

    # The memory watch: memory that runs out while the game is open crashes it too. Below 5 GB it quietly asks for the
    # archiver; only below 3 GB does it show anything, once per low spell and again only when a GB more is gone.
    $watch = Join-Path $PSScriptRoot 'Watch-Memory.ps1'
    function Get-Said { if (Test-Path "$dir\said-memory-warning.txt") { @(Get-Content "$dir\said-memory-warning.txt") } else { @() } }
    function Reset-Watch { Remove-Item "$dir\said-memory-warning.txt", "$dir\memory-warned.txt", "$dir\memory-toasted.txt", "$dir\game-running.txt", "$dir\archive-requested.txt" -ErrorAction SilentlyContinue }
    Reset-Watch
    Set-Content -LiteralPath "$dir\memory" -Value @('2.4', 'claude 19.5', 'chrome 4.7', 'SignalRgb 4.6')
    $out = & $watch -Once
    Check 'watch: game closed, it says nothing however low memory is' ($out -eq 'no game' -and (Get-Said).Count -eq 0 -and !(Test-Path "$dir\archive-requested.txt"))
    Set-Content -LiteralPath "$dir\game-running.txt" -Value 'yes'
    Set-Content -LiteralPath "$dir\memory" -Value @('20', 'WowB 6.6', 'claude 3.2')
    Check 'watch: game open with room, nothing is said' ((& $watch -Once) -eq 'ok' -and (Get-Said).Count -eq 0)
    Set-Content -LiteralPath "$dir\memory" -Value @('5.1', 'claude 19.5', 'WowB 6.6')
    Check 'watch: just above the limit, nothing is said' ((& $watch -Once) -eq 'ok' -and (Get-Said).Count -eq 0)
    Check 'watch: room enough, the archiver is not asked for' (!(Test-Path "$dir\archive-requested.txt"))
    Set-Content -LiteralPath "$dir\memory" -Value @('4.9', 'claude 8.3', 'WowB 6.4', 'vmmem 4.0')
    Check 'watch: just below 5 GB, it asks for the archiver and shows nothing' ((& $watch -Once) -eq 'archiving: 4.9 GB free' -and (Get-Said).Count -eq 0)
    Check 'watch: the archiver request says how much is free' ((Test-Path "$dir\archive-requested.txt") -and (Get-Content "$dir\archive-requested.txt" -Raw) -like '*4.9 GB free*')
    Remove-Item "$dir\archive-requested.txt" -ErrorAction SilentlyContinue
    Set-Content -LiteralPath "$dir\memory" -Value @('4.2', 'claude 8.3', 'WowB 6.4')
    Check 'watch: within 15 minutes the archiver is not asked again, and still nothing is shown' ((& $watch -Once) -eq 'low' -and !(Test-Path "$dir\archive-requested.txt") -and (Get-Said).Count -eq 0)
    Set-Content -LiteralPath "$dir\memory-warned.txt" -Value ([DateTime]::UtcNow.AddMinutes(-16).ToString('o'))
    Check 'watch: 16 minutes on and still low, the archiver is asked again' ((& $watch -Once) -eq 'archiving: 4.2 GB free' -and (Test-Path "$dir\archive-requested.txt") -and (Get-Said).Count -eq 0)
    Set-Content -LiteralPath "$dir\memory" -Value @('2.9', 'claude 19.5', 'WowB 6.6', 'chrome 4.7')
    $out = & $watch -Once
    $said = @(Get-Said)
    Check 'watch: below 3 GB, it warns once' ($out -like 'warned:*' -and $said.Count -eq 1)
    Check 'watch: the warning says how much is left, that it archives, and to restart the Claude app' ($said[0] -eq 'WoW Forever: memory almost gone / Only 2.9 GB of memory left. Finished Claude sessions are being archived. If that is not enough, restart the Claude app (19.5 GB) before the game runs out and crashes. Biggest: claude 19.5 GB, WowB 6.6 GB, chrome 4.7 GB.')
    Set-Content -LiteralPath "$dir\memory" -Value @('2.5', 'claude 20.1', 'WowB 6.6')
    Check 'watch: a little lower, it does not warn again' ((& $watch -Once) -eq 'warned already' -and (Get-Said).Count -eq 1)
    Set-Content -LiteralPath "$dir\memory-warned.txt" -Value ([DateTime]::UtcNow.AddMinutes(-16).ToString('o'))
    Check 'watch: a little lower 16 minutes on, it asks for the archiver but does not warn again' ((& $watch -Once) -eq 'archiving: 2.5 GB free' -and (Get-Said).Count -eq 1)
    Set-Content -LiteralPath "$dir\memory" -Value @('1.8', 'claude 21.0', 'WowB 6.6')
    Check 'watch: a GB worse than the last warning, it warns again' ((& $watch -Once) -like 'warned:*' -and @(Get-Said)[-1] -like '*Only 1.8 GB*restart the Claude app (21.0 GB)*' -and (Get-Said).Count -eq 2)
    Set-Content -LiteralPath "$dir\memory" -Value @('5.5', 'claude 19.5')
    Check 'watch: barely back over the limit, the warning stays' ((& $watch -Once) -eq 'ok' -and (Get-Said).Count -eq 2 -and (Test-Path "$dir\memory-toasted.txt"))
    Set-Content -LiteralPath "$dir\memory" -Value @('21', 'WowB 6.6', 'claude 1.8')
    Check 'watch: room again (Claude restarted), the warning goes by itself' ((& $watch -Once) -eq 'ok' -and (Get-Said).Count -eq 0 -and !(Test-Path "$dir\memory-toasted.txt"))
    Reset-Watch; Set-Content -LiteralPath "$dir\game-running.txt" -Value 'yes'
    Set-Content -LiteralPath "$dir\memory" -Value @('2.0', 'WowB 9.1', 'chrome 4.7', 'SignalRgb 4.6')
    Check 'watch: a new low spell warns afresh, the game itself biggest, it names the next one' ((& $watch -Once) -like 'warned:*' -and @(Get-Said)[0] -like '*restart chrome (4.7 GB) before*')
    Remove-Item "$dir\game-running.txt"
    Check 'watch: the game closed, the warning goes' ((& $watch -Once) -eq 'no game' -and (Get-Said).Count -eq 0 -and !(Test-Path "$dir\memory-toasted.txt"))
    Reset-Watch; Set-Content -LiteralPath "$dir\game-running.txt" -Value 'yes'
    Set-Content -LiteralPath "$dir\memory" -Value @('4.0', 'claude 8.3', 'WowB 6.4')
    Check 'watch: -ToastBelowGB shows the warning higher up' ((& $watch -Once -ToastBelowGB 4.5) -like 'warned:*' -and (Get-Said).Count -eq 1)
    Reset-Watch; Set-Content -LiteralPath "$dir\game-running.txt" -Value 'yes'
    Set-Content -LiteralPath "$dir\memory" -Value 'not a number'
    Check 'watch: memory that cannot be read says nothing and does not stop the watch' ((& $watch -Once) -eq 'not read' -and (Get-Said).Count -eq 0)
    Reset-Watch; Remove-Item "$dir\memory"

    # The live taint log: the game empties it at every /reload, so the watch keeps each session's copy.
    . (Join-Path $PSScriptRoot 'ForeverCommon.ps1')
    $logs = "$dir\_classic_beta_\Logs"
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    $live = "$logs\taint-live"
    Remove-Item -LiteralPath $live -Recurse -ErrorAction SilentlyContinue
    $taintState = @{}
    [IO.File]::WriteAllText("$logs\taint.log", 'one'); Copy-LiveTaintLog $taintState
    [IO.File]::WriteAllText("$logs\taint.log", 'one two'); Copy-LiveTaintLog $taintState
    $files = @(Get-ChildItem -LiteralPath $live)
    Check 'live taint: a growing log is one copy, kept up to date' ($files.Count -eq 1 -and (Get-Content $files[0].FullName -Raw) -eq 'one two')
    Start-Sleep -Seconds 1
    [IO.File]::WriteAllText("$logs\taint.log", 'n'); Copy-LiveTaintLog $taintState
    $files = @(Get-ChildItem -LiteralPath $live | Sort-Object Name)
    Check 'live taint: a /reload (a shorter log) starts a second copy and keeps the first' ($files.Count -eq 2 -and (Get-Content $files[0].FullName -Raw) -eq 'one two' -and (Get-Content $files[1].FullName -Raw) -eq 'n')
    [IO.File]::WriteAllText("$logs\taint.log", ''); Copy-LiveTaintLog $taintState
    Check 'live taint: an empty log copies nothing' (@(Get-ChildItem -LiteralPath $live).Count -eq 2)

    # The taint log: kept from the last session, and turned on for the next.
    $beta = "$dir\_classic_beta_"
    $kept = "$beta\Logs\taint-kept"
    New-Item -ItemType Directory -Path "$beta\Logs", "$beta\WTF" -Force | Out-Null
    $utf8 = New-Object Text.UTF8Encoding $false
    $config = "SET portal `"US`"`r`nSET lastCharacterName `"Sn" + [char]0xE4 + "ps`"`r`nSET InputDeviceInterfaceStyle `"1`"`r`n"
    function Set-Log($text, $when) { [IO.File]::WriteAllText("$beta\Logs\taint.log", $text);(Get-Item "$beta\Logs\taint.log").LastWriteTime = $when }
    Set-Blizzard $new '1.60.1.2'; Reset-Case
    [IO.File]::WriteAllText("$beta\WTF\Config.wtf", $config, $utf8)
    Set-Log 'blocked: the hang' ([DateTime]'2026-10-09 17:30:12')

    Set-Content -LiteralPath "$dir\game-running.txt" -Value 'yes'
    $p = Run-Start; $p.WaitForExit(20000) | Out-Null
    Check 'game open: its log and settings are left alone' ((Test-Path "$dir\launched.txt") -and !(Test-Path $kept) -and [IO.File]::ReadAllText("$beta\WTF\Config.wtf", $utf8) -eq $config)
    Remove-Item "$dir\game-running.txt"

    Reset-Case
    $p = Run-Start; $p.WaitForExit(20000) | Out-Null
    $copy = "$kept\taint-2026-10-09_17.30.12.log"
    Check 'the last session''s taint log is kept before the game starts' ((Test-Path "$dir\launched.txt") -and (Test-Path $copy) -and (Get-Content $copy -Raw).Trim() -eq 'blocked: the hang')
    Check 'the taint log is turned on, every other setting untouched' ([IO.File]::ReadAllText("$beta\WTF\Config.wtf", $utf8) -eq $config + "SET taintLog `"2`"`r`n")
    Check 'the settings file gets no byte order mark' ([IO.File]::ReadAllBytes("$beta\WTF\Config.wtf")[0] -eq 0x53)

    $before = (Get-Item "$beta\WTF\Config.wtf").LastWriteTimeUtc
    Reset-Case
    $p = Run-Start; $p.WaitForExit(20000) | Out-Null
    Check 'a second start keeps one copy and rewrites nothing' (@(Get-ChildItem $kept).Count -eq 1 -and (Get-Item "$beta\WTF\Config.wtf").LastWriteTimeUtc -eq $before)

    [IO.File]::WriteAllText("$beta\WTF\Config.wtf", "SET taintLog `"0`"`nSET portal `"US`"", $utf8)
    Set-Log '' ([DateTime]'2026-10-09 18:00:00')
    Reset-Case
    $p = Run-Start; $p.WaitForExit(20000) | Out-Null
    Check 'a log turned off is turned back on in place' ([IO.File]::ReadAllText("$beta\WTF\Config.wtf", $utf8) -eq "SET taintLog `"2`"`nSET portal `"US`"")
    Check 'an empty log is not kept' (@(Get-ChildItem $kept).Count -eq 1)

    foreach ($i in 1..12) { Set-Content -LiteralPath ("$kept\taint-2026-09-{0:00}_10.00.00.log" -f $i) -Value 'old' }
    Set-Log 'newest' ([DateTime]'2026-10-09 19:00:00')
    Reset-Case
    $p = Run-Start; $p.WaitForExit(20000) | Out-Null
    $names = @(Get-ChildItem $kept | Sort-Object Name | ForEach-Object Name)
    Check 'only the newest ten logs stay' ($names.Count -eq 10 -and $names[-1] -eq 'taint-2026-10-09_19.00.00.log' -and $names[0] -eq 'taint-2026-09-05_10.00.00.log')

    # Addon hooks: an update puts them back, the next start takes them out again.
    $addon = "$beta\Interface\AddOns\DungeonJourney"
    New-Item -ItemType Directory -Path "$addon\API" -Force | Out-Null
    Set-Content -LiteralPath "$addon\DungeonJourney.toc" -Value '## Version: 9.9.9'
    $hook = '        if WorldMapFrame.SetMapID then pcall(hooksecurefunc,WorldMapFrame,"SetMapID",function() DJ.MapPins:Refresh() end) end'
    [IO.File]::WriteAllText("$addon\API\MapPins.lua", "local a = 1`r`n$hook`r`nlocal b = 2`r`n", $utf8)
    Set-Content -LiteralPath "$dir\game-running.txt" -Value 'yes'; Reset-Case
    $p = Run-Start; $p.WaitForExit(20000) | Out-Null
    Check 'game open: its addons are left alone' ((Test-Path "$dir\launched.txt") -and [IO.File]::ReadAllText("$addon\API\MapPins.lua", $utf8).Contains($hook))
    Remove-Item "$dir\game-running.txt"; Reset-Case
    $p = Run-Start; $p.WaitForExit(20000) | Out-Null
    $patched = [IO.File]::ReadAllText("$addon\API\MapPins.lua", $utf8)
    Check 'an addon''s hook on a Blizzard frame method is taken out before the game starts' ((Test-Path "$dir\launched.txt") -and !$patched.Contains('hooksecurefunc,') -and $patched.Contains('Forever patch') -and $patched.StartsWith("local a = 1`r`n") -and $patched.EndsWith("local b = 2`r`n"))
    Check 'the addon''s own file is kept' ([IO.File]::ReadAllText("$beta\hook-patch-backups\DungeonJourney-9.9.9\API\MapPins.lua", $utf8).Contains($hook))
    Check 'a patch that fits says nothing' (!(Test-Path "$dir\said-misfit.txt"))
    [IO.File]::WriteAllText("$addon\API\MapPins.lua", "pcall(hooksecurefunc, WorldMapFrame, 'SetMapID', Refresh)`r`n", $utf8); Reset-Case
    $p = Run-Start; $p.WaitForExit(20000) | Out-Null
    Check 'an addon that no longer fits its patch: said, file untouched, the game still starts' ((Test-Path "$dir\launched.txt") -and (Get-Content "$dir\said-misfit.txt" -Raw) -like '*DungeonJourney 9.9.9 API/MapPins.lua: NOT PATCHED*' -and [IO.File]::ReadAllText("$addon\API\MapPins.lua", $utf8).StartsWith('pcall(hooksecurefunc, WorldMapFrame'))
    Remove-Item "$dir\said-misfit.txt"; Reset-Case
    $p = Run-Start; $p.WaitForExit(20000) | Out-Null
    Check 'the same misfit is said once' ((Test-Path "$dir\launched.txt") -and !(Test-Path "$dir\said-misfit.txt"))

    Remove-Item -LiteralPath $beta -Recurse -Force; Reset-Case
    $p = Run-Start; $p.WaitForExit(20000) | Out-Null
    Check 'no game folder: the game still starts' ($p.HasExited -and (Test-Path "$dir\launched.txt"))
} finally {
    $env:WOWFOREVER_TEST_DIR = $null
    $env:WOWFOREVER_GIVE_UP = $null
    $env:WOWFOREVER_CF_TIMEOUT = $null
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}
if ($failed) { Write-Output "$failed failed"; exit 1 }
Write-Output 'all passed'
