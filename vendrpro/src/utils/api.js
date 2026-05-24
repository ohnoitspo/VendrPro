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

const parseVision = (response) => {
  const text  = response.fullTextAnnotation?.text || '';
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const cardNumMatch = text.match(/\b(\d{2,3})\/(\d{2,3})\b/);
  const gradeMatch   = text.match(/(PSA|BGS|CGC|TAG)\s+(10|[0-9]\.?[05]?)/i);
  const hpMatch      = text.match(/(\d{2,3})\s*HP/i);
  const certMatch    = text.match(/\b(\d{7,10})\b/);

  const grade    = gradeMatch ? `${gradeMatch[1].toUpperCase()} ${gradeMatch[2]}` : '';
  const cardNum  = cardNumMatch ? cardNumMatch[0] : '';
  const hp       = hpMatch ? hpMatch[1] : '';
  const cert     = certMatch ? certMatch[1] : '';

  let itemType = 'single';
  if (grade)                   itemType = 'slab';
  else if (!hp && !cardNum)    itemType = 'sealed';

  const name    = extractName(lines);
  const setName = extractSet(lines);

  return {
    raw: text, name, setName, cardNum, grade, hp, cert, itemType,
    confidence: text.length > 30 ? 'high' : text.length > 10 ? 'medium' : 'low',
  };
};

const extractName = (lines) => {
  const noise = /^\d+$|^HP\d|^\d+\/\d+/;
  for (const line of lines) {
    if (line.length > 2 && !noise.test(line)) return line;
  }
  return lines[0] || '';
};

const extractSet = (lines) => {
  const kw = ['Scarlet','Violet','Silver','Tempest','Obsidian','Paradox','Paldea',
    'Base Set','151','Evolutions','Celebrations','Darkness','Vivid','Battle',
    'Chilling','Fusion','Lost','Brilliant','Astral','Evolving','Crown',
    'Temporal','Twilight','Surging','Prismatic','Journey','Destined','Shining',
    'Stellar','Perfect','Phantom','Phantom Forces','Burning'];
  for (const line of lines)
    for (const k of kw)
      if (line.includes(k)) return line;
  return '';
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
