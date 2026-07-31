# CallCast 📡

**Emergency Dispatch & Field Communication System**

A real-time crisis management Progressive Web App (PWA) designed for off-grid field operations — works entirely over a local network or Windows Mobile Hotspot with zero internet dependency.

---

## Architecture

```
Caller (any phone) → Twilio IVR → Backend API (Node.js/Express)
                                          │
                              ┌───────────┴────────────┐
                         Socket.IO               SQLite DB
                         (live push)           (reports, logs)
                              │
                    React PWA Dashboard
                  (map, registry, chat, DTMF)
```

## Features

| Feature | Description |
|---|---|
| 📞 **IVR Hotline** | Twilio webhook — callers press 1-5 to report status |
| 🗺️ **Live Map** | Leaflet map with real-time incident pins |
| 💬 **Operator Chat** | Socket.IO real-time dispatcher chat |
| 📻 **DTMF Transceiver** | Encode/decode emergency reports as audio tones |
| 🧑‍🤝‍🧑 **Missing Registry** | Voice log registry with printable export |
| 🖨️ **Print Fallback Cards** | Pocket cards for civilians — press 1=Safe, 2=Help, 3=Missing |
| 📱 **PWA** | Installable on mobile, works offline after first load |
| 🔁 **Always-On** | PM2 process manager with Windows Startup auto-recovery |

---

## Quick Start (Windows)

### 1. Run Production Server
```bat
.\run-production.bat
```
This builds the React frontend, installs backend deps, and launches via PM2.

### 2. Access the Dashboard
```
http://localhost:5000
```

### 3. Share on Local Network / Hotspot
```
http://<your-ip>:5000
```
Find your IP with: `ipconfig` (look for `IPv4 Address`)

---

## Off-Grid / Hotspot Mode

1. Open **Windows Settings → Mobile Hotspot** and turn it ON.
2. Run `.\run-production.bat`
3. Connect phones/tablets to your hotspot Wi-Fi.
4. Open `http://<hotspot-ip>:5000` on any connected device.

No internet required. The PWA caches all UI assets on first load.

---

## PM2 Commands

```powershell
pm2 status              # Check if CallCast is running
pm2 logs callcast       # Live server logs
pm2 restart callcast    # Restart (after code changes)
pm2 stop callcast       # Stop the server
pm2 start ecosystem.config.cjs  # Start fresh
```

## Windows Auto-Start on Login
```powershell
# Already configured via Startup folder:
# C:\Users\<you>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\CallCast-PM2.bat
```

---

## Project Structure

```
CallCast/
├── backend/
│   └── src/
│       ├── app.js          # Express server + Twilio IVR + REST API
│       ├── comms.js        # Socket.IO real-time layer
│       └── db.js           # SQLite database + seeding
├── frontend/
│   ├── public/
│   │   ├── sw.js           # Service Worker (PWA offline caching)
│   │   └── manifest.webmanifest
│   └── src/
│       ├── App.jsx         # Main React application
│       ├── index.css       # Tactical dark-mode UI
│       └── utils/
│           ├── comms-client.js   # Socket.IO client wrapper
│           ├── dtmf-encoder.js   # DTMF tone generation
│           └── dtmf-decoder.js   # DTMF mic decoding
├── ecosystem.config.cjs    # PM2 always-on config
├── Dockerfile              # Docker build (for cloud deploy)
├── docker-compose.yml      # Docker Compose (for server deploy)
└── run-production.bat      # One-click Windows deployer
```
## License
MIT — Built for emergency field operations.
