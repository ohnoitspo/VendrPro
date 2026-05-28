// All API calls go through Vercel serverless functions
// No API keys in the frontend — ever

const BASE = process.env.REACT_APP_API_BASE || '';

// ── Pre-warm functions on app load ────────────────────────────────────
export const pingFunctions = async () => {
  try { await fetch(`${BASE}/api/ping`); } catch {}
};

// ── Google Cloud Vision ───────────────────────────────────────────────
export const identifyCard = async (base64Image) => {
  const res  = await fetch(`${BASE}/api/vision`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ image: base64Image }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Vision API error ${res.status}`);
  }
  const data = await res.json();
  return parseVision(data.responses?.[0] || {});
};

const TYPE_PATTERN = /\b(BASIC|STAGE\s+[12]|ITEM|SUPPORTER|TOOL|STADIUM|TRAINER|POKEMON|RULE\s+BOX)\s+/i;

const parseVision = (response) => {
  const text  = response.fullTextAnnotation?.text || '';
  console.log('Vision raw text:', text);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  if (text.length < 10) {
    return { itemType: 'single', name: '', cardNumber: '', confidence: 'failed' };
  }

  const slabMatch = text.match(/\b(PSA|BGS|CGC|TAG)\b/i);
  if (slabMatch) return parseSlabVision(text, lines, slabMatch[1].toUpperCase());
  return parseRawVision(text, lines);
};

const parseRawVision = (text, lines) => {
  const cardNumberMatch = text.match(/\b(\d{1,3})\/(\d{1,3})\b/);
  const cardNumber      = cardNumberMatch ? cardNumberMatch[0] : '';

  let name = '';
  const typeMatch = text.match(TYPE_PATTERN);
  if (typeMatch) {
    const afterType = text.slice(typeMatch.index + typeMatch[0].length);
    const hpIdx     = afterType.search(/\s+HP\d+/i);
    const raw       = hpIdx > 0 ? afterType.slice(0, hpIdx) : afterType.split('\n')[0];
    name = raw.replace(/\s*\n\s*/g, ' ').trim();
  } else {
    name = extractRawName(lines);
  }

  const confidence = name && cardNumber ? 'high'
                   : name               ? 'medium'
                   :                      'low';
  return { itemType: 'single', name, cardNumber, confidence };
};

const extractRawName = (lines) => {
  const skipNum = /^\d[\d\s/]*$/;
  for (const line of lines) {
    const upper = line.toUpperCase().trim();
    if (skipNum.test(upper)) continue;
    if (/^(BASIC|STAGE [12]|ITEM|SUPPORTER|TOOL|STADIUM|TRAINER|POKEMON|RULE BOX)$/.test(upper)) continue;
    if (line.length > 1) return line;
  }
  return '';
};

const GRADE_DESCS = 'GEM\\s*MT|PRISTINE|MINT|NM-MT|NM|EX|VG-EX|VG|GOOD|FAIR|POOR';
const GRADE_RE    = new RegExp(`(?:${GRADE_DESCS})?\\s*(10|[1-9](?:\\.5)?)\\s+(?=\\d{7,10})`, 'i');

const parseSlabVision = (text, lines, company) => {
  const year        = (text.match(/\b(20\d{2})\b/) || [])[1] || '';
  const cardNumber  = (text.match(/#\s*(\w+)/) || [])[1] || '';

  // Cert = last 7-10 digit number in text
  const certMatches = [...text.matchAll(/\b(\d{7,10})\b/g)];
  const certNumber  = certMatches.length ? certMatches[certMatches.length - 1][1] : '';

  // Grade number appears just before the cert number
  const gradeMatch  = text.match(GRADE_RE);
  const grade       = gradeMatch ? `${company} ${gradeMatch[1]}` : '';
  const gradeDescMatch = text.match(new RegExp(GRADE_DESCS, 'i'));
  const gradeDescStr   = gradeDescMatch ? gradeDescMatch[0] : '';

  // Middle section: after #NUM, before grade descriptor (or grade number)
  let name = '', setName = '';
  const hashMatch = text.match(/#\s*\w+\s*/);
  if (hashMatch) {
    const afterHash = text.slice(hashMatch.index + hashMatch[0].length).trim();
    const boundary  = gradeDescStr
      ? afterHash.search(new RegExp(gradeDescStr.replace(/\s+/g, '\\s*'), 'i'))
      : (gradeMatch ? afterHash.search(GRADE_RE) : -1);
    const middle     = (boundary > 0 ? afterHash.slice(0, boundary) : afterHash).trim();
    const midLines   = middle.split('\n').map(l => l.trim()).filter(Boolean);
    name    = midLines[0] || '';
    setName = midLines[1] || '';
  }

  const confidence = name && (cardNumber || certNumber) ? 'high'
                   : name                               ? 'medium'
                   :                                      'low';
  return { itemType: 'slab', company, grade, name, setName, cardNumber, certNumber, year, confidence };
};

// ── eBay AU Search ────────────────────────────────────────────────────
export const searchEbay = async (name, set = '', grade = '') => {
  const query = [name, set, grade].filter(Boolean).join(' ');
  const res   = await fetch(`${BASE}/api/ebay-search`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error('eBay search failed');
  return res.json();
};

export const getEbayPrice = async (name, set = '', grade = '') => {
  try {
    const data = await searchEbay(name, set, grade);
    if (!data?.count) return null;
    return { median: data.median, lowest: data.lowest, avg: data.avg, count: data.count, results: data.results };
  } catch { return null; }
};

// ── Image compression before sending to Vision ────────────────────────
export const compressImage = (base64, maxWidthPx = 1200, quality = 0.7) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > maxWidthPx) {
        height = Math.round(height * maxWidthPx / width);
        width  = maxWidthPx;
      }
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
    };
    img.onerror = () => reject(new Error('Failed to decode image for compression'));
    const mime = base64.startsWith('/9j/') ? 'image/jpeg'
               : base64.startsWith('iVBOR') ? 'image/png'
               : 'image/jpeg';
    img.src = `data:${mime};base64,${base64}`;
  });
};
