@echo off
title AKASH TUNNEL MAPPER - Offline Windows .EXE Builder
color 0B
echo ============================================================================
echo   AKASH TUNNEL MAPPER - STANDALONE WINDOWS .EXE BUILDER
echo ============================================================================
echo.
echo [Step 1/3] Installing dependencies...
call npm install --legacy-peer-deps
echo.
echo [Step 2/3] Generating 256x256 Windows Icon (.ico)...
call npm run icon
echo.
echo [Step 3/3] Compiling production frontend assets ^& packaging Windows .EXE...
call npm run dist
echo.
echo Done! Your standalone Windows .EXE installer is ready in the .\release\ folder:
echo .\release\AKASH-TUNNEL-MAPPER-Setup.exe
pause
