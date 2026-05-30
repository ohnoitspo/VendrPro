import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createWorker } from 'tesseract.js';

// PSA slab physical ratio: 73mm wide × 130mm tall
const SLAB_RATIO = 73 / 130;
// PSA label occupies roughly the top 22% of the slab face
const LABEL_FRAC = 0.22;
// Contrast multiplier before thresholding — helps separate red sheen from white text
const CONTRAST = 1.6;
// White padding added around binary image so Tesseract doesn't clip edge glyphs
const PAD_PX = 30;

// ── Otsu's method: optimal threshold from greyscale histogram ──────────────
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

// ── Full preprocessing pipeline ────────────────────────────────────────────
// Returns { canvas, threshold, inverted } where canvas is the padded binary image.
function preprocessLabel(src) {
  const sw = src.width, sh = src.height;

  // ── Step 1: read source pixels ─────────────────────────────────────────
  const tmp = document.createElement('canvas');
  tmp.width = sw; tmp.height = sh;
  const tmpCtx = tmp.getContext('2d');
  tmpCtx.drawImage(src, 0, 0);
  const srcImgData = tmpCtx.getImageData(0, 0, sw, sh);
  const sd = srcImgData.data;

  // ── Step 2: greyscale (luminance) + contrast boost → histogram ─────────
  const grey = new Uint8Array(sw * sh);
  const hist = new Uint32Array(256);
  for (let i = 0; i < sw * sh; i++) {
    const k = i << 2;
    const lum = (0.299 * sd[k] + 0.587 * sd[k + 1] + 0.114 * sd[k + 2]) | 0;
    const con = Math.min(255, Math.max(0, (((lum - 128) * CONTRAST) + 128) | 0));
    grey[i] = con;
    hist[con]++;
  }

  // ── Step 3: Otsu threshold ──────────────────────────────────────────────
  const thr = otsu(hist, sw * sh);

  // ── Step 4: write greyscale into canvas for 3× upscale ─────────────────
  for (let i = 0; i < sw * sh; i++) {
    const k = i << 2;
    sd[k] = sd[k + 1] = sd[k + 2] = grey[i];
    sd[k + 3] = 255;
  }
  tmpCtx.putImageData(srcImgData, 0, 0);

  // ── Step 5: 3× upscale with bicubic-like smoothing ─────────────────────
  const dw = sw * 3, dh = sh * 3;
  const big = document.createElement('canvas');
  big.width = dw; big.height = dh;
  const bigCtx = big.getContext('2d');
  bigCtx.imageSmoothingEnabled = true;
  bigCtx.imageSmoothingQuality = 'high';
  bigCtx.drawImage(tmp, 0, 0, dw, dh);

  // ── Step 6: binary threshold on upscaled image ─────────────────────────
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

  // ── Step 7: auto-invert to normalise to black-text-on-white ────────────
  // PSA labels have white text on red background. After Otsu the red
  // background (mid-grey) falls below the threshold → becomes black, giving
  // white-on-black. Invert when most pixels are dark so Tesseract gets the
  // canonical black-on-white polarity it expects.
  const inverted = darkCount / (dw * dh) > 0.5;
  if (inverted) {
    for (let i = 0; i < dw * dh; i++) {
      const k = i << 2;
      px[k] = px[k + 1] = px[k + 2] = 255 - upd.data[k];
    }
    bigCtx.putImageData(upd, 0, 0);
  }

  // ── Step 8: pad with white border so Tesseract doesn't clip edges ───────
  const out = document.createElement('canvas');
  out.width  = dw + PAD_PX * 2;
  out.height = dh + PAD_PX * 2;
  const outCtx = out.getContext('2d');
  outCtx.fillStyle = '#ffffff';
  outCtx.fillRect(0, 0, out.width, out.height);
  outCtx.drawImage(big, PAD_PX, PAD_PX);

  return { canvas: out, threshold: thr, inverted };
}

