@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo ========================================
echo   LAN Traffic Monitor
echo ========================================
echo.

if not exist "server\node_modules" (
    echo Installing backend deps...
    cd server
    call npm install
    cd ..
    echo.
)

if not exist "web\node_modules" (
    echo Installing frontend deps...
    cd web
    call npm install
    cd ..
    echo.
)

echo Starting backend on port 3000...
start "Backend" /D "%~dp0server" cmd /c "node index.js && pause"

echo Starting frontend on port 9999...
start "Frontend" /D "%~dp0web" cmd /c "npx vite --host && pause"

echo Waiting for servers...
timeout /t 5 /nobreak >nul
start http://localhost:9999

echo.
echo   Backend  : http://localhost:3000
echo   Frontend : http://localhost:9999
echo.
echo Close the two server windows to stop.
pause
