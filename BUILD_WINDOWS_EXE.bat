@echo off
title Akash Tunnel Joint Tracer - Offline Windows .EXE Builder
color 0B
echo ============================================================================
echo   AKASH TUNNEL JOINT TRACER - STANDALONE WINDOWS .EXE BUILDER
echo ============================================================================
echo.
echo [Step 1/3] Installing dependencies...
call npm install
call npm install --save-dev electron electron-builder
echo.
echo [Step 2/3] Compiling production frontend assets...
call npm run build
echo.
echo [Step 3/3] Packaging Windows x64 Portable ^& Setup .EXE...
npx electron-builder --win --x64 --config.appId=com.akash.tunnelmapper --config.productName="Akash Tunnel Joint Tracer" --config.directories.output=release --config.win.target=portable --config.extraMetadata.main=electron/main.cjs
echo.
echo Done! Your standalone Windows .EXE is ready in the .\release\ folder.
pause
