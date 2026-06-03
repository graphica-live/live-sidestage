$ErrorActionPreference = "Stop"

# 1. Kill electron/node
Write-Host "[1/3] Stopping electron/node processes..."
Get-Process | Where-Object { $_.Name -match '^(electron|node)$' } | Stop-Process -Force -ErrorAction SilentlyContinue

# 2. Build
Write-Host "[2/3] Building..."
npm run build:windows
if ($LASTEXITCODE -ne 0) { throw "Build failed (exit $LASTEXITCODE)" }

# 3. Upload to R2
$version = (Get-Content package.json | ConvertFrom-Json).version
$bucket  = "graphica-produce-updates"
$prefix  = "tikcaption/win"

$files = @(
    "TikCaption Setup $version.exe",
    "TikCaption Setup $version.exe.blockmap",
    "latest.yml"
)

Write-Host "[3/3] Uploading to R2 (remote)..."
foreach ($f in $files) {
    Write-Host "  -> $f"
    npx wrangler r2 object put "$bucket/$prefix/$f" --file "dist/$f" --remote
    if ($LASTEXITCODE -ne 0) { throw "Upload failed: $f" }
}

Write-Host "Deploy complete: https://update.graphica-produce.com/$prefix"
