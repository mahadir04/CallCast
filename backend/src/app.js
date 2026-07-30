import express from 'express';
import http from 'http';
import cors from 'cors';
import twilio from 'twilio';
import path from 'path';
import { fileURLToPath } from 'url';
import { insertReport, getReports, getStats, getLogs, insertLog, resetDatabase, queryAreaStats } from './db.js';
import { initCommsServer, emitNewReport, emitNewLog, emitStatsUpdate, emitSystemAlert, getIO } from './comms.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = http.createServer(app);
const PORT = process.env.PORT || 5000;

// Enable CORS and parsing of request bodies
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve compiled static frontend files in production
const frontendDistPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDistPath));

const VoiceResponse = twilio.twiml.VoiceResponse;

// Root route (for API info)
app.get('/api/status', (req, res) => {
  res.json({ message: 'CallCast Telephony API + Real-Time Comms Server is running.', version: '2.0.0' });
});

// ── COMMS STATUS ENDPOINT ────────────────────────────────────────────────────
// Returns real-time info about connected operators, uptime, and server state.

app.get('/api/comms/status', (req, res) => {
  const io = getIO();
  if (!io) return res.status(503).json({ error: 'Comms server not initialised.' });
  const sockets = io.sockets.sockets;
  const connectedCount = sockets ? sockets.size : 0;
  res.json({
    status: 'online',
    connectedClients: connectedCount,
    uptime: Math.round(process.uptime()),
    serverTime: new Date().toISOString(),
    transport: 'socket.io',
  });
});

// REST APIs for the React Dashboard
app.get('/api/reports', async (req, res) => {
  try {
    const reports = await getReports();
    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch reports: ' + err.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats: ' + err.message });
  }
});

app.post('/api/reports/create', async (req, res) => {
  try {
    const { phone, type, category, area_code, recording_url, timestamp, source } = req.body;
    if (!phone || !type) {
      return res.status(400).json({ error: 'Phone and Type are required fields.' });
    }
    const report = await insertReport({
      phone,
      type,
      category: category || null,
      area_code: area_code || null,
      recording_url: recording_url || null,
      timestamp: timestamp || Date.now(),
      source: source || 'relay'
    });
    // ── Real-time push: new report → all connected dashboards ──────────────
    emitNewReport(report);
    const updatedStats = await getStats();
    emitStatsUpdate(updatedStats);
    res.status(201).json(report);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create report: ' + err.message });
  }
});

// Dispatcher log endpoints
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await getLogs();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch logs: ' + err.message });
  }
});

app.post('/api/logs/create', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Log message is required.' });
    }
    const log = await insertLog(message);
    // ── Real-time push: new log entry → all connected dashboards ───────────
    emitNewLog(log);
    res.status(201).json(log);
  } catch (err) {
    res.status(500).json({ error: 'Failed to log action: ' + err.message });
  }
});

// Database reset endpoint
app.post('/api/database/reset', async (req, res) => {
  try {
    const result = await resetDatabase();
    // Notify all clients that the database was reset
    emitSystemAlert('Database has been reset and reseeded with mock data.', 'warning');
    const freshStats = await getStats();
    emitStatsUpdate(freshStats);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset database: ' + err.message });
  }
});

// --- TWILIO WEBHOOK / IVR ROUTES ---

// 1. Initial greeting and menu options
app.post('/voice', (req, res) => {
  const response = new VoiceResponse();
  const gather = response.gather({
    numDigits: '1',
    action: '/voice/menu-select',
    method: 'POST',
    timeout: 8,
  });

  gather.say(
    { voice: 'alice' },
    'Welcome to CallCast emergency hotline. ' +
    'Press 1 to report you are safe. ' +
    'Press 2 if you need help or emergency services. ' +
    'Press 3 to report a missing person. ' +
    'Press 4 to report a public hazard. ' +
    'Press 5 to query active sector reports.'
  );

  // If no input, redirect back to voice menu
  response.redirect('/voice');

  res.type('text/xml');
  res.send(response.toString());
});

