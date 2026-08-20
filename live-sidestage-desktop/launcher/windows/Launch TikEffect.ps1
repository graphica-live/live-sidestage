param(
    [string]$AppHome,

    [string]$AppDataDir,

    [string]$AutoOpenBrowser = '1',
    [string]$AppStartPath = '/admin',
    [int]$Port = 38100,
    [int]$StartupTimeoutSeconds = 20
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

if ([string]::IsNullOrWhiteSpace($AppHome)) {
    $AppHome = $PSScriptRoot
}

if ([string]::IsNullOrWhiteSpace($AppDataDir)) {
    $AppDataDir = Join-Path $env:LOCALAPPDATA 'TikEffect'
}

if (-not (Test-Path $AppDataDir)) {
    New-Item -ItemType Directory -Path $AppDataDir -Force | Out-Null
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$nodeExe = Join-Path $AppHome 'node\node.exe'
$serverRoot = Join-Path $AppHome 'app'
$entryScript = Join-Path $serverRoot 'index.js'
$healthUrl = "http://localhost:$Port/api/state"
$shutdownUrl = "http://localhost:$Port/api/app/exit"
$appUrl = "http://localhost:$Port$AppStartPath"
$iconPath = Join-Path $AppHome 'TikEffect.ico'
$launcherScriptPath = Join-Path $AppHome 'Launch TikEffect.ps1'
$powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$startupShortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'TikEffect.lnk'

$script:notifyIcon = $null
$script:contextMenu = $null
$script:monitorTimer = $null
$script:appContext = $null
$script:process = $null
$script:startupMenuItem = $null
$script:isExiting = $false
$script:isAttachedToExistingServer = $false

function Test-Truthy {
    param(
        [AllowNull()]
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $false
    }

    switch ($Value.Trim().ToLowerInvariant()) {
        '1' { return $true }
        'true' { return $true }
        'yes' { return $true }
        'on' { return $true }
        default { return $false }
    }
}

function Get-TrayIcon {
    if (Test-Path $iconPath) {
        try {
            return [System.Drawing.Icon]::new($iconPath)
        } catch {
            # Fall back to the default application icon.
        }
    }

    return [System.Drawing.SystemIcons]::Application
}

function ConvertTo-QuotedArgument {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    return '"' + $Value.Replace('"', '""') + '"'
}

function Test-StartupRegistration {
    return Test-Path $startupShortcutPath
}

function Update-StartupMenuItemState {
    if (-not $script:startupMenuItem) {
        return
    }

    $script:startupMenuItem.Checked = Test-StartupRegistration
}

function New-StartupShortcutArguments {
    $quotedLauncherPath = ConvertTo-QuotedArgument -Value $launcherScriptPath
    $quotedAppHome = ConvertTo-QuotedArgument -Value $AppHome
    $quotedAppDataDir = ConvertTo-QuotedArgument -Value $AppDataDir
    $quotedAppStartPath = ConvertTo-QuotedArgument -Value $AppStartPath

    return "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $quotedLauncherPath -AppHome $quotedAppHome -AppDataDir $quotedAppDataDir -AutoOpenBrowser 0 -AppStartPath $quotedAppStartPath -Port $Port"
}

function Set-StartupRegistration {
    param(
        [Parameter(Mandatory = $true)]
        [bool]$Enabled
    )

    if ($Enabled) {
        $startupDirectory = Split-Path -Parent $startupShortcutPath

        if (-not (Test-Path $startupDirectory)) {
            New-Item -ItemType Directory -Path $startupDirectory -Force | Out-Null
        }

        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($startupShortcutPath)
        $shortcut.TargetPath = $powershellExe
        $shortcut.Arguments = New-StartupShortcutArguments
        $shortcut.WorkingDirectory = $AppHome

        if (Test-Path $iconPath) {
            $shortcut.IconLocation = "$iconPath,0"
        }

        $shortcut.Description = 'TikEffect を Windows 起動時に開始します。'
        $shortcut.Save()
    } else {
        Remove-Item -Path $startupShortcutPath -Force -ErrorAction SilentlyContinue
    }

    Update-StartupMenuItemState
}

function Switch-StartupRegistration {
    $enableStartup = -not (Test-StartupRegistration)
    Set-StartupRegistration -Enabled $enableStartup

    if (-not $script:notifyIcon) {
        return
    }

    if ($enableStartup) {
        $script:notifyIcon.ShowBalloonTip(
            2500,
            'TikEffect',
            'Windows のスタートアップに登録しました。',
            [System.Windows.Forms.ToolTipIcon]::Info
        )
        return
    }

    $script:notifyIcon.ShowBalloonTip(
        2500,
        'TikEffect',
        'Windows のスタートアップ登録を解除しました。',
        [System.Windows.Forms.ToolTipIcon]::Info
    )
}

function Set-NotifyText {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text
    )

    if (-not $script:notifyIcon) {
        return
    }

    $normalized = $Text.Trim()
    if ($normalized.Length -gt 63) {
        $normalized = $normalized.Substring(0, 63)
    }

    $script:notifyIcon.Text = $normalized
}

function Test-AppReady {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    } catch {
        return $false
    }
}

