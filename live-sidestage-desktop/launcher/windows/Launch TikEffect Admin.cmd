@echo off
setlocal

set "APP_HOME=%~dp0"
if "%APP_HOME:~-1%"=="\" set "APP_HOME=%APP_HOME:~0,-1%"
set "LAUNCHER_SCRIPT=%APP_HOME%\Launch TikEffect.ps1"

if "%APP_DATA_DIR%"=="" set "APP_DATA_DIR=%LOCALAPPDATA%\TikEffect"
if "%AUTO_OPEN_BROWSER%"=="" set "AUTO_OPEN_BROWSER=1"

chcp 65001 >nul

PowerShell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%LAUNCHER_SCRIPT%" -AppHome "%APP_HOME%" -AppDataDir "%APP_DATA_DIR%" -AutoOpenBrowser "%AUTO_OPEN_BROWSER%" -AppStartPath "/admin"

endlocal
