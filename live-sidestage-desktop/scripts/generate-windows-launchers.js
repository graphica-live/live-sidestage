const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const configPath = path.join(__dirname, 'windows-launchers.config.json');
const launcherRoot = path.join(projectRoot, 'launcher', 'windows');
const installerGeneratedIconsPath = path.join(projectRoot, 'installer', 'windows', 'generated-launchers-icons.iss');
const installerGeneratedRunPath = path.join(projectRoot, 'installer', 'windows', 'generated-launchers-run.iss');

function loadConfig() {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function escapeVbsString(value) {
    return String(value).replace(/"/g, '""');
}

function createCmdContent(entry) {
    return [
        '@echo off',
        'setlocal',
        '',
        'set "APP_HOME=%~dp0"',
        'if "%APP_HOME:~-1%"=="\\" set "APP_HOME=%APP_HOME:~0,-1%"',
        'set "LAUNCHER_SCRIPT=%APP_HOME%\\Launch TikEffect.ps1"',
        '',
        'if "%APP_DATA_DIR%"=="" set "APP_DATA_DIR=%LOCALAPPDATA%\\TikEffect"',
        'if "%AUTO_OPEN_BROWSER%"=="" set "AUTO_OPEN_BROWSER=1"',
        '',
        'chcp 65001 >nul',
        '',
        `PowerShell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%LAUNCHER_SCRIPT%" -AppHome "%APP_HOME%" -AppDataDir "%APP_DATA_DIR%" -AutoOpenBrowser "%AUTO_OPEN_BROWSER%" -AppStartPath "${entry.appStartPath}"`,
        '',
        'endlocal',
        ''
    ].join('\r\n');
}

function createVbsContent(entry) {
    return [
        'Option Explicit',
        '',
        'Dim shell',
        'Dim fileSystem',
        'Dim scriptDirectory',
        'Dim launcherScript',
        'Dim powershellPath',
        'Dim appDataDirectory',
        'Dim command',
        '',
        'Set shell = CreateObject("WScript.Shell")',
        'Set fileSystem = CreateObject("Scripting.FileSystemObject")',
        '',
        'scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)',
        'launcherScript = fileSystem.BuildPath(scriptDirectory, "Launch TikEffect.ps1")',
        'powershellPath = shell.ExpandEnvironmentStrings("%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")',
        'appDataDirectory = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\\TikEffect")',
        '',
        'command = Quote(powershellPath) _',
        '    & " -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File " & Quote(launcherScript) _',
        '    & " -AppHome " & Quote(scriptDirectory) _',
        '    & " -AppDataDir " & Quote(appDataDirectory) _',
        `    & " -AutoOpenBrowser 1 -AppStartPath ${escapeVbsString(entry.appStartPath)}"`,
        '',
        'shell.Run command, 0, False',
        '',
        'Function Quote(value)',
        '    Quote = Chr(34) & value & Chr(34)',
        'End Function',
        ''
    ].join('\r\n');
}

function createInstallerIconsInclude(entries) {
    const lines = [];

    entries.filter((entry) => entry.includeInInstaller).forEach((entry) => {
        if (entry.includeInProgramGroup) {
            lines.push(`Name: "{autoprograms}\\${entry.programGroupShortcutName}"; Filename: "{app}\\${entry.fileBaseName}.vbs"; WorkingDir: "{app}"; IconFilename: "{app}\\TikEffect.ico"`);
        }

        if (entry.includeInDesktop) {
            lines.push(`Name: "{autodesktop}\\${entry.desktopShortcutName}"; Filename: "{app}\\${entry.fileBaseName}.vbs"; WorkingDir: "{app}"; IconFilename: "{app}\\TikEffect.ico"`);
        }
    });

    lines.push('');
    return lines.join('\r\n');
}

function createInstallerRunInclude(entries) {
    const lines = [];

    entries.filter((entry) => entry.includeInInstaller && entry.includeInRunSection).forEach((entry) => {
        lines.push(`Filename: "{app}\\${entry.fileBaseName}.vbs"; Description: "${entry.runShortcutDescription}"; Flags: nowait postinstall skipifsilent`);
    });

    lines.push('');
    return lines.join('\r\n');
}

function main() {
    const entries = loadConfig();

    entries.forEach((entry) => {
        fs.writeFileSync(path.join(launcherRoot, `${entry.fileBaseName}.cmd`), createCmdContent(entry), 'utf8');
        fs.writeFileSync(path.join(launcherRoot, `${entry.fileBaseName}.vbs`), createVbsContent(entry), 'utf8');
    });

    fs.writeFileSync(installerGeneratedIconsPath, createInstallerIconsInclude(entries), 'utf8');
    fs.writeFileSync(installerGeneratedRunPath, createInstallerRunInclude(entries), 'utf8');
}

main();