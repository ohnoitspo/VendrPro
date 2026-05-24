import React, { useState, useContext, useRef } from 'react';
import { Ctx } from '../App';
import { startSession, importFromCollectr, parseCollectrCSV } from '../utils/storage';

export default function StartShow() {
  const { setSession, showToast } = useContext(Ctx);
  const [float,    setFloat]    = useState('');
  const [showName, setShowName] = useState('');
  const [showDate, setShowDate] = useState(new Date().toISOString().split('T')[0]);
  const [location, setLocation] = useState('');
  const [imported, setImported] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const fileRef = useRef(null);

  const handleCSV = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const items = parseCollectrCSV(ev.target.result);
        if (!items.length) { showToast('No items found in CSV', 'error'); return; }
        setImported({ count: items.length, items,
          slabs:  items.filter(i => i.itemType === 'slab').length,
          singles:items.filter(i => i.itemType === 'single').length,
          sealed: items.filter(i => i.itemType === 'sealed').length,
        });
        showToast(`${items.length} items loaded`, 'success');
      } catch { showToast('Could not parse CSV', 'error'); }
    };
    reader.readAsText(file);
  };

  const handleStart = () => {
    if (!float || isNaN(parseFloat(float))) { showToast('Enter your starting float', 'error'); return; }
    setLoading(true);
    const session = startSession(parseFloat(float), { showName, showDate, showLocation: location });
    if (imported?.items?.length) importFromCollectr(imported.items);
    setSession(session);
  };

  return (
    <div style={{ position:'fixed',inset:0,background:'var(--navy)',
      display:'flex',flexDirection:'column',alignItems:'center',
      justifyContent:'center',padding:'24px' }}>

      {/* Logo */}
      <div style={{ marginBottom:32, textAlign:'center' }}>
        <div style={{ width:76,height:76,borderRadius:20,background:'var(--gold)',
          display:'flex',alignItems:'center',justifyContent:'center',
          margin:'0 auto 16px',fontSize:'2.2rem' }}>🃏</div>
        <h1 style={{ fontSize:'2rem',color:'var(--gold)',marginBottom:4 }}>VendrPro</h1>
        <p style={{ color:'var(--grey)',fontSize:'.9rem' }}>TCG Vendor Tool</p>
      </div>

      <div style={{ width:'100%',maxWidth:380 }}>
        {/* Float */}
        <div className="field">
          <label>Starting Float (A$)</label>
          <input type="number" inputMode="decimal" placeholder="e.g. 2000"
            value={float} onChange={e => setFloat(e.target.value)}
            style={{ fontSize:'1.4rem',textAlign:'center',fontWeight:700 }} />
        </div>

        {/* Show details */}
        <div className="field">
          <label>Show Name (optional)</label>
          <input value={showName} onChange={e => setShowName(e.target.value)}
            placeholder="e.g. PokeMarket Sydney" />
        </div>
        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10 }}>
          <div className="field" style={{ margin:0 }}>
            <label>Date</label>
            <input type="date" value={showDate} onChange={e => setShowDate(e.target.value)} />
          </div>
          <div className="field" style={{ margin:0 }}>
            <label>Location (optional)</label>
            <input value={location} onChange={e => setLocation(e.target.value)}
              placeholder="e.g. ICC Sydney" />
          </div>
        </div>
        <div style={{ height:14 }} />

        {/* Collectr import */}
        <div className="card" style={{ marginBottom:16 }}>
          <p className="section-label" style={{ marginBottom:8 }}>Import Collectr Inventory</p>
          <p style={{ color:'var(--grey)',fontSize:'.82rem',marginBottom:12 }}>
            Export your collection from Collectr as CSV and import here.
          </p>
          <input ref={fileRef} type="file" accept=".csv"
            onChange={handleCSV} style={{ display:'none' }} />
          {imported ? (
            <div style={{ display:'flex',alignItems:'center',gap:10 }}>
              <div style={{ flex:1,background:'rgba(5,150,105,.1)',
                border:'1px solid var(--emerald)',borderRadius:'var(--radius-sm)',padding:'10px 14px' }}>
                <p style={{ color:'var(--emerald)',fontWeight:700 }}>✅ {imported.count} items ready</p>
                <p style={{ color:'var(--grey)',fontSize:'.78rem',marginTop:2 }}>
                  {imported.slabs} slabs · {imported.singles} singles · {imported.sealed} sealed
                </p>
              </div>
              <button className="btn btn-ghost btn-sm"
                onClick={() => { setImported(null); fileRef.current.value=''; }}>✕</button>
            </div>
          ) : (
            <button className="btn btn-secondary btn-full"
              onClick={() => fileRef.current.click()}>📂 Select Collectr CSV</button>
          )}
        </div>

        {!imported && (
          <p style={{ color:'var(--grey)',fontSize:'.78rem',textAlign:'center',marginBottom:16 }}>
            Skip import to start fresh — add inventory manually during the show
          </p>
        )}

        <button className="btn btn-primary btn-full" onClick={handleStart}
          disabled={loading} style={{ fontSize:'1.1rem',minHeight:60 }}>
          {loading ? 'Starting...' : '🚀 Start Show'}
        </button>
      </div>
    </div>
  );
}