function Open-AdminPage {
    Start-Process $appUrl | Out-Null
}

function Wait-UntilAppStops {
    param(
        [int]$TimeoutSeconds = 10
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        if (-not (Test-AppReady)) {
            return $true
        }

        Start-Sleep -Milliseconds 300
    }

    return -not (Test-AppReady)
}

function Invoke-AppShutdown {
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $shutdownUrl -Method Post -TimeoutSec 3 | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Clear-TrayResources {
    if ($script:monitorTimer) {
        $script:monitorTimer.Stop()
        $script:monitorTimer.Dispose()
        $script:monitorTimer = $null
    }

    if ($script:contextMenu) {
        $script:contextMenu.Dispose()
        $script:contextMenu = $null
    }

    if ($script:notifyIcon) {
        $script:notifyIcon.Visible = $false
        $script:notifyIcon.Dispose()
        $script:notifyIcon = $null
    }
}

function Exit-TrayApplication {
    if ($script:isExiting) {
        return
    }

    $script:isExiting = $true
    Set-NotifyText -Text 'TikEffect | 終了中'

    $shutdownRequested = Invoke-AppShutdown
    if ($shutdownRequested) {
        [void](Wait-UntilAppStops -TimeoutSeconds 10)
    }

    if ($script:process -and -not $script:process.HasExited) {
        try {
            Stop-Process -Id $script:process.Id -Force
        } catch {
            # Ignore process cleanup failures during shutdown.
        }
    }

    Clear-TrayResources

    if ($script:appContext) {
        $script:appContext.ExitThread()
    }
}

function Start-AppMonitor {
    $script:monitorTimer = New-Object System.Windows.Forms.Timer
    $script:monitorTimer.Interval = 1000
    $script:monitorTimer.Add_Tick({
        if ($script:isExiting) {
            return
        }

        if ($script:process) {
            if (-not $script:process.HasExited) {
                return
            }

            $script:notifyIcon.ShowBalloonTip(
                2500,
                'TikEffect',
                'アプリが終了しました。',
                [System.Windows.Forms.ToolTipIcon]::Info
            )

            Clear-TrayResources

            if ($script:appContext) {
                $script:appContext.ExitThread()
            }

            return
        }

        if (-not (Test-AppReady)) {
            $script:notifyIcon.ShowBalloonTip(
                2500,
                'TikEffect',
                '既存のアプリ接続が終了しました。',
                [System.Windows.Forms.ToolTipIcon]::Info
            )

            Clear-TrayResources

            if ($script:appContext) {
                $script:appContext.ExitThread()
            }
        }
    })
    $script:monitorTimer.Start()
}

function Start-AppProcess {
    if (Test-AppReady) {
        $script:isAttachedToExistingServer = $true
        return $null
    }

    if (-not (Test-Path $nodeExe)) {
        throw "Bundled Node.js runtime was not found: $nodeExe"
    }

    if (-not (Test-Path $entryScript)) {
        throw "Application entry script was not found: $entryScript"
    }

    $processStartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $processStartInfo.FileName = $nodeExe
    $processStartInfo.Arguments = '"' + $entryScript + '"'
    $processStartInfo.WorkingDirectory = $serverRoot
    $processStartInfo.UseShellExecute = $false
    $processStartInfo.CreateNoWindow = $true
    $processStartInfo.EnvironmentVariables['APP_DATA_DIR'] = $AppDataDir
    $processStartInfo.EnvironmentVariables['AUTO_OPEN_BROWSER'] = '0'
    $processStartInfo.EnvironmentVariables['APP_START_PATH'] = $AppStartPath

    $process = [System.Diagnostics.Process]::Start($processStartInfo)

    if (-not $process) {
        throw 'Failed to start TikEffect.'
    }

    $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500

        if ($process.HasExited) {
            throw "TikEffect terminated during startup. Exit code: $($process.ExitCode)"
        }

        if (Test-AppReady) {
            return $process
        }
    }

    try {
        if (-not $process.HasExited) {
            Stop-Process -Id $process.Id -Force
        }
    } catch {
        # Ignore cleanup errors on timeout.
    }

    throw "TikEffect did not become ready within $StartupTimeoutSeconds seconds."
}

