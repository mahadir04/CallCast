import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { 
  Radio, ShieldAlert, Volume2, MapPin, Activity, 
  Wifi, WifiOff, RotateCw, Plus, CheckCircle2,
  Trash2, Play, Mic, MicOff, RefreshCw, Send, 
  User, Server, Shield, FileText, Settings, Heart, HelpCircle, AlertOctagon, Check, MessageSquare, Users, Zap, Phone
} from 'lucide-react';
import { playDTMFSequence, encodeReportToDTMF, encodeReportToHexDTMF } from './utils/dtmf-encoder';
import { startListening, stopListening, parseDTMFBurst, parseHexDTMFBurst } from './utils/dtmf-decoder';
import { connectComms, disconnectComms, joinAsOperator, sendChatMessage, sendSectorAlert, requestPresence } from './utils/comms-client';


const BACKEND_URL = `http://${window.location.hostname}:5000`;

// Geocoding Coordinates for Bangladesh postcodes/regions
const AREA_COORDS = {
  '1200': [23.7461, 90.3742], // Dhanmondi, Dhaka
  '1212': [23.7925, 90.4078], // Gulshan, Dhaka
  '1000': [23.7251, 90.4121], // Dhaka GPO
  '4000': [22.3569, 91.7832], // Chittagong
  '3100': [24.8949, 91.8687], // Sylhet
  '9000': [22.7010, 90.3535], // Barisal
  '6000': [24.3745, 88.6042], // Rajshahi
  '9100': [22.8456, 89.5403], // Khulna
  '5400': [25.7439, 89.2752], // Rangpur
  '2200': [24.7471, 90.4203], // Mymensingh
};

// Default center
const DEFAULT_CENTER = [23.8103, 90.4125]; // Dhaka, Bangladesh

