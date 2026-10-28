@echo off
title IPO Alerts sender
cd /d "%~dp0"
if not exist node_modules (
  echo Installing for the first time...
  call npm install
)
node --env-file=.env sender.js
pause
