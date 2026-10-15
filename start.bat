@echo off
title RUGRADAR
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org then run this again. & pause & exit /b)
set "REPO="
if exist update-source.txt set /p REPO=<update-source.txt
if defined REPO (
  echo Checking for a newer version...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" -Repo "%REPO%"
)
if not exist node_modules (
  echo First run: installing, this takes a minute...
  call npm install --no-audit --no-fund
)
start "" cmd /c "timeout /t 3 >nul & start http://localhost:8787"
node server.js %*
pause
