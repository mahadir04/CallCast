/**
 * CallCast Dedicated Real-Time Communication Server
 * =========================================================
 * Built on Socket.IO, this module creates a dedicated comms layer on top of
 * the Express HTTP server. It provides:
 *
 *  1. LIVE PUSH  - Push new reports/logs/stats to all connected dashboards
 *                  instantly (replaces client-side 4s polling).
 *  2. PRESENCE   - Track how many operators are online and in which sector.
 *  3. OPERATOR CHAT - Text broadcast channel for dispatcher coordination.
 *  4. P2P RELAY SIGNALING - WebRTC offer/answer/ICE exchange for operator-to-
 *                  operator audio bridge (future voice-over-data path).
 *  5. SECTOR ALERTS - Emit targeted alerts to all operators watching a
 *                  specific sector.
 *
 * Usage:  import { initCommsServer, emitNewReport, emitNewLog, emitStatsUpdate }
 *         from './comms.js';
 */

import { Server as SocketIOServer } from 'socket.io';

/** Tracks connected operators:  socketId → { name, sector, joinedAt } */
const operators = new Map();

let io = null;

// ──────────────────────────────────────────────────────────────────────────────
// PUBLIC: Initialise and attach Socket.IO to the HTTP server
// ──────────────────────────────────────────────────────────────────────────────
export function initCommsServer(httpServer) {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',          // Allow all origins (LAN / Twilio / etc.)
      methods: ['GET', 'POST'],
    },
    // Ping every 10 s; drop stale connections after 30 s
    pingInterval: 10_000,
    pingTimeout:  30_000,
  });

  io.on('connection', (socket) => {
    console.log(`[COMMS] Operator connected → ${socket.id}`);

    // ── 1. OPERATOR REGISTRATION ───────────────────────────────────────────
    socket.on('operator:join', ({ name = 'Anonymous', sector = 'All' } = {}) => {
      operators.set(socket.id, { name, sector, joinedAt: Date.now() });
      socket.join(`sector:${sector}`);    // Sector-specific room
      socket.join('operators');           // Global operator room

      // Confirm to the joining operator
      socket.emit('operator:joined', {
        socketId: socket.id,
        name,
        sector,
        message: `Welcome to CallCast Comms, ${name}. Sector: ${sector}.`,
      });

      // Broadcast updated presence list to everyone
      broadcastPresence();

      console.log(`[COMMS] ${name} joined sector "${sector}"`);
    });

    // ── 2. OPERATOR CHAT ───────────────────────────────────────────────────
    // Operators can broadcast short text messages to the comms channel.
    socket.on('chat:send', ({ message }) => {
      if (!message || message.length > 500) return;
      const op = operators.get(socket.id) || { name: 'Unknown' };
      const payload = {
        from:   op.name,
        sector: op.sector,
        message: message.trim(),
        ts:     Date.now(),
      };
      io.to('operators').emit('chat:message', payload);
      console.log(`[CHAT] ${op.name}: ${message.trim().substring(0, 60)}`);
    });

    // ── 3. SECTOR ALERT (operator-initiated broadcast) ─────────────────────
    socket.on('alert:sector', ({ sector, message }) => {
      const op = operators.get(socket.id) || { name: 'Dispatcher' };
      const payload = {
        from:    op.name,
        sector,
        message,
        ts:      Date.now(),
        urgent:  true,
      };
      io.to(`sector:${sector}`).emit('alert:incoming', payload);
      io.to('operators').emit('alert:incoming', payload);  // Also all operators
      console.log(`[ALERT] ${op.name} → Sector ${sector}: ${message.substring(0, 60)}`);
    });

    // ── 4. P2P WEBRTC SIGNALING ────────────────────────────────────────────
    // Minimal signaling relay: offer → answer → ICE candidates
    // Clients send { to: targetSocketId, sdp/candidate }
    socket.on('signal:offer', ({ to, offer }) => {
      socket.to(to).emit('signal:offer', { from: socket.id, offer });
    });

    socket.on('signal:answer', ({ to, answer }) => {
      socket.to(to).emit('signal:answer', { from: socket.id, answer });
    });

    socket.on('signal:ice', ({ to, candidate }) => {
      socket.to(to).emit('signal:ice', { from: socket.id, candidate });
    });

    // Request the current operator list
    socket.on('presence:request', () => {
      socket.emit('presence:update', buildPresenceList());
    });

    // ── 5. DISCONNECT ──────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      const op = operators.get(socket.id);
      operators.delete(socket.id);
      if (op) {
        console.log(`[COMMS] ${op.name} disconnected (${reason})`);
      }
      broadcastPresence();
    });
  });

  console.log('[COMMS] Real-time communication server initialised on Socket.IO');
  return io;
}

// ──────────────────────────────────────────────────────────────────────────────
// PUBLIC: Emit events from the REST API handlers → all dashboard clients
// ──────────────────────────────────────────────────────────────────────────────

/** Push a newly created report to all connected clients */
export function emitNewReport(report) {
  if (!io) return;
  io.emit('report:new', report);
  console.log(`[COMMS] emitNewReport → type="${report.type}" area="${report.area_code}"`);
}

/** Push a newly created dispatcher log to all connected clients */
export function emitNewLog(log) {
  if (!io) return;
  io.emit('log:new', log);
}

/** Push a full stats object to all connected clients */
export function emitStatsUpdate(stats) {
  if (!io) return;
  io.emit('stats:update', stats);
}

/** Push a system-level alert (e.g. database reset, server restart) */
export function emitSystemAlert(message, level = 'info') {
  if (!io) return;
  io.emit('system:alert', { message, level, ts: Date.now() });
  console.log(`[COMMS] system:alert [${level}] – ${message}`);
}

/** Return the Socket.IO server instance (for advanced usage) */
export function getIO() {
  return io;
}

// ──────────────────────────────────────────────────────────────────────────────
// INTERNAL helpers
// ──────────────────────────────────────────────────────────────────────────────
function buildPresenceList() {
  const list = [];
  for (const [id, op] of operators) {
    list.push({ socketId: id, name: op.name, sector: op.sector, joinedAt: op.joinedAt });
  }
  return list;
}

function broadcastPresence() {
  if (!io) return;
  io.emit('presence:update', buildPresenceList());
}
