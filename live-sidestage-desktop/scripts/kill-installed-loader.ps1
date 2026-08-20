$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# パッケージ済みインストール版は Windows スタートアップに登録され、
# TikEffect.exe --loader-only としてポート 38099 を常時待ち受けている。
# dev の loader-server（node.exe）が同じポートにバインドできず起動失敗するため、
# npm run run の前に既存インストール版のローダーを停止する。
$LOADER_PORT = 38099

$connections = Get-NetTCPConnection -LocalPort $LOADER_PORT -State Listen -ErrorAction SilentlyContinue

if (-not $connections) {
    Write-Host "No existing installed loader found on port $LOADER_PORT"
    exit 0
}

$processIds = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)

foreach ($processId in $processIds) {
    $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Host "Stopping existing installed loader (PID $processId, $($proc.ProcessName)) on port $LOADER_PORT"
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
}

Wait-Process -Id $processIds -Timeout 10 -ErrorAction SilentlyContinue
