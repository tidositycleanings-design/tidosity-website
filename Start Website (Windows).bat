@echo off
title Tidosity Website
cd /d "%~dp0"
echo.
echo   Starting your website...
echo.
where node >nul 2>nul
if errorlevel 1 goto nonode
if not exist "node_modules\nodemailer" (
  echo   First-time setup: getting things ready. This takes about a minute...
  call npm install --omit=dev --no-audit --no-fund
)
if not defined OPEN_BROWSER set OPEN_BROWSER=1
node --disable-warning=ExperimentalWarning server.js
echo.
pause
exit /b

:nonode
echo   Node.js isn't installed on this computer yet.
echo   Opening the download page now. Install the "LTS" version,
echo   then double-click this file again.
echo.
start "" "https://nodejs.org/en/download"
pause