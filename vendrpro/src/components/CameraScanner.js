import React, { useRef, useEffect, useState } from 'react';
import { identifyCard, compressImage } from '../utils/api';

export default function CameraScanner({ onResult, onClose }) {
  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);
  const streamRef  = useRef(null);
  const [status,     setStatus]     = useState('starting');
  const [errMsg,     setErrMsg]     = useState('');
  const [scanResult, setScanResult] = useState(null);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setErrMsg('Camera not available on this device or browser.');
      return;
    }
    startCam();
    return stopCam;
  }, []);

  const startCam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setStatus('ready');
    } catch {
      setStatus('error');
      setErrMsg('Camera access denied. Allow camera in browser settings.');
    }
  };

  const stopCam = () => streamRef.current?.getTracks().forEach(t => t.stop());

  const retake = () => {
    setScanResult(null);
    setStatus('ready');
  };

  const capture = async () => {
    if (status !== 'ready') return;
    setStatus('processing');
    const canvas = canvasRef.current;
    const video  = videoRef.current;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const raw = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
    try {
      const compressed = await compressImage(raw);
      const result     = await identifyCard(compressed);
      setScanResult(result);
      if (!result.name) {
        setStatus('failed');
      } else if (result.confidence === 'low') {
        setStatus('uncertain');
      } else {
        setStatus('identified');
      }
    } catch (err) {
      setScanResult({ error: err.message });
      setStatus('failed');
    }
  };

  const isResultScreen = ['identified', 'uncertain', 'failed'].includes(status);

  return (
    <div className="camera-overlay">
      {/* Video always mounted so stream stays alive for retake */}
      <video ref={videoRef} playsInline muted
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {isResultScreen ? (
        /* ── Result overlay ───────────────────────────────────── */
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.88)',
          display: 'flex', flexDirection: 'column',
          padding: 'max(32px,env(safe-area-inset-top)) 20px max(32px,env(safe-area-inset-bottom))' }}>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
            <button onClick={() => { stopCam(); onClose(); }}
              style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1rem',
                cursor: 'pointer', padding: 8 }}>✕ Cancel</button>
            <p style={{ color: 'var(--gold)', fontWeight: 600 }}>Scan Result</p>
            <div style={{ width: 60 }} />
          </div>

          {status === 'failed' ? (
            <div style={{ background: 'rgba(225,29,72,.1)', border: '1px solid var(--rose)',
              borderRadius: 'var(--radius-lg)', padding: 24, textAlign: 'center', marginBottom: 24 }}>
              <p style={{ fontSize: '2rem', marginBottom: 12 }}>❌</p>
              <p style={{ color: 'var(--rose)', fontWeight: 700, fontSize: '1.1rem', marginBottom: 8 }}>
                Could not identify card
              </p>
              <p style={{ color: 'rgba(255,255,255,.55)', fontSize: '.85rem' }}>
                {scanResult?.error || 'Try again with better lighting or a cleaner shot.'}
              </p>
            </div>
          ) : (
            <div style={{
              background: status === 'uncertain' ? 'rgba(245,158,11,.1)' : 'rgba(5,150,105,.1)',
              border: `1px solid ${status === 'uncertain' ? 'var(--amber)' : 'var(--emerald)'}`,
              borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: '1.2rem' }}>{status === 'uncertain' ? '⚠️' : '✅'}</span>
                <p style={{ fontWeight: 700, fontSize: '.88rem',
                  color: status === 'uncertain' ? 'var(--amber)' : '#34D399' }}>
                  {status === 'uncertain' ? 'Uncertain — please verify' : 'Card identified'}
                </p>
              </div>
              <p style={{ color: 'var(--white)', fontWeight: 700, fontSize: '1.1rem', marginBottom: 4 }}>
                {scanResult?.name}
              </p>
              {scanResult?.setName && (
                <p style={{ color: 'var(--grey)', fontSize: '.85rem' }}>{scanResult.setName}</p>
              )}
              {scanResult?.grade && (
                <p style={{ color: 'var(--gold)', fontSize: '.85rem', marginTop: 4 }}>{scanResult.grade}</p>
              )}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {status !== 'failed' && (
              <button className="btn btn-primary btn-full"
                onClick={() => { stopCam(); onResult(scanResult); }}>
                ✓ Use This
              </button>
            )}
            <button className="btn btn-secondary btn-full" onClick={retake}>
              📷 Retake
            </button>
            <button className="btn btn-ghost btn-full"
              onClick={() => { stopCam(); onResult({ name: '', setName: '', itemType: 'single', confidence: 'none', manual: true }); }}>
              ✏️ Enter Manually
            </button>
          </div>
        </div>
      ) : (
        /* ── Camera viewfinder ────────────────────────────────── */
        <>
          <div style={{ position: 'absolute', inset: 0,
            background: 'radial-gradient(ellipse 70% 50% at 50% 35%, transparent 40%, rgba(0,0,0,.65) 100%)' }} />

          <div style={{ position: 'absolute', top: 0, left: 0, right: 0,
            padding: 'max(16px,env(safe-area-inset-top)) 16px 16px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: 'linear-gradient(to bottom,rgba(0,0,0,.55),transparent)' }}>
            <button onClick={() => { stopCam(); onClose(); }}
              style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1rem',
                cursor: 'pointer', padding: 8 }}>✕ Cancel</button>
            <p style={{ color: 'var(--gold)', fontWeight: 600 }}>Scan Card</p>
            <div style={{ width: 60 }} />
          </div>

          <div className="cam-guide">
            <div className="cam-corner cam-tl" />
            <div className="cam-corner cam-tr" />
            <div className="cam-corner cam-bl" />
            <div className="cam-corner cam-br" />
          </div>

          <div style={{ position: 'absolute', top: '52%', left: 0, right: 0,
            textAlign: 'center', padding: '0 32px' }}>
            {status === 'starting'   && <p style={{ color: 'rgba(255,255,255,.7)', fontSize: '.85rem' }}>Starting camera...</p>}
            {status === 'ready'      && <p style={{ color: 'rgba(255,255,255,.7)', fontSize: '.85rem' }}>Centre the card in the frame</p>}
            {status === 'processing' && <p style={{ color: 'var(--gold)', fontSize: '.9rem', fontWeight: 600 }}>🔍 Identifying...</p>}
            {status === 'error'      && <p style={{ color: 'var(--rose)', fontSize: '.85rem' }}>{errMsg}</p>}
          </div>

          <div style={{ position: 'absolute', bottom: 'max(48px,env(safe-area-inset-bottom))',
            left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
            {status === 'ready' && (
              <button onClick={capture} style={{ width: 76, height: 76, borderRadius: '50%',
                background: 'var(--gold)', border: '4px solid white', cursor: 'pointer',
                fontSize: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 20px rgba(0,0,0,.5)' }}>📸</button>
            )}
            {status === 'processing' && (
              <div style={{ width: 76, height: 76, borderRadius: '50%',
                border: '4px solid var(--gold)', borderTopColor: 'transparent',
                animation: 'spin 1s linear infinite' }} />
            )}
          </div>

          {status === 'error' && (
            <div style={{ position: 'absolute', bottom: 'max(32px,env(safe-area-inset-bottom))',
              left: 0, right: 0, textAlign: 'center', padding: '0 32px' }}>
              <button className="btn btn-secondary"
                onClick={() => { onResult({ name: '', setName: '', itemType: 'single', confidence: 'none', manual: true }); }}>
                ✏️ Enter Manually
              </button>
            </div>
          )}

          {status === 'ready' && (
            <div style={{ position: 'absolute', bottom: 'max(14px,env(safe-area-inset-bottom))',
              left: 0, right: 0, textAlign: 'center' }}>
              <button onClick={() => { stopCam(); onResult({ name: '', setName: '', itemType: 'single', confidence: 'none', manual: true }); }}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.55)',
                  fontSize: '.82rem', cursor: 'pointer' }}>
                Enter manually instead
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
