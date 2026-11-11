@echo off
cd /d "%~dp0"
where npm >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules\electron-builder (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
set CSC_IDENTITY_AUTO_DISCOVERY=false
echo Building CryptoChartMonitor.exe ...
call npm run build
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)
echo.
echo Built: %~dp0dist\CryptoChartMonitor.exe
pause
