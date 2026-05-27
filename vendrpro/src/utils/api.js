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

const NOISE_WORDS = new Set([
  'BASIC','STAGE 1','STAGE 2','ITEM','SUPPORTER','TOOL','STADIUM','TRAINER','POKEMON','RULE BOX',
]);

const parseVision = (response) => {
  const text  = response.fullTextAnnotation?.text || '';
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
  const name            = extractRawName(lines);
  const confidence      = name && (cardNumber) ? 'high'
                        : name                 ? 'medium'
                        :                        'low';
  return { itemType: 'single', name, cardNumber, confidence };
};

const extractRawName = (lines) => {
  const skipNum  = /^\d[\d\s/]*$/;
  for (const line of lines) {
    const upper = line.toUpperCase().trim();
    if (skipNum.test(upper)) continue;
    if (NOISE_WORDS.has(upper)) continue;
    if (line.length > 1) return line;
  }
  return '';
};

const parseSlabVision = (text, lines, company) => {
  const gradeKeywords = /GEM\s*MT|PRISTINE|MINT|NM[- ]?MT|NM|EX|VG[- ]?EX|VG|GOOD|FAIR|POOR/i;

  let grade = '';
  const gradeLineMatch = text.match(
    new RegExp(`(GEM\\s*MT|PRISTINE|MINT|NM[- ]?MT|NM|EX|VG[- ]?EX|VG|GOOD|FAIR|POOR)?\\s*(10|[1-9](?:\\.5)?(?:\\/10)?)`, 'i')
  );
  if (gradeLineMatch) {
    const num = gradeLineMatch[2].replace('/10', '');
    grade = `${company} ${num}`;
  }

  const certMatch = text.match(/\b(\d{7,10})\b/);
  const cert      = certMatch ? certMatch[1] : '';

  const yearMatch = text.match(/\b(20\d{2})\b/);
  const year      = yearMatch ? yearMatch[1] : '';

  const hashMatch    = text.match(/#\s*(\w+)/);
  const cardNumber   = hashMatch ? hashMatch[1] : '';

  const companyLineIdx = lines.findIndex(l => l.toUpperCase().includes(company));
  const name    = lines[companyLineIdx + 1] || '';
  const setName = lines[companyLineIdx + 2] || '';

  const confidence = name && (cardNumber || cert) ? 'high'
                   : name                         ? 'medium'
                   :                                'low';

  return {
    itemType: 'slab', company, grade, name, setName,
    cardNumber, certNumber: cert, year, confidence,
  };
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