try {
    [System.Windows.Forms.Application]::EnableVisualStyles()

    $script:process = Start-AppProcess
    $script:appContext = New-Object System.Windows.Forms.ApplicationContext
    $script:notifyIcon = New-Object System.Windows.Forms.NotifyIcon
    $script:notifyIcon.Icon = Get-TrayIcon
    $script:notifyIcon.Visible = $true
    Set-NotifyText -Text 'TikEffect'

    $script:contextMenu = New-Object System.Windows.Forms.ContextMenuStrip
    $openItem = $script:contextMenu.Items.Add('管理画面を開く')
    $script:startupMenuItem = New-Object System.Windows.Forms.ToolStripMenuItem 'Windowsのスタートアップに登録する'
    $script:startupMenuItem.CheckOnClick = $false
    Update-StartupMenuItemState
    [void]$script:contextMenu.Items.Add($script:startupMenuItem)
    $exitItem = $script:contextMenu.Items.Add('終了')
    $openItem.Add_Click({
        Open-AdminPage
    })
    $script:startupMenuItem.Add_Click({
        Switch-StartupRegistration
    })
    $exitItem.Add_Click({
        Exit-TrayApplication
    })

    $script:notifyIcon.ContextMenuStrip = $script:contextMenu
    $script:notifyIcon.Add_MouseClick({
        if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
            Open-AdminPage
        }
    })

    Start-AppMonitor

    if (Test-Truthy -Value $AutoOpenBrowser) {
        Open-AdminPage
    }

    if ($script:isAttachedToExistingServer) {
        $script:notifyIcon.ShowBalloonTip(
            2500,
            'TikEffect',
            '既に起動しているアプリに接続しました。',
            [System.Windows.Forms.ToolTipIcon]::Info
        )
    } else {
        $script:notifyIcon.ShowBalloonTip(
            2500,
            'TikEffect',
            'タスクバーの通知領域から管理画面表示と終了ができます。',
            [System.Windows.Forms.ToolTipIcon]::Info
        )
    }

    [System.Windows.Forms.Application]::Run($script:appContext)
} catch {
    Clear-TrayResources
    [System.Windows.Forms.MessageBox]::Show(
        $_.Exception.Message,
        'TikEffect',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    exit 1
} finally {
    Clear-TrayResources
}