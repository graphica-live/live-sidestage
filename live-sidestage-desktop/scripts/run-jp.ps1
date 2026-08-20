$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# 開発中に既存のTikEffect(electron+loader)を確実に落としてから再起動し、
# 起動完了を待ってギフト日本語名エディタをブラウザで自動オープンする。
# `npm run run:jp` から実行する。

$RepoRoot = Split-Path -Parent $PSScriptRoot
$BackendPort = 38100
$LoaderPort = 38099
$EditorUrl = "http://localhost:$BackendPort/db/gift-ja-editor.html"

Write-Host "Stopping existing TikEffect processes..."

foreach ($port in @($BackendPort, $LoaderPort)) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $connections) {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "  stopping PID $($proc.Id) ($($proc.ProcessName)) on port $port"
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

# electron の renderer/gpu/utility 等の子プロセスはポートを直接掴んでいないため、
# 起動コマンドライン(このリポジトリのパス)で絞り込んで追加停止する。
Get-CimInstance Win32_Process -Filter "Name='electron.exe' or Name='node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($RepoRoot) } |
    ForEach-Object {
        Write-Host "  stopping PID $($_.ProcessId) ($($_.Name))"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

Start-Sleep -Seconds 1

Write-Host "Starting TikEffect (npm run run) in a new window..."
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "cd /d `"$RepoRoot`" && npm run run" -WindowStyle Normal

Write-Host "Waiting for backend on port $BackendPort..."
$deadline = (Get-Date).AddSeconds(90)
$ready = $false
while ((Get-Date) -lt $deadline) {
    $conn = Get-NetTCPConnection -LocalPort $BackendPort -State Listen -ErrorAction SilentlyContinue
    if ($conn) { $ready = $true; break }
    Start-Sleep -Seconds 1
}

if (-not $ready) {
    Write-Host "Timed out waiting for backend to start on port $BackendPort."
    exit 1
}

Write-Host "Backend is up. Opening $EditorUrl"
Start-Sleep -Seconds 1
Start-Process $EditorUrl
