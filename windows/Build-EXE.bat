@echo off
title Lyric Player - build .exe
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)

echo Installing build tools...
call npm install
if errorlevel 1 (
  echo Install failed. Check your internet connection and try again.
  pause
  exit /b 1
)

echo Building the portable .exe...
call npm run dist
if errorlevel 1 (
  echo Build failed. Scroll up to see the error.
  pause
  exit /b 1
)

echo.
echo Done. Your .exe is in the "dist" folder.
explorer dist
pause