// 2. Menu selection handler
app.post('/voice/menu-select', (req, res) => {
  const digits = req.body.Digits;
  const response = new VoiceResponse();

  if (digits === '1') {
    response.redirect('/voice/safe');
  } else if (digits === '2') {
    response.redirect('/voice/help');
  } else if (digits === '3') {
    response.redirect('/voice/missing');
  } else if (digits === '4') {
    response.redirect('/voice/hazard');
  } else if (digits === '5') {
    response.redirect('/voice/query');
  } else {
    // Invalid digit, play message and redirect to main menu
    response.say({ voice: 'alice' }, 'Invalid selection. Please try again.');
    response.redirect('/voice');
  }

  res.type('text/xml');
  res.send(response.toString());
});

// 3. SAFE FLOW: Gather 4-digit area code
app.post('/voice/safe', (req, res) => {
  const response = new VoiceResponse();
  const gather = response.gather({
    finishOnKey: '#',
    action: '/voice/safe/submit',
    method: 'POST',
    timeout: 8,
  });

  gather.say(
    { voice: 'alice' },
    'You selected: I am safe. Please enter your four digit area code or postal code, followed by the pound key.'
  );

  response.redirect('/voice/safe');
  res.type('text/xml');
  res.send(response.toString());
});

// Submit Safe report
app.post('/voice/safe/submit', async (req, res) => {
  const response = new VoiceResponse();
  const areaCode = req.body.Digits;
  const phone = req.body.From || 'Unknown Caller';

  try {
    const report = await insertReport({
      phone,
      type: 'safe',
      area_code: areaCode,
      timestamp: Date.now(),
      source: 'call',
    });
    
    const log = await insertLog(`Call from ${phone.replace(/(\d{4})\d{4}$/, '$1****')}: Safety check-in logged for Area ${areaCode}.`);
    // ── Push live events to dashboard ──
    emitNewReport(report);
    emitNewLog(log);
    emitStatsUpdate(await getStats());

    response.say({ voice: 'alice' }, 'Thank you. Your safety check-in has been logged. Goodbye.');
    response.hangup();
  } catch (err) {
    console.error('Error logging safe report:', err);
    response.say({ voice: 'alice' }, 'An error occurred while saving your report. Goodbye.');
    response.hangup();
  }

  res.type('text/xml');
  res.send(response.toString());
});

// 4. HELP FLOW: Gather emergency category
app.post('/voice/help', (req, res) => {
  const response = new VoiceResponse();
  const gather = response.gather({
    numDigits: '1',
    action: '/voice/help/category-submit',
    method: 'POST',
    timeout: 8,
  });

  gather.say(
    { voice: 'alice' },
    'Emergency Assistance. ' +
    'Press 1 if you require medical assistance. ' +
    'Press 2 if you are trapped. ' +
    'Press 3 for water and flood emergency. ' +
    'Press 4 for emergency shelter info.'
  );

  response.redirect('/voice/help');
  res.type('text/xml');
  res.send(response.toString());
});

// Category selected, redirect to gather area code
app.post('/voice/help/category-submit', (req, res) => {
  const digits = req.body.Digits;
  const response = new VoiceResponse();

  let category = 'other';
  if (digits === '1') category = 'medical';
  else if (digits === '2') category = 'trapped';
  else if (digits === '3') category = 'flood';
  else if (digits === '4') category = 'shelter';

  response.redirect(`/voice/help/area?category=${category}`);

  res.type('text/xml');
  res.send(response.toString());
});

// Gather Area Code for Help report
app.post('/voice/help/area', (req, res) => {
  const category = req.query.category || 'other';
  const response = new VoiceResponse();
  const gather = response.gather({
    finishOnKey: '#',
    action: `/voice/help/submit?category=${category}`,
    method: 'POST',
    timeout: 8,
  });

  gather.say(
    { voice: 'alice' },
    'Please enter the four digit area code or postal code of your current location, followed by the pound key.'
  );

  response.redirect(`/voice/help/area?category=${category}`);
  res.type('text/xml');
  res.send(response.toString());
});

