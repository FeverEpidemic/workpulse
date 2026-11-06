# Claude Code hook for this repo. "start" marks the session busy when a prompt arrives.
# "stop" clears the mark and, once no other session is busy, stops this repo's containers
# and dev processes. Supabase data volumes are kept, so `pnpm db:start` brings them back.
param(
  [ValidateSet('start', 'stop')][string]$Phase = 'stop',
  [switch]$DryRun
)

$hookInput = $null
if (-not $DryRun) {
  try { $hookInput = [Console]::In.ReadToEnd() | ConvertFrom-Json } catch { $hookInput = $null }
}
$sessionId = 'unknown'
if ($hookInput -and $hookInput.session_id) { $sessionId = $hookInput.session_id -replace '[^\w-]', '_' }

# The Supabase stack is shared by every worktree, so markers live in the common .git directory.
$gitDir = (git rev-parse --path-format=absolute --git-common-dir) -replace '/', '\'
$markerDir = Join-Path $gitDir 'claude-task-cleanup'
$marker = Join-Path $markerDir $sessionId

if ($Phase -eq 'start') {
  New-Item -ItemType Directory -Force $markerDir | Out-Null
  Set-Content -Path $marker -Value (Get-Date -Format o) -Encoding ascii
  exit 0
}

if (-not $DryRun) { Remove-Item $marker -Force -ErrorAction SilentlyContinue }

function Send-Result([string]$Text) {
  if ($DryRun) { Write-Output $Text } else { @{ systemMessage = $Text } | ConvertTo-Json -Compress }
}

# Marks older than 3 hours come from sessions that crashed or were closed mid-turn.
$cutoff = (Get-Date).AddHours(-3)
$busy = @(Get-ChildItem $markerDir -File -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -gt $cutoff -and $_.Name -ne $sessionId })
if ($busy.Count -gt 0) {
  Send-Result "Cleanup skipped: $($busy.Count) other session(s) still working."
  exit 0
}

$roots = @(git worktree list --porcelain |
  Where-Object { $_ -like 'worktree *' } |
  ForEach-Object { (($_ -replace '^worktree ', '') -replace '/', '\').TrimEnd('\').ToLower() + '\' })

$repoProcesses = @(Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='deno.exe'" |
  Where-Object {
    $line = ([string]$_.CommandLine -replace '/', '\').ToLower()
    $roots | Where-Object { $line.Contains($_) }
  })

# A test runner still going means background work this turn is waiting on, not a leftover.
$runners = @($repoProcesses | Where-Object { $_.CommandLine -match 'vitest|playwright' })
if ($runners.Count -gt 0) {
  Send-Result 'Cleanup skipped: a test run is still in progress.'
  exit 0
}

$done = @()
$mainRoot = Split-Path $gitDir -Parent

$supabase = @(docker ps -q --filter 'label=com.supabase.cli.project=WorkPulse' 2>$null)
if ($supabase.Count -gt 0) {
  if ($DryRun) {
    $done += "would run supabase stop ($($supabase.Count) containers)"
  } else {
    Push-Location $mainRoot
    pnpm exec supabase stop *> $null
    $stopped = $LASTEXITCODE -eq 0
    Pop-Location
    if ($stopped) { $done += "Supabase ($($supabase.Count) containers)" } else { $done += 'Supabase stop FAILED' }
  }
}

$helpers = @(docker ps --filter 'name=^workpulse-' --format '{{.Names}}' 2>$null)
if ($helpers.Count -gt 0) {
  if ($DryRun) {
    $done += "would stop $($helpers -join ', ')"
  } else {
    docker stop $helpers *> $null
    $done += ($helpers -join ', ')
  }
}

if ($repoProcesses.Count -gt 0) {
  if ($DryRun) {
    $done += "would end processes $(($repoProcesses | ForEach-Object { $_.ProcessId }) -join ', ')"
  } else {
    foreach ($process in $repoProcesses) { taskkill /PID $process.ProcessId /T /F *> $null }
    $done += "$($repoProcesses.Count) dev process(es)"
  }
}

if ($done.Count -gt 0) { Send-Result "Cleanup: $($done -join '; ')." }
exit 0
