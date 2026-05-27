import React, { useState } from 'react';
import { getEODSummary, exportCSV, downloadCSV, endSession, clearSession } from '../utils/storage';

export default function EndOfDay() {
  const [summary]     = useState(() => getEODSummary());
  const [confirm,     setConfirm]  = useState(false);
  const [exporting,   setExporting]= useState(false);

  const fmt  = (n) => `A$${Math.abs(n||0).toFixed(2)}`;
  const sign = (n) => `${n>=0?'+':'-'}A$${Math.abs(n||0).toFixed(2)}`;

  const handleExport = () => {
    setExporting(true);
    try {
      const { txCSV, collectrCSV, txFilename, collectrFilename } = exportCSV();
      downloadCSV(txCSV, txFilename);
      setTimeout(() => downloadCSV(collectrCSV, collectrFilename), 600);
    } catch (e) { console.error(e); }
    setExporting(false);
  };

  const handleEndShow = () => { endSession(); clearSession(); window.location.reload(); };

  const { session, soldItems, tradedItems, acquiredUnsold,
          totalRevenue, totalCost, grossProfit, cashIn, cashOut,
          currentFloat, txCount, paymentBreakdown } = summary;

  return (
    <div className="page">
      <div className="page-header">
        <h2>End of Day</h2>
        <span className="badge badge-gold">{txCount} transactions</span>
      </div>

      <div className="page-body">

        {/* Float reconciliation */}
        <p className="section-label">Float Reconciliation</p>
        <div className="card" style={{ marginBottom:16 }}>
          {[
            ['Starting Float',  fmt(session?.startingFloat||0), 'var(--white)'],
            ['Cash Received',  `+${fmt(cashIn)}`,               'var(--emerald)'],
            ['Cash Paid Out',  `-${fmt(cashOut)}`,              'var(--rose)'],
            ['Expected Float',  fmt(currentFloat),               'var(--gold)'],
          ].map(([label,value,color]) => (
            <div key={label} style={{ display:'flex',justifyContent:'space-between',
              padding:'9px 0',borderBottom:'1px solid var(--navy-light)' }}>
              <p style={{ color:'var(--grey)',fontSize:'.9rem' }}>{label}</p>
              <p style={{ color,fontWeight:700 }}>{value}</p>
            </div>
          ))}
        </div>

        {/* P&L */}
        <p className="section-label">Profit & Loss</p>
        <div className="card" style={{ marginBottom:16 }}>
          {[
            ['Total Revenue',  fmt(totalRevenue),  'var(--white)'],
            ['Cost of Goods',  fmt(totalCost),     'var(--white)'],
          ].map(([label,value,color]) => (
            <div key={label} style={{ display:'flex',justifyContent:'space-between',
              padding:'9px 0',borderBottom:'1px solid var(--navy-light)' }}>
              <p style={{ color:'var(--grey)',fontSize:'.9rem' }}>{label}</p>
              <p style={{ color,fontWeight:700 }}>{value}</p>
            </div>
          ))}
          <div style={{ padding:'14px 0 4px',textAlign:'center' }}>
            <p style={{ color:'var(--grey)',fontSize:'.72rem',marginBottom:4 }}>GROSS PROFIT</p>
            <p style={{ fontSize:'2.5rem',fontWeight:700,
              color:grossProfit>=0?'var(--gold)':'var(--rose)' }}>
              {sign(grossProfit)}
            </p>
          </div>
        </div>

        {/* Revenue by payment method */}
        {Object.keys(paymentBreakdown).length > 0 && (
          <>
            <p className="section-label">Revenue by Payment Method</p>
            <div className="card" style={{ marginBottom:16 }}>
              {Object.entries(paymentBreakdown).map(([method, amount]) => (
                <div key={method} style={{ display:'flex',justifyContent:'space-between',
                  padding:'9px 0',borderBottom:'1px solid var(--navy-light)' }}>
                  <p style={{ color:'var(--grey)',fontSize:'.9rem' }}>{method}</p>
                  <p style={{ color:'var(--white)',fontWeight:700 }}>{fmt(amount)}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Acquired today unsold */}
        {acquiredUnsold.length > 0 && (
          <>
            <p className="section-label">Cards Acquired Today — Unsold ({acquiredUnsold.length})</p>
            <div className="card" style={{ marginBottom:16 }}>
              {acquiredUnsold.map(item => (
                <div key={item.id} style={{ display:'flex',justifyContent:'space-between',
                  padding:'8px 0',borderBottom:'1px solid var(--navy-light)' }}>
                  <div>
                    <p style={{ fontSize:'.9rem',fontWeight:600 }}>{item.name}</p>
                    <p style={{ color:'var(--grey)',fontSize:'.75rem' }}>
                      {item.grade||item.condition}
                    </p>
                  </div>
                  <p style={{ color:'var(--gold)',fontWeight:700,fontSize:'.9rem' }}>
                    {fmt(item.costBasis)}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Collectr checklist */}
        <p className="section-label">Collectr Update Checklist</p>
        <div className="card" style={{ marginBottom:20 }}>
          {soldItems.filter(i => i.source==='imported').length > 0 && (
            <>
              <p style={{ color:'var(--rose)',fontWeight:700,fontSize:'.82rem',marginBottom:6 }}>
                🔴 Remove from Collectr ({soldItems.filter(i=>i.source==='imported').length})
              </p>
              {soldItems.filter(i=>i.source==='imported').map(i=>(
                <p key={i.id} style={{ color:'var(--grey)',fontSize:'.8rem',paddingLeft:12,marginBottom:4 }}>
                  • {i.name} — sold {fmt(i.salePrice)}
                </p>
              ))}
              <div className="divider" />
            </>
          )}
          {tradedItems.filter(i=>i.source==='imported').length > 0 && (
            <>
              <p style={{ color:'var(--rose)',fontWeight:700,fontSize:'.82rem',marginBottom:6 }}>
                🔴 Remove from Collectr — traded ({tradedItems.filter(i=>i.source==='imported').length})
              </p>
              {tradedItems.filter(i=>i.source==='imported').map(i=>(
                <p key={i.id} style={{ color:'var(--grey)',fontSize:'.8rem',paddingLeft:12,marginBottom:4 }}>
                  • {i.name}
                </p>
              ))}
              <div className="divider" />
            </>
          )}
          {acquiredUnsold.length > 0 && (
            <>
              <p style={{ color:'var(--emerald)',fontWeight:700,fontSize:'.82rem',marginBottom:6 }}>
                🟢 Add to Collectr ({acquiredUnsold.length})
              </p>
              {acquiredUnsold.map(i=>(
                <p key={i.id} style={{ color:'var(--grey)',fontSize:'.8rem',paddingLeft:12,marginBottom:4 }}>
                  • {i.name} — cost {fmt(i.costBasis)}
                </p>
              ))}
              <div className="divider" />
            </>
          )}
          <p style={{ color:'var(--grey)',fontSize:'.78rem',fontStyle:'italic' }}>
            Full highlighted checklist included in the CSV export
          </p>
        </div>

        {/* Export */}
        <button className="btn btn-primary btn-full"
          onClick={handleExport} disabled={exporting}
          style={{ minHeight:56,marginBottom:10 }}>
          {exporting ? '⏳ Exporting...' : '📥 Export CSV Files'}
        </button>
        <p style={{ color:'var(--grey)',fontSize:'.78rem',textAlign:'center',marginBottom:20 }}>
          Downloads two files: transactions + Collectr update checklist
        </p>

        {/* End show */}
        {!confirm ? (
          <button className="btn btn-danger btn-full"
            onClick={() => setConfirm(true)} style={{ minHeight:52 }}>
            🏁 End Show & Clear Data
          </button>
        ) : (
          <div className="card" style={{ border:'1px solid var(--rose)',textAlign:'center' }}>
            <p style={{ fontWeight:700,marginBottom:8 }}>⚠️ End the show?</p>
            <p style={{ color:'var(--grey)',fontSize:'.82rem',marginBottom:16 }}>
              This clears all show data. Export your CSV first.
            </p>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10 }}>
              <button className="btn btn-ghost" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleEndShow}>Yes, End Show</button>
            </div>
          </div>
        )}
        <div style={{ height:20 }} />
      </div>
    </div>
  );
}
