# Updates the addons CurseForge manages in the Forever folder with CurseForge's own updater, then closes CurseForge.
# Start-WoWForever.ps1 runs it before the game starts. CurseForge has no command-line switch or link for "update
# all", so this starts it minimized and sends its mods agent (Curse.Agent.Host) the same "updateAllAddons" request
# the app's Update all button sends, over the agent's local WebSocket, with the key the app gave the agent at start.
# Only the projects in CurseForge's list of installed addons are touched; addons it doesn't know are left alone.
# Prints one line per addon that changed, then the last line: OK, NOTHING (all current), or FAILED: <why>.
# -ResultPath: the same lines go to that file. -Probe: ask the agent for the instance only, update nothing.
# ASCII only.
param([int]$TimeoutSec = 240, [string]$ResultPath = '', [switch]$Probe, [switch]$LeaveOpen)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ForeverCommon.ps1')
$exe =Join-Path $env:LOCALAPPDATA 'Programs\CurseForge Windows\CurseForge.exe'
$instanceId = 'bc0cce03-10dd-4cbb-9a2c-e6e7769eafbc'   # CurseForge's "Forever" instance: D:\Games\World of Warcraft\_classic_beta_
$db = Join-Path $env:APPDATA 'CurseForge\agent\GameInstances\AddonGameInstance.json'
$logs = Join-Path $env:APPDATA 'CurseForge\logs'
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$out = New-Object Collections.Generic.List[string]

function Say([string]$line) {
    $out.Add($line)
    Write-Output $line
}

# Every addon CurseForge has installed in the instance: id -> name, installed file and newest file it knows of.
function Get-Installed {
    $all = [IO.File]::ReadAllText($db) | ConvertFrom-Json
    $instance = $all | Where-Object { $_.guid -eq $instanceId }
    if (!$instance) { throw "CurseForge has no instance $instanceId" }
    $map = @{}
    foreach ($a in $instance.installedAddons) {
        $map[[string]$a.addonID] = [pscustomobject]@{
            Name = $a.name; FileId = $a.installedFile.id; File = $a.installedFile.fileName
            LatestId = if ($a.latestFile) { $a.latestFile.id } else { $a.installedFile.id }
        }
    }
    return $map
}

function Get-Agent {
    $p = Get-CimInstance Win32_Process -Filter "Name='Curse.Agent.Host.exe'" | Select-Object -First 1
    if (!$p -or $p.CommandLine -notmatch '--api-key=([0-9a-fA-F-]+)') { return $null }
    $key = $Matches[1]
    $port = Get-NetTCPConnection -OwningProcess $p.ProcessId -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalAddress -eq '127.0.0.1' } | Select-Object -First 1 -ExpandProperty LocalPort
    if (!$port) { return $null }
    return [pscustomobject]@{ Pid = $p.ProcessId; Key = $key; Port = $port }
}

# A log file CurseForge still has open.
function Read-Shared([string]$path) {
    $fs = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
    try { return (New-Object IO.StreamReader $fs).ReadToEnd() } finally { $fs.Dispose() }
}

# The app logs "Mods agent was initialized successfully" once the agent can take requests, and "Scan complete ...
# <instance>" once it has looked at the AddOns folder. Returns 'init', 'scan' or $null for the agent with this pid.
function Get-AgentReadiness([int]$agentPid) {
    $files = Get-ChildItem -LiteralPath $logs -Directory | Sort-Object Name -Descending | Select-Object -First 3 |
        ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Filter 'main-*.log' }
    foreach ($f in $files) {
        $text = Read-Shared $f.FullName
        $at = $text.IndexOf("Mods Agent started. pid: $agentPid,")
        if ($at -lt 0) { continue }
        $rest = $text.Substring($at)
        if ($rest -notmatch 'Mods agent was initialized successfully') { return $null }
        if ($rest -match "Scan complete for game 1 - [^\r\n]* - $instanceId") { return 'scan' }
        return 'init'
    }
    return $null
}

