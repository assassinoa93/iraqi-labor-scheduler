@echo off
setlocal
echo ============================================================
echo   Iraqi Labor Scheduler - One-Time Build Script
echo ============================================================
echo.
echo This script will build a standalone Windows Installer (.exe).
echo ONCE BUILT, you can take that .exe to any computer and run it
echo WITHOUT needing Node.js or any other software installed.
echo.
echo PREREQUISITES (for this build machine only):
echo 1. Node.js installed
echo.
set /p choice="Do you want to proceed with the build? (y/n): "
if /i "%choice%" neq "y" exit /b

echo.
echo [1/4] Installing dependencies...
call npm install

echo.
echo [2/4] Building web application...
call npm run build

echo.
echo [3/4] Preparing native components (Icon ^& Server)...
call npm run build:icon
call npm run build:server

echo.
echo [4/4] Creating Windows Installer (.exe)...
call npx electron-builder

echo.
echo ============================================================
echo   SUCCESS!
echo ============================================================
echo Your installer is ready in the 'dist-electron' folder.
echo Look for: Iraqi Labor Scheduler Setup X.X.X.exe
echo.
echo You can now share this .exe with anyone. They will NOT
echo need Node.js to use the app.
echo ============================================================
pause
