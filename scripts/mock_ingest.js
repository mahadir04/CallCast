// Simple mock ingestion script for CallCast
// Run this while the backend is running to populate SQLite database with test reports.

const BACKEND_URL = 'http://localhost:5000';

const sampleReports = [
  // Safety check-ins
  { phone: '+8801711112233', type: 'safe', area_code: '1200' }, // Dhanmondi
  { phone: '+8801822223344', type: 'safe', area_code: '1212' }, // Gulshan
  { phone: '+8801933334455', type: 'safe', area_code: '1000' }, // Dhaka GPO
  { phone: '+8801544445566', type: 'safe', area_code: '4000' }, // Chittagong
  { phone: '+8801655556677', type: 'safe', area_code: '3100' }, // Sylhet

  // Help requests
  { phone: '+8801722223344', type: 'help', category: 'medical', area_code: '1200' },
  { phone: '+8801833334455', type: 'help', category: 'trapped', area_code: '1212' },
  { phone: '+8801944445566', type: 'help', category: 'flood', area_code: '9000' }, // Barisal
  { phone: '+8801555556677', type: 'help', category: 'shelter', area_code: '6000' }, // Rajshahi

  // Hazards
  { phone: '+8801733334455', type: 'hazard', category: 'road', area_code: '1200' },
  { phone: '+8801844445566', type: 'hazard', category: 'bridge', area_code: '4000' },
  { phone: '+8801955556677', type: 'hazard', category: 'fire', area_code: '9100' }, // Khulna

  // Missing persons
  {
    phone: '+8801744445566',
    type: 'missing',
    area_code: '1212',
    recording_url: 'https://api.twilio.com/2010-04-01/Accounts/ACxxx/Recordings/RExxx'
  },
  {
    phone: '+8801855556677',
    type: 'missing',
    area_code: '3100',
    recording_url: 'https://api.twilio.com/2010-04-01/Accounts/ACxxx/Recordings/REyyy'
  }
];

async function runMockIngestion() {
  console.log('Starting mock ingestion...');
  
  for (const report of sampleReports) {
    try {
      const response = await fetch(`${BACKEND_URL}/api/reports/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phone: report.phone,
          type: report.type,
          category: report.category,
          area_code: report.area_code,
          recording_url: report.recording_url,
          timestamp: Date.now() - Math.floor(Math.random() * 24 * 60 * 60 * 1000), // Random timestamp in the last 24h
          source: 'call' // Simulate Twilio voice call records
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`Successfully ingested ${report.type} report from ${report.phone} for area ${report.area_code}`);
      } else {
        console.error(`Failed to ingest report: ${response.statusText}`);
      }
    } catch (error) {
      console.error(`Error sending request to backend: ${error.message}`);
    }
  }

  console.log('Mock ingestion complete!');
}

runMockIngestion();
