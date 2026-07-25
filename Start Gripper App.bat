@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies - first run only, this takes a few minutes...
  call npm install
)
echo Starting Spindle Gripper Automation app...
start "" http://localhost:5178
call npm run dev
