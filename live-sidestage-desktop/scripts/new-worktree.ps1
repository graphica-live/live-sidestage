param(
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$BaseBranch = 'main'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$worktreesRoot = Join-Path $projectRoot '.worktrees'
$worktreePath = Join-Path $worktreesRoot $Name
$branchName = "wt/$Name"

if (Test-Path $worktreePath) {
    throw "Worktree already exists: $worktreePath"
}

New-Item -ItemType Directory -Force -Path $worktreesRoot | Out-Null

Write-Host "Creating worktree '$Name' on branch '$branchName' from '$BaseBranch'..."
git -C $projectRoot worktree add -b $branchName $worktreePath $BaseBranch

# node_modules はネイティブモジュールの再ビルド待ちを避けるため junction で共有する
$sourceModules = Join-Path $projectRoot 'node_modules'
$targetModules = Join-Path $worktreePath 'node_modules'
if ((Test-Path $sourceModules) -and -not (Test-Path $targetModules)) {
    cmd /c mklink /J "$targetModules" "$sourceModules" | Out-Null
    Write-Host 'node_modules を junction で共有しました'
}

# .env は git 管理外のため個別にコピーする
$sourceEnv = Join-Path $projectRoot '.env'
if (Test-Path $sourceEnv) {
    Copy-Item $sourceEnv (Join-Path $worktreePath '.env')
    Write-Host '.env をコピーしました'
}

Write-Host ""
Write-Host "完了: $worktreePath"
Write-Host "新しいタブ（Claude Codeセッション）はこのディレクトリを作業ディレクトリとして開始してください。"
Write-Host "不要になったら: git worktree remove .worktrees/$Name"
