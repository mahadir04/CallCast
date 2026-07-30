import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, '../callcast.db');

// Enable verbose mode for debugging
const sqlite = sqlite3.verbose();

const db = new sqlite.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database at:', dbPath);
    db.serialize(() => {
      // Create reports table
      db.run(`
        CREATE TABLE IF NOT EXISTS reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone TEXT NOT NULL,
          type TEXT NOT NULL,
          category TEXT,
          area_code TEXT,
          recording_url TEXT,
          timestamp INTEGER NOT NULL,
          source TEXT NOT NULL DEFAULT 'call'
        )
      `, (err) => {
        if (err) {
          console.error('Error creating reports table:', err.message);
        } else {
          console.log('Reports table initialized.');
          seedMockReports();
        }
      });

      // Create logs table
      db.run(`
        CREATE TABLE IF NOT EXISTS logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        )
      `, (err) => {
        if (err) {
          console.error('Error creating logs table:', err.message);
        } else {
          console.log('Logs table initialized.');
          seedMockLogs();
        }
      });
    });
  }
});

// Seed mock reports
function seedMockReports() {
  db.get('SELECT COUNT(*) as count FROM reports', [], (err, row) => {
    if (!err && row && row.count === 0) {
      console.log('Database reports empty. Seeding mock reports...');
      const mockReports = [
        { phone: '+8801711112233', type: 'safe', category: null, area_code: '1200', recording_url: null, timestamp: Date.now() - 3600000 * 4, source: 'call' },
        { phone: '+8801822223344', type: 'safe', category: null, area_code: '1212', recording_url: null, timestamp: Date.now() - 3600000 * 3, source: 'call' },
        { phone: '+8801933334455', type: 'safe', category: null, area_code: '1000', recording_url: null, timestamp: Date.now() - 3600000 * 2, source: 'call' },
        { phone: '+8801722223344', type: 'help', category: 'medical', area_code: '1200', recording_url: null, timestamp: Date.now() - 3600000 * 6, source: 'call' },
        { phone: '+8801833334455', type: 'help', category: 'trapped', area_code: '1212', recording_url: null, timestamp: Date.now() - 3600000 * 5, source: 'call' },
        { phone: '+8801944445566', type: 'help', category: 'flood', area_code: '9000', recording_url: null, timestamp: Date.now() - 3600000 * 1, source: 'call' },
        { phone: '+8801733334455', type: 'hazard', category: 'road', area_code: '1200', recording_url: null, timestamp: Date.now() - 3600000 * 8, source: 'call' },
        { phone: '+8801844445566', type: 'hazard', category: 'bridge', area_code: '4000', recording_url: null, timestamp: Date.now() - 3600000 * 7, source: 'call' },
        { phone: '+8801744445566', type: 'missing', category: null, area_code: '1212', recording_url: 'https://api.twilio.com/2010-04-01/Accounts/ACxxx/Recordings/RExxx', timestamp: Date.now() - 3600000 * 10, source: 'call' }
      ];
      const stmt = db.prepare(`
        INSERT INTO reports (phone, type, category, area_code, recording_url, timestamp, source)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      mockReports.forEach((r) => {
        stmt.run([r.phone, r.type, r.category, r.area_code, r.recording_url, r.timestamp, r.source]);
      });
      stmt.finalize();
      console.log('Seeded mock reports.');
    }
  });
}

// Seed mock logs
function seedMockLogs() {
  db.get('SELECT COUNT(*) as count FROM logs', [], (err, row) => {
    if (!err && row && row.count === 0) {
      console.log('Database logs empty. Seeding mock logs...');
      const mockLogs = [
        { message: 'Dhaka Sector: Cellular communications collapsed at 08:14 AM.', timestamp: Date.now() - 600000 * 5 },
        { message: 'Offline IVR gateway deployed on Dhaka Hub. 32 fallback lines activated.', timestamp: Date.now() - 600000 * 4 },
        { message: 'Local cache DB initialized successfully.', timestamp: Date.now() - 600000 * 3 },
        { message: 'Dispatcher M. Rahman logged in and assigned to Dhaka Hub.', timestamp: Date.now() - 600000 * 2 }
      ];
      const stmt = db.prepare(`
        INSERT INTO logs (message, timestamp)
        VALUES (?, ?)
      `);
      mockLogs.forEach((l) => {
        stmt.run([l.message, l.timestamp]);
      });
      stmt.finalize();
      console.log('Seeded mock dispatcher logs.');
    }
  });
}

// Reset Database function
export function resetDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('DELETE FROM reports', (err) => {
        if (err) return reject(err);
        db.run('DELETE FROM logs', (err) => {
          if (err) return reject(err);
          // Seed again
          seedMockReports();
          seedMockLogs();
          resolve({ message: 'Database reset and seeded successfully.' });
        });
      });
    });
  });
}

// Helper function to insert a report
export function insertReport(report) {
  return new Promise((resolve, reject) => {
    const { phone, type, category, area_code, recording_url, timestamp, source = 'call' } = report;
    const query = `
      INSERT INTO reports (phone, type, category, area_code, recording_url, timestamp, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    db.run(query, [phone, type, category, area_code, recording_url, timestamp || Date.now(), source], function (err) {
      if (err) {
        console.error('Error inserting report:', err.message);
        reject(err);
      } else {
        resolve({ id: this.lastID, ...report });
      }
    });
  });
}

// Helper function to get all reports
export function getReports() {
  return new Promise((resolve, reject) => {
    const query = `SELECT * FROM reports ORDER BY timestamp DESC`;
    db.all(query, [], (err, rows) => {
      if (err) {
        console.error('Error fetching reports:', err.message);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Helper function to get stats
export function getStats() {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN type = 'safe' THEN 1 ELSE 0 END) as safe_count,
        SUM(CASE WHEN type = 'help' THEN 1 ELSE 0 END) as help_count,
        SUM(CASE WHEN type = 'missing' THEN 1 ELSE 0 END) as missing_count,
        SUM(CASE WHEN type = 'hazard' THEN 1 ELSE 0 END) as hazard_count
      FROM reports
    `;
    db.get(query, [], (err, row) => {
      if (err) {
        console.error('Error fetching stats:', err.message);
        reject(err);
      } else {
        resolve({
          total: row.total || 0,
          safe: row.safe_count || 0,
          help: row.help_count || 0,
          missing: row.missing_count || 0,
          hazard: row.hazard_count || 0
        });
      }
    });
  });
}

// Helper function to insert a dispatcher log
export function insertLog(message) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now();
    const query = `INSERT INTO logs (message, timestamp) VALUES (?, ?)`;
    db.run(query, [message, timestamp], function (err) {
      if (err) {
        console.error('Error inserting log:', err.message);
        reject(err);
      } else {
        resolve({ id: this.lastID, message, timestamp });
      }
    });
  });
}

// Helper function to get all dispatcher logs
export function getLogs() {
  return new Promise((resolve, reject) => {
    const query = `SELECT * FROM logs ORDER BY timestamp DESC LIMIT 50`;
    db.all(query, [], (err, rows) => {
      if (err) {
        console.error('Error fetching logs:', err.message);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Helper function to get stats for a specific area code (IVR chatbot query)
export function queryAreaStats(areaCode) {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
        SUM(CASE WHEN type = 'safe' THEN 1 ELSE 0 END) as safe_count,
        SUM(CASE WHEN type = 'help' THEN 1 ELSE 0 END) as help_count,
        SUM(CASE WHEN type = 'hazard' THEN 1 ELSE 0 END) as hazard_count
      FROM reports 
      WHERE area_code = ?
    `;
    db.get(query, [areaCode], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve({
          safe: row.safe_count || 0,
          help: row.help_count || 0,
          hazard: row.hazard_count || 0
        });
      }
    });
  });
}

export default db;
