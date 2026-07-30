# CallCast
**Turning ordinary phone calls into an emergency data channel when the internet is down.**

Built for: Crisis Tech track — dedicated to the spirit of Jogajog and the July Revolution internet shutdowns.

---

## 1. The Problem

When internet and SMS go dark during a crisis (protest, disaster, deliberate shutdown), most "offline-first" hackathon projects assume people have smartphones with Bluetooth/Wi-Fi Direct/mesh capability. In reality:

- The people most affected often have basic feature phones, not smartphones.
- Telcos frequently keep **voice calling alive** even when they throttle or kill data and SMS — for regulatory/emergency reasons.
- Nobody is building for that gap: **voice-only, zero-app, zero-data communication.**

CallCast exploits the one channel that survives: **the phone call itself.**

---

## 2. The Idea, in One Sentence

Anyone — even with a $10 button phone — can dial a number and press keys (DTMF tones) to report their status, location, or a missing person, and that data appears live on a shelter/safety dashboard. No app, no data plan, no SMS required.

---

## 3. What It Actually Does

### Core system
1. **IVR hotline.** Person dials a local number.
2. **Voice menu** (in local language) offers options via key press:
   - `1` — "I am safe" + record/select location
   - `2` — "I need help" + category (medical / trapped / flood / shelter)
   - `3` — "Report a missing person"
   - `4` — "Report a hazard"
3. **Backend decodes DTMF + call metadata** into structured records.
4. **Live dashboard (PWA)** shows a map + list: safety check-ins, shelter capacity, missing-person registry, hazard reports.

### New Features added during implementation:
- **Progressive Web App (PWA):** The frontend is a fully installable mobile app. With its Service Worker (`sw.js`), the app interface works completely offline.
- **Operator Comms Chat:** A real-time chat interface powered by Socket.IO allows operators to coordinate in real time while viewing live system alerts directly in the chat panel.
- **Windows Production Deployer:** A 1-click `run-production.bat` script builds the React assets and serves them via the Node.js backend on a single port (5000), making deployment extremely simple.
- **Off-Grid "Mobile Hotspot" Mode:** Operates entirely without a Wi-Fi router. The server machine broadcasts a Windows Mobile Hotspot, allowing operators to connect their phones directly to the server's local IP via Wi-Fi for completely decentralized field operations.

---

## 4. Why This Is Different From Typical Crisis-Tech Projects

| Typical approach | CallCast |
|---|---|
| Requires a smartphone + app install | Works on any phone that can dial and press keys |
| Requires Bluetooth/Wi-Fi range (~30–100m) | Works over normal cellular voice, any distance |
| Assumes data or SMS survives | Assumes only voice calling survives |
| Serves smartphone-owning population | Serves the population *least* likely to have a smartphone |

---

## 5. Architecture

```
Caller's Phone (any phone, any network)
        │  (voice call, DTMF tones)
        ▼
Telephony Gateway (Twilio / Asterisk)
        │  (decoded DTMF + call metadata)
        ▼
Backend API (Node.js + Express, single process serving frontend)
        │
        ├──► Socket.IO (Real-time Operator Comms)
        │
        ▼
Database (SQLite)
        │
        ▼
Dashboard (React PWA, Offline-capable, Mobile Responsive)
```

---

## 6. Tech Stack

| Layer | Tool |
|---|---|
| Telephony / IVR | **Twilio Programmable Voice** |
| Backend API | **Node.js + Express** (Serves API and static frontend assets) |
| Database | **SQLite** (Fast setup, portable) |
| Dashboard frontend | **React + Vite** (PWA, Leaflet map, Mobile-first CSS) |
| Real-time Comms | **Socket.IO** (Instant operator chat and alerts) |

---

## 7. How to Run

### Development Mode
1. Start the backend: `cd backend && npm run dev` (Runs on port 5000)
2. Start the frontend: `cd frontend && npm run dev` (Runs on port 5173)

### Production / Off-Grid Deployment (Windows)
1. Double click `run-production.bat` in the root folder.
2. This script compiles the frontend and runs the backend on port `5000`.
3. To access from other devices on the network, run `ipconfig` to find your IPv4 address (e.g. `192.168.0.x`) and navigate to `http://192.168.0.x:5000` on your mobile phone or tablet.

### Off-Grid Field Setup (No Wi-Fi Router)
1. Turn on "Mobile Hotspot" in Windows Settings on the server PC.
2. Connect operator phones to the PC's hotspot.
3. Run `run-production.bat`.
4. Open the PC's hotspot IP address on the phones to use the system offline.

---

## 8. Credits / Inspiration

Dedicated to the spirit of **Jogajog**, which kept people connected during the internet shutdowns of the July Revolution — built on the idea that resilience means designing for the channel that's actually still there, not the one we wish were there.
