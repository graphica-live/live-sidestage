$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$electronRebuild = Join-Path $projectRoot 'node_modules\.bin\electron-rebuild.cmd'

if (-not (Test-Path $electronRebuild)) {
    throw "electron-rebuild was not found at $electronRebuild"
}

# 自分自身の祖先プロセス（concurrently 経由で loader と同時起動した場合の親プロセスなど）は
# 誤って巻き込んで停止しないよう除外する
$excludePids = @($PID)
$currentId = $PID
while ($true) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$currentId" -ErrorAction SilentlyContinue
    if (-not $proc -or -not $proc.ParentProcessId -or $proc.ParentProcessId -eq 0) { break }
    $excludePids += $proc.ParentProcessId
    $currentId = $proc.ParentProcessId
}

$workspaceProcesses = Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -match '^(electron|node)\.exe$') -and
    $_.ExecutablePath -and
    ($excludePids -notcontains $_.ProcessId) -and
    (
        ($_.ExecutablePath -like "$projectRoot*") -or
        ($_.CommandLine -like "*$projectRoot*")
    )
}

if ($workspaceProcesses) {
    $processIds = @($workspaceProcesses | Select-Object -ExpandProperty ProcessId)
    Write-Host "Stopping workspace Electron/Node processes: $($processIds -join ', ')"
    $workspaceProcesses | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Wait-Process -Id $processIds -Timeout 15 -ErrorAction SilentlyContinue
}

Write-Host 'Running electron-rebuild for better-sqlite3...'
$ErrorActionPreference = 'Continue'
& $electronRebuild -f -o better-sqlite3
$rebuildExitCode = $LASTEXITCODE
$ErrorActionPreference = 'Stop'

if ($rebuildExitCode -ne 0) {
    Write-Warning "electron-rebuild exited with code $rebuildExitCode (continuing)"
}