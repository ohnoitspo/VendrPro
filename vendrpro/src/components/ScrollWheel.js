import React from 'react';

// ── Scroll Wheel ──────────────────────────────────────────────────────
export function ScrollWheel({ value, onChange, min=70, max=90, step=5, label }) {
  return (
    <div>
      {label && <p className="section-label" style={{ marginBottom:8 }}>{label}</p>}
      <div style={{ display:'flex',alignItems:'center',gap:12 }}>
        <button className="wheel-btn" onClick={() => value-step>=min && onChange(value-step)}
          disabled={value<=min}>−</button>
        <div style={{ flex:1,textAlign:'center' }}>
          <p style={{ fontSize:'2rem',fontWeight:700,color:'var(--gold)',lineHeight:1 }}>{value}%</p>
          <p style={{ color:'var(--grey)',fontSize:'.72rem',marginTop:2 }}>{min}–{max}%</p>
        </div>
        <button className="wheel-btn" onClick={() => value+step<=max && onChange(value+step)}
          disabled={value>=max}>+</button>
      </div>
    </div>
  );
}

// ── Offer Screen ──────────────────────────────────────────────────────
export function OfferScreen({ itemName, refPrice, cashPct, tradePct, onAcceptCash, onAcceptTrade, onDecline }) {
  const cashOffer  = refPrice ? (refPrice * cashPct  / 100).toFixed(2) : null;
  const tradeOffer = refPrice ? (refPrice * tradePct / 100).toFixed(2) : null;
  const fmt = (n) => n ? `A$${n}` : '—';

  return (
    <div className="offer-screen">
      {/* Card name */}
      <div style={{ textAlign:'center' }}>
        <p style={{ color:'var(--grey)',fontSize:'.8rem',textTransform:'uppercase',
          letterSpacing:'.08em',marginBottom:6 }}>Offer for</p>
        <h2 style={{ fontSize:'1.4rem',color:'var(--white)',marginBottom:4 }}>
          {itemName || 'Card'}
        </h2>
        {refPrice && (
          <p style={{ color:'var(--grey)',fontSize:'.85rem' }}>
            eBay AU ref: A${parseFloat(refPrice).toFixed(2)}
          </p>
        )}
      </div>

      {/* Offer cards */}
      <div style={{ width:'100%',display:'flex',flexDirection:'column',gap:12 }}>
        <div className="offer-card gold-border">
          <p style={{ color:'var(--grey)',fontSize:'.82rem',textTransform:'uppercase',
            letterSpacing:'.08em',marginBottom:8 }}>Cash Offer ({cashPct}%)</p>
          <p className="offer-amount">{fmt(cashOffer)}</p>
          {!refPrice && <p style={{ color:'var(--grey)',fontSize:'.8rem',marginTop:8 }}>
            Enter reference price to calculate</p>}
        </div>
        <div className="offer-card">
          <p style={{ color:'var(--grey)',fontSize:'.82rem',textTransform:'uppercase',
            letterSpacing:'.08em',marginBottom:8 }}>Trade Offer ({tradePct}%)</p>
          <p className="offer-amount" style={{ fontSize:'3rem',color:'var(--teal)' }}>
            {fmt(tradeOffer)}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div style={{ width:'100%' }}>
        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10 }}>
          <button className="btn btn-success" onClick={onAcceptCash} style={{ minHeight:56 }}>
            ✅ Cash
          </button>
          <button className="btn btn-teal" onClick={onAcceptTrade} style={{ minHeight:56 }}>
            🔄 Trade
          </button>
        </div>
        <button className="btn btn-ghost btn-full" onClick={onDecline}>✕ Decline</button>
      </div>
    </div>
  );
}

export default ScrollWheel;
