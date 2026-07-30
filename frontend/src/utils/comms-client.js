/**
 * CallCast Frontend Communications Client
 * =========================================================
 * Wraps Socket.IO client into a clean React-friendly module.
 * Provides:
 *  - connect / disconnect lifecycle
 *  - event subscription helpers
 *  - operator join / chat / alert emitters
 *  - P2P signaling helpers
 */

import { io } from 'socket.io-client';

let socket = null;

/**
 * Returns (or generates) a stable operator ID stored in localStorage.
 * This ensures the same browser session always uses the same identity,
 * even across page refreshes and socket reconnections.
 */
function getOrCreateOperatorId() {
  const key = 'callcast_operator_id';
  let id = localStorage.getItem(key);
  if (!id) {
    // Generate a simple UUID v4
    id = 'op-' + ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
    localStorage.setItem(key, id);
  }
  return id;
}

/**
 * Connect to the CallCast comms server.
 * @param {string} serverUrl  e.g.  http://192.168.0.191:5000
 * @returns {object} socket instance
 */
export function connectComms(serverUrl) {
  if (socket && socket.connected) return socket;

  const operatorId = getOrCreateOperatorId();
  const normalizedUrl = serverUrl?.replace(/\/$/, '');

  socket = io(normalizedUrl, {
    transports: ['websocket', 'polling'],
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    withCredentials: false,
    // Send persistent operatorId as auth on every connection/reconnect
    auth: { operatorId },
  });

  return socket;
}

export function disconnectComms() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket() {
  return socket;
}

// ── Operator actions ─────────────────────────────────────────────────────────

/** Register this browser session as an operator in the given sector. */
export function joinAsOperator(name, sector = 'All') {
  if (!socket) return;
  socket.emit('operator:join', { name, sector });
}

/** Send a chat message to all operators. */
export function sendChatMessage(message) {
  if (!socket) return;
  socket.emit('chat:send', { message });
}

/** Broadcast a sector alert from the dashboard. */
export function sendSectorAlert(sector, message) {
  if (!socket) return;
  socket.emit('alert:sector', { sector, message });
}

/** Request the current presence list. */
export function requestPresence() {
  if (!socket) return;
  socket.emit('presence:request');
}

// ── P2P WebRTC signaling helpers ─────────────────────────────────────────────

export function sendOffer(targetSocketId, offer) {
  if (!socket) return;
  socket.emit('signal:offer', { to: targetSocketId, offer });
}

export function sendAnswer(targetSocketId, answer) {
  if (!socket) return;
  socket.emit('signal:answer', { to: targetSocketId, answer });
}

export function sendIceCandidate(targetSocketId, candidate) {
  if (!socket) return;
  socket.emit('signal:ice', { to: targetSocketId, candidate });
}
