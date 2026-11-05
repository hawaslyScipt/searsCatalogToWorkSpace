@echo off
setlocal
cd /d "%~dp0"
title Sears Catalog Console

REM If UI is already running, just open the browser
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing 'http://localhost:4177/api/status' -TimeoutSec 2; if ($r.StatusCode -ge 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL%==0 (
  echo UI already running — opening browser...
  start "" "http://localhost:4177"
  exit /b 0
)

if not exist "node_modules\" (
  echo Installing dependencies first...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo Starting Sears Catalog Console...
echo Keep this window open while using the UI.
echo Close this window to stop the server.
echo.
call npm start

echo.
echo Server stopped.
pause
