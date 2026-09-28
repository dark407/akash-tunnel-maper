@echo off
title AKASH TUNNEL MAPPER - 1-Click Windows Installer Builder
color 0B
echo ============================================================================
echo   AKASH TUNNEL MAPPER - AUTOMATIC WINDOWS .EXE INSTALLER BUILDER
echo ============================================================================
echo.
cd /d "%~dp0"

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo [INFO] Node.js is not installed on this PC yet.
  echo Opening official Node.js installer page... Please install Node.js LTS once,
  echo then double-click this file again.
  start https://nodejs.org/
  pause
  exit /b 1
)

echo [Step 1/4] Preparing packages (please wait 1-2 minutes)...
call npm install --legacy-peer-deps
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Package installation failed. Check your internet connection.
  pause
  exit /b 1
)

echo.
echo [Step 2/4] Generating Windows Application Icon (.ico)...
call node scripts/generate-win-icon.mjs

echo.
echo [Step 3/4] Building AKASH-TUNNEL-MAPPER-Setup.exe Windows Installer...
call npm run dist
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Build failed.
  pause
  exit /b 1
)

echo.
echo ============================================================================
echo   SUCCESS! Your Windows Installer is ready at:
echo   %~dp0release\AKASH-TUNNEL-MAPPER-Setup.exe
echo ============================================================================
echo.
echo [Step 4/4] Launching AKASH-TUNNEL-MAPPER-Setup.exe now...
if exist "%~dp0release\AKASH-TUNNEL-MAPPER-Setup.exe" (
  explorer.exe /select,"%~dp0release\AKASH-TUNNEL-MAPPER-Setup.exe"
  start "" "%~dp0release\AKASH-TUNNEL-MAPPER-Setup.exe"
)
pause
