// DTMF Frequency definitions
const ROW_FREQS = [697, 770, 852, 941];
const COL_FREQS = [1209, 1336, 1477, 1633];

const DTMF_MAP = [
  ['1', '2', '3', 'A'],
  ['4', '5', '6', 'B'],
  ['7', '8', '9', 'C'],
  ['*', '0', '#', 'D']
];

/**
 * Goertzel Algorithm implementation to calculate magnitude of a specific frequency.
 */
function goertzel(samples, targetFreq, sampleRate) {
  const numSamples = samples.length;
  // Calculate coefficients
  const k = Math.round((numSamples * targetFreq) / sampleRate);
  const omega = (2 * Math.PI * k) / numSamples;
  const cosine = Math.cos(omega);
  const sine = Math.sin(omega);
  const coeff = 2 * cosine;

  let q0 = 0;
  let q1 = 0;
  let q2 = 0;

  for (let i = 0; i < numSamples; i++) {
    q0 = coeff * q1 - q2 + samples[i];
    q2 = q1;
    q1 = q0;
  }

  const real = q1 - q2 * cosine;
  const imag = q2 * sine;
  const magnitudeSquared = real * real + imag * imag;

  return Math.sqrt(magnitudeSquared);
}

let audioContext = null;
let mediaStream = null;
let scriptProcessor = null;

/**
 * Starts listening to the microphone and processes audio to decode DTMF tones.
 * @param {function} onCharDecoded Callback when a DTMF character is detected and debounced: (char) => {}
 * @param {function} onError Callback for errors (e.g. mic permission denied)
 * @param {function} onAnalyserReady Optional callback called with the AnalyserNode for visualization: (analyser) => {}
 */
export function startListening(onCharDecoded, onError = null, onAnalyserReady = null) {
  navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    .then((stream) => {
      mediaStream = stream;
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      
      const sampleRate = audioContext.sampleRate;
      
      // 1024 samples is a good compromise between frequency resolution and time resolution
      scriptProcessor = audioContext.createScriptProcessor(1024, 1, 1);

      // Optional AnalyserNode for spectrum visualisation
      let analyserNode = null;
      if (onAnalyserReady) {
        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = 256;
        source.connect(analyserNode);
        onAnalyserReady(analyserNode);
      }
      
      // Debounce state
      let activeChar = null;
      let activeCount = 0;
      let silenceCount = 0;
      const REQUIRE_FRAMES = 2; // Character must be detected for 2 frames (~46ms at 44.1kHz) to trigger
      const REQUIRE_SILENCE_FRAMES = 3; // Must detect silence for 3 frames before triggering a new character

      scriptProcessor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        
        // 1. Calculate Goertzel magnitudes for all rows and cols
        const rowMagnitudes = ROW_FREQS.map(f => goertzel(inputData, f, sampleRate));
        const colMagnitudes = COL_FREQS.map(f => goertzel(inputData, f, sampleRate));

        // 2. Find maximum row and column
        let maxRowVal = -1;
        let maxRowIdx = -1;
        rowMagnitudes.forEach((val, idx) => {
          if (val > maxRowVal) {
            maxRowVal = val;
            maxRowIdx = idx;
          }
        });

        let maxColVal = -1;
        let maxColIdx = -1;
        colMagnitudes.forEach((val, idx) => {
          if (val > maxColVal) {
            maxColVal = val;
            maxColIdx = idx;
          }
        });

        // 3. Validation and Thresholding (Talk-off protection)
        // Thresholds depend on overall background noise, but 0.35 is a good default for normalized audio.
        const minThreshold = 0.4;
        
        // Compute averages to check if the peak is prominent
        const rowAvg = (rowMagnitudes.reduce((a, b) => a + b, 0) - maxRowVal) / 3;
        const colAvg = (colMagnitudes.reduce((a, b) => a + b, 0) - maxColVal) / 3;

        let detectedChar = null;

        if (maxRowVal > minThreshold && maxColVal > minThreshold) {
          // Peak-to-average ratio check (must be at least 2x louder than other DTMF frequencies in the same band)
          if (maxRowVal > rowAvg * 2.0 && maxColVal > colAvg * 2.0) {
            detectedChar = DTMF_MAP[maxRowIdx][maxColIdx];
          }
        }

        // 4. Debouncing & State Machine
        if (detectedChar) {
          silenceCount = 0;
          if (detectedChar === activeChar) {
            activeCount++;
          } else {
            activeChar = detectedChar;
            activeCount = 1;
          }
        } else {
          // No tone detected in this frame
          silenceCount++;
          if (silenceCount >= REQUIRE_SILENCE_FRAMES) {
            if (activeChar && activeCount >= REQUIRE_FRAMES) {
              // We had a valid tone sequence, now followed by silence, trigger it!
              onCharDecoded(activeChar);
            }
            // Reset state
            activeChar = null;
            activeCount = 0;
          }
        }
      };

      // Connect the mic source to the script processor (analyser already connected above if present)
      if (analyserNode) {
        analyserNode.connect(scriptProcessor);
      } else {
        source.connect(scriptProcessor);
      }
      scriptProcessor.connect(audioContext.destination);
    })
    .catch((err) => {
      console.error('Error accessing microphone for DTMF decoding:', err);
      if (onError) onError(err);
    });
}

