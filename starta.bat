@echo off
echo Installerar beroenden...
call npm install
echo.
echo Startar server och app...
start "Kassabok Server" cmd /k "node server.js"
timeout /t 1 /nobreak >nul
start "Kassabok App" cmd /k "npm run dev"
timeout /t 2 /nobreak >nul
start http://localhost:5173
echo.
echo Kassabok startar i webbläsaren...
