#!/bin/bash
echo "╔══════════════════════════════════════════════════╗"
echo "║  CallCast Production Deployer                    ║"
echo "╚══════════════════════════════════════════════════╝"

# 1. Build React/Vite Frontend
echo "[1/3] Building frontend static assets..."
cd frontend
npm install
npm run build
cd ..

# 2. Setup Backend Dependencies
echo "[2/3] Preparing backend runtime..."
cd backend
npm install --production
cd ..

# 3. Boot Server
echo "[3/3] Launching CallCast Unified Server..."
cd backend
node src/app.js