// Submit Help report
app.post('/voice/help/submit', async (req, res) => {
  const response = new VoiceResponse();
  const category = req.query.category || 'other';
  const areaCode = req.body.Digits;
  const phone = req.body.From || 'Unknown Caller';

  try {
    const report = await insertReport({
      phone,
      type: 'help',
      category,
      area_code: areaCode,
      timestamp: Date.now(),
      source: 'call',
    });

    const log = await insertLog(`Call from ${phone.replace(/(\d{4})\d{4}$/, '$1****')}: Emergency HELP requested (${category}) in Area ${areaCode}.`);
    // ── Push live events to dashboard ──
    emitNewReport(report);
    emitNewLog(log);
    emitStatsUpdate(await getStats());

    response.say({ voice: 'alice' }, 'Thank you. Your request for assistance has been registered. We are alerting response teams. Goodbye.');
    response.hangup();
  } catch (err) {
    console.error('Error logging help report:', err);
    response.say({ voice: 'alice' }, 'An error occurred. Goodbye.');
    response.hangup();
  }

  res.type('text/xml');
  res.send(response.toString());
});

// 5. MISSING PERSON FLOW: Gather last known area code
app.post('/voice/missing', (req, res) => {
  const response = new VoiceResponse();
  const gather = response.gather({
    finishOnKey: '#',
    action: '/voice/missing/area-submit',
    method: 'POST',
    timeout: 8,
  });

  gather.say(
    { voice: 'alice' },
    'Missing Person Report. Please enter the last known four digit area code or postal code of the missing person, followed by the pound key.'
  );

  response.redirect('/voice/missing');
  res.type('text/xml');
  res.send(response.toString());
});

// Area code submitted, redirect to voice note recording
app.post('/voice/missing/area-submit', (req, res) => {
  const areaCode = req.body.Digits;
  const response = new VoiceResponse();

  response.redirect(`/voice/missing/record?area_code=${areaCode}`);

  res.type('text/xml');
  res.send(response.toString());
});

// Prompt for Recording
app.post('/voice/missing/record', (req, res) => {
  const areaCode = req.query.area_code;
  const response = new VoiceResponse();

  response.say(
    { voice: 'alice' },
    'Please record a short message with the missing person\'s name and description after the tone. Press pound when you are finished.'
  );

  response.record({
    maxLength: 30,
    finishOnKey: '#',
    action: `/voice/missing/submit?area_code=${areaCode}`,
    method: 'POST',
  });

  res.type('text/xml');
  res.send(response.toString());
});

// Submit Missing Person report
app.post('/voice/missing/submit', async (req, res) => {
  const response = new VoiceResponse();
  const areaCode = req.query.area_code;
  const recordingUrl = req.body.RecordingUrl;
  const phone = req.body.From || 'Unknown Caller';

  try {
    const report = await insertReport({
      phone,
      type: 'missing',
      area_code: areaCode,
      recording_url: recordingUrl || null,
      timestamp: Date.now(),
      source: 'call',
    });

    const log = await insertLog(`Call from ${phone.replace(/(\d{4})\d{4}$/, '$1****')}: Missing person reported in Area ${areaCode}. Voice recording saved.`);
    // ── Push live events to dashboard ──
    emitNewReport(report);
    emitNewLog(log);
    emitStatsUpdate(await getStats());

    response.say({ voice: 'alice' }, 'Thank you. The missing person report has been successfully registered. Goodbye.');
    response.hangup();
  } catch (err) {
    console.error('Error logging missing report:', err);
    response.say({ voice: 'alice' }, 'An error occurred. Goodbye.');
    response.hangup();
  }

  res.type('text/xml');
  res.send(response.toString());
});

// 6. HAZARD FLOW: Gather category
app.post('/voice/hazard', (req, res) => {
  const response = new VoiceResponse();
  const gather = response.gather({
    numDigits: '1',
    action: '/voice/hazard/category-submit',
    method: 'POST',
    timeout: 8,
  });

  gather.say(
    { voice: 'alice' },
    'Public Hazard Report. ' +
    'Press 1 to report a flooded road. ' +
    'Press 2 to report a blocked bridge. ' +
    'Press 3 to report fire. ' +
    'Press 4 for other hazards.'
  );

  response.redirect('/voice/hazard');
  res.type('text/xml');
  res.send(response.toString());
});

// Hazard category selected, redirect to gather area code
app.post('/voice/hazard/category-submit', (req, res) => {
  const digits = req.body.Digits;
  const response = new VoiceResponse();

  let category = 'other';
  if (digits === '1') category = 'road';
  else if (digits === '2') category = 'bridge';
  else if (digits === '3') category = 'fire';
  else if (digits === '4') category = 'other';

  response.redirect(`/voice/hazard/area?category=${category}`);

  res.type('text/xml');
  res.send(response.toString());
});

