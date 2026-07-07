@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Start-CryptoDashboard.ps1"
if errorlevel 1 (
  echo.
  echo Startup hit an error. Press any key to close this window.
  pause >nul
)
