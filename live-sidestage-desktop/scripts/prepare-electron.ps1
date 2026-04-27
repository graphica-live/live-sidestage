$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$electronRebuild = Join-Path $projectRoot 'node_modules\.bin\electron-rebuild.cmd'

if (-not (Test-Path $electronRebuild)) {
    throw "electron-rebuild was not found at $electronRebuild"
}

$workspaceProcesses = Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -match '^(electron|node)\.exe$') -and
    $_.ExecutablePath -and
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
& $electronRebuild -f better-sqlite3

if ($LASTEXITCODE -ne 0) {
    throw "electron-rebuild failed with exit code $LASTEXITCODE"
}