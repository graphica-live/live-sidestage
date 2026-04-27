param(
    [string]$NodeVersion,
    [switch]$CompileInstaller
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $projectRoot 'dist\windows'
$stagingRoot = Join-Path $distRoot 'app'
$appRoot = Join-Path $stagingRoot 'app'
$nodeRoot = Join-Path $stagingRoot 'node'
$tempRoot = Join-Path $distRoot 'tmp'
$installerOutputRoot = Join-Path $distRoot 'installer'
$launcherFiles = @(
    'Launch TikEffect.ps1',
    'Launch TikEffect.vbs',
    'Launch TikEffect Admin.cmd',
    'Launch TikEffect Admin.vbs',
    'Launch TikEffect Contributors Overlay.cmd',
    'Launch TikEffect Contributors Overlay.vbs'
)
$iconFiles = @(
    'TikEffect.ico',
    'TikEffect.png'
)
$launcherSourceRoot = Join-Path $projectRoot 'launcher\windows'
$iconSourceRoot = Join-Path $projectRoot 'assets\windows'
$installerScript = Join-Path $projectRoot 'installer\windows\TikEffect.iss'

if ([string]::IsNullOrWhiteSpace($NodeVersion)) {
    $NodeVersion = node -p "process.versions.node"
}

$nodeZipName = "node-v$NodeVersion-win-x64.zip"
$nodeDownloadUrl = "https://nodejs.org/dist/v$NodeVersion/$nodeZipName"
$nodeZipPath = Join-Path $tempRoot $nodeZipName
$nodeExtractRoot = Join-Path $tempRoot "node-v$NodeVersion-win-x64"
$bundledNodeExe = Join-Path $nodeRoot 'node.exe'
$bundledNpmCli = Join-Path $nodeRoot 'node_modules\npm\bin\npm-cli.js'

function Reset-Directory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    Remove-Item -Path $Path -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function Find-InnoSetupCompiler {
    $command = Get-Command 'ISCC.exe' -ErrorAction SilentlyContinue

    if ($command) {
        return $command.Source
    }

    $commonPaths = @(
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles(x86)\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
    )

    foreach ($candidate in $commonPaths) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
}

Write-Host 'Preparing Windows package staging directory...'

Write-Host 'Generating Windows launchers from shared config...'
node (Join-Path $projectRoot 'scripts\generate-windows-launchers.js')

if ($LASTEXITCODE -ne 0) {
    throw "Windows launcher generation failed with exit code $LASTEXITCODE"
}

Reset-Directory -Path $stagingRoot
Reset-Directory -Path $tempRoot
New-Item -ItemType Directory -Path $appRoot -Force | Out-Null
New-Item -ItemType Directory -Path $nodeRoot -Force | Out-Null
New-Item -ItemType Directory -Path $installerOutputRoot -Force | Out-Null

$itemsToCopy = @(
    'backend',
    'index.js',
    'overlays',
    'package.json',
    'package-lock.json',
    '.env.example'
)

foreach ($item in $itemsToCopy) {
    $sourcePath = Join-Path $projectRoot $item
    $targetPath = Join-Path $appRoot $item

    if (-not (Test-Path $sourcePath)) {
        throw "Required project item not found: $sourcePath"
    }

    Copy-Item -Path $sourcePath -Destination $targetPath -Recurse -Force
}

Write-Host "Downloading Node.js $NodeVersion portable runtime..."
Invoke-WebRequest -Uri $nodeDownloadUrl -OutFile $nodeZipPath

Write-Host 'Expanding Node.js runtime...'
Expand-Archive -Path $nodeZipPath -DestinationPath $tempRoot -Force
Copy-Item -Path (Join-Path $nodeExtractRoot '*') -Destination $nodeRoot -Recurse -Force

Write-Host 'Installing production dependencies into staging app with the bundled Node runtime...'
Push-Location $appRoot
try {
    & $bundledNodeExe $bundledNpmCli ci --omit=dev
} finally {
    Pop-Location
}

if ($LASTEXITCODE -ne 0) {
    throw "Bundled npm install failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path (Join-Path $appRoot 'node_modules\better-sqlite3'))) {
    throw 'better-sqlite3 was not installed in the staging directory.'
}

foreach ($launcherFile in $launcherFiles) {
    Copy-Item -Path (Join-Path $launcherSourceRoot $launcherFile) -Destination (Join-Path $stagingRoot $launcherFile) -Force
}

foreach ($iconFile in $iconFiles) {
    $iconSourcePath = Join-Path $iconSourceRoot $iconFile

    if (-not (Test-Path $iconSourcePath)) {
        throw "Required icon asset not found: $iconSourcePath"
    }

    Copy-Item -Path $iconSourcePath -Destination (Join-Path $stagingRoot $iconFile) -Force
}

Write-Host "Windows app staging is ready: $stagingRoot"
Write-Host 'Primary launchers: TikEffect Admin / TikEffect Contributors Overlay'

if (-not $CompileInstaller) {
    Write-Host 'Skipping installer compilation. Run with -CompileInstaller or npm run installer:windows to build setup.exe.'
    exit 0
}

$isccPath = Find-InnoSetupCompiler

if (-not $isccPath) {
    throw 'Inno Setup 6 (ISCC.exe) was not found. Install it or add ISCC.exe to PATH.'
}

Write-Host 'Compiling Windows installer...'
& $isccPath "/DSourceRoot=$stagingRoot" "/DOutputDir=$installerOutputRoot" $installerScript

if ($LASTEXITCODE -ne 0) {
    throw "Installer compilation failed with exit code $LASTEXITCODE"
}

Write-Host "Installer created under: $installerOutputRoot"