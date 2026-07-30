// DTMF Frequency mappings
const DTMF_FREQS = {
  '1': [697, 1209],
  '2': [697, 1336],
  '3': [697, 1477],
  'A': [697, 1633],
  '4': [770, 1209],
  '5': [770, 1336],
  '6': [770, 1477],
  'B': [770, 1633],
  '7': [852, 1209],
  '8': [852, 1336],
  '9': [852, 1477],
  'C': [852, 1633],
  '*': [941, 1209],
  '0': [941, 1336],
  '#': [941, 1477],
  'D': [941, 1633]
};

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Play a single DTMF tone.
 * @param {string} char DTMF character (0-9, A-D, *, #)
 * @param {number} duration Duration in milliseconds
 * @returns {Promise} Resolves when the tone is finished playing
 */
export function playDTMFTone(char, duration = 250) {
  return new Promise((resolve) => {
    const uppercaseChar = char.toUpperCase();
    if (!DTMF_FREQS[uppercaseChar]) {
      // If it's a spacer, just wait
      setTimeout(resolve, duration);
      return;
    }

    const ctx = getAudioContext();
    const [freqLow, freqHigh] = DTMF_FREQS[uppercaseChar];

    // Create low frequency oscillator
    const oscLow = ctx.createOscillator();
    oscLow.type = 'sine';
    oscLow.frequency.value = freqLow;

    // Create high frequency oscillator
    const oscHigh = ctx.createOscillator();
    oscHigh.type = 'sine';
    oscHigh.frequency.value = freqHigh;

    // Create gain node to mix and control volume
    const gainNode = ctx.createGain();
    // Use low volume to be gentle on speakers/headphones (0.15 each is plenty)
    gainNode.gain.setValueAtTime(0.12, ctx.currentTime);
    // Smooth ramp down at the end to prevent clicking sound
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (duration / 1000));

    // Connect nodes
    oscLow.connect(gainNode);
    oscHigh.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Start oscillators
    oscLow.start();
    oscHigh.start();

    // Stop and cleanup
    setTimeout(() => {
      oscLow.stop();
      oscHigh.stop();
      oscLow.disconnect();
      oscHigh.disconnect();
      gainNode.disconnect();
      resolve();
    }, duration);
  });
}

/**
 * Play a sequence of DTMF tones.
 * @param {string} sequence A string of characters to encode (e.g. "*1*1200*5830*3#")
 * @param {number} toneDuration Tone duration in milliseconds
 * @param {number} pauseDuration Pause duration in milliseconds between tones
 * @param {function} onProgress Callback called before each character plays
 */
export async function playDTMFSequence(sequence, toneDuration = 200, pauseDuration = 100, onProgress = null) {
  const chars = sequence.split('');
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (onProgress) {
      onProgress(char, i, chars.length);
    }
    await playDTMFTone(char, toneDuration);
    await new Promise(r => setTimeout(r, pauseDuration));
  }
}

/**
 * Generates a standard data burst string from report parameters.
 * Format: * [Type] * [AreaCode] * [TimestampSuffix] * [Checksum] #
 * - Type: 1-9 (1: safe, 2: med, 3: trapped, 4: flood, 5: shelter, 6: missing, 7: road, 8: bridge, 9: fire)
 * - AreaCode: 4-digit area code (e.g., 1200)
 * - Timestamp: Short timestamp (seconds % 10000) (e.g., 9134)
 * - Checksum: Modulo sum of all numeric digits
 */
export function encodeReportToDTMF(report) {
  let typeCode = '1'; // safe
  if (report.type === 'help') {
    if (report.category === 'medical') typeCode = '2';
    else if (report.category === 'trapped') typeCode = '3';
    else if (report.category === 'flood') typeCode = '4';
    else if (report.category === 'shelter') typeCode = '5';
  } else if (report.type === 'missing') {
    typeCode = '6';
  } else if (report.type === 'hazard') {
    if (report.category === 'road') typeCode = '7';
    else if (report.category === 'bridge') typeCode = '8';
    else if (report.category === 'fire') typeCode = '9';
  }

  const area = String(report.area_code || '0000').padStart(4, '0');
  
  // Create a 4-digit timestamp suffix from epoch
  const shortTime = String(Math.floor(Date.now() / 1000) % 10000).padStart(4, '0');
  
  // Calculate a basic checksum of all digits so far
  const digitStr = `${typeCode}${area}${shortTime}`;
  const sum = digitStr.split('').reduce((acc, char) => acc + parseInt(char, 10), 0);
  const checksum = sum % 10;

  return `*${typeCode}*${area}*${shortTime}*${checksum}#`;
}

/**
 * Generates a high-speed Base16 compressed DTMF burst string from report parameters.
 * Format: A [TypeCode] [AreaCodeHex:3] [TimestampHex:3] [ChecksumHex] D
 */
export function encodeReportToHexDTMF(report) {
  let typeCode = '1';
  if (report.type === 'help') {
    if (report.category === 'medical') typeCode = '2';
    else if (report.category === 'trapped') typeCode = '3';
    else if (report.category === 'flood') typeCode = '4';
    else if (report.category === 'shelter') typeCode = '5';
  } else if (report.type === 'missing') {
    typeCode = '6';
  } else if (report.type === 'hazard') {
    if (report.category === 'road') typeCode = '7';
    else if (report.category === 'bridge') typeCode = '8';
    else if (report.category === 'fire') typeCode = '9';
  }

  // Area code to 3-digit hex (max area code 4095)
  const areaVal = parseInt(report.area_code || '0', 10);
  const areaHex = areaVal.toString(16).toUpperCase().padStart(3, '0');

  // Timestamp to 3-digit hex (seconds % 4096)
  const timeVal = Math.floor(Date.now() / 1000) % 4096;
  const timeHex = timeVal.toString(16).toUpperCase().padStart(3, '0');

  // Calculate Checksum of all preceding characters in Hex
  const preStr = `${typeCode}${areaHex}${timeHex}`;
  const sum = preStr.split('').reduce((acc, char) => acc + parseInt(char, 16), 0);
  const checksumHex = (sum % 16).toString(16).toUpperCase();

  return `A${typeCode}${areaHex}${timeHex}${checksumHex}D`;
}
