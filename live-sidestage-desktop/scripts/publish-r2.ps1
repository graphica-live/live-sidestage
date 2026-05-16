$ErrorActionPreference = 'Stop'

# Load .env if present
$envFile = Join-Path $PSScriptRoot '..\.env'
if (Test-Path $envFile) {
    Get-Content $envFile | Where-Object { $_ -match '^\s*([^#][^=]+)=(.*)$' } | ForEach-Object {
        $key, $val = $_ -split '=', 2
        if (-not [System.Environment]::GetEnvironmentVariable($key.Trim())) {
            [System.Environment]::SetEnvironmentVariable($key.Trim(), $val.Trim(), 'Process')
        }
    }
}

$pkg     = Get-Content -Raw (Join-Path $PSScriptRoot '..\package.json') | ConvertFrom-Json
$version = $pkg.version
$distDir = Join-Path $PSScriptRoot '..\dist\electron'
$bucket  = 'graphica-produce-updates'
$r2Base  = 'tikeffect/win'

$files = @(
    @{ local = "$distDir\latest.yml";                              remote = "$r2Base/latest.yml";                              type = 'text/yaml' },
    @{ local = "$distDir\TikEffect Setup $version.exe";            remote = "$r2Base/TikEffect Setup $version.exe";            type = 'application/octet-stream' },
    @{ local = "$distDir\TikEffect Setup $version.exe.blockmap";   remote = "$r2Base/TikEffect Setup $version.exe.blockmap";   type = 'application/octet-stream' }
)

Write-Host "[publish-r2] Uploading TikEffect v$version"

foreach ($f in $files) {
    if (Test-Path $f.local) {
        Write-Host "  -> $($f.remote)"
        wrangler r2 object put "$bucket/$($f.remote)" --file $f.local --content-type $f.type --remote
    } else {
        Write-Warning "  skip (not found): $($f.local)"
    }
}

Write-Host "[publish-r2] Done. https://update.graphica-produce.com/tikeffect/win"