// Gather Area Code for Hazard report
app.post('/voice/hazard/area', (req, res) => {
  const category = req.query.category || 'other';
  const response = new VoiceResponse();
  const gather = response.gather({
    finishOnKey: '#',
    action: `/voice/hazard/submit?category=${category}`,
    method: 'POST',
    timeout: 8,
  });

  gather.say(
    { voice: 'alice' },
    'Please enter the four digit area code or postal code of the hazard, followed by the pound key.'
  );

  response.redirect(`/voice/hazard/area?category=${category}`);
  res.type('text/xml');
  res.send(response.toString());
});

// Submit Hazard report
app.post('/voice/hazard/submit', async (req, res) => {
  const response = new VoiceResponse();
  const category = req.query.category || 'other';
  const areaCode = req.body.Digits;
  const phone = req.body.From || 'Unknown Caller';

  try {
    const report = await insertReport({
      phone,
      type: 'hazard',
      category,
      area_code: areaCode,
      timestamp: Date.now(),
      source: 'call',
    });

    const log = await insertLog(`Call from ${phone.replace(/(\d{4})\d{4}$/, '$1****')}: Public Hazard reported (${category}) in Area ${areaCode}.`);
    // ── Push live events to dashboard ──
    emitNewReport(report);
    emitNewLog(log);
    emitStatsUpdate(await getStats());

    response.say({ voice: 'alice' }, 'Thank you. The hazard report has been recorded. Goodbye.');
    response.hangup();
  } catch (err) {
    console.error('Error logging hazard report:', err);
    response.say({ voice: 'alice' }, 'An error occurred. Goodbye.');
    response.hangup();
  }

  res.type('text/xml');
  res.send(response.toString());
});

// 7. QUERY FLOW: Dynamic Sector Reports Chatbot
app.post('/voice/query', (req, res) => {
  const response = new VoiceResponse();
  const gather = response.gather({
    finishOnKey: '#',
    action: '/voice/query/submit',
    method: 'POST',
    timeout: 8,
  });

  gather.say(
    { voice: 'alice' },
    'Reports Query System. Please enter the four digit area code you wish to check, followed by the pound key.'
  );

  response.redirect('/voice/query');
  res.type('text/xml');
  res.send(response.toString());
});

app.post('/voice/query/submit', async (req, res) => {
  const response = new VoiceResponse();
  const areaCode = req.body.Digits;
  const phone = req.body.From || 'Unknown Caller';

  try {
    const stats = await queryAreaStats(areaCode);
    
    await insertLog(`Call from ${phone.replace(/(\d{4})\d{4}$/, '$1****')}: Queried sector reports for Area ${areaCode}.`);

    const textResponse = `Sector reports for area code ${areaCode.split('').join(' ')}. ` +
      `There are ${stats.safe} safe check ins, ` +
      `${stats.help} requests for emergency assistance, ` +
      `and ${stats.hazard} public hazards reported. ` +
      `Thank you for calling CallCast. Goodbye.`;

    response.say({ voice: 'alice' }, textResponse);
    response.hangup();
  } catch (err) {
    console.error('Error in voice query:', err);
    response.say({ voice: 'alice' }, 'An error occurred while querying stats. Goodbye.');
    response.hangup();
  }

  res.type('text/xml');
  res.send(response.toString());
});

// Catch-all route to serve the React SPA index.html for client-side routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/voice')) {
    return next();
  }
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

// ── BOOT SEQUENCE ────────────────────────────────────────────────────────────
// 1. Attach Socket.IO comms server to the shared HTTP server instance.
// 2. Start the HTTP server (Express + Socket.IO) on 0.0.0.0 (all interfaces).
initCommsServer(httpServer);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`╔══════════════════════════════════════════════════`);
  console.log(`║  CallCast Communication Server  v2.0.0`);
  console.log(`║  HTTP  API → http://0.0.0.0:${PORT}/`);
  console.log(`║  WS  Comms → ws://0.0.0.0:${PORT}/  (Socket.IO)`);
  console.log(`║  LAN  Access → http://192.168.0.191:${PORT}/`);
  console.log(`╚══════════════════════════════════════════════════`);
});