// Custom Leaflet DivIcon creator to avoid asset loader issues
const createMarkerIcon = (type) => {
  let color = '#3a3a3c'; // default grey
  if (type === 'safe') color = '#ffffff'; // white
  if (type === 'help') color = '#ff3b30'; // red
  if (type === 'missing') color = '#ff9500'; // amber
  if (type === 'hazard') color = '#8e8e93'; // grey

  return L.divIcon({
    html: `<div style="
      background-color: ${color}; 
      width: 14px; 
      height: 14px; 
      border-radius: 50%; 
      border: 1px solid #000;
      box-shadow: 0 0 6px ${color === '#ffffff' ? '#fff' : color};
    "></div>`,
    className: 'custom-marker',
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
};

function App() {
  const [currentTab, setCurrentTab] = useState('dashboard'); // sidebar tabs: 'dashboard', 'medical', 'missing', 'shelter', 'roster', 'logs', 'transceiver', 'settings'
  const [reports, setReports] = useState([]);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState({ total: 0, safe: 0, help: 0, missing: 0, hazard: 0 });
  const [isOnline, setIsOnline] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [systemTime, setSystemTime] = useState('');
  const [dispatchCount, setDispatchCount] = useState(8); // Start with 8/12 dispatch units active

  // Modals state
  const [printMode, setPrintMode] = useState(null); // 'missing' or 'card'
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [alertSector, setAlertSector] = useState('Dhaka Sector');
  const [alertMsg, setAlertMsg] = useState('Emergency broadcast alert: Evacuate lower sectors.');
  const [isDispatchModalOpen, setIsDispatchModalOpen] = useState(false);
  const [dispatchUnit, setDispatchUnit] = useState('Unit 4 - Medical Support');
  const [dispatchSector, setDispatchSector] = useState('Mirpur');

  // Offline Sync Queue for DTMF transceiver
  const [syncQueue, setSyncQueue] = useState(() => {
    const saved = localStorage.getItem('callcast_sync_queue');
    return saved ? JSON.parse(saved) : [];
  });

  // Transceiver state
  const [encoderType, setEncoderType] = useState('safe');
  const [encoderCategory, setEncoderCategory] = useState('medical');
  const [encoderAreaCode, setEncoderAreaCode] = useState('1200');
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [activeTransmitChar, setActiveTransmitChar] = useState('');
  
  const [isListening, setIsListening] = useState(false);
  const [rawDecodedChars, setRawDecodedChars] = useState('');
  const [decodedReports, setDecodedReports] = useState([]);
  const [hexMode, setHexMode] = useState(false);
  const [signalLog, setSignalLog] = useState([]);
  const [transmitProgress, setTransmitProgress] = useState(0);
  const visualizerCanvasRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);

  // ── COMMS STATE ──────────────────────────────────────────────────────────────────────
  const [commsConnected, setCommsConnected] = useState(false);
  const [connectedCount, setConnectedCount] = useState(0);
  const [operatorList, setOperatorList] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [operatorName, setOperatorName] = useState('Operator-1');
  const [operatorSector, setOperatorSector] = useState('All');
  const [commsJoined, setCommsJoined] = useState(false);
  const [incomingAlerts, setIncomingAlerts] = useState([]);
  const chatEndRef = useRef(null);

  // Auto-save sync queue to localStorage
  useEffect(() => {
    localStorage.setItem('callcast_sync_queue', JSON.stringify(syncQueue));
  }, [syncQueue]);

  // Load cached data on startup
  useEffect(() => {
    const cachedReports = localStorage.getItem('callcast_reports_cache');
    if (cachedReports) setReports(JSON.parse(cachedReports));
    const cachedStats = localStorage.getItem('callcast_stats_cache');
    if (cachedStats) setStats(JSON.parse(cachedStats));
    const cachedLogs = localStorage.getItem('callcast_logs_cache');
    if (cachedLogs) setLogs(JSON.parse(cachedLogs));
  }, []);

  // Update Clock System Time
  useEffect(() => {
    const updateTime = () => {
      const date = new Date();
      setSystemTime(date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch Reports and Logs from backend
  const fetchData = async () => {
    try {
      const repResponse = await fetch(`${BACKEND_URL}/api/reports`);
      if (repResponse.ok) {
        const repData = await repResponse.json();
        setReports(repData);
        localStorage.setItem('callcast_reports_cache', JSON.stringify(repData));
        setIsOnline(true);
      }

      const statsResponse = await fetch(`${BACKEND_URL}/api/stats`);
      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        setStats(statsData);
        localStorage.setItem('callcast_stats_cache', JSON.stringify(statsData));
      }

      const logsResponse = await fetch(`${BACKEND_URL}/api/logs`);
      if (logsResponse.ok) {
        const logsData = await logsResponse.json();
        setLogs(logsData);
        localStorage.setItem('callcast_logs_cache', JSON.stringify(logsData));
      }
    } catch (err) {
      console.warn('Backend server connection lost.', err);
      setIsOnline(false);
    }
  };

  // ── SOCKET.IO COMMS CONNECTION ────────────────────────────────────────────────────
  useEffect(() => {
    const socket = connectComms(BACKEND_URL);

    socket.on('connect', () => {
      console.log('[COMMS] Connected to communication server');
      setCommsConnected(true);
      setIsOnline(true);
      requestPresence();
    });

    socket.on('disconnect', () => {
      console.warn('[COMMS] Disconnected from communication server');
      setCommsConnected(false);
    });

    // ─ Live data push ──────────────────────────────────────────────
    socket.on('report:new', (report) => {
      setReports(prev => {
        const updated = [report, ...prev];
        localStorage.setItem('callcast_reports_cache', JSON.stringify(updated));
        return updated;
      });
    });

    socket.on('stats:update', (newStats) => {
      setStats(newStats);
      localStorage.setItem('callcast_stats_cache', JSON.stringify(newStats));
    });

    socket.on('log:new', (log) => {
      setLogs(prev => {
        const updated = [log, ...prev].slice(0, 50);
        localStorage.setItem('callcast_logs_cache', JSON.stringify(updated));
        return updated;
      });
    });

    socket.on('system:alert', ({ message, level }) => {
      const entry = { message: `[SYSTEM] ${message}`, level, ts: Date.now() };
      setIncomingAlerts(prev => [entry, ...prev].slice(0, 20));
      // Also reload all data after a system alert (e.g. DB reset)
      fetchData();
    });

    // ─ Presence ───────────────────────────────────────────────────
    socket.on('presence:update', (list) => {
      setOperatorList(list);
      setConnectedCount(list.length);
    });

    // ─ Chat ──────────────────────────────────────────────────────
    socket.on('chat:message', (msg) => {
      setChatMessages(prev => [...prev, msg].slice(-100));
      // Auto scroll
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    });

    // ─ Alerts ───────────────────────────────────────────────────
    socket.on('alert:incoming', (alert) => {
      setIncomingAlerts(prev => [alert, ...prev].slice(0, 20));
    });

    socket.on('operator:joined', ({ name, sector }) => {
      console.log(`[COMMS] Joined as ${name} in sector ${sector}`);
      setCommsJoined(true);
    });

    return () => { disconnectComms(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flush Sync Cache function
  const handleFlushCache = async () => {
    if (!confirm('Are you sure you want to reset the database and clear all logs?')) return;
    setIsLoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/database/reset`, { method: 'POST' });
      if (response.ok) {
        setSyncQueue([]);
        setDecodedReports([]);
        setDispatchCount(8);
        setChatMessages([]);
        setIncomingAlerts([]);
        await fetchData();
        alert('Database cache flushed and seeded with mock defaults.');
      }
    } catch (err) {
      alert('Could not connect to backend server.');
    } finally {
      setIsLoading(false);
    }
  };

  // Comms: Join the operator network
  const handleJoinComms = () => {
    if (!operatorName.trim()) return;
    joinAsOperator(operatorName.trim(), operatorSector);
  };

  // Comms: Send a chat message
  const handleSendChat = (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !commsJoined) return;
    sendChatMessage(chatInput.trim());
    setChatInput('');
  };

  // Print Modes
  const handlePrintMissing = () => {
    setPrintMode('missing');
    setTimeout(() => { window.print(); setPrintMode(null); }, 100);
  };
  
  const handlePrintCard = () => {
    setPrintMode('card');
    setTimeout(() => { window.print(); setPrintMode(null); }, 100);
  };

  // Broadcast Alert submit
  const handleBroadcastAlert = async () => {
    setIsAlertModalOpen(false);
    const messageText = `ALERT BROADCASTED to ${alertSector}: "${alertMsg}"`;
    try {
      // Post log to backend
      await fetch(`${BACKEND_URL}/api/logs/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageText })
      });
      fetchData();
      
      // Play a short synth siren sound
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, audioCtx.currentTime);
      osc.frequency.linearRampToValueAtTime(600, audioCtx.currentTime + 0.5);
      osc.frequency.linearRampToValueAtTime(300, audioCtx.currentTime + 1.0);
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.5);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 1.5);
      
      alert(`Alert Broadcasted to ${alertSector}!`);
    } catch (err) {
      console.error(err);
    }
  };

  // Dispatch Unit submit
  const handleDispatchUnit = async () => {
    setIsDispatchModalOpen(false);
    const messageText = `Dispatcher action: Dispatched ${dispatchUnit} to ${dispatchSector} Sector.`;
    try {
      await fetch(`${BACKEND_URL}/api/logs/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageText })
      });
      
      // Log a mock hazard/incident report as well to represent activity
      await fetch(`${BACKEND_URL}/api/reports/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: `Unit Dispatch`,
          type: 'help',
          category: 'dispatch',
          area_code: dispatchSector === 'Mirpur' ? '1216' : dispatchSector === 'Banani' ? '1213' : '1200',
          source: 'relay'
        })
      });

      setDispatchCount(prev => Math.min(prev + 1, 12));
      fetchData();
      alert(`Unit dispatched to ${dispatchSector}!`);
    } catch (err) {
      console.error(err);
    }
  };

  // Transmit DTMF Tone Sequence
  const handleTransmit = async () => {
    setIsTransmitting(true);
    setTransmitProgress(0);
    const reportData = {
      type: encoderType,
      category: encoderType === 'safe' || encoderType === 'missing' ? null : encoderCategory,
      area_code: encoderAreaCode
    };
    const toneString = hexMode
      ? encodeReportToHexDTMF(reportData)
      : encodeReportToDTMF(reportData);
    
    const total = toneString.length;
    try {
      await playDTMFSequence(toneString, hexMode ? 120 : 180, hexMode ? 50 : 80, (char, idx) => {
        setActiveTransmitChar(char);
        setTransmitProgress(Math.round(((idx + 1) / total) * 100));
      });
      setSignalLog(prev => [{ ts: new Date().toLocaleTimeString(), dir: 'TX', mode: hexMode ? 'HEX' : 'STD', seq: toneString, type: encoderType }, ...prev.slice(0, 19)]);
    } catch (err) {
      console.error('DTMF transmission error:', err);
    } finally {
      setIsTransmitting(false);
      setActiveTransmitChar('');
      setTransmitProgress(0);
    }
  };

  // Draw waveform on canvas
  const drawWaveform = useCallback(() => {
    const canvas = visualizerCanvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#07090e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const barWidth = (canvas.width / bufferLength) * 2.5;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * canvas.height;
      const r = barHeight + 50;
      const g = 200 - barHeight;
      ctx.fillStyle = `rgb(${r},${g},80)`;
      ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
      x += barWidth + 1;
    }
    animFrameRef.current = requestAnimationFrame(drawWaveform);
  }, []);

  // Start Mic Audio Listener for DTMF Tones
  const handleStartListening = () => {
    setRawDecodedChars('');
    setIsListening(true);
    let currentSequence = '';

    startListening(
      (char) => {
        setRawDecodedChars(prev => prev + char);
        currentSequence += char;

        // Detect end of standard burst (#) or hex burst (D)
        const isStdEnd = char === '#' && !hexMode;
        const isHexEnd = char === 'D' && hexMode;

        if (isStdEnd) {
          const startIndex = currentSequence.lastIndexOf('*');
          if (startIndex !== -1) {
            const burst = currentSequence.substring(startIndex);
            try {
              const parsed = parseDTMFBurst(burst);
              setDecodedReports(prev => [parsed, ...prev]);
              setSignalLog(prev => [{ ts: new Date().toLocaleTimeString(), dir: 'RX', mode: 'STD', seq: burst, type: parsed.type }, ...prev.slice(0, 19)]);
              currentSequence = '';
            } catch (err) {
              console.warn('Failed to parse std burst:', err.message);
            }
          }
        } else if (isHexEnd) {
          const startIndex = currentSequence.lastIndexOf('A');
          if (startIndex !== -1) {
            const burst = currentSequence.substring(startIndex);
            try {
              const parsed = parseHexDTMFBurst(burst);
              setDecodedReports(prev => [parsed, ...prev]);
              setSignalLog(prev => [{ ts: new Date().toLocaleTimeString(), dir: 'RX', mode: 'HEX', seq: burst, type: parsed.type }, ...prev.slice(0, 19)]);
              currentSequence = '';
            } catch (err) {
              console.warn('Failed to parse hex burst:', err.message);
            }
          }
        }
      },
      (err) => {
        alert('Could not open microphone. Please check system permissions.');
        setIsListening(false);
      },
      (analyserNode) => {
        analyserRef.current = analyserNode;
        drawWaveform();
      }
    );
  };

  // Stop Mic Audio Listener
  const handleStopListening = () => {
    stopListening();
    setIsListening(false);
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    analyserRef.current = null;
    // Clear canvas
    const canvas = visualizerCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#07090e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  };

  // Sync Offline Decoded Tones
  const handleSyncDecodedReport = async (report, idx) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/reports/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report)
      });
      if (response.ok) {
        setDecodedReports(prev => prev.filter((_, i) => i !== idx));
        fetchData();
        alert('Report successfully synced to the database!');
      }
    } catch (err) {
      alert('Connection error. Report added to pending Sync Queue.');
      setSyncQueue(prev => [...prev, report]);
      setDecodedReports(prev => prev.filter((_, i) => i !== idx));
    }
  };

  // Play voice ID recording audio file (generates simple beep tones for missing person playback)
  const handlePlayVoiceID = (voiceId) => {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    // Simulate playing recorded static voice
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, audioCtx.currentTime);
    osc.frequency.setValueAtTime(330, audioCtx.currentTime + 0.3);
    osc.frequency.setValueAtTime(550, audioCtx.currentTime + 0.6);
    
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.0);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 1.0);
    alert(`Playing voice memo recording for ${voiceId}...`);
  };

  // Render SVG Donut Chart dynamically
  const renderDonutChart = () => {
    const total = stats.safe + stats.help + stats.hazard;
    if (total === 0) return <div style={{ color: 'var(--text-muted)' }}>No Data</div>;

    const safePercentage = (stats.safe / total) * 100;
    const helpPercentage = (stats.help / total) * 100;
    const hazardPercentage = (stats.hazard / total) * 100;

    // SVG parameters
    const size = 180;
    const radius = 60;
    const strokeWidth = 14;
    const circumference = 2 * Math.PI * radius;

    // Calculate stroke offsets
    const safeOffset = circumference - (safePercentage / 100) * circumference;
    const helpOffset = circumference - (helpPercentage / 100) * circumference;
    const hazardOffset = circumference - (hazardPercentage / 100) * circumference;

    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Safe: White segment */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke="#ffffff"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={safeOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        {/* Help: Red segment */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke="var(--accent-red)"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={helpOffset}
          transform={`rotate(${(safePercentage * 3.6) - 90} ${size / 2} ${size / 2})`}
        />
        {/* Hazard: Gray segment */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke="#8e8e93"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={hazardOffset}
          transform={`rotate(${((safePercentage + helpPercentage) * 3.6) - 90} ${size / 2} ${size / 2})`}
        />
      </svg>
    );
  };

  // Dynamic SVG sparkline graph for Bottom Incident Map
  const renderSparkline = () => {
    // Generate styled sparkline coordinates
    return (
      <svg width="100%" height="40" viewBox="0 0 1000 40" preserveAspectRatio="none" style={{ display: 'block' }}>
        <path
          d="M 0 35 Q 100 20 200 32 T 400 15 T 600 28 T 800 10 T 1000 32 L 1000 40 L 0 40 Z"
          fill="rgba(255, 59, 48, 0.12)"
          stroke="var(--accent-red)"
          strokeWidth="1.5"
        />
      </svg>
    );
  };

  return (
    <div style={{ background: 'var(--bg-primary)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      
      {/* 1. Left Sidebar Navigation */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">CC</div>
          <div style={{ lineHeight: '1.2' }}>
            <div style={{ fontWeight: '900', fontSize: '15px', color: '#fff' }}>CallCast</div>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 'bold' }}>Offline Crisis Hub</span>
          </div>
        </div>

        {/* Sync Status Box */}
        <div style={{ padding: '10px 12px' }}>
          <div style={{ background: '#0e1219', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '4px', padding: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: isOnline ? 'var(--accent-green)' : 'var(--accent-amber)' }}></span>
            <div style={{ fontSize: '10px', color: '#fff', fontWeight: 'bold', flex: 1 }}>
              {isOnline ? 'Synced / Local Cache' : 'Local Mode / Connection Offline'}
            </div>
          </div>
          {/* Comms Status */}
          <div style={{ background: '#0e1219', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '4px', padding: '8px 10px', display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: commsConnected ? '#00e5ff' : '#ff3b30', animation: commsConnected ? 'blink 2s infinite' : 'none' }}></span>
            <div style={{ fontSize: '10px', color: commsConnected ? '#00e5ff' : '#ff3b30', fontWeight: 'bold', flex: 1 }}>
              {commsConnected ? `WS LIVE · ${connectedCount} online` : 'WS DISCONNECTED'}
            </div>
            <Zap size={10} style={{ color: commsConnected ? '#00e5ff' : '#ff3b30' }} />
          </div>
        </div>

        {/* Hotline Box */}
        <div className="hotline-card">
          <div className="hotline-title">
            <Radio size={10} className="pulse-indicator" style={{ background: 'transparent' }} />
            Emergency Hotline
          </div>
          <div className="hotline-number">HOTLINE:</div>
          <div style={{ fontSize: '11px', color: '#fff', fontWeight: 'bold', fontFamily: 'monospace' }}>+880 9612-444999</div>
        </div>

        <div className="sidebar-menu">
          <div className="menu-section-title">Response Management</div>
          <div className={`menu-item ${currentTab === 'medical' ? 'active' : ''}`} onClick={() => setCurrentTab('medical')}>
            <Heart size={14} /> Medical Assistance
          </div>
          <div className={`menu-item ${currentTab === 'missing' ? 'active' : ''}`} onClick={() => setCurrentTab('missing')}>
            <User size={14} /> Missing Persons Registry
          </div>
          <div className={`menu-item ${currentTab === 'dashboard' ? 'active' : ''}`} onClick={() => setCurrentTab('dashboard')}>
            <ShieldAlert size={14} /> Hazard Map (Dashboard)
          </div>
          <div className={`menu-item ${currentTab === 'shelter' ? 'active' : ''}`} onClick={() => setCurrentTab('shelter')}>
            <Server size={14} /> Shelter Status
          </div>

          <div className="menu-section-title">System & Operations</div>
          <div className={`menu-item ${currentTab === 'roster' ? 'active' : ''}`} onClick={() => setCurrentTab('roster')}>
            <Shield size={14} /> Operator Roster
          </div>
          <div className={`menu-item ${currentTab === 'logs' ? 'active' : ''}`} onClick={() => setCurrentTab('logs')}>
            <FileText size={14} /> Incident Logs
          </div>
          <div className={`menu-item ${currentTab === 'transceiver' ? 'active' : ''}`} onClick={() => setCurrentTab('transceiver')}>
            <Volume2 size={14} /> IVR Routing (Transceiver)
          </div>

          <div className="menu-section-title">Communications</div>
          <div className={`menu-item ${currentTab === 'comms' ? 'active' : ''}`} onClick={() => setCurrentTab('comms')} style={{ position: 'relative' }}>
            <MessageSquare size={14} /> Operator Comms
            {connectedCount > 0 && (
              <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: '#00e5ff', color: '#000', fontSize: '9px', fontWeight: '900', borderRadius: '10px', padding: '1px 6px', minWidth: '16px', textAlign: 'center' }}>{connectedCount}</span>
            )}
          </div>

          <div className={`menu-item ${currentTab === 'settings' ? 'active' : ''}`} onClick={() => setCurrentTab('settings')}>
            <Settings size={14} /> Settings
          </div>
        </div>

        {/* User profile footer */}
        <div className="sidebar-profile">
          <div className="profile-avatar">MR</div>
          <div style={{ lineHeight: '1.2' }}>
            <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#fff' }}>M. Rahman – Dispatcher</div>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Shift 06:00-18:00 · Dhaka Hub</span>
          </div>
        </div>
      </aside>

      {/* 2. Top Header Bar */}
      <header className="header-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '13px', fontWeight: 'bold', letterSpacing: '1px' }}>CRISIS RESPONSE CONTROL</span>
          <span className="live-indicator">
            <span className="live-dot"></span> LIVE
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* Digital Clock */}
          <div style={{ fontSize: '12px', fontFamily: 'monospace', fontWeight: 'bold', color: '#fff' }}>
            {systemTime || '08:35:25 AM'}
          </div>
          
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '2px', padding: '2px 8px', fontSize: '10px', fontWeight: 'bold' }}>
            Offline IVR · 32 lines
          </div>

          <button className="btn-red" onClick={() => setIsAlertModalOpen(true)}>
            <Radio size={12} /> Broadcast Alert
          </button>
        </div>
      </header>

      {/* 3. Main Content Area */}
      <main className="main-content">

        {/* VIEW A: MAIN HAZARD MAP DASHBOARD */}
        {currentTab === 'dashboard' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* Outage status grid info */}
            <div className="outage-grid">
              
              {/* Active Outage */}
              <div className="tactical-panel-red outage-card">
                <div className="outage-card-label" style={{ color: 'var(--accent-red)' }}>Active Outage</div>
                <div className="outage-card-value">Dhaka & Chittagong Sectors</div>
                <div className="outage-card-desc">Cellular network down since 08:14 AM. IVR fallback engaged.</div>
              </div>

              {/* Last Sync */}
              <div className="tactical-panel outage-card">
                <div className="outage-card-label">Last Sync</div>
                <div className="outage-card-value">12 min ago</div>
                <div className="outage-card-desc">Local cache holding {reports.length + 1400} unpushed reports.</div>
              </div>

              {/* Dispatch Trigger */}
              <div className="tactical-panel outage-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div className="outage-card-label">Dispatch Trigger</div>
                  <div className="outage-card-value" style={{ fontSize: '14px', margin: '4px 0' }}>Route to nearest field unit</div>
                </div>
                <button className="btn-red" style={{ padding: '8px 16px' }} onClick={() => setIsDispatchModalOpen(true)}>
                  <Send size={12} /> Dispatch
                </button>
              </div>

            </div>

            {/* Metrics cards row */}
            <div className="metrics-row">
              
              {/* Active Reports */}
              <div className="tactical-panel metric-box" style={{ borderLeft: '3px solid var(--accent-red)' }}>
                <div className="metric-box-title">Active Reports</div>
                <div className="metric-box-num">{stats.total + 1400}</div>
                <div className="metric-box-sub" style={{ color: 'var(--accent-red)' }}>↗ +12% vs last hour</div>
              </div>

              {/* Safe Checkins */}
              <div className="tactical-panel metric-box" style={{ borderLeft: '3px solid #fff' }}>
                <div className="metric-box-title">Safe Check-ins</div>
                <div className="metric-box-num">{stats.safe + 9000}</div>
                <div className="metric-box-sub" style={{ color: 'var(--text-secondary)' }}>Verified via DTMF</div>
              </div>

              {/* Missing Persons */}
              <div className="tactical-panel metric-box" style={{ borderLeft: '3px solid var(--accent-amber)' }}>
                <div className="metric-box-title">Missing Persons</div>
                <div className="metric-box-num">{stats.missing + 340}</div>
                <div className="metric-box-sub" style={{ color: 'var(--accent-amber)' }}>Awaiting confirmation</div>
              </div>

              {/* System Status */}
              <div className="tactical-panel metric-box" style={{ borderLeft: '3px solid var(--text-muted)' }}>
                <div className="metric-box-title">System Status</div>
                <div className="metric-box-num">99.8%</div>
                <div className="metric-box-sub" style={{ color: 'var(--text-muted)' }}>IVR line uptime</div>
              </div>

            </div>

            {/* Three Column Info Section */}
            <div className="info-grid">
              
              {/* Column 1: DTMF Live Feed */}
              <div className="tactical-panel grid-panel">
                <div className="panel-header">
                  <span className="panel-title">DTMF Live Feed</span>
                  <span className="panel-sub-label">real-time</span>
                </div>
                <div className="panel-body-scroll">
                  {reports.slice(0, 10).map((report, idx) => (
                    <div className="feed-item" key={report.id || idx}>
                      <span className={`feed-dot ${report.type === 'safe' ? 'safe' : report.type === 'help' ? 'help' : 'hazard'}`}></span>
                      <div className="feed-text">
                        <div>
                          <strong>
                            {new Date(report.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </strong>: Call from{' '}
                          <strong>
                            {report.phone.replace(/(\d{4})\d{4}$/, '$1****')}
                          </strong>{' '}
                          reported{' '}
                          <span style={{ 
                            color: report.type === 'help' ? 'var(--accent-red)' : report.type === 'safe' ? '#fff' : 'var(--text-secondary)',
                            fontWeight: 'bold' 
                          }}>
                            {report.type === 'safe' ? 'Safe' : report.type === 'help' ? 'Emergency Assistance' : 'Hazard'}
                          </span>
                        </div>
                        <div className="feed-meta">
                          DTMF: {report.type === 'safe' ? '1' : report.type === 'help' ? '2' : '4'}-{report.category ? report.category[0].toUpperCase() : '1'} • Area {report.area_code || 'Unknown'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Column 2: Missing Persons */}
              <div className="tactical-panel grid-panel">
                <div className="panel-header">
                  <span className="panel-title">Missing Persons</span>
                  <span className="panel-sub-label" style={{ cursor: 'pointer', color: 'var(--accent-red)' }} onClick={() => setCurrentTab('missing')}>
                    View All
                  </span>
                </div>
                <div className="panel-body-scroll">
                  {reports.filter(r => r.type === 'missing').map((report, idx) => (
                    <div 
                      className="feed-item" 
                      key={idx}
                      style={{ 
                        background: 'rgba(255, 255, 255, 0.01)',
                        padding: '12px 10px',
                        border: '1px solid rgba(255,255,255,0.03)',
                        borderRadius: '2px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <div style={{ background: 'rgba(255, 149, 0, 0.1)', color: 'var(--accent-amber)', padding: '6px', borderRadius: '2px' }}>
                          <User size={16} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 'bold', color: '#fff' }}>Voice ID: #44{report.id || 90 + idx}</div>
                          <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                            Area: {report.area_code || '1212'} · {Math.floor((Date.now() - report.timestamp) / 60000)}m ago
                          </span>
                        </div>
                      </div>
                      <button 
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
                        onClick={() => handlePlayVoiceID(`Voice ID #44${report.id || 90 + idx}`)}
                      >
                        <Play size={14} />
                      </button>
                    </div>
                  ))}
                  {reports.filter(r => r.type === 'missing').length === 0 && (
                    <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--text-muted)' }}>
                      No missing reports logged.
                    </div>
                  )}
                </div>
              </div>

              {/* Column 3: Stats Breakdown & Operational Status */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '380px' }}>
                
                {/* Donut chart */}
                <div className="tactical-panel" style={{ flex: 1, padding: '10px 16px', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Reports by Category
                  </div>
                  <div className="chart-container" style={{ flex: 1 }}>
                    {renderDonutChart()}
                    <div className="donut-label-center">
                      <span className="total-label">Total</span>
                      <span className="total-num">{stats.safe + stats.help + stats.hazard + 9865}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', fontSize: '9px', color: 'var(--text-secondary)', paddingBottom: '4px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ width: '6px', height: '6px', background: 'var(--accent-red)', borderRadius: '50%' }}></span> Medical
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ width: '6px', height: '6px', background: '#ffffff', borderRadius: '50%' }}></span> Safe
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ width: '6px', height: '6px', background: '#8e8e93', borderRadius: '50%' }}></span> Hazard
                    </span>
                  </div>
                </div>

                {/* Operations panel */}
                <div className="tactical-panel" style={{ padding: '12px 16px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                    Operations Status
                  </div>
                  
                  <div className="ops-row">
                    <span className="ops-key">IVR_QUEUED</span>
                    <span className="ops-val" style={{ color: 'var(--accent-red)' }}>12</span>
                  </div>
                  <div className="ops-row">
                    <span className="ops-key">DISPATCH_UNITS</span>
                    <span className="ops-val">0{dispatchCount}/12</span>
                  </div>
                  <div className="ops-row">
                    <span className="ops-key">BATTERY_LVL</span>
                    <span className="ops-val" style={{ color: 'var(--accent-red)' }}>24%</span>
                  </div>
                  <div className="ops-row">
                    <span className="ops-key">UPTIME</span>
                    <span className="ops-val">72:14:02</span>
                  </div>

                  <button 
                    className="btn-black" 
                    style={{ width: '100%', padding: '6px', fontSize: '10px', marginTop: '10px', justifyContent: 'center' }}
                    onClick={handleFlushCache}
                    disabled={isLoading}
                  >
                    <RefreshCw size={10} className={isLoading ? 'pulse-indicator' : ''} /> Flush Sync Cache
                  </button>
                </div>

              </div>

            </div>

            {/* Bottom Panel: Incident Map */}
            <div className="tactical-panel map-panel">
              <div className="panel-header">
                <span className="panel-title">Incident Map</span>
                <div style={{ display: 'flex', gap: '10px', fontSize: '10px', color: 'var(--text-secondary)' }}>
                  <span>• Safe (White)</span>
                  <span style={{ color: 'var(--accent-red)' }}>• Help (Red)</span>
                  <span>• Hazard (Gray)</span>
                </div>
              </div>
              <div className="map-body-wrapper">
                <div className="map-wrapper">
                  <MapContainer center={DEFAULT_CENTER} zoom={7} style={{ height: '100%', width: '100%' }} zoomControl={false}>
                    <TileLayer
                      attribution='&copy; CartoDB Dark Matter'
                      url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    />
                    {reports.map((report, idx) => {
                      const pos = getCoordinates(report.area_code, idx);
                      return (
                        <Marker 
                          key={report.id || idx} 
                          position={pos} 
                          icon={createMarkerIcon(report.type)}
                        >
                          <Popup>
                            <div style={{ color: '#000', fontSize: '11px', fontFamily: 'monospace' }}>
                              <strong style={{ textTransform: 'uppercase' }}>{report.type} Report</strong>
                              {report.category && <div style={{ marginTop: '2px' }}>Type: {report.category}</div>}
                              <div>Area: {report.area_code || '1200'}</div>
                              <div>Phone: {report.phone}</div>
                              <div style={{ color: 'var(--text-muted)', fontSize: '9px', marginTop: '2px' }}>
                                {new Date(report.timestamp).toLocaleString()}
                              </div>
                            </div>
                          </Popup>
                        </Marker>
                      );
                    })}
                  </MapContainer>
                </div>

                {/* SVG sparkline graph overlay */}
                <div className="sparkline-overlay">
                  {renderSparkline()}
                </div>
              </div>
            </div>

            {/* Recent Hazards footer widget */}
            <div className="tactical-panel" style={{ padding: '16px' }}>
              <div style={{ fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px', color: 'var(--accent-red)' }}>
                Recent Hazards
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <li style={{ display: 'flex', gap: '10px' }}>
                  <span style={{ color: 'var(--accent-amber)' }}>■</span>
                  <div>
                    <strong>Road Blockage</strong> - Dhanmondi Rd 27 · <span style={{ color: 'var(--text-muted)' }}>14m ago</span>
                  </div>
                </li>
                <li style={{ display: 'flex', gap: '10px' }}>
                  <span style={{ color: 'var(--accent-amber)' }}>■</span>
                  <div>
                    <strong>Power Line Down</strong> - Uttara Sector 4 · <span style={{ color: 'var(--text-muted)' }}>22m ago</span>
                  </div>
                </li>
              </ul>
            </div>

          </div>
        )}

        {/* VIEW B: MEDICAL ASSISTANCE FILTER */}
        {currentTab === 'medical' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h2 style={{ margin: 0, fontSize: '18px', color: 'var(--accent-red)' }}>Medical Assistance Control</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
              Viewing emergency medical requests received via fallback voice DTMF.
            </p>

            <div className="info-grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
              <div className="tactical-panel grid-panel" style={{ height: '400px' }}>
                <div className="panel-header">
                  <span className="panel-title">Active Medical Reports</span>
                </div>
                <div className="panel-body-scroll">
                  {reports.filter(r => r.type === 'help' && r.category === 'medical').map((report, idx) => (
                    <div className="feed-item" key={idx}>
                      <span className="feed-dot help"></span>
                      <div className="feed-text">
                        <div>
                          <strong>{report.phone.replace(/(\d{4})\d{4}$/, '$1****')}</strong> - Medical emergency flagged in Area <strong>{report.area_code}</strong>.
                        </div>
                        <div className="feed-meta">{formatDate(report.timestamp)}</div>
                      </div>
                    </div>
                  ))}
                  {reports.filter(r => r.type === 'help' && r.category === 'medical').length === 0 && (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No medical logs found.</div>
                  )}
                </div>
              </div>

              <div className="tactical-panel" style={{ padding: '16px' }}>
                <h3 style={{ fontSize: '12px', textTransform: 'uppercase', margin: '0 0 12px 0', color: '#fff' }}>Medical Dispatch</h3>
                <div className="form-group" style={{ gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Assigned Sector</label>
                    <select className="form-select" style={{ width: '100%', marginTop: '4px' }} value={dispatchSector} onChange={(e) => setDispatchSector(e.target.value)}>
                      <option value="Mirpur">Mirpur Sector</option>
                      <option value="Banani">Banani Sector</option>
                      <option value="Dhanmondi">Dhanmondi Sector</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Ambulance / Med Unit</label>
                    <select className="form-select" style={{ width: '100%', marginTop: '4px' }} value={dispatchUnit} onChange={(e) => setDispatchUnit(e.target.value)}>
                      <option value="Unit 4 - Medical Support">Ambulance Team #4</option>
                      <option value="Unit 2 - Disaster First Aid">Disaster First Aid #2</option>
                    </select>
                  </div>
                  <button className="btn-red" style={{ width: '100%', justifyContent: 'center', marginTop: '10px' }} onClick={handleDispatchUnit}>
                    Dispatch Medical Support
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW C: MISSING PERSONS REGISTRY */}
        {currentTab === 'missing' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h2 style={{ margin: 0, fontSize: '18px', color: 'var(--accent-amber)' }}>Missing Persons Voice Registry</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
              Responders can listen to recorded voice notes reported offline via DTMF voice recorders.
            </p>

            <div className="tactical-panel">
              <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="panel-title">Missing Registry Database</span>
                <button className="btn-black" onClick={handlePrintMissing} style={{ padding: '6px 12px' }}>
                  <FileText size={12} style={{ marginRight: '6px' }} /> Print / Export List
                </button>
              </div>
              <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {reports.filter(r => r.type === 'missing').map((report, idx) => (
                  <div 
                    key={idx}
                    style={{
                      background: 'rgba(255,255,255,0.01)',
                      border: '1px solid rgba(255,255,255,0.04)',
                      borderRadius: '4px',
                      padding: '16px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#fff' }}>Voice Log ID: #44{report.id || 90 + idx}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                        Last known location: Area <strong>{report.area_code || '1200'}</strong> | Reporter: <strong>{report.phone.replace(/(\d{4})\d{4}$/, '$1****')}</strong>
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                        Logged: {new Date(report.timestamp).toLocaleString()}
                      </div>
                    </div>
                    <button 
                      className="btn-black" 
                      onClick={() => handlePlayVoiceID(`Voice ID #44${report.id || 90 + idx}`)}
                      style={{ padding: '8px 16px' }}
                    >
                      <Play size={12} /> Play Recording
                    </button>
                  </div>
                ))}

                {reports.filter(r => r.type === 'missing').length === 0 && (
                  <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    No recorded voice notes logged.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* VIEW D: SHELTER STATUS */}
        {currentTab === 'shelter' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h2 style={{ margin: 0, fontSize: '18px', color: '#fff' }}>Shelter Status & Capacity</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
              Monitoring shelter utilization and emergency capacities.
            </p>

            <div className="tactical-panel">
              <div className="panel-header">
                <span className="panel-title">Active Shelter Roster</span>
              </div>
              <div style={{ padding: '16px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '8px' }}>Shelter Name</th>
                      <th style={{ padding: '8px' }}>Location / Area</th>
                      <th style={{ padding: '8px' }}>Capacity</th>
                      <th style={{ padding: '8px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                      <td style={{ padding: '8px' }}><strong>Dhanmondi Govt School</strong></td>
                      <td style={{ padding: '8px' }}>Dhanmondi (1200)</td>
                      <td style={{ padding: '8px' }}>85% full (170/200 occupied)</td>
                      <td style={{ padding: '8px', color: 'var(--accent-amber)' }}>NEAR LIMIT</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                      <td style={{ padding: '8px' }}><strong>Mirpur College Shelter</strong></td>
                      <td style={{ padding: '8px' }}>Mirpur (1216)</td>
                      <td style={{ padding: '8px' }}>40% full (120/300 occupied)</td>
                      <td style={{ padding: '8px', color: 'var(--accent-green)' }}>AVAILABLE</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                      <td style={{ padding: '8px' }}><strong>Gulshan Youth Club</strong></td>
                      <td style={{ padding: '8px' }}>Gulshan (1212)</td>
                      <td style={{ padding: '8px' }}>92% full (184/200 occupied)</td>
                      <td style={{ padding: '8px', color: 'var(--accent-red)', fontWeight: 'bold' }}>CRITICAL</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* VIEW E: OPERATOR ROSTER */}
        {currentTab === 'roster' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h2 style={{ margin: 0, fontSize: '18px', color: '#fff' }}>Operator & Dispatcher Roster</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
              Current team members monitoring voice fallback networks in Dhaka sector.
            </p>

            <div className="tactical-panel">
              <div className="panel-header">
                <span className="panel-title">Active Operators</span>
              </div>
              <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ padding: '12px', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '2px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div className="profile-avatar">MR</div>
                  <div>
                    <strong>M. Rahman (You)</strong> - Dhaka Hub Dispatcher | Shift: 06:00-18:00
                    <div style={{ fontSize: '10px', color: 'var(--accent-green)', marginTop: '2px' }}>ACTIVE NOW</div>
                  </div>
                </div>
                <div style={{ padding: '12px', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '2px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div className="profile-avatar">TI</div>
                  <div>
                    <strong>T. Islam</strong> - Chittagong Gateway Admin | Shift: 08:00-20:00
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px' }}>STANDBY</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW F: INCIDENT LOGS */}
        {currentTab === 'logs' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h2 style={{ margin: 0, fontSize: '18px', color: '#fff' }}>Dispatcher Incident Logs</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
              Chronological log of system alerts, dispatch activities, database events, and caller inputs.
            </p>

            <div className="tactical-panel grid-panel" style={{ height: '500px' }}>
              <div className="panel-header">
                <span className="panel-title">Console Activity Stream</span>
              </div>
              <div className="panel-body-scroll" style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                {logs.map((log) => (
                  <div key={log.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)', padding: '6px 0' }}>
                    <span style={{ color: 'var(--text-muted)' }}>
                      [{new Date(log.timestamp).toLocaleTimeString()}]
                    </span>{' '}
                    <span style={{ color: log.message.includes('ALERT') ? 'var(--accent-red)' : log.message.includes('Dispatched') ? 'var(--accent-amber)' : '#fff' }}>
                      {log.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* VIEW G: DTMF TRANSCEIVER (PEER-TO-PEER RELAY) */}
        {currentTab === 'transceiver' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '18px', color: '#fff' }}>IVR Routing & DTMF Transceiver</h2>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                  Tactical transceiver tool. Emit DTMF tone bursts via speaker or decode them via microphone to relay crisis reports peer-to-peer.
                </p>
              </div>
              {/* Hex Mode Toggle */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button className="btn-black" onClick={handlePrintCard} style={{ padding: '4px 10px', fontSize: '10px' }}>
                    <FileText size={10} style={{ marginRight: '4px' }} /> Print Fallback Card
                  </button>
                  <label style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Encoding Mode</label>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    id="btn-mode-std"
                    onClick={() => setHexMode(false)}
                    style={{
                      padding: '5px 12px', fontSize: '10px', border: '1px solid', borderRadius: '3px', cursor: 'pointer',
                      background: !hexMode ? 'rgba(255,255,255,0.12)' : 'transparent',
                      color: !hexMode ? '#fff' : 'var(--text-muted)',
                      borderColor: !hexMode ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)'
                    }}
                  >
                    STD · 13 digits
                  </button>
                  <button
                    id="btn-mode-hex"
                    onClick={() => setHexMode(true)}
                    style={{
                      padding: '5px 12px', fontSize: '10px', border: '1px solid', borderRadius: '3px', cursor: 'pointer',
                      background: hexMode ? 'rgba(255,165,0,0.18)' : 'transparent',
                      color: hexMode ? 'var(--accent-amber)' : 'var(--text-muted)',
                      borderColor: hexMode ? 'var(--accent-amber)' : 'rgba(255,255,255,0.08)'
                    }}
                  >
                    HEX · 10 digits ⚡
                  </button>
                </div>
                <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                  {hexMode ? 'Compact Base16 burst — 23% faster transmission' : 'Standard decimal burst — maximum compatibility'}
                </span>
              </div>
            </div>

            <div className="info-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              
              {/* ── TRANSMITTER PANEL ── */}
              <div className="tactical-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h3 style={{ fontSize: '13px', textTransform: 'uppercase', margin: 0, color: 'var(--accent-red)', letterSpacing: '0.08em' }}>
                  ▶ DTMF Tone Transmitter
                </h3>
                
                <div className="form-group">
                  <label style={{ fontSize: '10px' }}>Report Type</label>
                  <select className="form-select" value={encoderType} onChange={(e) => setEncoderType(e.target.value)}>
                    <option value="safe">✓ Safe check-in</option>
                    <option value="help">⚠ Emergency Assistance</option>
                    <option value="missing">? Missing Person</option>
                    <option value="hazard">⬡ Public Hazard</option>
                  </select>
                </div>

                {(encoderType === 'help' || encoderType === 'hazard') && (
                  <div className="form-group">
                    <label style={{ fontSize: '10px' }}>Category Details</label>
                    <select className="form-select" value={encoderCategory} onChange={(e) => setEncoderCategory(e.target.value)}>
                      {encoderType === 'help' ? (
                        <>
                          <option value="medical">Medical emergency</option>
                          <option value="trapped">Trapped / Blocked</option>
                          <option value="flood">Flood hazard</option>
                          <option value="shelter">Need shelter</option>
                        </>
                      ) : (
                        <>
                          <option value="road">Flooded / Blocked road</option>
                          <option value="bridge">Damaged bridge</option>
                          <option value="fire">Fire hazard</option>
                          <option value="other">Other hazard</option>
                        </>
                      )}
                    </select>
                  </div>
                )}

                <div className="form-group">
                  <label style={{ fontSize: '10px' }}>4-Digit Area Code</label>
                  <input 
                    type="text" 
                    className="form-input"
                    maxLength={4}
                    placeholder="e.g. 1200"
                    value={encoderAreaCode}
                    onChange={(e) => setEncoderAreaCode(e.target.value.replace(/\D/g, '').slice(0,4))}
                  />
                </div>

                {/* Encoded Tone Preview */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    <span>Encoded Tone Burst:</span>
                    <span style={{ color: hexMode ? 'var(--accent-amber)' : 'rgba(255,255,255,0.4)' }}>
                      {hexMode ? 'HEX MODE' : 'STANDARD MODE'}
                    </span>
                  </div>
                  <div className="digit-display" style={{ padding: '10px', minHeight: '36px', fontSize: '18px', background: '#07090e', marginTop: '4px', letterSpacing: '3px', color: hexMode ? 'var(--accent-amber)' : '#fff' }}>
                    {encoderAreaCode.length === 4
                      ? hexMode
                        ? encodeReportToHexDTMF({ type: encoderType, category: encoderType === 'safe' || encoderType === 'missing' ? null : encoderCategory, area_code: encoderAreaCode })
                        : encodeReportToDTMF({ type: encoderType, category: encoderType === 'safe' || encoderType === 'missing' ? null : encoderCategory, area_code: encoderAreaCode })
                      : <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Enter 4-digit area code…</span>
                    }
                  </div>
                </div>

                {/* Transmit progress bar */}
                {isTransmitting && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                      <span>Transmitting: <strong style={{ color: '#fff' }}>'{activeTransmitChar}'</strong></span>
                      <span>{transmitProgress}%</span>
                    </div>
                    <div style={{ height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${transmitProgress}%`, background: 'var(--accent-red)', transition: 'width 0.1s', borderRadius: '2px' }} />
                    </div>
                  </div>
                )}

                <button 
                  id="btn-transmit"
                  className="btn-red" 
                  style={{ width: '100%', justifyContent: 'center', marginTop: '4px', gap: '8px' }}
                  onClick={handleTransmit}
                  disabled={isTransmitting || encoderAreaCode.length < 4}
                >
                  <Volume2 size={14} />
                  {isTransmitting ? `Transmitting… (${transmitProgress}%)` : 'Transmit Audio Burst'}
                </button>
              </div>

              {/* ── RECEIVER PANEL ── */}
              <div className="tactical-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <h3 style={{ fontSize: '13px', textTransform: 'uppercase', margin: 0, color: 'var(--accent-green)', letterSpacing: '0.08em' }}>
                  ◉ DTMF Microphone Decoder
                </h3>

                {isListening ? (
                  <button id="btn-stop-listen" className="btn-red" style={{ width: '100%', justifyContent: 'center' }} onClick={handleStopListening}>
                    <MicOff size={14} /> Disable Microphone
                  </button>
                ) : (
                  <button id="btn-start-listen" className="btn-black" style={{ width: '100%', justifyContent: 'center', border: '1px solid var(--accent-green)' }} onClick={handleStartListening}>
                    <Mic size={14} /> Enable Microphone
                  </button>
                )}

                {/* Live Spectrum Visualizer */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    <span>DSP Frequency Spectrum</span>
                    {isListening && <span style={{ color: 'var(--accent-red)' }} className="pulse-indicator">● LIVE</span>}
                  </div>
                  <canvas
                    ref={visualizerCanvasRef}
                    width={340}
                    height={60}
                    style={{ width: '100%', height: '60px', background: '#07090e', borderRadius: '2px', border: '1px solid rgba(255,255,255,0.06)' }}
                  />
                </div>

                {/* Raw char stream */}
                <div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>Raw Decoded Stream:</div>
                  <div className="digit-display" style={{ minHeight: '32px', fontSize: '14px', background: '#07090e', color: hexMode ? 'var(--accent-amber)' : '#fff', letterSpacing: '2px', wordBreak: 'break-all' }}>
                    {rawDecodedChars || <span style={{ color: 'rgba(255,255,255,0.15)' }}>waiting for signal…</span>}
                  </div>
                </div>

                {/* Decoded buffer */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <h4 style={{ fontSize: '11px', textTransform: 'uppercase', margin: 0, color: 'var(--accent-green)' }}>Decoded Buffer</h4>
                    {decodedReports.length > 0 && (
                      <button onClick={() => setDecodedReports([])} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '10px', cursor: 'pointer' }}>Clear</button>
                    )}
                  </div>
                  
                  {decodedReports.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '12px', fontSize: '11px', border: '1px dashed rgba(255,255,255,0.06)', color: 'var(--text-muted)', borderRadius: '2px' }}>
                      No incoming signals. Play transmitter tones near mic.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '120px', overflowY: 'auto' }}>
                      {decodedReports.map((report, idx) => (
                        <div key={idx} style={{ background: 'rgba(255,255,255,0.02)', padding: '8px', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '2px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                          <div>
                            <strong style={{ color: report.type === 'help' ? 'var(--accent-red)' : report.type === 'missing' ? 'var(--accent-amber)' : 'var(--accent-green)' }}>
                              {report.type.toUpperCase()}
                            </strong>
                            {report.category ? <span style={{ color: 'var(--text-muted)' }}> ({report.category})</span> : ''}
                            <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>Area: {report.area_code}</div>
                          </div>
                          <button 
                            className="btn-red" 
                            style={{ padding: '4px 8px', fontSize: '9px' }}
                            onClick={() => handleSyncDecodedReport(report, idx)}
                          >
                            Sync →
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── SIGNAL LOG ── */}
            {signalLog.length > 0 && (
              <div className="tactical-panel" style={{ padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <h3 style={{ fontSize: '12px', textTransform: 'uppercase', margin: 0, color: '#fff' }}>Signal Activity Log</h3>
                  <button onClick={() => setSignalLog([])} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '10px', cursor: 'pointer' }}>Clear</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '140px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '10px' }}>
                  {signalLog.map((entry, idx) => (
                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: '60px 28px 32px 1fr 60px', gap: '8px', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.03)', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-muted)' }}>{entry.ts}</span>
                      <span style={{ color: entry.dir === 'TX' ? 'var(--accent-red)' : 'var(--accent-green)', fontWeight: 'bold' }}>{entry.dir}</span>
                      <span style={{ color: entry.mode === 'HEX' ? 'var(--accent-amber)' : 'rgba(255,255,255,0.5)' }}>{entry.mode}</span>
                      <span style={{ color: '#fff', letterSpacing: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.seq}</span>
                      <span style={{ color: 'var(--text-muted)', textTransform: 'uppercase' }}>{entry.type}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}

        {/* VIEW H: COMMS */}
        {currentTab === 'comms' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: 'calc(100vh - 120px)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '18px', color: '#fff' }}>Operator Communications Network</h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: 'var(--text-muted)' }}>Dedicated secure digital coordinating channel for dispatch hubs.</p>
              </div>
              <div style={{ fontSize: '10px', background: commsConnected ? 'rgba(0, 229, 255, 0.1)' : 'rgba(255, 59, 48, 0.1)', color: commsConnected ? '#00e5ff' : '#ff3b30', border: `1px solid ${commsConnected ? '#00e5ff' : '#ff3b30'}`, borderRadius: '4px', padding: '4px 8px', textTransform: 'uppercase', fontWeight: 'bold' }}>
                {commsConnected ? 'WS Server Connected' : 'Server Offline'}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '20px', flex: 1, minHeight: 0 }}>
              
              {/* Main Chat/Alerts Panel */}
              <div className="tactical-panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, padding: 0 }}>
                <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#fff', textTransform: 'uppercase', tracking: '1px' }}>Active Chat Stream</div>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{chatMessages.length} messages buffered</span>
                </div>

                {!commsJoined ? (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '20px' }}>
                    <Users size={32} style={{ color: 'var(--text-muted)' }} />
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ color: '#fff', fontWeight: 'bold', fontSize: '13px' }}>Join the Coordinating Network</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '4px' }}>Register this terminal to receive live broadcasts and coordinate with operators.</div>
                    </div>
                    
                    <div style={{ display: 'flex', gap: '8px', width: '320px', flexDirection: 'column' }}>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input 
                          type="text" 
                          className="form-input" 
                          placeholder="Your Name (e.g. Dhaka Hub)" 
                          value={operatorName}
                          onChange={(e) => setOperatorName(e.target.value)}
                        />
                        <select 
                          className="form-select" 
                          value={operatorSector} 
                          onChange={(e) => setOperatorSector(e.target.value)}
                          style={{ width: '120px' }}
                        >
                          <option value="All">All Sectors</option>
                          <option value="Dhaka">Dhaka</option>
                          <option value="Chittagong">Chittagong</option>
                          <option value="Sylhet">Sylhet</option>
                        </select>
                      </div>
                      <button className="btn-red" onClick={handleJoinComms}>Register Node</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Chat log messages */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', background: '#090c11' }}>
                      {chatMessages.length === 0 ? (
                        <div style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: '11px', padding: '40px 0' }}>
                          No messages yet. Use the command line below to broadcast to other dispatchers.
                        </div>
                      ) : (
                        chatMessages.map((m, idx) => (
                          <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignSelf: m.from === operatorName ? 'flex-end' : 'flex-start', maxWidth: '70%' }}>
                            <div style={{ display: 'flex', gap: '6px', fontSize: '9px', color: 'var(--text-muted)', alignSelf: m.from === operatorName ? 'flex-end' : 'flex-start' }}>
                              <span style={{ fontWeight: 'bold', color: m.from === operatorName ? '#00e5ff' : '#ffffff' }}>{m.from}</span>
                              <span>[{m.sector}]</span>
                              <span>{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                            </div>
                            <div style={{ background: m.from === operatorName ? 'rgba(0, 229, 255, 0.08)' : 'rgba(255, 255, 255, 0.04)', border: `1px solid ${m.from === operatorName ? 'rgba(0, 229, 255, 0.2)' : 'rgba(255, 255, 255, 0.08)'}`, borderRadius: '4px', padding: '8px 12px', fontSize: '11px', color: '#fff', wordBreak: 'break-word', fontFamily: 'monospace' }}>
                              {m.message}
                            </div>
                          </div>
                        ))
                      )}
                      <div ref={chatEndRef} />
                    </div>

                    {/* Chat input box */}
                    <form onSubmit={handleSendChat} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px', display: 'flex', gap: '8px', background: '#0b0e14' }}>
                      <input 
                        type="text" 
                        className="form-input" 
                        placeholder="Type message to broadcast to operators..." 
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <button type="submit" className="btn-red" style={{ padding: '8px 16px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <Send size={12} /> Send
                      </button>
                    </form>
                  </>
                )}
              </div>

              {/* Sidebar: Presence & Alerts */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', minHeight: 0 }}>
                {/* Active Terminals / Operators */}
                <div className="tactical-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 0 }}>
                  <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Users size={12} style={{ color: '#00e5ff' }} />
                    <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#fff', textTransform: 'uppercase' }}>Active Hub Terminals</span>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {operatorList.length === 0 ? (
                      <div style={{ color: 'var(--text-muted)', fontSize: '10px', textAlign: 'center', padding: '20px 0' }}>No active terminals found.</div>
                    ) : (
                      operatorList.map((op, idx) => (
                        <div key={idx} style={{ background: '#090c11', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '4px', padding: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#fff' }}>{op.name}</div>
                            <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Sector: {op.sector}</div>
                          </div>
                          <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#00e5ff', animation: 'blink 2s infinite' }}></span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* System Alerts and Warnings log */}
                <div className="tactical-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 0 }}>
                  <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ShieldAlert size={12} style={{ color: 'var(--accent-red)' }} />
                    <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#fff', textTransform: 'uppercase' }}>Alerts Stream</span>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {incomingAlerts.length === 0 ? (
                      <div style={{ color: 'var(--text-muted)', fontSize: '10px', textAlign: 'center', padding: '20px 0' }}>No incoming alerts.</div>
                    ) : (
                      incomingAlerts.map((al, idx) => (
                        <div key={idx} style={{ background: al.level === 'warning' ? 'rgba(255,149,0,0.06)' : 'rgba(255,59,48,0.06)', borderLeft: `3px solid ${al.level === 'warning' ? 'var(--accent-amber)' : 'var(--accent-red)'}`, padding: '8px', borderRadius: '0 4px 4px 0' }}>
                          <div style={{ fontSize: '10px', color: '#fff', fontFamily: 'monospace' }}>{al.message}</div>
                          <span style={{ fontSize: '8px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>{new Date(al.ts || Date.now()).toLocaleTimeString()}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* VIEW H: SETTINGS */}
        {currentTab === 'settings' && (

          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h2 style={{ margin: 0, fontSize: '18px', color: '#fff' }}>System Configurations</h2>
            
            <div className="tactical-panel" style={{ padding: '16px' }}>
              <h3 style={{ fontSize: '12px', textTransform: 'uppercase', color: '#fff', margin: '0 0 16px 0' }}>Server Connection</h3>
              <div className="form-group" style={{ gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Backend URL</label>
                  <input type="text" className="form-input" style={{ width: '95%', marginTop: '4px' }} defaultValue={BACKEND_URL} disabled />
                </div>
                <div>
                  <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Twilio Webhook Target</label>
                  <input type="text" className="form-input" style={{ width: '95%', marginTop: '4px' }} defaultValue={`${BACKEND_URL}/voice`} disabled />
                </div>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* 4. MODALS */}

      {/* Broadcast Alert Modal */}
      {isAlertModalOpen && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-header">
              <span>BROADCAST EMERGENCY ALERT</span>
              <button 
                style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '16px', cursor: 'pointer' }}
                onClick={() => setIsAlertModalOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="form-group">
                <label>Target Sector</label>
                <select className="form-select" value={alertSector} onChange={(e) => setAlertSector(e.target.value)}>
                  <option value="Dhaka Sector">Dhaka Sector (All)</option>
                  <option value="Chittagong Sector">Chittagong Sector</option>
                  <option value="All Sectors">All Sectors</option>
                </select>
              </div>
              <div className="form-group">
                <label>Alert Message</label>
                <textarea 
                  className="form-input" 
                  style={{ height: '80px', resize: 'none', fontFamily: 'monospace' }}
                  value={alertMsg}
                  onChange={(e) => setAlertMsg(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-black" onClick={() => setIsAlertModalOpen(false)}>Cancel</button>
              <button className="btn-red" onClick={handleBroadcastAlert}>Trigger Broadcast</button>
            </div>
          </div>
        </div>
      )}

      {/* Dispatch Unit Modal */}
      {isDispatchModalOpen && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-header">
              <span>DISPATCH EMERGENCY FIELD UNIT</span>
              <button 
                style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '16px', cursor: 'pointer' }}
                onClick={() => setIsDispatchModalOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="form-group">
                <label>Field Unit / Team</label>
                <select className="form-select" value={dispatchUnit} onChange={(e) => setDispatchUnit(e.target.value)}>
                  <option value="Unit 4 - Medical Support">Ambulance Team #4</option>
                  <option value="Unit 9 - Search & Rescue">Search & Rescue Team #9</option>
                  <option value="Unit 2 - Disaster First Aid">Disaster First Aid #2</option>
                  <option value="Unit 5 - Shelter Logistics">Shelter Supply Unit #5</option>
                </select>
              </div>
              <div className="form-group">
                <label>Target Sector</label>
                <select className="form-select" value={dispatchSector} onChange={(e) => setDispatchSector(e.target.value)}>
                  <option value="Mirpur">Mirpur Sector</option>
                  <option value="Banani">Banani Sector</option>
                  <option value="Dhanmondi">Dhanmondi Sector</option>
                  <option value="Uttara">Uttara Sector</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-black" onClick={() => setIsDispatchModalOpen(false)}>Cancel</button>
              <button className="btn-red" onClick={handleDispatchUnit}>Deploy Unit</button>
            </div>
          </div>
        </div>
      )}

      {/* ── PRINT-ONLY VIEWS ── */}
      {printMode === 'missing' && (
        <div className="print-only">
          <h2 style={{ textAlign: 'center', marginBottom: '20px', textTransform: 'uppercase' }}>Missing Persons Registry</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#eee' }}>
                <th style={{ padding: '8px', border: '1px solid #000' }}>Voice Log ID</th>
                <th style={{ padding: '8px', border: '1px solid #000' }}>Area Code</th>
                <th style={{ padding: '8px', border: '1px solid #000' }}>Phone / Reporter</th>
                <th style={{ padding: '8px', border: '1px solid #000' }}>Logged Time</th>
              </tr>
            </thead>
            <tbody>
              {reports.filter(r => r.type === 'missing').map((report, idx) => (
                <tr key={idx}>
                  <td style={{ padding: '8px', border: '1px solid #000', textAlign: 'center' }}>#44{report.id || 90 + idx}</td>
                  <td style={{ padding: '8px', border: '1px solid #000', textAlign: 'center' }}>{report.area_code || '1200'}</td>
                  <td style={{ padding: '8px', border: '1px solid #000', textAlign: 'center' }}>{report.phone.replace(/(\d{4})\d{4}$/, '$1****')}</td>
                  <td style={{ padding: '8px', border: '1px solid #000', textAlign: 'center' }}>{new Date(report.timestamp).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: '20px', fontSize: '12px', fontStyle: 'italic' }}>Confidential - For shelter bulletin boards only.</p>
        </div>
      )}

      {printMode === 'card' && (
        <div className="print-only" style={{ display: 'flex', flexWrap: 'wrap', gap: '20px' }}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} style={{ width: '300px', border: '2px solid #000', padding: '16px', borderRadius: '8px', fontFamily: 'sans-serif' }}>
              <h3 style={{ margin: '0 0 10px 0', textAlign: 'center', borderBottom: '1px solid #000', paddingBottom: '8px' }}>CallCast Emergency Dialing</h3>
              <p style={{ fontSize: '12px', margin: '0 0 10px 0', textAlign: 'center' }}>If internet is down, call<br/><strong style={{ fontSize: '16px' }}>+880 9612-444999</strong></p>
              <table style={{ width: '100%', fontSize: '12px', marginBottom: '10px' }}>
                <tbody>
                  <tr><td style={{ padding: '4px', borderBottom: '1px solid #ddd' }}><strong style={{ display: 'inline-block', width: '20px', height: '20px', background: '#000', color: '#fff', textAlign: 'center', borderRadius: '4px', lineHeight: '20px' }}>1</strong></td><td style={{ padding: '4px', borderBottom: '1px solid #ddd' }}>I am Safe (Check-in)</td></tr>
                  <tr><td style={{ padding: '4px', borderBottom: '1px solid #ddd' }}><strong style={{ display: 'inline-block', width: '20px', height: '20px', background: '#000', color: '#fff', textAlign: 'center', borderRadius: '4px', lineHeight: '20px' }}>2</strong></td><td style={{ padding: '4px', borderBottom: '1px solid #ddd' }}>I Need Medical/Help</td></tr>
                  <tr><td style={{ padding: '4px', borderBottom: '1px solid #ddd' }}><strong style={{ display: 'inline-block', width: '20px', height: '20px', background: '#000', color: '#fff', textAlign: 'center', borderRadius: '4px', lineHeight: '20px' }}>3</strong></td><td style={{ padding: '4px', borderBottom: '1px solid #ddd' }}>Report Missing Person</td></tr>
                  <tr><td style={{ padding: '4px', borderBottom: '1px solid #ddd' }}><strong style={{ display: 'inline-block', width: '20px', height: '20px', background: '#000', color: '#fff', textAlign: 'center', borderRadius: '4px', lineHeight: '20px' }}>4</strong></td><td style={{ padding: '4px', borderBottom: '1px solid #ddd' }}>Report Hazard/Roadblock</td></tr>
                </tbody>
              </table>
              <p style={{ fontSize: '10px', margin: 0, fontStyle: 'italic', textAlign: 'center' }}>Keep this card in your wallet.</p>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

// Coordinate helper function (defined outside component or nested, outside is cleaner)
const getCoordinates = (areaCode, idx) => {
  if (AREA_COORDS[areaCode]) {
    return AREA_COORDS[areaCode];
  }
  // Jitter coordinates near default center for duplicate/unknown postcodes
  const offsetLat = (Math.sin(idx) * 0.05);
  const offsetLng = (Math.cos(idx) * 0.05);
  return [DEFAULT_CENTER[0] + offsetLat, DEFAULT_CENTER[1] + offsetLng];
};

const formatDate = (ts) => {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + 
         ' (' + new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ')';
};

export default App;
