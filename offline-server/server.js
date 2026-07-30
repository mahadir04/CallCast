/**
 * CallCast Offline Dedicated Server
 * ================================
 * Runs entirely on local network — no internet required.
 * 
 * Features:
 *  - Real-time chat via WebSocket (Socket.IO)
 *  - SQLite persistence for messages & reports
 *  - REST API for reports, stats, logs
 *  - GSM gateway webhook support (DTMF via SIM dongle)
 *  - Auto local IP discovery
 *  - Area-based chat rooms
 *  - File/image sharing (base64 via WS)
 *  - Offline-first web client (served from /public)
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { networkInterfaces, hostname } from 'os';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 5000;
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(join(__dirname, 'public')));

/* ============================================================
   DATABASE SETUP
   ============================================================ */
const dbPath = join(__dirname, 'callcast-offline.db');
const sqlite = sqlite3.verbose();
const db = new sqlite.Database(dbPath);

db.serialize(() => {
  // Reports table (same schema as original, for GSM call-ins)
  db.run(`CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT,
    type TEXT NOT NULL,
    category TEXT,
    area_code TEXT,
    recording_url TEXT,
    timestamp INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'lan'
  )`);

  // Chat messages table
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT NOT NULL DEFAULT 'general',
    sender_name TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    content TEXT NOT NULL,
    msg_type TEXT NOT NULL DEFAULT 'text',
    timestamp INTEGER NOT NULL
  )`);

  // Connected devices / users registry
  db.run(`CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT UNIQUE NOT NULL,
    name TEXT,
    ip TEXT,
    area_code TEXT,
    last_seen INTEGER NOT NULL,
    status TEXT DEFAULT 'online'
  )`);

  // Dispatcher / system logs
  db.run(`CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  )`);

  console.log('[DB] SQLite initialized at', dbPath);
});

/* ============================================================
   HELPERS
   ============================================================ */
function now() { return Date.now(); }

function getLocalIPs() {
  const nets = networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push({ interface: name, address: net.address });
      }
    }
  }
  return ips;
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

/* ============================================================
   REST API
   ============================================================ */

// Health / info
app.get('/api/info', async (req, res) => {
  const ips = getLocalIPs();
  res.json({
    name: 'CallCast Offline Server',
    version: '1.0.0',
    hostname: hostname(),
    port: PORT,
    local_ips: ips,
    websocket_url: ips.length > 0 ? `ws://${ips[0].address}:${PORT}` : null,
    timestamp: now()
  });
});

