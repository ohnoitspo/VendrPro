import React, { useState, useEffect } from 'react';
import { getInventory } from '../utils/storage';

const TYPE_ICON  = { slab:'🏆', single:'🃏', sealed:'📦' };
const STATUS_COL = { available:'var(--emerald)', sold:'var(--rose)', traded:'var(--teal)' };

export default function Inventory() {
  const [filter, setFilter] = useState('available');
  const [search, setSearch] = useState('');
  const [items,  setItems]  = useState([]);

  useEffect(() => { setItems(getInventory()); }, []);

  const counts = {
    available: items.filter(i => i.status==='available').length,
    sold:      items.filter(i => i.status==='sold').length,
    traded:    items.filter(i => i.status==='traded').length,
  };

  const filtered = items
    .filter(i => filter==='all' || i.status===filter)
    .filter(i => !search ||
      (i.name||'').toLowerCase().includes(search.toLowerCase()) ||
      (i.set||'').toLowerCase().includes(search.toLowerCase()) ||
      (i.grade||'').toLowerCase().includes(search.toLowerCase()));

  const fmt = (n) => n ? `A$${parseFloat(n).toFixed(2)}` : '—';

  return (
    <div className="page">
      <div className="page-header">
        <h2>Inventory</h2>
        <span className="badge badge-gold">{counts.available} available</span>
      </div>

      <div style={{ padding:'0 16px 8px',flexShrink:0 }}>
        <div className="field" style={{ marginBottom:10 }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Search cards..." />
        </div>
        <div className="seg-control">
          {[
            { id:'available', label:`Available (${counts.available})` },
            { id:'sold',      label:`Sold (${counts.sold})` },
            { id:'traded',    label:`Traded (${counts.traded})` },
          ].map(f => (
            <button key={f.id}
              className={`seg-btn${filter===f.id?' active':''}`}
              onClick={() => setFilter(f.id)}
              style={{ fontSize:'.7rem' }}>{f.label}</button>
          ))}
        </div>
      </div>

      <div className="page-body">
        {filtered.length === 0 ? (
          <div style={{ textAlign:'center',padding:'40px 0' }}>
            <p style={{ fontSize:'2rem',marginBottom:8 }}>📭</p>
            <p style={{ color:'var(--grey)' }}>
              {search ? 'No items match your search' : `No ${filter} items`}
            </p>
          </div>
        ) : (
          <div className="card" style={{ padding:0 }}>
            {filtered.map(item => (
              <div key={item.id} style={{ padding:'12px 16px',
                borderBottom:'1px solid var(--navy-light)' }}>
                <div style={{ display:'flex',gap:12,alignItems:'flex-start' }}>
                  <div style={{ width:36,height:36,borderRadius:8,background:'var(--navy-light)',
                    display:'flex',alignItems:'center',justifyContent:'center',
                    fontSize:'1rem',flexShrink:0 }}>
                    {TYPE_ICON[item.itemType]||'🃏'}
                  </div>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start' }}>
                      <p style={{ fontWeight:700,fontSize:'.95rem',
                        overflow:'hidden',textOverflow:'ellipsis',
                        whiteSpace:'nowrap',maxWidth:'60%' }}>
                        {item.name||'Unknown'}
                      </p>
                      <span className="badge"
                        style={{ background:`${STATUS_COL[item.status]}20`,
                          color:STATUS_COL[item.status],fontSize:'.65rem' }}>
                        {item.status}
                      </span>
                    </div>
                    <p style={{ color:'var(--grey)',fontSize:'.78rem',marginTop:2 }}>
                      {[item.set, item.grade||item.condition].filter(Boolean).join(' · ')}
                    </p>
                    <div style={{ display:'flex',gap:16,marginTop:6 }}>
                      <div>
                        <p style={{ color:'var(--grey)',fontSize:'.65rem' }}>COST BASIS</p>
                        <p style={{ color:'var(--gold)',fontWeight:700,fontSize:'.88rem' }}>
                          {fmt(item.costBasis)}
                          {item.uncosted && <span style={{ color:'var(--rose)',fontSize:'.7rem' }}> ⚠️</span>}
                        </p>
                      </div>
                      {item.marketPrice > 0 && (
                        <div>
                          <p style={{ color:'var(--grey)',fontSize:'.65rem' }}>MARKET</p>
                          <p style={{ color:'var(--white)',fontWeight:600,fontSize:'.88rem' }}>
                            {fmt(item.marketPrice)}
                          </p>
                        </div>
                      )}
                      {item.status==='sold' && item.salePrice && (
                        <div>
                          <p style={{ color:'var(--grey)',fontSize:'.65rem' }}>SOLD FOR</p>
                          <p style={{ color:'var(--emerald)',fontWeight:700,fontSize:'.88rem' }}>
                            {fmt(item.salePrice)}
                          </p>
                        </div>
                      )}
                    </div>
                    <p style={{ color:'var(--grey)',fontSize:'.65rem',marginTop:4 }}>
                      {item.source==='imported' ? '📥 Collectr import' : '🛒 Acquired today'}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
