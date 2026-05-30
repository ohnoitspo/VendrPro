import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createWorker } from 'tesseract.js';

// Slab physical dimensions: ~73mm wide × 130mm tall → aspect ratio 0.562
const SLAB_RATIO  = 73 / 130;
// PSA label occupies roughly the top 22% of the slab face
const LABEL_FRAC  = 0.22;

// Zone definitions: fractional coordinates within the cropped label image.
// lf/tf = left/top fraction, wf/hf = width/height fraction
// psm: Tesseract page segmentation mode (7 = SINGLE_LINE)
// wl: character whitelist (only effective with legacy OCR engine)
const ZONES = [
  { id: 'yearSet',   label: 'Year/Set zone',  lf: 0,   tf: 0,    wf: 0.50, hf: 0.38, psm: 7, wl: '' },
  { id: 'cardNo',    label: 'Card No zone',   lf: 0.5, tf: 0,    wf: 0.50, hf: 0.38, psm: 7, wl: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#' },
  { id: 'name',      label: 'Name zone',      lf: 0,   tf: 0.35, wf: 0.60, hf: 0.32, psm: 7, wl: '' },
  { id: 'grade',     label: 'Grade zone',     lf: 0.6, tf: 0.35, wf: 0.40, hf: 0.32, psm: 7, wl: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.- ' },
  { id: 'setDetail', label: 'Set zone',       lf: 0,   tf: 0.65, wf: 0.60, hf: 0.35, psm: 7, wl: '' },
  { id: 'cert',      label: 'Cert zone',      lf: 0.6, tf: 0.65, wf: 0.40, hf: 0.35, psm: 7, wl: '0123456789' },
];

export default function SlabScanPOC({ onClose }) {
  const [mode,     setMode]    = useState('camera'); // 'camera' | 'processing' | 'results'
  const [labelUrl, setLabelUrl]= useState('');
  const [results,  setResults] = useState([]);
  const [progress, setProgress]= useState('');
  const [error,    setError]   = useState('');

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
    }).catch(err => setError('Camera: ' + err.message));

    return () => { streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  // Compute guide dimensions that fit the screen with some padding.
  const guideSize = () => {
    const maxW = Math.min(window.innerWidth  * 0.82, 300);
    const maxH = window.innerHeight * 0.62;
    let w = maxW;
    let h = w / SLAB_RATIO;
    if (h > maxH) { h = maxH; w = h * SLAB_RATIO; }
    return { w: Math.round(w), h: Math.round(h) };
  };

  // Map a CSS-pixel point inside the viewport to a native video pixel.
  // Accounts for object-fit:cover scaling and centering.
  const cssToVideoPx = (video, cssX, cssY) => {
    const vW = video.videoWidth;
    const vH = video.videoHeight;
    const cW = window.innerWidth;
    const cH = window.innerHeight;
    const s  = Math.max(cW / vW, cH / vH);     // cover scale factor
    const cropVx = (vW - cW / s) / 2;           // video pixels cropped on left
    const cropVy = (vH - cH / s) / 2;           // video pixels cropped on top
    return { x: cssX / s + cropVx, y: cssY / s + cropVy };
  };

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) { setError('Camera not ready'); return; }
    setError('');
    setMode('processing');
    setProgress('Cropping label region…');

    try {
      const { w: guideW, h: guideH } = guideSize();
      const guideX = (window.innerWidth  - guideW) / 2;
      const guideY = (window.innerHeight - guideH) / 2;
      const labelH = Math.round(guideH * LABEL_FRAC);

      // Label zone CSS coords (top portion of guide, full width)
      const tl = cssToVideoPx(video, guideX,          guideY);
      const br = cssToVideoPx(video, guideX + guideW, guideY + labelH);
      const lW = Math.round(br.x - tl.x);
      const lH = Math.round(br.y - tl.y);

      // Capture full frame then crop to label
      const full = document.createElement('canvas');
      full.width  = video.videoWidth;
      full.height = video.videoHeight;
      full.getContext('2d').drawImage(video, 0, 0);

      const label = document.createElement('canvas');
      label.width  = lW;
      label.height = lH;
      label.getContext('2d').drawImage(full, tl.x, tl.y, lW, lH, 0, 0, lW, lH);

      const labelDataUrl = label.toDataURL('image/png');
      setLabelUrl(labelDataUrl);

      // Run Tesseract — single worker, sequential zones so we can show progress
      setProgress('Loading Tesseract engine…');
      const worker = await createWorker('eng');

      const zoneResults = [];
      for (const zone of ZONES) {
        setProgress(`Reading ${zone.label}…`);

        // Reset whitelist for zones that don't use one, then apply
        await worker.setParameters({
          tessedit_pageseg_mode: String(zone.psm),
          tessedit_char_whitelist: zone.wl,
        });

        const rect = {
          left:   Math.round(zone.lf * lW),
          top:    Math.round(zone.tf * lH),
          width:  Math.round(zone.wf * lW),
          height: Math.round(zone.hf * lH),
        };

        const { data } = await worker.recognize(label, { rectangle: rect });
        zoneResults.push({ id: zone.id, label: zone.label, text: data.text.trim() });

        console.log(`[SlabScanPOC] ${zone.label}:`, JSON.stringify(data.text.trim()));
      }

      await worker.terminate();
      setResults(zoneResults);
      setMode('results');
    } catch (err) {
      console.error('[SlabScanPOC] error:', err);
      setError('Failed: ' + err.message);
      setMode('camera');
    }
  }, []);

  const reset = () => {
    setMode('camera');
    setLabelUrl('');
    setResults([]);
    setProgress('');
    setError('');
  };

  // ── Processing screen ─────────────────────────────────────────────────
  if (mode === 'processing') return (
    <div style={{ position:'fixed',inset:0,background:'#0D1023',zIndex:999,
      display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:20 }}>
      <div style={{ width:44,height:44,borderRadius:'50%',border:'3px solid #F5A623',
        borderTopColor:'transparent',animation:'spin .8s linear infinite' }} />
      <p style={{ color:'#fff',fontSize:'.9rem',textAlign:'center',padding:'0 24px' }}>{progress}</p>
    </div>
  );

  // ── Results screen ────────────────────────────────────────────────────
  if (mode === 'results') return (
    <div style={{ position:'fixed',inset:0,background:'var(--navy)',zIndex:999,overflowY:'auto' }}>
      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',
        padding:'16px',borderBottom:'1px solid var(--navy-light)',position:'sticky',top:0,
        background:'var(--navy)',zIndex:1 }}>
        <h2 style={{ color:'var(--gold)',fontSize:'1.1rem' }}>POC: Slab Scan Results</h2>
        <button onClick={onClose} style={{ background:'none',border:'none',
          color:'var(--grey)',fontSize:'1.3rem',cursor:'pointer',lineHeight:1 }}>✕</button>
      </div>

      <div style={{ padding:'16px' }}>
        {/* Cropped label preview */}
        {labelUrl && (
          <div style={{ marginBottom:16 }}>
            <p style={{ color:'var(--grey)',fontSize:'.7rem',textTransform:'uppercase',
              letterSpacing:'.06em',marginBottom:8 }}>Cropped Label</p>
            <img src={labelUrl} alt="label"
              style={{ width:'100%',borderRadius:8,border:'1px solid var(--navy-light)',display:'block' }} />
          </div>
        )}

        {/* Zone results */}
        <p style={{ color:'var(--grey)',fontSize:'.7rem',textTransform:'uppercase',
          letterSpacing:'.06em',marginBottom:10 }}>Zone Results</p>
        {results.map(r => (
          <div key={r.id} style={{ background:'var(--navy-card)',borderRadius:8,
            padding:'10px 14px',marginBottom:8,border:'1px solid var(--navy-light)' }}>
            <p style={{ color:'var(--grey)',fontSize:'.7rem',marginBottom:4 }}>{r.label}</p>
            {r.text ? (
              <p style={{ color:'var(--white)',fontFamily:'monospace',fontSize:'.88rem',
                wordBreak:'break-all',whiteSpace:'pre-wrap' }}>{r.text}</p>
            ) : (
              <p style={{ color:'var(--grey)',fontStyle:'italic',fontSize:'.82rem' }}>(empty)</p>
            )}
          </div>
        ))}

        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:16 }}>
          <button className="btn btn-secondary" onClick={reset}>← Scan Another</button>
          <button className="btn btn-ghost" onClick={onClose}>Close POC</button>
        </div>
        <div style={{ height:24 }} />
      </div>
    </div>
  );

  // ── Camera view ───────────────────────────────────────────────────────
  const { w: guideW, h: guideH } = guideSize();
  const labelZoneH = Math.round(guideH * LABEL_FRAC);

  return (
    <div style={{ position:'fixed',inset:0,background:'#000',zIndex:999,overflow:'hidden' }}>
      <video ref={videoRef} playsInline muted
        style={{ position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover' }} />

      {/* Dimming overlay — renders guide as a transparent window */}
      <div style={{ position:'absolute',inset:0,display:'flex',alignItems:'center',
        justifyContent:'center',background:'rgba(0,0,0,.55)' }}>
        <div style={{ position:'relative',width:guideW,height:guideH }}>

          {/* Slab outline */}
          <div style={{ position:'absolute',inset:0,border:'2px solid rgba(255,255,255,.55)',
            borderRadius:8,pointerEvents:'none' }} />

          {/* PSA label zone highlight */}
          <div style={{ position:'absolute',left:0,right:0,top:0,height:labelZoneH,
            background:'rgba(220,40,40,.22)',border:'2px solid rgba(220,60,60,.9)',
            borderRadius:'8px 8px 0 0',display:'flex',alignItems:'center',justifyContent:'center' }}>
            <span style={{ color:'#fff',fontSize:'.68rem',fontWeight:700,letterSpacing:'.07em',
              textTransform:'uppercase',textShadow:'0 1px 4px rgba(0,0,0,.9)' }}>
              PSA Label Zone
            </span>
          </div>

          {/* Corner marks */}
          <div style={{ position:'absolute',top:-2,left:-2,width:20,height:20,
            borderTop:'3px solid #fff',borderLeft:'3px solid #fff',borderRadius:'4px 0 0 0' }} />
          <div style={{ position:'absolute',top:-2,right:-2,width:20,height:20,
            borderTop:'3px solid #fff',borderRight:'3px solid #fff',borderRadius:'0 4px 0 0' }} />
          <div style={{ position:'absolute',bottom:-2,left:-2,width:20,height:20,
            borderBottom:'3px solid #fff',borderLeft:'3px solid #fff',borderRadius:'0 0 0 4px' }} />
          <div style={{ position:'absolute',bottom:-2,right:-2,width:20,height:20,
            borderBottom:'3px solid #fff',borderRight:'3px solid #fff',borderRadius:'0 0 4px 0' }} />
        </div>
      </div>

      {/* Instruction */}
      <div style={{ position:'absolute',left:0,right:0,
        top:`calc(50% + ${guideH / 2 + 16}px)`,textAlign:'center',padding:'0 32px' }}>
        <p style={{ color:'rgba(255,255,255,.75)',fontSize:'.8rem',lineHeight:1.4 }}>
          Align the red PSA label inside the highlighted zone
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
            border:'4px solid rgba(255,255,255,.35)',cursor:'pointer',flexShrink:0 }} />
        <button onClick={onClose}
          style={{ background:'none',border:'none',color:'rgba(255,255,255,.55)',
            fontSize:'.85rem',cursor:'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
