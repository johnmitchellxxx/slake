@echo off
rem Double-click to launch Slake on Windows.
cd /d "%~dp0"
if not exist node_modules (
  echo First launch on this PC: installing, takes a minute...
  call npm install || (echo Install failed. Scroll up for the error. & pause & exit /b 1)
)
call npm start
