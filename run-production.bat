@echo off
echo ====================================================
echo   CallCast Windows Production Deployer (Bare-Metal)
echo ====================================================

echo [1/3] Compiling React static assets...
cd frontend
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Frontend build failed!
    pause
    exit /b %ERRORLEVEL%
)

echo [2/3] Setting up backend dependencies...
cd ../backend
call npm install --production

echo [3/3] Launching CallCast Unified Server on port 5000...
node src/app.js
pause
