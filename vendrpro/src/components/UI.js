import React, { useState } from 'react';
import { checkPin, setPin as savePin, hasPin } from '../utils/storage';

// ── Toast ─────────────────────────────────────────────────────────────
export function Toast({ msg, type }) {
  return <div className={`toast toast-${type}`}>{type === 'success' ? '✅' : type === 'info' ? 'ℹ️' : '❌'} {msg}</div>;
}
export default Toast;

// ── Bottom Nav ────────────────────────────────────────────────────────
export function BottomNav({ page, setPage, version }) {
  const items = [
    { id: 'dashboard',   label: 'Home',  icon: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z' },
    { id: 'transaction-type', label: 'Deal',  icon: 'M12 5v14M5 12h14' },
    { id: 'inventory',   label: 'Stock', icon: 'M3 6h18M3 12h18M3 18h18' },
    { id: 'eod',         label: 'EOD',   icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z' },
  ];
  return (
    <nav className="bottom-nav">
      {items.map(({ id, label, icon }) => (
        <button key={id} className={`nav-btn${(page === id || (id === 'transaction-type' && page === 'transaction')) ? ' active' : ''}`} onClick={() => setPage(id)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={icon} />
          </svg>
          {label}
        </button>
      ))}
      {version && (
        <span style={{
          position: 'absolute', bottom: 3, right: 6,
          fontSize: '0.6rem', opacity: 0.3, pointerEvents: 'none',
          color: 'inherit', letterSpacing: '0.02em',
        }}>
          v{version}
        </span>
      )}
    </nav>
  );
}

// ── PIN Screen ────────────────────────────────────────────────────────
export function PinScreen({ onUnlock, isSetup = false }) {
  const [digits,  setDigits] = useState([]);
  const [error,   setError]  = useState(false);
  const [shake,   setShake]  = useState(false);

  const handleKey = (key) => {
    if (digits.length >= 4) return;
    const next = [...digits, key];
    setDigits(next);
    if (next.length === 4) {
      const pin = next.join('');
      setTimeout(() => {
        if (isSetup) {
          savePin(pin);
          onUnlock();
        } else if (checkPin(pin)) {
          onUnlock();
        } else {
          setShake(true);
          setTimeout(() => { setShake(false); setDigits([]); setError(true); }, 500);
          setTimeout(() => setError(false), 2000);
        }
      }, 150);
    }
  };

  const handleDelete = () => setDigits(d => d.slice(0, -1));

  const keys = [1,2,3,4,5,6,7,8,9,null,0,'⌫'];

  return (
    <div className="pin-screen">
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', marginBottom: 8 }}>🃏</div>
        <h2 style={{ color: 'var(--gold)', marginBottom: 4 }}>VendrPro</h2>
        <p style={{ color: 'var(--grey)', fontSize: '.85rem' }}>
          {isSetup ? 'Set a 4-digit PIN' : 'Enter your PIN'}
        </p>
      </div>

      <div className={`pin-dots${shake ? ' shake' : ''}`}
        style={{ animation: shake ? 'shake .4s ease' : 'none' }}>
        {[0,1,2,3].map(i => (
          <div key={i} className={`pin-dot${digits[i] !== undefined ? ' filled' : ''}`} />
        ))}
      </div>

      {error && <p style={{ color: 'var(--rose)', fontSize: '.85rem' }}>Incorrect PIN</p>}

      <div className="pin-pad">
        {keys.map((k, i) => (
          k === null ? <div key={i} /> :
          k === '⌫' ? (
            <button key={i} className="pin-key" onClick={handleDelete}
              style={{ fontSize: '1rem' }}>⌫</button>
          ) : (
            <button key={i} className="pin-key" onClick={() => handleKey(String(k))}>{k}</button>
          )
        ))}
      </div>

      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}`}</style>
    </div>
  );
}
