@echo off
cd /d "%~dp0"
echo Muse: http://127.0.0.1:3210
echo Keep this window open while using Muse. Press Ctrl+C to stop.
node src/server.mjs
pause
