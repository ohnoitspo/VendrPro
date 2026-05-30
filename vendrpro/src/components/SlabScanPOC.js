import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createWorker } from 'tesseract.js';

const SLAB_RATIO = 73 / 130;
const LABEL_FRAC = 0.22;
const CONTRAST   = 1.6;
const PAD_PX     = 30;

// ── Otsu optimal threshold from greyscale histogram ────────────────────────
function otsu(histogram, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];
  let sumB = 0, wB = 0, varMax = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v  = wB * wF * (mB - mF) ** 2;
    if (v > varMax) { varMax = v; thr = t; }
  }
  return thr;
}

// ── Preprocessing pipeline (unchanged from v2) ─────────────────────────────
function preprocessLabel(src) {
  const sw = src.width, sh = src.height;

  const tmp = document.createElement('canvas');
  tmp.width = sw; tmp.height = sh;
  const tmpCtx = tmp.getContext('2d');
  tmpCtx.drawImage(src, 0, 0);
  const srcImgData = tmpCtx.getImageData(0, 0, sw, sh);
  const sd = srcImgData.data;

  const grey = new Uint8Array(sw * sh);
  const hist = new Uint32Array(256);
  for (let i = 0; i < sw * sh; i++) {
    const k = i << 2;
    const lum = (0.299 * sd[k] + 0.587 * sd[k + 1] + 0.114 * sd[k + 2]) | 0;
    const con = Math.min(255, Math.max(0, (((lum - 128) * CONTRAST) + 128) | 0));
    grey[i] = con;
    hist[con]++;
  }

  const thr = otsu(hist, sw * sh);

  for (let i = 0; i < sw * sh; i++) {
    const k = i << 2;
    sd[k] = sd[k + 1] = sd[k + 2] = grey[i];
    sd[k + 3] = 255;
  }
  tmpCtx.putImageData(srcImgData, 0, 0);

  const dw = sw * 3, dh = sh * 3;
  const big = document.createElement('canvas');
  big.width = dw; big.height = dh;
  const bigCtx = big.getContext('2d');
  bigCtx.imageSmoothingEnabled = true;
  bigCtx.imageSmoothingQuality = 'high';
  bigCtx.drawImage(tmp, 0, 0, dw, dh);

  const upd = bigCtx.getImageData(0, 0, dw, dh);
  const px  = upd.data;
  let darkCount = 0;
  for (let i = 0; i < dw * dh; i++) {
    const k = i << 2;
    const v = px[k] < thr ? 0 : 255;
    px[k] = px[k + 1] = px[k + 2] = v;
    px[k + 3] = 255;
    if (v === 0) darkCount++;
  }
  bigCtx.putImageData(upd, 0, 0);

  const inverted = darkCount / (dw * dh) > 0.5;
  if (inverted) {
    for (let i = 0; i < dw * dh; i++) {
      const k = i << 2;
      px[k] = px[k + 1] = px[k + 2] = 255 - upd.data[k];
    }
    bigCtx.putImageData(upd, 0, 0);
  }

  const out = document.createElement('canvas');
  out.width  = dw + PAD_PX * 2;
  out.height = dh + PAD_PX * 2;
  const outCtx = out.getContext('2d');
  outCtx.fillStyle = '#ffffff';
  outCtx.fillRect(0, 0, out.width, out.height);
  outCtx.drawImage(big, PAD_PX, PAD_PX);

  return { canvas: out, threshold: thr, inverted };
}

// ── Detect grading company from raw OCR text ───────────────────────────────
// Returns the company string or null if undetected.
function detectCompany(rawText) {
  if (/\bPSA\b/.test(rawText)) return 'PSA';
  if (/\bBGS\b/.test(rawText)) return 'BGS';
  if (/\bCGC\b/.test(rawText)) return 'CGC';
  if (/\bTAG\b/.test(rawText)) return 'TAG';
  return null;
}

