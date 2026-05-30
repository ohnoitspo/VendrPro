import React, { useState, useEffect, useContext } from 'react';
import { Ctx } from '../App';
import { getCurrentFloat, getTransactions, getInventory, getSession } from '../utils/storage';
import SlabScanPOC from './SlabScanPOC';

export default function Dashboard() {
  const { setPage, isOnline } = useContext(Ctx);
  const [stats, setStats]       = useState({ float:0, txCount:0, acquired:0, profit:0, revenue:0 });
  const [showSlabPOC, setShowSlabPOC] = useState(false);

  useEffect(() => {
    const refresh = () => {
      const float    = getCurrentFloat();
      const txns     = getTransactions();
      const inv      = getInventory();
      const acquired = inv.filter(i => i.source === 'acquired' && i.status === 'available').length;
      const profit   = txns.reduce((s,tx) => s + ((tx.revenue||0)-(tx.costOfGoods||0)), 0);
      const revenue  = txns.reduce((s,tx) => s + (tx.revenue||0), 0);
      setStats({ float, txCount: txns.length, acquired, profit, revenue });
    };
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, []);

  const session  = getSession();
  const showTime = session?.startedAt
    ? new Date(session.startedAt).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'})
    : '';
  const fmt  = (n) => `A$${Math.abs(n||0).toFixed(2)}`;
  const sign = (n) => `${n>=0?'+':'-'}A$${Math.abs(n||0).toFixed(2)}`;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 style={{ color:'var(--gold)' }}>VendrPro</h1>
          <p style={{ color:'var(--grey)',fontSize:'.78rem' }}>
            Started {showTime} · {isOnline ? '🟢 Online' : '🔴 Offline'}
          </p>
        </div>
        <div style={{ display:'flex',alignItems:'center',gap:10 }}>
          <div style={{ textAlign:'right' }}>
            <p style={{ color:'var(--grey)',fontSize:'.7rem' }}>FLOAT</p>
            <p style={{ color:'var(--gold)',fontSize:'1.5rem',fontWeight:700 }}>{fmt(stats.float)}</p>
          </div>
          <button onClick={() => setPage('settings')}
            style={{ background:'none',border:'none',color:'var(--grey)',
              fontSize:'1.3rem',cursor:'pointer',padding:'4px',lineHeight:1 }}>⚙️</button>
        </div>
      </div>

      <div className="page-body">
        <button className="btn btn-primary btn-full"
          onClick={() => setPage('transaction-type')}
          style={{ minHeight:68,fontSize:'1.1rem',marginBottom:20 }}>
          ➕ New Transaction
        </button>

        {/* KPI grid */}
        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:20 }}>
          {[
            { label:'Transactions', value: stats.txCount, color:'var(--teal)' },
            { label:'Cards Acquired', value: stats.acquired, color:'var(--purple)' },
            { label:'Revenue', value: fmt(stats.revenue), color:'var(--white)', large:true },
            { label:'Gross Profit', value: sign(stats.profit),
              color: stats.profit>=0 ? 'var(--emerald)' : 'var(--rose)', large:true },
          ].map(({ label,value,color,large }) => (
            <div key={label} className="card card-sm" style={{ textAlign:'center' }}>
              <p style={{ color:'var(--grey)',fontSize:'.7rem',textTransform:'uppercase',
                letterSpacing:'.06em',marginBottom:4 }}>{label}</p>
              <p style={{ color,fontSize:large?'1.3rem':'1.6rem',fontWeight:700 }}>{value}</p>
            </div>
          ))}
        </div>

        {/* Quick actions */}
        <p className="section-label">Quick Actions</p>
        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10 }}>
          <button className="btn btn-secondary" onClick={() => setPage('inventory')}>📦 Inventory</button>
          <button className="btn btn-secondary" onClick={() => setPage('eod')}>📊 End of Day</button>
        </div>
        <button className="btn btn-ghost btn-full btn-sm" onClick={() => setShowSlabPOC(true)}
          style={{ marginBottom:20,fontSize:'.78rem',color:'var(--teal)',borderColor:'var(--teal)' }}>
          🧪 POC: Slab Scan
        </button>

        {/* Recent transactions */}
        <RecentTxns />
        {showSlabPOC && <SlabScanPOC onClose={() => setShowSlabPOC(false)} />}
      </div>
    </div>
  );
}

function RecentTxns() {
  const txns = getTransactions().slice(-5).reverse();
  if (!txns.length) return null;
  const icons = { sale:'💰', trade:'🔄', buy:'📥' };
  const fmt   = (n) => `A$${(n||0).toFixed(2)}`;
  return (
    <div>
      <p className="section-label">Recent Transactions</p>
      <div className="card">
        {txns.map(tx => {
          const profit = (tx.revenue||0) - (tx.costOfGoods||0);
          return (
            <div key={tx.id} className="list-item">
              <div className="list-item-icon" style={{ background:'var(--navy-light)' }}>
                {icons[tx.type]||'📋'}
              </div>
              <div className="list-item-content">
                <p className="list-item-title">{tx.itemName||tx.type}</p>
                <p className="list-item-sub">
                  {new Date(tx.createdAt).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'})} · {tx.type}
                </p>
              </div>
              <div className="list-item-right">
                <p className={`list-item-amount ${profit>=0?'pos':'neg'}`}>
                  {profit>=0?'+':'-'}{fmt(Math.abs(profit))}
                </p>
                <p style={{ color:'var(--grey)',fontSize:'.75rem' }}>{fmt(tx.revenue||0)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
