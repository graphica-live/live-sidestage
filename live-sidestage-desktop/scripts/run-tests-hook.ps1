# Claude Code PostToolUse フック: JS編集後にユニットテストを自動実行する
# stdin から JSON を読み取り、対象ファイルの場合のみ jest を実行する

param()

$j = [Console]::In.ReadToEnd() | ConvertFrom-Json
$f = if ($j.tool_input.file_path) { $j.tool_input.file_path } else { '' }

# backend/ tests/unit/ shared/ の .js ファイルのみ対象
if ($f -notmatch '(backend|tests.unit|shared).*\.js$') { exit 0 }

Push-Location C:\dev\tiktok-app
$output = & npx jest --no-coverage 2>&1 | ForEach-Object {
    if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" }
}
Pop-Location

$last6 = ($output | Select-Object -Last 6) -join "`n"
$hasFail = ($output | Where-Object { $_ -match 'Tests:.*failed' }).Count -gt 0
$hasPass = ($output | Where-Object { $_ -match 'Tests:.*\d+ passed' }).Count -gt 0

$status = if ($hasFail) { 'FAIL' } elseif ($hasPass) { 'PASS' } else { 'ERROR' }
$label  = "[jest $status]"
$ctx    = "$label`n$last6"

@{
    systemMessage     = $ctx
    hookSpecificOutput = @{
        hookEventName  = 'PostToolUse'
        additionalContext = $ctx
    }
} | ConvertTo-Json -Compress