// ── Split Tesseract word bboxes into left and right columns ────────────────
// Uses the image midpoint as the split axis.
// Words are sorted by y then x within each column and grouped into lines
// by comparing consecutive y0 values against 1.3× the average word height.
// Words below the confidence threshold (30%) are discarded as OCR noise.
function wordsToColumns(words, imageWidth) {
  const valid = (words || []).filter(w => w.text.trim() && w.confidence > 30);
  if (!valid.length) return { leftLines: [], rightLines: [] };

  const midX = imageWidth / 2;
  const avgH = valid.reduce((s, w) => s + (w.bbox.y1 - w.bbox.y0), 0) / valid.length;
  const lineGap = avgH * 1.3;

  const left  = valid.filter(w => (w.bbox.x0 + w.bbox.x1) / 2 < midX);
  const right = valid.filter(w => (w.bbox.x0 + w.bbox.x1) / 2 >= midX);

  const groupLines = (list) => {
    if (!list.length) return [];
    list.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
    const lines = []; let cur = [list[0]];
    for (let i = 1; i < list.length; i++) {
      if (list[i].bbox.y0 - list[i - 1].bbox.y0 < lineGap) {
        cur.push(list[i]);
      } else {
        lines.push(cur);
        cur = [list[i]];
      }
    }
    lines.push(cur);
    return lines
      .map(l => l.sort((a, b) => a.bbox.x0 - b.bbox.x0).map(w => w.text).join(' ').trim())
      .filter(Boolean);
  };

  return { leftLines: groupLines(left), rightLines: groupLines(right) };
}

