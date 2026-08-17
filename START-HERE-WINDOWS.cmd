@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Family Travel Command Center - Start Here

echo.
echo ============================================================
echo   Family Travel Command Center - Windows Start Here
echo ============================================================
echo.

where node >nul 2>&1
if errorlevel 1 goto node_missing

set "NODE_VERSION="
for /f "delims=" %%V in ('node -p "process.versions.node" 2^>nul') do set "NODE_VERSION=%%V"
if not defined NODE_VERSION goto node_missing

node -e "const [major, minor, patch] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && (minor > 13 || (minor === 13 && patch >= 0))) ? 0 : 1)"
if errorlevel 1 goto node_too_old

where npm >nul 2>&1
if errorlevel 1 goto npm_missing

echo Node.js %NODE_VERSION% is ready.
echo.
echo [1/4] Checking and installing project dependencies...
echo       Existing current packages will be reused.
call npm install
if errorlevel 1 goto install_failed

echo.
echo [2/4] Regenerating the app from the two files in the data folder...
call npm run regenerate
if errorlevel 1 goto regenerate_failed

echo.
echo [3/4] Building the private production app...
echo       This may take a minute on the first run.
call npm run build:prepared
if errorlevel 1 goto build_failed

echo.
echo [4/4] Starting the private local production server...
echo       Keep this window open while using the app.
echo       Press Ctrl+C here when you are finished.
echo       If Windows asks "Terminate batch job?", enter Y.
echo.
node scripts\start-here.mjs
set "SERVER_EXIT=%ERRORLEVEL%"
if not "%SERVER_EXIT%"=="0" goto server_failed

echo.
echo Family Travel Command Center has stopped.
exit /b 0

:node_missing
echo ERROR: Node.js was not found on this computer.
echo Install Node.js 22.13 or newer from the official download page:
echo https://nodejs.org/en/download
goto pause_error

:node_too_old
echo ERROR: Node.js %NODE_VERSION% is installed, but version 22.13 or newer is required.
echo Download a supported version from the official Node.js site:
echo https://nodejs.org/en/download
goto pause_error

:npm_missing
echo ERROR: npm was not found. A standard Node.js installation includes npm.
echo Reinstall Node.js 22.13 or newer from:
echo https://nodejs.org/en/download
goto pause_error

:install_failed
echo.
echo ERROR: Project dependencies could not be installed.
echo Check your internet connection and the messages above, then run this file again.
goto pause_error

:regenerate_failed
echo.
echo ERROR: Your trip files could not be regenerated.
echo Check the messages above. The JSON or packing Markdown may need correction.
goto pause_error

:build_failed
echo.
echo ERROR: The private production app could not be built.
echo Check the messages above, then run this file again.
goto pause_error

:server_failed
echo.
echo ERROR: The local server stopped unexpectedly.
echo Check the messages above. Another program may already be using port 3000.
goto pause_error

:pause_error
echo.
if not "%FTC_START_HERE_NONINTERACTIVE%"=="1" pause
exit /b 1
