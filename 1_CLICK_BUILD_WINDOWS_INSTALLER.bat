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

echo [Step 1/4] Normalizing public npm package versions and installing packages...
node --input-type=module -e "import fs from 'fs';const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));pkg.dependencies={'@google/genai':'^1.0.0','@tailwindcss/vite':'^4.0.9','@vitejs/plugin-react':'^4.3.4','lucide-react':'^0.475.0','react':'^19.0.0','react-dom':'^19.0.0','vite':'^6.2.0','express':'^4.21.2','dotenv':'^16.4.7','motion':'^12.4.7'};pkg.devDependencies={'@types/express':'^4.17.21','@types/node':'^22.13.5','@types/react':'^19.0.10','@types/react-dom':'^19.0.4','autoprefixer':'^10.4.20','electron':'^34.2.0','electron-builder':'^25.1.8','esbuild':'^0.25.0','tailwindcss':'^4.0.9','tsx':'^4.19.2','typescript':'^5.7.3','vite-plugin-pwa':'^0.21.1'};fs.writeFileSync('package.json',JSON.stringify(pkg,null,2));if(fs.existsSync('package-lock.json'))fs.unlinkSync('package-lock.json');if(fs.existsSync('bun.lock'))fs.unlinkSync('bun.lock');"
call npm install --legacy-peer-deps
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Package installation failed. Check your internet connection.
  pause
  exit /b 1
)

echo.
echo [Step 2/4] Generating 256x256 Windows Application Icon (.ico)...
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
