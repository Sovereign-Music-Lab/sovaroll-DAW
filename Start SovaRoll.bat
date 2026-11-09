@echo off
REM Double-click on Windows to start SovaRoll. Songs are kept in %USERPROFILE%\Music\SovaRoll.
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 22+ from https://nodejs.org then run again. & pause & exit /b 1)
set "SONGDIR=%USERPROFILE%\Music\SovaRoll\My First Song"
set "PROJECT=%SONGDIR%\My First Song.newdaw.json"
if not exist "%SONGDIR%" mkdir "%SONGDIR%"
if not exist "%PROJECT%" node src\cli.mjs init "%PROJECT%"
echo Keep this window open. Press Ctrl+C to stop SovaRoll.
start "" http://127.0.0.1:4317
node src\cli.mjs serve --project "%PROJECT%" --port 4317
pause
