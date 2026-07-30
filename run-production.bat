@echo off
echo ====================================================
echo   CallCast Windows Production Deployer (PM2 Mode)
echo ====================================================

REM Step 0: Install PM2 globally if not present (ignore exit code from npm warnings)
where pm2 >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [0/4] PM2 not found. Installing globally...
    npm install -g pm2
    echo [INFO] PM2 install attempted. Continuing...
)

REM Step 1: Build React frontend
echo [1/4] Compiling React static assets...
cd frontend
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Frontend build failed!
    cd ..
    pause
    exit /b 1
)
cd ..

REM Step 2: Install backend dependencies
echo [2/4] Setting up backend dependencies...
cd backend
npm install --omit=dev
cd ..

REM Step 3: Stop any existing CallCast PM2 process
echo [3/4] Stopping any existing CallCast instance...
pm2 delete callcast >nul 2>&1

REM Step 4: Launch with PM2
echo [4/4] Launching CallCast with PM2 (always-on mode)...
pm2 start ecosystem.config.cjs
pm2 save

echo.
echo ====================================================
echo   CallCast is RUNNING (always-on via PM2)
echo ====================================================
echo.
echo   Dashboard :  http://localhost:5000
echo.
echo   PM2 commands:
echo     pm2 logs callcast    - Live server logs
echo     pm2 status           - See running processes
echo     pm2 restart callcast - Restart
echo     pm2 stop callcast    - Stop
echo.
echo   To auto-start on Windows login (run as Admin):
echo     powershell -ExecutionPolicy Bypass -File setup-windows-startup.ps1
echo.
