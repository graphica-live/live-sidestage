# Claude Code PostToolUse フック: 編集後に自動テストを実行する
# stdin から JSON を読み取り、対象ファイルの種類に応じてテストを選択実行する

param()

$j = [Console]::In.ReadToEnd() | ConvertFrom-Json
$f = if ($j.tool_input.file_path) { $j.tool_input.file_path } else { '' }

$isAdminHtml = $f -match 'backend[/\\]public[/\\]db[/\\].+\.html$'
$isJs        = $f -match '(backend|tests.unit|shared).*\.js$'

if (-not $isAdminHtml -and -not $isJs) { exit 0 }

Push-Location C:\dev\tiktok-app

# ── admin HTML 編集時: モーダルテスト同期 → playwright ──────────────────────
if ($isAdminHtml) {
    # 未テストのモーダルを admin.spec.js に自動追加
    $relPath = $f -replace '\\','/' -replace '^.*?backend/','backend/'
    & node scripts\sync-modal-tests.js $relPath 2>&1 | Out-Null

    $pw = & npx playwright test tests/visual/admin.spec.js --reporter=line 2>&1 | ForEach-Object {
        if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" }
    }
    Pop-Location

    $last6   = ($pw | Select-Object -Last 6) -join "`n"
    $hasFail = ($pw | Where-Object { $_ -match 'failed' }).Count -gt 0
    $hasPass = ($pw | Where-Object { $_ -match 'passed' }).Count -gt 0
    $status  = if ($hasFail) { 'FAIL' } elseif ($hasPass) { 'PASS' } else { 'ERROR' }
    $ctx     = "[playwright $status]`n$last6"

    @{
        systemMessage      = $ctx
        hookSpecificOutput = @{ hookEventName = 'PostToolUse'; additionalContext = $ctx }
    } | ConvertTo-Json -Compress
    exit 0
}

# ── JS 編集時: jest ────────────────────────────────────────────────────────────
$output = & npx jest --no-coverage 2>&1 | ForEach-Object {
    if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" }
}
Pop-Location

$last6  = ($output | Select-Object -Last 6) -join "`n"
$hasFail = ($output | Where-Object { $_ -match 'Tests:.*failed' }).Count -gt 0
$hasPass = ($output | Where-Object { $_ -match 'Tests:.*\d+ passed' }).Count -gt 0
$status  = if ($hasFail) { 'FAIL' } elseif ($hasPass) { 'PASS' } else { 'ERROR' }
$ctx     = "[jest $status]`n$last6"

@{
    systemMessage      = $ctx
    hookSpecificOutput = @{ hookEventName = 'PostToolUse'; additionalContext = $ctx }
} | ConvertTo-Json -Compress