// ── Parse raw Tesseract output into PSA fields ─────────────────────────────
function parsePSAText(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

  // Year: first 20XX token
  const yearM      = raw.match(/\b(20\d{2})\b/);
  const year       = yearM ? yearM[1] : '';

  // Card number: alphanumeric token after #
  const cardNumM   = raw.match(/#\s*([A-Z0-9]+)/i);
  const cardNumber = cardNumM ? cardNumM[1].toUpperCase() : '';

  // Grade: descriptor + numeric grade
  const gradeM = raw.match(
    /(GEM\s+MT|PRISTINE|MINT|NM[-\s]?MT|NM|NEAR\s+MINT|EX|VG[-\s]?EX)\s+(10|[1-9](?:\.5)?)/i
  );
  const grade = gradeM ? gradeM[0].replace(/\s+/g, ' ').trim() : '';

  // Cert: last 7–9 digit number that isn't a year
  const certAll    = [...raw.matchAll(/\b(\d{7,9})\b/g)].filter(m => !/^20\d{2}$/.test(m[1]));
  const certNumber = certAll.length ? certAll[certAll.length - 1][1] : '';

  // Name + setName: lines that appear after the card-number token and
  // before the grade description, excluding pure-numeric lines.
  let name = '', setName = '';
  const hashIdx  = lines.findIndex(l => /#[A-Z0-9]+/i.test(l));
  const gradeIdx = gradeM
    ? lines.findIndex(l => new RegExp(gradeM[1].replace(/\s+/g, '\\s*'), 'i').test(l))
    : lines.length;
  const midLines = lines
    .slice(hashIdx >= 0 ? hashIdx + 1 : 0, gradeIdx >= 0 ? gradeIdx : lines.length)
    .filter(l => !/^\d+$/.test(l) && l.length > 1);
  name    = (midLines[0] || '').replace(/^FA\//, '').trim();
  setName =  midLines[1] || '';

  return { year, cardNumber, grade, certNumber, name, setName };
}

// ── Component ──────────────────────────────────────────────────────────────
export default function SlabScanPOC({ onClose }) {
  const [mode,         setMode]         = useState('camera');
  const [originalUrl,  setOriginalUrl]  = useState('');
  const [processedUrl, setProcessedUrl] = useState('');
  const [procMeta,     setProcMeta]     = useState(null); // { threshold, inverted }
  const [rawText,      setRawText]      = useState('');
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

  // ── Guide sizing: fits screen with padding ────────────────────────────
  const guideSize = () => {
    const maxW = Math.min(window.innerWidth * 0.82, 300);
    const maxH = window.innerHeight * 0.62;
    let w = maxW, h = w / SLAB_RATIO;
    if (h > maxH) { h = maxH; w = h * SLAB_RATIO; }
    return { w: Math.round(w), h: Math.round(h) };
  };

  // ── CSS pixel → native video pixel (accounts for object-fit:cover) ────
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
      // ── 1. Crop to label zone ─────────────────────────────────────────
      setProgress('Cropping label…');
      const { w: gW, h: gH } = guideSize();
      const gX = (window.innerWidth  - gW) / 2;
      const gY = (window.innerHeight - gH) / 2;
      const labelH_css = gH * LABEL_FRAC;

      const tl = cssToVP(video, gX,      gY);
      const br = cssToVP(video, gX + gW, gY + labelH_css);
      const lW = Math.round(br.x - tl.x);
      const lH = Math.round(br.y - tl.y);

      const full = document.createElement('canvas');
      full.width = video.videoWidth; full.height = video.videoHeight;
      full.getContext('2d').drawImage(video, 0, 0);

      const labelCanvas = document.createElement('canvas');
      labelCanvas.width = lW; labelCanvas.height = lH;
      labelCanvas.getContext('2d').drawImage(full, tl.x, tl.y, lW, lH, 0, 0, lW, lH);
      setOriginalUrl(labelCanvas.toDataURL('image/png'));

      // ── 2. Preprocessing pipeline ─────────────────────────────────────
      setProgress('Preprocessing: greyscale → contrast → upscale → Otsu threshold…');
      const { canvas: processed, threshold, inverted } = preprocessLabel(labelCanvas);
      setProcessedUrl(processed.toDataURL('image/png'));
      setProcMeta({ threshold, inverted });
      console.log('[SlabScanPOC v.2] Otsu thr:', threshold, '| auto-inverted:', inverted);
      console.log('[SlabScanPOC v.2] Processed canvas:', processed.width, '×', processed.height);

      // ── 3. Tesseract — full label, PSM 6 ─────────────────────────────
      setProgress('Initialising Tesseract engine…');
      const worker = await createWorker('eng', 1, {
        logger: m => {
          if (m.status && typeof m.progress === 'number' && m.progress > 0) {
            setProgress(`${m.status} ${Math.round(m.progress * 100)}%`);
          }
        },
      });

      await worker.setParameters({
        tessedit_pageseg_mode: '6',    // uniform text block
        preserve_interword_spaces: '1',
      });

      setProgress('Running OCR (PSM 6 — full block)…');
      const { data } = await worker.recognize(processed);
      const raw = data.text;
      setRawText(raw);
      console.log('[SlabScanPOC v.2] Raw OCR output:\n', raw);

      // ── 4. Parse fields from full-label output ────────────────────────
      const fields = parsePSAText(raw);
      setParsed(fields);
      console.log('[SlabScanPOC v.2] Parsed fields:', fields);

      // ── 5. Refined cert number: bottom strip, digit-only whitelist ────
      setProgress('Refining cert number (PSM 7 + digits)…');
      await worker.setParameters({
        tessedit_pageseg_mode: '7',
        tessedit_char_whitelist: '0123456789',
        preserve_interword_spaces: '0',
      });
      const certH = Math.round(processed.height * 0.28);
      const { data: certData } = await worker.recognize(processed, {
        rectangle: {
          left:   PAD_PX,
          top:    processed.height - certH,
          width:  processed.width - PAD_PX * 2,
          height: certH - PAD_PX,
        },
      });
      const certRef = certData.text.replace(/\D/g, '').trim();
      setCertRefined(certRef);
      console.log('[SlabScanPOC v.2] Cert refined:', certRef);

      await worker.terminate();
      setMode('results');
    } catch (err) {
      console.error('[SlabScanPOC v.2]', err);
      setError('Failed: ' + err.message);
      setMode('camera');
    }
  }, []);

  const reset = () => {
    setMode('camera');
    setOriginalUrl(''); setProcessedUrl(''); setProcMeta(null);
    setRawText(''); setParsed(null); setCertRefined('');
    setProgress(''); setError('');
  };

  // ── Processing screen ──────────────────────────────────────────────────
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

  // ── Results screen ─────────────────────────────────────────────────────
  if (mode === 'results') {
    const FIELDS = [
      { label:'Year',              value: parsed?.year },
      { label:'Card Number',       value: parsed?.cardNumber },
      { label:'Grade',             value: parsed?.grade },
      { label:'Name',              value: parsed?.name },
      { label:'Set Name',          value: parsed?.setName },
      { label:'Cert # (from text)',value: parsed?.certNumber },
      { label:'Cert # (refined)',  value: certRefined, highlight: true },
    ];
    return (
      <div style={{ position:'fixed',inset:0,background:'var(--navy)',zIndex:999,overflowY:'auto' }}>

        {/* Header */}
        <div style={{ position:'sticky',top:0,background:'var(--navy)',zIndex:1,
          padding:'12px 16px',borderBottom:'1px solid var(--navy-light)',
          display:'flex',alignItems:'center',justifyContent:'space-between' }}>
          <div>
            <p style={{ color:'var(--teal)',fontSize:'.68rem',fontWeight:700,
              textTransform:'uppercase',letterSpacing:'.08em' }}>POC v.2</p>
            <h2 style={{ color:'var(--gold)',fontSize:'1rem',marginTop:1 }}>Slab Scan Results</h2>
          </div>
          <button onClick={onClose} style={{ background:'none',border:'none',
            color:'var(--grey)',fontSize:'1.3rem',cursor:'pointer',lineHeight:1 }}>✕</button>
        </div>

        <div style={{ padding:16 }}>

          {/* ── Images ── */}
          <p style={{ color:'var(--grey)',fontSize:'.68rem',textTransform:'uppercase',
            letterSpacing:'.06em',marginBottom:8 }}>Label Images</p>
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:4 }}>
            <div>
              <p style={{ color:'var(--grey)',fontSize:'.7rem',marginBottom:4,textAlign:'center' }}>
                Original crop
              </p>
              {originalUrl && <img src={originalUrl} alt="original"
                style={{ width:'100%',borderRadius:6,border:'1px solid var(--navy-light)',display:'block' }} />}
            </div>
            <div>
              <p style={{ color:'var(--grey)',fontSize:'.7rem',marginBottom:4,textAlign:'center' }}>
                Preprocessed (B&W)
              </p>
              {processedUrl && <img src={processedUrl} alt="processed"
                style={{ width:'100%',borderRadius:6,border:'1px solid var(--navy-light)',display:'block' }} />}
            </div>
          </div>
          {procMeta && (
            <p style={{ color:'var(--grey)',fontSize:'.7rem',textAlign:'center',marginBottom:16 }}>
              Otsu thr: {procMeta.threshold} · auto-inverted: {procMeta.inverted ? 'yes' : 'no'}
            </p>
          )}

          {/* ── Raw OCR text ── */}
          <p style={{ color:'var(--grey)',fontSize:'.68rem',textTransform:'uppercase',
            letterSpacing:'.06em',marginBottom:8 }}>Raw OCR Text (full label, PSM 6)</p>
          <div style={{ background:'var(--navy-card)',border:'1px solid var(--navy-light)',
            borderRadius:8,padding:'12px 14px',marginBottom:16,
            maxHeight:220,overflowY:'auto' }}>
            <pre style={{ color:'var(--white)',fontFamily:'monospace',fontSize:'.78rem',
              margin:0,whiteSpace:'pre-wrap',wordBreak:'break-all',lineHeight:1.6 }}>
              {rawText || '(empty — nothing recognised)'}
            </pre>
          </div>

          {/* ── Parsed fields ── */}
          <p style={{ color:'var(--grey)',fontSize:'.68rem',textTransform:'uppercase',
            letterSpacing:'.06em',marginBottom:8 }}>Parsed Fields</p>
          <div className="card" style={{ padding:0,marginBottom:20 }}>
            {FIELDS.map(({ label, value, highlight }) => (
              <div key={label} style={{ display:'flex',justifyContent:'space-between',
                alignItems:'center',padding:'9px 14px',
                borderBottom:'1px solid var(--navy-light)' }}>
                <p style={{ color:'var(--grey)',fontSize:'.82rem',flexShrink:0,marginRight:12 }}>
                  {label}
                </p>
                <p style={{
                  color: value ? (highlight ? 'var(--teal)' : 'var(--white)') : 'var(--grey)',
                  fontFamily:'monospace',fontSize:'.82rem',
                  textAlign:'right',fontStyle: value ? 'normal' : 'italic',
                  fontWeight: highlight && value ? 700 : 400,
                }}>
                  {value || '—'}
                </p>
              </div>
            ))}
          </div>

          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10 }}>
            <button className="btn btn-secondary" onClick={reset}>← Scan Another</button>
            <button className="btn btn-ghost" onClick={onClose}>Close POC</button>
          </div>
          <div style={{ height:32 }} />
        </div>
      </div>
    );
  }

  // ── Camera view ────────────────────────────────────────────────────────
  const { w: guideW, h: guideH } = guideSize();
  const labelZoneH = Math.round(guideH * LABEL_FRAC);

  return (
    <div style={{ position:'fixed',inset:0,background:'#000',zIndex:999,overflow:'hidden' }}>
      <video ref={videoRef} playsInline muted
        style={{ position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover' }} />

      {/* Dimming overlay with guide */}
      <div style={{ position:'absolute',inset:0,background:'rgba(0,0,0,.55)',
        display:'flex',alignItems:'center',justifyContent:'center' }}>
        <div style={{ position:'relative',width:guideW,height:guideH }}>

          {/* Slab outline */}
          <div style={{ position:'absolute',inset:0,border:'2px solid rgba(255,255,255,.45)',
            borderRadius:8,pointerEvents:'none' }} />

          {/* Label zone highlight */}
          <div style={{ position:'absolute',left:0,right:0,top:0,height:labelZoneH,
            background:'rgba(210,40,40,.2)',
            border:'2px solid rgba(220,60,60,.85)',
            borderRadius:'8px 8px 0 0',
            display:'flex',alignItems:'center',justifyContent:'center',gap:6 }}>
            <span style={{ color:'#fff',fontSize:'.68rem',fontWeight:700,
              letterSpacing:'.07em',textTransform:'uppercase',
              textShadow:'0 1px 4px rgba(0,0,0,.85)' }}>
              PSA Label ↑
            </span>
          </div>

          {/* Corner marks */}
          {[
            { k:'tl', s:{ top:-2,   left:-2,  borderTop:'3px solid #fff', borderLeft:'3px solid #fff',  borderRadius:'4px 0 0 0' }},
            { k:'tr', s:{ top:-2,   right:-2, borderTop:'3px solid #fff', borderRight:'3px solid #fff', borderRadius:'0 4px 0 0' }},
            { k:'bl', s:{ bottom:-2,left:-2,  borderBottom:'3px solid #fff',borderLeft:'3px solid #fff', borderRadius:'0 0 0 4px' }},
            { k:'br', s:{ bottom:-2,right:-2, borderBottom:'3px solid #fff',borderRight:'3px solid #fff',borderRadius:'0 0 4px 0' }},
          ].map(({ k, s }) => (
            <div key={k} style={{ position:'absolute',width:20,height:20,...s }} />
          ))}
        </div>
      </div>

      {/* Instruction */}
      <div style={{ position:'absolute',left:0,right:0,
        top:`calc(50% + ${guideH / 2 + 14}px)`,padding:'0 32px',textAlign:'center' }}>
        <p style={{ color:'rgba(255,255,255,.65)',fontSize:'.8rem',lineHeight:1.5 }}>
          POC v.2 — hold slab label-up, align inside the red zone
        </p>
      </div>

      {/* Controls */}
      <div style={{ position:'absolute',bottom:0,left:0,right:0,
        padding:'20px',paddingBottom:'max(20px,env(safe-area-inset-bottom))',
        display:'flex',flexDirection:'column',alignItems:'center',gap:14 }}>
        {error && (
          <p style={{ color:'#FB7185',fontSize:'.82rem',textAlign:'center' }}>{error}</p>
        )}
        <button onClick={capture} aria-label="Capture"
          style={{ width:70,height:70,borderRadius:'50%',background:'#fff',
            border:'4px solid rgba(255,255,255,.3)',cursor:'pointer',flexShrink:0 }} />
        <button onClick={onClose}
          style={{ background:'none',border:'none',color:'rgba(255,255,255,.5)',
            fontSize:'.85rem',cursor:'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
