@echo off
cd /d "%~dp0"

echo ================================================
echo  Kassabok - Bygger Windows-program (.exe)
echo ================================================
echo.
echo Projektmapp: %cd%
echo.

node --version >nul 2>&1
if errorlevel 1 (
    echo FEL: Node.js hittades inte. Installera fran nodejs.org
    pause & exit /b 1
)

echo [1/4] Installerar beroenden...
call npm install
if errorlevel 1 ( echo FEL vid npm install & pause & exit /b 1 )

echo.
echo [2/4] Bygger React-appen...
call npm run build
if errorlevel 1 ( echo FEL vid vite build & pause & exit /b 1 )

echo.
echo [3/4] Skapar Windows-installationsprogram...

set CSC_IDENTITY_AUTO_DISCOVERY=false
set CSC_LINK=

call npx electron-builder --win
if errorlevel 1 ( echo FEL vid electron-builder & pause & exit /b 1 )

echo.
echo ================================================
echo  [4/4] Klart!
echo ================================================
echo.
echo Installationsprogrammet finns i: release\
echo Leta efter: Kassabok Setup 1.0.0.exe
echo.
pause
