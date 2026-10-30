@echo off
cd /d "%~dp0"

echo =============================================
echo  Kassabok - Snabbbygge for testning
echo  (ingen installationsfil, ingen signering)
echo =============================================
echo.

set CSC_IDENTITY_AUTO_DISCOVERY=false
set CSC_LINK=

echo [1/2] Bygger React-appen...
call npm run build
if errorlevel 1 ( echo FEL vid build & pause & exit /b 1 )

echo.
echo [2/2] Paketerar Electron (ingen installer)...
call npx electron-builder --win --dir
if errorlevel 1 ( echo FEL vid electron-builder & pause & exit /b 1 )

echo.
echo =============================================
echo  Klart! Kör programmet direkt med:
echo  release\win-unpacked\Kassabok.exe
echo =============================================
echo.
start "" "release\win-unpacked\Kassabok.exe"
pause