// ── PSA column parser ──────────────────────────────────────────────────────
// Left column top→bottom: [year+game+set, cardName, setName]
// Right column top→bottom: [lang+cardNum, gradeDesc, gradeNum, cert]
//
// The ONLY normalisation applied is substituting common OCR confusion in the
// game-code slot (e.g. P0KEMON → POKEMON). Card name, set name, card number,
// and cert number are returned verbatim from the OCR output.
function parsePSA(leftLines, rightLines) {
  // ── Left column ────────────────────────────────────────────────────────
  const yearRaw = leftLines[0] || '';
  // Normalise game code only — unambiguous because this slot always holds it
  const gameLine = yearRaw.replace(/\bP[O0]K[EÉ]M[O0]N\b/gi, 'POKEMON');
  const year     = (gameLine.match(/\b(20\d{2})\b/) || [])[1] || '';

  // Card name: second left-column line — returned raw, no alteration
  const cardName = leftLines[1] || '';
  // Set name: third left-column line — returned raw
  const setName  = leftLines[2] || '';

  // ── Right column ───────────────────────────────────────────────────────
  let language = '', cardNumber = '';
  for (const line of rightLines) {
    if (!language) {
      const lm = line.match(/\b(JP|EN|KR|TW|CN|DE|FR|IT|ES|PT)\b/i);
      if (lm) language = lm[1].toUpperCase();
    }
    if (!cardNumber) {
      const cm = line.match(/#([A-Z0-9]+)/i);
      if (cm) cardNumber = cm[1].toUpperCase(); // raw token after #, not corrected
    }
  }

  // Grade descriptor line — located by pattern, returned as raw OCR text
  const gradeDescLine = rightLines.find(l =>
    /GEM\s*MT|PRISTINE|MINT|NM[-\s]?MT|NEAR\s*MINT|EX|VG[-\s]?EX/i.test(l)
  ) || '';
  // Grade number: first right-column line that is exactly a grade numeral
  const gradeNumLine = rightLines.find(l => /^(10|[1-9](?:\.5)?)$/.test(l.trim())) || '';
  const grade = [gradeDescLine.trim(), gradeNumLine.trim()].filter(Boolean).join(' ');

  // Cert number: last right-column line that is 7–9 digits — returned raw
  const certCandidates = rightLines.filter(l => /^\d{7,9}$/.test(l.trim()));
  const certNumber = certCandidates.length
    ? certCandidates[certCandidates.length - 1].trim()
    : '';

  return { year, gameLine, cardName, setName, language, cardNumber, grade, certNumber };
}

// ── Component ──────────────────────────────────────────────────────────────
export default function SlabScanPOC({ onClose }) {
  const [mode,         setMode]         = useState('camera');
  const [originalUrl,  setOriginalUrl]  = useState('');
  const [processedUrl, setProcessedUrl] = useState('');
  const [procMeta,     setProcMeta]     = useState(null);
  const [rawText,      setRawText]      = useState('');
  const [company,      setCompany]      = useState(null);
  const [leftLines,    setLeftLines]    = useState([]);
  const [rightLines,   setRightLines]   = useState([]);
  const [parsed,       setParsed]       = useState(null);
  const [certRefined,  setCertRefined]  = useState('');
  const [progress,     setProgress]     = useState('');
  const [error,        setError]        = useState('');

  const videoRef  = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    }).then(stream => {
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    }).catch(e => setError('Camera: ' + e.message));
    return () => streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  const guideSize = () => {
    const maxW = Math.min(window.innerWidth * 0.82, 300);
    const maxH = window.innerHeight * 0.62;
    let w = maxW, h = w / SLAB_RATIO;
    if (h > maxH) { h = maxH; w = h * SLAB_RATIO; }
    return { w: Math.round(w), h: Math.round(h) };
  };

  const cssToVP = (video, cx, cy) => {
    const vW = video.videoWidth, vH = video.videoHeight;
    const cW = window.innerWidth,  cH = window.innerHeight;
    const s  = Math.max(cW / vW, cH / vH);
    return { x: cx / s + (vW - cW / s) / 2, y: cy / s + (vH - cH / s) / 2 };
  };

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) { setError('Camera not ready'); return; }
    setError('');
    setMode('processing');

    try {
      // ── 1. Crop to label zone (same as v2) ───────────────────────────
      setProgress('Cropping label…');
      const { w: gW, h: gH } = guideSize();
      const gX = (window.innerWidth  - gW) / 2;
      const gY = (window.innerHeight - gH) / 2;

      const tl = cssToVP(video, gX,      gY);
      const br = cssToVP(video, gX + gW, gY + gH * LABEL_FRAC);
      const lW = Math.round(br.x - tl.x);
      const lH = Math.round(br.y - tl.y);

      const full = document.createElement('canvas');
      full.width = video.videoWidth; full.height = video.videoHeight;
      full.getContext('2d').drawImage(video, 0, 0);

      const labelCanvas = document.createElement('canvas');
      labelCanvas.width = lW; labelCanvas.height = lH;
      labelCanvas.getContext('2d').drawImage(full, tl.x, tl.y, lW, lH, 0, 0, lW, lH);
      setOriginalUrl(labelCanvas.toDataURL('image/png'));

      // ── 2. Preprocessing (same as v2) ────────────────────────────────
      setProgress('Preprocessing: greyscale → contrast → 3× upscale → Otsu…');
      const { canvas: processed, threshold, inverted } = preprocessLabel(labelCanvas);
      setProcessedUrl(processed.toDataURL('image/png'));
      setProcMeta({ threshold, inverted });
      console.log('[POC v3] Otsu thr:', threshold, '| auto-inverted:', inverted,
                  '| canvas:', processed.width, '×', processed.height);

      // ── 3. Tesseract OCR — full label, PSM 6 ─────────────────────────
      setProgress('Initialising Tesseract…');
      const worker = await createWorker('eng', 1, {
        logger: m => {
          if (m.status && typeof m.progress === 'number' && m.progress > 0)
            setProgress(`${m.status} ${Math.round(m.progress * 100)}%`);
        },
      });
      await worker.setParameters({
        tessedit_pageseg_mode: '6',
        preserve_interword_spaces: '1',
      });

      setProgress('Running OCR (PSM 6 — full block)…');
      const { data } = await worker.recognize(processed);
      const raw = data.text;
      setRawText(raw);
      console.log('[POC v3] Raw OCR:\n', raw);
      console.log('[POC v3] Word count:', data.words?.length ?? 0);

      // ── 4. Company detection ─────────────────────────────────────────
      const co = detectCompany(raw);
      setCompany(co);
      console.log('[POC v3] Detected company:', co);

      // ── 5. Positional column split (word bboxes) ─────────────────────
      setProgress('Splitting columns by word position…');
      const cols = wordsToColumns(data.words, processed.width);
      setLeftLines(cols.leftLines);
      setRightLines(cols.rightLines);
      console.log('[POC v3] Left col:', cols.leftLines);
      console.log('[POC v3] Right col:', cols.rightLines);

      // ── 6. PSA field extraction — only when PSA detected ─────────────
      if (co === 'PSA') {
        const fields = parsePSA(cols.leftLines, cols.rightLines);
        setParsed(fields);
        console.log('[POC v3] Parsed PSA:', fields);
      } else {
        setParsed(null);
      }

      // ── 7. Refined cert: bottom strip, digit whitelist ────────────────
      setProgress('Refining cert number (PSM 7 + digit whitelist)…');
      await worker.setParameters({
        tessedit_pageseg_mode: '7',
        tessedit_char_whitelist: '0123456789',
        preserve_interword_spaces: '0',
      });
      const certH = Math.round(processed.height * 0.28);
      const { data: cd } = await worker.recognize(processed, {
        rectangle: {
          left:   PAD_PX,
          top:    processed.height - certH,
          width:  processed.width - PAD_PX * 2,
          height: certH - PAD_PX,
        },
      });
      const certRef = cd.text.replace(/\D/g, '').trim();
      setCertRefined(certRef);
      console.log('[POC v3] Cert refined:', certRef);

      await worker.terminate();
      setMode('results');
    } catch (err) {
      console.error('[POC v3]', err);
      setError('Failed: ' + err.message);
      setMode('camera');
    }
  }, []);

  const reset = () => {
    setMode('camera');
    setOriginalUrl(''); setProcessedUrl(''); setProcMeta(null);
    setRawText(''); setCompany(null);
    setLeftLines([]); setRightLines([]);
    setParsed(null); setCertRefined('');
    setProgress(''); setError('');
  };

  // ── Processing ─────────────────────────────────────────────────────────
  if (mode === 'processing') return (
    <div style={{ position:'fixed',inset:0,background:'#080D1E',zIndex:999,
      display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:20 }}>
      <div style={{ width:46,height:46,borderRadius:'50%',
        border:'3px solid #F5A623',borderTopColor:'transparent',
        animation:'spin .8s linear infinite' }} />
      <p style={{ color:'#fff',fontSize:'.85rem',textAlign:'center',
        padding:'0 36px',lineHeight:1.5 }}>{progress}</p>
    </div>
  );

  // ── Results ────────────────────────────────────────────────────────────
  if (mode === 'results') {
    const companyColour = company === 'PSA' ? 'var(--emerald)'
                        : company           ? 'var(--amber)'
                        :                     'var(--rose)';

    const PSA_FIELDS = parsed ? [
      { label: 'Year',             value: parsed.year },
      { label: 'Game / Set line',  value: parsed.gameLine },
      { label: 'Card Name',        value: parsed.cardName },
      { label: 'Set Name',         value: parsed.setName },
      { label: 'Language',         value: parsed.language },
      { label: 'Card Number',      value: parsed.cardNumber },
      { label: 'Grade',            value: parsed.grade },
      { label: 'Cert # (column)',  value: parsed.certNumber },
      { label: 'Cert # (refined)', value: certRefined, highlight: true },
    ] : [];

    return (
      <div style={{ position:'fixed',inset:0,background:'var(--navy)',zIndex:999,overflowY:'auto' }}>

        {/* Sticky header */}
        <div style={{ position:'sticky',top:0,background:'var(--navy)',zIndex:1,
          padding:'12px 16px',borderBottom:'1px solid var(--navy-light)',
          display:'flex',alignItems:'center',justifyContent:'space-between' }}>
          <div>
            <p style={{ color:'var(--teal)',fontSize:'.68rem',fontWeight:700,
              textTransform:'uppercase',letterSpacing:'.08em' }}>POC Slabscan v3</p>
            <h2 style={{ color:'var(--gold)',fontSize:'1rem',marginTop:1 }}>Results</h2>
          </div>
          <button onClick={onClose} style={{ background:'none',border:'none',
            color:'var(--grey)',fontSize:'1.3rem',cursor:'pointer',lineHeight:1 }}>✕</button>
        </div>

        <div style={{ padding:16 }}>

          {/* ── Images ── */}
          <p style={{ color:'var(--grey)',fontSize:'.68rem',textTransform:'uppercase',
            letterSpacing:'.06em',marginBottom:8 }}>Label Images</p>
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:4 }}>
            {[['Original crop', originalUrl], ['Preprocessed B&W', processedUrl]].map(([lbl, url]) => (
              <div key={lbl}>
                <p style={{ color:'var(--grey)',fontSize:'.7rem',marginBottom:4,textAlign:'center' }}>{lbl}</p>
                {url && <img src={url} alt={lbl}
                  style={{ width:'100%',borderRadius:6,border:'1px solid var(--navy-light)',display:'block' }} />}
              </div>
            ))}
          </div>
          {procMeta && (
            <p style={{ color:'var(--grey)',fontSize:'.7rem',textAlign:'center',marginBottom:16 }}>
              Otsu thr: {procMeta.threshold} · auto-inverted: {procMeta.inverted ? 'yes' : 'no'}
            </p>
          )}

          {/* ── Company detection ── */}
          <p style={{ color:'var(--grey)',fontSize:'.68rem',textTransform:'uppercase',
            letterSpacing:'.06em',marginBottom:8 }}>Company Detection</p>
          <div style={{ background:'var(--navy-card)',border:'1px solid var(--navy-light)',
            borderRadius:8,padding:'10px 14px',marginBottom:16,
            display:'flex',alignItems:'center',gap:10 }}>
            <span style={{ fontWeight:700,fontSize:'1rem',color:companyColour }}>
              {company ?? 'Unknown'}
            </span>
            <span style={{ color:'var(--grey)',fontSize:'.82rem' }}>
              {company === 'PSA'
                ? '— two-column template applied'
                : company
                  ? `— layout template for ${company} not yet implemented in this POC`
                  : '— could not detect grading company from OCR text'}
            </span>
          </div>

          {/* ── Column lines (always shown so you can verify the split) ── */}
          <p style={{ color:'var(--grey)',fontSize:'.68rem',textTransform:'uppercase',
            letterSpacing:'.06em',marginBottom:8 }}>Positional Column Split</p>
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:16 }}>
            {[['Left col', leftLines], ['Right col', rightLines]].map(([colLabel, lines]) => (
              <div key={colLabel} style={{ background:'var(--navy-card)',
                border:'1px solid var(--navy-light)',borderRadius:8,padding:'10px 12px' }}>
                <p style={{ color:'var(--grey)',fontSize:'.68rem',marginBottom:8,
                  textTransform:'uppercase',letterSpacing:'.05em' }}>{colLabel}</p>
                {lines.length === 0
                  ? <p style={{ color:'var(--grey)',fontStyle:'italic',fontSize:'.78rem' }}>(empty)</p>
                  : lines.map((ln, i) => (
                    <div key={i} style={{ display:'flex',gap:6,marginBottom:4,alignItems:'flex-start' }}>
                      <span style={{ color:'var(--grey)',fontSize:'.68rem',
                        flexShrink:0,marginTop:2,minWidth:14 }}>[{i}]</span>
                      <span style={{ color:'var(--white)',fontFamily:'monospace',
                        fontSize:'.78rem',wordBreak:'break-all' }}>{ln}</span>
                    </div>
                  ))
                }
              </div>
            ))}
          </div>

          {/* ── Raw OCR text ── */}
          <p style={{ color:'var(--grey)',fontSize:'.68rem',textTransform:'uppercase',
            letterSpacing:'.06em',marginBottom:8 }}>Raw OCR Text (PSM 6, full block)</p>
          <div style={{ background:'var(--navy-card)',border:'1px solid var(--navy-light)',
            borderRadius:8,padding:'12px 14px',marginBottom:16,
            maxHeight:200,overflowY:'auto' }}>
            <pre style={{ color:'var(--white)',fontFamily:'monospace',fontSize:'.78rem',
              margin:0,whiteSpace:'pre-wrap',wordBreak:'break-all',lineHeight:1.6 }}>
              {rawText || '(nothing recognised)'}
            </pre>
          </div>

          {/* ── Parsed fields — PSA only ── */}
          {company === 'PSA' && parsed && (
            <>
              <p style={{ color:'var(--grey)',fontSize:'.68rem',textTransform:'uppercase',
                letterSpacing:'.06em',marginBottom:8 }}>Parsed Fields</p>
              <div className="card" style={{ padding:0,marginBottom:20 }}>
                {PSA_FIELDS.map(({ label, value, highlight }) => (
                  <div key={label} style={{ display:'flex',justifyContent:'space-between',
                    alignItems:'flex-start',padding:'9px 14px',
                    borderBottom:'1px solid var(--navy-light)',gap:12 }}>
                    <p style={{ color:'var(--grey)',fontSize:'.8rem',flexShrink:0 }}>{label}</p>
                    <p style={{
                      color: value ? (highlight ? 'var(--teal)' : 'var(--white)') : 'var(--grey)',
                      fontFamily:'monospace',fontSize:'.8rem',textAlign:'right',
                      fontStyle: value ? 'normal' : 'italic',
                      fontWeight: highlight && value ? 700 : 400,
                      wordBreak:'break-all',
                    }}>
                      {value || '—'}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10 }}>
            <button className="btn btn-secondary" onClick={reset}>← Scan Another</button>
            <button className="btn btn-ghost" onClick={onClose}>Close POC</button>
          </div>
          <div style={{ height:32 }} />
        </div>
      </div>
    );
  }

  // ── Camera ─────────────────────────────────────────────────────────────
  const { w: guideW, h: guideH } = guideSize();
  const labelZoneH = Math.round(guideH * LABEL_FRAC);

  return (
    <div style={{ position:'fixed',inset:0,background:'#000',zIndex:999,overflow:'hidden' }}>
      <video ref={videoRef} playsInline muted
        style={{ position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover' }} />

      <div style={{ position:'absolute',inset:0,background:'rgba(0,0,0,.55)',
        display:'flex',alignItems:'center',justifyContent:'center' }}>
        <div style={{ position:'relative',width:guideW,height:guideH }}>
          <div style={{ position:'absolute',inset:0,border:'2px solid rgba(255,255,255,.45)',
            borderRadius:8 }} />
          <div style={{ position:'absolute',left:0,right:0,top:0,height:labelZoneH,
            background:'rgba(210,40,40,.2)',border:'2px solid rgba(220,60,60,.85)',
            borderRadius:'8px 8px 0 0',display:'flex',alignItems:'center',justifyContent:'center' }}>
            <span style={{ color:'#fff',fontSize:'.68rem',fontWeight:700,
              letterSpacing:'.07em',textTransform:'uppercase',textShadow:'0 1px 4px rgba(0,0,0,.85)' }}>
              Label Zone ↑
            </span>
          </div>
          {[
            { k:'tl', s:{ top:-2,   left:-2,  borderTop:'3px solid #fff', borderLeft:'3px solid #fff',   borderRadius:'4px 0 0 0' }},
            { k:'tr', s:{ top:-2,   right:-2, borderTop:'3px solid #fff', borderRight:'3px solid #fff',  borderRadius:'0 4px 0 0' }},
            { k:'bl', s:{ bottom:-2,left:-2,  borderBottom:'3px solid #fff',borderLeft:'3px solid #fff', borderRadius:'0 0 0 4px' }},
            { k:'br', s:{ bottom:-2,right:-2, borderBottom:'3px solid #fff',borderRight:'3px solid #fff',borderRadius:'0 0 4px 0' }},
          ].map(({ k, s }) => <div key={k} style={{ position:'absolute',width:20,height:20,...s }} />)}
        </div>
      </div>

      <div style={{ position:'absolute',left:0,right:0,
        top:`calc(50% + ${guideH / 2 + 14}px)`,padding:'0 32px',textAlign:'center' }}>
        <p style={{ color:'rgba(255,255,255,.65)',fontSize:'.8rem',lineHeight:1.5 }}>
          POC Slabscan v3 — align label inside red zone
        </p>
      </div>

      <div style={{ position:'absolute',bottom:0,left:0,right:0,
        padding:'20px',paddingBottom:'max(20px,env(safe-area-inset-bottom))',
        display:'flex',flexDirection:'column',alignItems:'center',gap:14 }}>
        {error && <p style={{ color:'#FB7185',fontSize:'.82rem',textAlign:'center' }}>{error}</p>}
        <button onClick={capture} aria-label="Capture"
          style={{ width:70,height:70,borderRadius:'50%',background:'#fff',
            border:'4px solid rgba(255,255,255,.3)',cursor:'pointer',flexShrink:0 }} />
        <button onClick={onClose}
          style={{ background:'none',border:'none',color:'rgba(255,255,255,.5)',
            fontSize:'.85rem',cursor:'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}