// Reports
app.get('/api/reports', async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM reports ORDER BY timestamp DESC LIMIT 200');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/reports', async (req, res) => {
  const { phone, type, category, area_code, recording_url, source = 'lan' } = req.body;
  if (!type) return res.status(400).json({ error: 'type is required' });
  try {
    const result = await dbRun(
      'INSERT INTO reports (phone, type, category, area_code, recording_url, timestamp, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [phone || null, type, category || null, area_code || null, recording_url || null, now(), source]
    );
    const report = { id: result.lastID, phone, type, category, area_code, recording_url, timestamp: now(), source };
    io.emit('new_report', report);
    res.status(201).json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Stats
app.get('/api/stats', async (req, res) => {
  try {
    const row = await dbGet(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN type = 'safe' THEN 1 ELSE 0 END) as safe,
        SUM(CASE WHEN type = 'help' THEN 1 ELSE 0 END) as help,
        SUM(CASE WHEN type = 'missing' THEN 1 ELSE 0 END) as missing,
        SUM(CASE WHEN type = 'hazard' THEN 1 ELSE 0 END) as hazard
      FROM reports
    `);
    const online = await dbGet(`SELECT COUNT(*) as count FROM devices WHERE status = 'online'`);
    res.json({ ...row, online_users: online?.count || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Messages (chat history)
app.get('/api/messages/:room?', async (req, res) => {
  const room = req.params.room || 'general';
  try {
    const rows = await dbAll(
      'SELECT * FROM messages WHERE room = ? ORDER BY timestamp DESC LIMIT 100',
      [room]
    );
    res.json(rows.reverse());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Devices
app.get('/api/devices', async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM devices ORDER BY last_seen DESC');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Logs
app.get('/api/logs', async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM logs ORDER BY timestamp DESC LIMIT 50');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/logs', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    const result = await dbRun('INSERT INTO logs (message, timestamp) VALUES (?, ?)', [message, now()]);
    const log = { id: result.lastID, message, timestamp: now() };
    io.emit('new_log', log);
    res.status(201).json(log);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ============================================================
   GSM GATEWAY WEBHOOKS (for SIM dongle / Asterisk integration)
   ============================================================ */

// Receive DTMF + caller data from GSM gateway (Asterisk/FreeSWITCH/sim dongle)
app.post('/gateway/dtmf', async (req, res) => {
  const { caller, dtmf, duration, gateway_id } = req.body;
  console.log('[GATEWAY] DTMF from', caller, 'digits:', dtmf);

  // Parse DTMF: e.g., "1*1200#" -> type=safe, area=1200
  // Format: <option>#<area_code># or <option>*<area_code>*<category>#
  let type = 'unknown', area_code = null, category = null;
  const clean = dtmf.replace(/[^0-9*#]/g, '');
  const parts = clean.split(/[*#]/).filter(Boolean);

  if (parts.length >= 1) {
    const opt = parts[0];
    if (opt === '1') type = 'safe';
    else if (opt === '2') type = 'help';
    else if (opt === '3') type = 'missing';
    else if (opt === '4') type = 'hazard';
  }
  if (parts.length >= 2) area_code = parts[1];
  if (parts.length >= 3) category = parts[2];

  try {
    const result = await dbRun(
      'INSERT INTO reports (phone, type, category, area_code, timestamp, source) VALUES (?, ?, ?, ?, ?, ?)',
      [caller || 'unknown', type, category, area_code, now(), 'gsm']
    );
    const report = { id: result.lastID, phone: caller, type, category, area_code, timestamp: now(), source: 'gsm' };
    io.emit('new_report', report);
    await dbRun('INSERT INTO logs (message, timestamp) VALUES (?, ?)', [
      `GSM call from ${caller}: ${type} report area ${area_code}`, now()
    ]);
    res.json({ success: true, parsed: { type, area_code, category }, report });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Receive voice recording URL from gateway
app.post('/gateway/recording', async (req, res) => {
  const { caller, recording_url, area_code, gateway_id } = req.body;
  try {
    const result = await dbRun(
      'INSERT INTO reports (phone, type, area_code, recording_url, timestamp, source) VALUES (?, ?, ?, ?, ?, ?)',
      [caller || 'unknown', 'missing', area_code || null, recording_url, now(), 'gsm']
    );
    const report = { id: result.lastID, phone: caller, type: 'missing', area_code, recording_url, timestamp: now(), source: 'gsm' };
    io.emit('new_report', report);
    res.json({ success: true, report });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ============================================================
   SOCKET.IO — REAL-TIME COMMUNICATION
   ============================================================ */

const connectedSockets = new Map();

io.on('connection', (socket) => {
  const clientIp = socket.handshake.address;
  console.log(`[WS] Client connected: ${socket.id} from ${clientIp}`);

  // Client announces itself
  socket.on('join', async (data) => {
    const { name, device_id, area_code } = data || {};
    socket.userName = name || 'Anonymous';
    socket.deviceId = device_id || socket.id;
    socket.areaCode = area_code || 'general';
    socket.join(socket.areaCode);
    socket.join('general');
    connectedSockets.set(socket.id, socket);

    // Register or update device
    try {
      const existing = await dbGet('SELECT id FROM devices WHERE device_id = ?', [socket.deviceId]);
      if (existing) {
        await dbRun('UPDATE devices SET name=?, ip=?, area_code=?, last_seen=?, status=? WHERE device_id=?',
          [socket.userName, clientIp, socket.areaCode, now(), 'online', socket.deviceId]);
      } else {
        await dbRun('INSERT INTO devices (device_id, name, ip, area_code, last_seen, status) VALUES (?, ?, ?, ?, ?, ?)',
          [socket.deviceId, socket.userName, clientIp, socket.areaCode, now(), 'online']);
      }
    } catch (e) { console.error('[DB] device registration error:', e.message); }

    // Notify room
    socket.to('general').emit('user_joined', {
      name: socket.userName,
      device_id: socket.deviceId,
      area_code: socket.areaCode,
      timestamp: now()
    });

    // Send online users list
    const onlineUsers = Array.from(connectedSockets.values()).map(s => ({
      name: s.userName,
      device_id: s.deviceId,
      area_code: s.areaCode
    }));
    io.emit('online_users', onlineUsers);

    console.log(`[WS] ${socket.userName} joined room ${socket.areaCode}`);
  });

  // Chat message
  socket.on('chat_message', async (data) => {
    const { content, msg_type = 'text', room } = data || {};
    if (!content || !content.trim()) return;
    const targetRoom = room || socket.areaCode || 'general';

    const msg = {
      room: targetRoom,
      sender_name: socket.userName || 'Anonymous',
      sender_id: socket.deviceId || socket.id,
      content: content.trim(),
      msg_type,
      timestamp: now()
    };

    try {
      const result = await dbRun(
        'INSERT INTO messages (room, sender_name, sender_id, content, msg_type, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [msg.room, msg.sender_name, msg.sender_id, msg.content, msg.msg_type, msg.timestamp]
      );
      msg.id = result.lastID;
      io.to(targetRoom).emit('chat_message', msg);
      // Also broadcast critical types to general
      if (targetRoom !== 'general' && (msg.msg_type === 'alert' || msg.msg_type === 'help')) {
        io.to('general').emit('chat_message', { ...msg, room: 'general' });
      }
    } catch (e) {
      console.error('[DB] message save error:', e.message);
      socket.emit('error_msg', { error: 'Failed to save message' });
    }
  });

  // Typing indicator
  socket.on('typing', (data) => {
    const room = data?.room || socket.areaCode || 'general';
    socket.to(room).emit('typing', { name: socket.userName, device_id: socket.deviceId });
  });

  // Report via socket (from web client)
  socket.on('submit_report', async (data) => {
    const { type, category, area_code, details } = data || {};
    if (!type) return;
    try {
      const result = await dbRun(
        'INSERT INTO reports (phone, type, category, area_code, timestamp, source) VALUES (?, ?, ?, ?, ?, ?)',
        [socket.deviceId || socket.id, type, category || null, area_code || socket.areaCode || null, now(), 'lan']
      );
      const report = {
        id: result.lastID,
        phone: socket.deviceId,
        type,
        category,
        area_code: area_code || socket.areaCode,
        timestamp: now(),
        source: 'lan',
        details
      };
      io.emit('new_report', report);
      await dbRun('INSERT INTO logs (message, timestamp) VALUES (?, ?)', [
        `${socket.userName} reported ${type}${category ? ` (${category})` : ''} in area ${area_code || socket.areaCode}`, now()
      ]);
    } catch (e) {
      console.error('[DB] report error:', e.message);
    }
  });

  // Request sync (for clients that reconnected)
  socket.on('request_sync', async (data) => {
    const { since, room } = data || {};
    const targetRoom = room || socket.areaCode || 'general';
    try {
      const msgs = since
        ? await dbAll('SELECT * FROM messages WHERE room = ? AND timestamp > ? ORDER BY timestamp ASC', [targetRoom, since])
        : await dbAll('SELECT * FROM messages WHERE room = ? ORDER BY timestamp DESC LIMIT 50', [targetRoom]);
      socket.emit('sync_messages', { room: targetRoom, messages: msgs.reverse() });
    } catch (e) {
      console.error('[DB] sync error:', e.message);
    }
  });

  // Disconnect
  socket.on('disconnect', async () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
    connectedSockets.delete(socket.id);
    if (socket.deviceId) {
      try {
        await dbRun('UPDATE devices SET status=?, last_seen=? WHERE device_id=?', ['offline', now(), socket.deviceId]);
      } catch (e) {}
    }
    const onlineUsers = Array.from(connectedSockets.values()).map(s => ({
      name: s.userName,
      device_id: s.deviceId,
      area_code: s.areaCode
    }));
    io.emit('online_users', onlineUsers);
    io.emit('user_left', { name: socket.userName, device_id: socket.deviceId, timestamp: now() });
  });
});

/* ============================================================
   START SERVER
   ============================================================ */
httpServer.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║     CallCast OFFLINE DEDICATED SERVER v1.0.0               ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log('║  Mode: NO INTERNET REQUIRED                                ║');
  console.log('║  Works over: WiFi Hotspot / Local LAN / Ethernet           ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log(`Server listening on port ${PORT}`);
  console.log(`Hostname: ${hostname()}`);
  console.log('');

  if (ips.length === 0) {
    console.log('⚠️  No local network interfaces detected.');
    console.log('   Connect to a WiFi network or create a hotspot.');
  } else {
    console.log('✅ Connect devices to this server using any of these addresses:');
    console.log('');
    for (const ip of ips) {
      console.log(`   → http://${ip.address}:${PORT}`);
      console.log(`   → WebSocket: ws://${ip.address}:${PORT}`);
      console.log(`   (via interface: ${ip.interface})`);
      console.log('');
    }
  }

  console.log('────────────────────────────────────────────────────────────');
  console.log('Quick Start:');
  console.log('  1. Create a WiFi hotspot on this machine');
  console.log('  2. Ask others to connect to the same network');
  console.log('  3. Share one of the URLs above');
  console.log('  4. Everyone opens it in their browser — no app needed');
  console.log('────────────────────────────────────────────────────────────\n');
});