# Sends one request to the agent and waits for its answer: the "result" of the callback with the same id.
function Invoke-Agent($agent, [string]$name, [object[]]$arguments) {
    $ws = New-Object Net.WebSockets.ClientWebSocket
    $ws.Options.SetRequestHeader('Origin', 'cfapp')   # the agent turns away any other origin, as the app's own client sends
    $ct = [Threading.CancellationToken]::None
    try {
        if (!$ws.ConnectAsync([Uri]"ws://127.0.0.1:$($agent.Port)/CurseForge", $ct).Wait(10000)) { throw 'no answer from the CurseForge agent' }
        $id = 900000 + (Get-Random -Maximum 99999)
        $json = ConvertTo-Json -Compress -Depth 5 ([ordered]@{ id = $id; apiKey = $agent.Key; args = $arguments; type = 'method'; name = $name })
        $bytes = [Text.Encoding]::UTF8.GetBytes($json)
        $ws.SendAsync((New-Object 'ArraySegment[byte]' -ArgumentList @(, $bytes)), 'Text', $true, $ct).Wait(10000) | Out-Null
        $buffer = New-Object byte[] 65536
        $message = New-Object IO.MemoryStream
        while ($true) {
            $left = ($deadline - (Get-Date)).TotalMilliseconds
            if ($left -le 0) { throw "CurseForge took over $TimeoutSec seconds" }
            $task = $ws.ReceiveAsync((New-Object 'ArraySegment[byte]' -ArgumentList @(, $buffer)), $ct)
            if (!$task.Wait([int][Math]::Min($left, 2147483647))) { throw "CurseForge took over $TimeoutSec seconds" }
            if ($task.Result.MessageType -eq 'Close') { throw 'the CurseForge agent closed the connection' }
            $message.Write($buffer, 0, $task.Result.Count)
            if (!$task.Result.EndOfMessage) { continue }
            $text = [Text.Encoding]::UTF8.GetString($message.ToArray())
            $message.SetLength(0)
            $reply = $text | ConvertFrom-Json
            if ($reply.type -eq 'callback' -and $reply.id -eq $id) { return $reply.result }
        }
    } finally { $ws.Dispose() }
}

function Close-CurseForge {
    Stop-CurseForge
    Start-Sleep -Milliseconds 500
    if (Get-Process -Name CurseForge, Curse.Agent.Host -ErrorAction SilentlyContinue) { Say 'CurseForge is still running' }
}

$status = $null
try {
    if (!(Test-Path -LiteralPath $exe)) { throw 'CurseForge is not installed' }
    $before = Get-Installed
    if (!(Get-Process -Name CurseForge -ErrorAction SilentlyContinue)) { Start-Process -FilePath $exe -ArgumentList '--minimized' }

    # Wait for the agent to be up and to have scanned the folder; a scan that never comes is not worth waiting for.
    $agent = $null
    $scanUntil = $null
    while ($true) {
        if ((Get-Date) -gt $deadline) { throw 'CurseForge did not start' }
        $agent = Get-Agent
        $ready = if ($agent) { Get-AgentReadiness $agent.Pid }
        if ($ready -eq 'scan') { break }
        if ($ready -eq 'init') {
            if (!$scanUntil) { $scanUntil = (Get-Date).AddSeconds(20) }
            elseif ((Get-Date) -gt $scanUntil) { break }
        }
        Start-Sleep -Milliseconds 500
    }

    if ($Probe) {
        $r = Invoke-Agent $agent 'getGameInstancesByIds' @(, @($instanceId))
        Say ("probe: success={0} error={1} data={2}" -f $r.success, $r.error, ((ConvertTo-Json -Compress -Depth 3 $r.data) -replace '(.{300}).*', '$1...'))
        $status = 'OK'
    } else {
        $r = Invoke-Agent $agent 'updateAllAddons' @($instanceId)
        if (!$r.success) { throw "CurseForge said: $($r.error)" }
        # The answer can come before the last file is in place: wait until CurseForge's own list has every addon on
        # its newest file.
        while ($true) {
            $after = Get-Installed
            $behind = @($after.Values | Where-Object { $_.FileId -ne $_.LatestId })
            if (!$behind.Count) { break }
            if ((Get-Date) -gt $deadline) { throw ('still not updated: ' + (($behind | ForEach-Object { $_.Name }) -join ', ')) }
            Start-Sleep -Seconds 1
        }
        foreach ($key in $after.Keys) {
            $was = $before[$key]
            if (!$was) { Say "added: $($after[$key].Name) $($after[$key].File)" }
            elseif ($was.FileId -ne $after[$key].FileId) { Say "updated: $($after[$key].Name): $($was.File) -> $($after[$key].File)" }
        }
        $status = if ($out.Count) { 'OK' } else { 'NOTHING' }
    }
} catch {
    $status = "FAILED: $($_.Exception.GetBaseException().Message)"
} finally {
    if (!$LeaveOpen) { try { Close-CurseForge } catch { Say "closing CurseForge failed: $($_.Exception.Message)" } }
}
Say $status
if ($ResultPath) { [IO.File]::WriteAllLines($ResultPath, $out) }
