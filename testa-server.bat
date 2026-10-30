@echo off
cd /d "%~dp0"
echo =============================================
echo  Testar server.cjs (Ctrl+C for att avsluta)
echo =============================================
echo.

:: Kör server.cjs med ELECTRON_RUN_AS_NODE precis som Electron gör
set ELECTRON_RUN_AS_NODE=1
.\node_modules\.bin\electron.cmd server.cjs

pause