/**
 * Stops listening and cleans up media streams.
 */
export function stopListening() {
  if (scriptProcessor) {
    scriptProcessor.disconnect();
    scriptProcessor = null;
  }
  if (audioContext) {
    if (audioContext.state !== 'closed') {
      audioContext.close();
    }
    audioContext = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
}

/**
 * Parses a CallCast DTMF data burst string.
 * Format: * [Type] * [AreaCode] * [TimestampSuffix] * [Checksum] #
 * Returns a parsed report object or throws an error.
 */
export function parseDTMFBurst(burstStr) {
  // Regex to match the burst structure
  const regex = /^\*(\d)\*(\d{4})\*(\d{4})\*(\d)#$/;
  const match = burstStr.match(regex);
  if (!match) {
    throw new Error('Invalid DTMF burst format');
  }

  const [_, typeCode, areaCode, timestampSuffix, checksum] = match;

  // Validate checksum
  const digitStr = `${typeCode}${areaCode}${timestampSuffix}`;
  const sum = digitStr.split('').reduce((acc, char) => acc + parseInt(char, 10), 0);
  const calculatedChecksum = sum % 10;

  if (calculatedChecksum !== parseInt(checksum, 10)) {
    throw new Error(`Checksum mismatch. Expected ${calculatedChecksum}, got ${checksum}`);
  }

  // Map typeCode to status & category
  let type = 'safe';
  let category = null;

  switch (typeCode) {
    case '1':
      type = 'safe';
      break;
    case '2':
      type = 'help';
      category = 'medical';
      break;
    case '3':
      type = 'help';
      category = 'trapped';
      break;
    case '4':
      type = 'help';
      category = 'flood';
      break;
    case '5':
      type = 'help';
      category = 'shelter';
      break;
    case '6':
      type = 'missing';
      break;
    case '7':
      type = 'hazard';
      category = 'road';
      break;
    case '8':
      type = 'hazard';
      category = 'bridge';
      break;
    case '9':
      type = 'hazard';
      category = 'fire';
      break;
    default:
      type = 'safe';
  }

  return {
    type,
    category,
    area_code: areaCode,
    timestamp: Date.now(), // Approximate timestamp (we could calculate it using the suffix if needed)
    source: 'relay'
  };
}

/**
 * Parses a CallCast high-speed Hex DTMF data burst string.
 * Format: A [Type:1] [AreaCodeHex:3] [TimestampHex:3] [ChecksumHex:1] D
 * Returns a parsed report object or throws an error.
 */
export function parseHexDTMFBurst(burstStr) {
  const regex = /^A([1-9])([0-9A-F]{3})([0-9A-F]{3})([0-9A-F])D$/i;
  const match = burstStr.toUpperCase().match(regex);
  if (!match) {
    throw new Error('Invalid Hex DTMF burst format');
  }

  const [_, typeCode, areaHex, timeHex, checksumHex] = match;

  // Validate checksum
  const preStr = `${typeCode}${areaHex}${timeHex}`;
  const sum = preStr.split('').reduce((acc, char) => acc + parseInt(char, 16), 0);
  const calculatedChecksum = (sum % 16).toString(16).toUpperCase();

  if (calculatedChecksum !== checksumHex) {
    throw new Error(`Checksum mismatch. Expected ${calculatedChecksum}, got ${checksumHex}`);
  }

  // Convert area code back to decimal string (e.g. 4B0 -> 1200)
  const areaCode = String(parseInt(areaHex, 16));

  // Map typeCode to status & category
  let type = 'safe';
  let category = null;

  switch (typeCode) {
    case '1': type = 'safe'; break;
    case '2': type = 'help'; category = 'medical'; break;
    case '3': type = 'help'; category = 'trapped'; break;
    case '4': type = 'help'; category = 'flood'; break;
    case '5': type = 'help'; category = 'shelter'; break;
    case '6': type = 'missing'; break;
    case '7': type = 'hazard'; category = 'road'; break;
    case '8': type = 'hazard'; category = 'bridge'; break;
    case '9': type = 'hazard'; category = 'fire'; break;
  }

  return {
    type,
    category,
    area_code: areaCode,
    timestamp: Date.now(),
    source: 'relay'
  };
}
