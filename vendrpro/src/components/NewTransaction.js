import React, { useState, useRef, useContext } from 'react';
import { Ctx } from '../App';
import { getSettings, updateSettings, addTransaction,
         updateSessionCash, addInventoryItem,
         markItemSold, markItemTraded, getAvailableInventory } from '../utils/storage';
import { getEbayPrice } from '../utils/api';
import CameraScanner from './CameraScanner';
import BatchScanner from './BatchScanner';
import { OfferScreen } from './ScrollWheel';
import { ScrollWheel } from './ScrollWheel';
import { BottomNav } from './UI';

const CONDITIONS    = ['Near Mint','Lightly Played','Moderately Played','Heavily Played','Damaged','New/Sealed','Graded'];
const GRADERS       = ['PSA','BGS','CGC','TAG'];
const GRADES        = ['10','9.5','9','8.5','8','7','6','5','4','3','2','1'];
const PAY_METHODS   = ['Cash','Card (Square)','Bank Transfer','PayID'];
const TX_TYPES      = [
  { id:'buy',        label:'📥 Buy',             desc:'Purchase cards from customer for cash' },
  { id:'batch_buy',  label:'📦 Batch Buy',        desc:'Scan and price multiple cards at once — adds directly to inventory' },
  { id:'sale',       label:'💰 Cash Sale',        desc:'Sell from your inventory for cash' },
  { id:'trade_in',   label:'🔄 Trade + Cash In',  desc:'Sell your card, receive cards + cash top-up' },
  { id:'trade_even', label:'⚖️ Even Trade',        desc:'Swap cards of equal value, no cash' },
  { id:'trade_out',  label:'💸 Trade + Cash Out',  desc:'Receive cards, pay cash to make up difference' },
];

export default function NewTransaction() {
  const { showToast, isOnline, setPage, page } = useContext(Ctx);
  const s = getSettings();

  const [step,        setStep]       = useState('type');
  const [txType,      setTxType]     = useState('buy');
  const [showCamera,  setShowCamera] = useState(false);
  const [showOffer,   setShowOffer]  = useState(false);
  const [showBatch,   setShowBatch]  = useState(false);

  // Item
  const [itemName,    setItemName]   = useState('');
  const [itemSet,     setItemSet]    = useState('');
  const [itemGrade,   setItemGrade]  = useState('');
  const [itemCond,    setItemCond]   = useState(s.lastCondition || 'Near Mint');
  const [itemType,    setItemType]   = useState('single');
  const [costBasis,   setCostBasis]  = useState('');
  const [saleValue,   setSaleValue]  = useState('');

  // eBay / offer
  const [refPrice,    setRefPrice]   = useState('');
  const [cashPct,     setCashPct]    = useState(s.cashPct  || 80);
  const [tradePct,    setTradePct]   = useState(s.tradePct || 85);
  const [ebayData,    setEbayData]   = useState(null);

  // Payment amounts
  const [cashIn,      setCashIn]     = useState('');
  const [cashOut,     setCashOut]    = useState('');
  const [tradeValIn,  setTradeValIn] = useState('');

  // Trade-in cards
  const [tradeIns,    setTradeIns]   = useState([]);
  const [notes,       setNotes]      = useState('');
  const [loading,     setLoading]    = useState(false);

  // Inventory selection
  const [selInvItem,  setSelInvItem] = useState(null);
  const [showInvPick, setShowInvPick]= useState(false);

  const [showOfferCalc, setShowOfferCalc] = useState(false);

  // Payment method
  const [payMethod,    setPayMethod]    = useState('Cash');
  const [splitMethod1, setSplitMethod1] = useState('Cash');
  const [splitMethod2, setSplitMethod2] = useState('Card (Square)');
  const [splitAmount1, setSplitAmount1] = useState('');
  const [squareLaunched, setSquareLaunched] = useState(false);

  // Bundle
  const [bundleMode,  setBundleMode]  = useState(false);
  const [bundleItems, setBundleItems] = useState([]);
  const [bundleName,  setBundleName]  = useState('');

  // Swipe-up peek nav
  const [navPeek,    setNavPeek]    = useState(false);
  const peekTimer    = useRef(null);
  const touchStartY  = useRef(null);

  const showNavPeek = () => {
    setNavPeek(true);
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setNavPeek(false), 4000);
  };
  const handleTouchStart = (e) => {
    const t = e.touches[0];
    touchStartY.current = window.innerHeight - t.clientY < 80 ? t.clientY : null;
  };
  const handleTouchEnd = (e) => {
    if (touchStartY.current === null) return;
    if (touchStartY.current - e.changedTouches[0].clientY > 50) showNavPeek();
    touchStartY.current = null;
  };
  const peekSetPage = (p) => {
    setNavPeek(false);
    if (peekTimer.current) clearTimeout(peekTimer.current);
    if (p === 'transaction-type') setStep('type');
    setPage(p);
  };

  // ── Computed values ───────────────────────────────────────────────────
  const ref  = parseFloat(refPrice)   || 0;
  const cash = parseFloat(cashIn)     || 0;
  const paid = parseFloat(cashOut)    || 0;
  const tval = parseFloat(tradeValIn) || 0;
  const sale = parseFloat(saleValue)  || 0;

  const bundleCost = bundleItems.reduce((s, i) => s + (i.costBasis || 0), 0);
  const cost       = bundleMode ? bundleCost : (parseFloat(costBasis) || selInvItem?.costBasis || 0);

  const squareAmount = txType === 'sale'      ? sale
                     : txType === 'buy'       ? paid
                     : txType === 'trade_in'  ? cash
                     : txType === 'trade_out' ? paid
                     : 0;

  const revenue  = txType === 'buy'        ? 0
                 : txType === 'sale'       ? sale
                 : txType === 'trade_in'   ? sale + cash
                 : txType === 'trade_even' ? sale
                 : sale;
  const profit   = revenue - cost;

  const showInvSelector = ['sale','trade_in','trade_even'].includes(txType);
  const showCardsRcvd   = txType !== 'sale';
  const showWheels      = txType !== 'sale';

  const netPos = tval + cash - sale;
  const summaryRows =
    txType === 'buy' ? [
      ['Offer / Cost',  `A$${cost.toFixed(2)}`, 'var(--white)'],
      ['Cash Paid Out', `A$${paid.toFixed(2)}`, 'var(--white)'],
    ] : txType === 'sale' ? [
      ['Sale Price', `A$${sale.toFixed(2)}`,  'var(--white)'],
      ['Cost Basis', `A$${cost.toFixed(2)}`,  'var(--white)'],
      ['Profit',     `${profit>=0?'+':'-'}A$${Math.abs(profit).toFixed(2)}`, profit>=0?'var(--gold)':'var(--rose)'],
    ] : txType === 'trade_in' ? [
      ['Your Card Value', `A$${sale.toFixed(2)}`, 'var(--white)'],
      ['Trade Value In',  `A$${tval.toFixed(2)}`, 'var(--white)'],
      ['Cash Top-up',     `A$${cash.toFixed(2)}`, 'var(--white)'],
      ['Net Position',    `${netPos>=0?'+':'-'}A$${Math.abs(netPos).toFixed(2)}`, netPos>=0?'var(--emerald)':'var(--rose)'],
    ] : txType === 'trade_even' ? [
      ['Your Card Value', `A$${sale.toFixed(2)}`, 'var(--white)'],
      ['Trade Value In',  `A$${tval.toFixed(2)}`, 'var(--white)'],
      ['Difference',      `${(tval-sale)>=0?'+':'-'}A$${Math.abs(tval-sale).toFixed(2)}`, (tval-sale)>=0?'var(--emerald)':'var(--rose)'],
    ] : [
      ['Trade Value In', `A$${tval.toFixed(2)}`, 'var(--white)'],
      ['Cash Paid Out',  `A$${paid.toFixed(2)}`, 'var(--white)'],
      ['Net Received',   `${(tval-paid)>=0?'+':'-'}A$${Math.abs(tval-paid).toFixed(2)}`, (tval-paid)>=0?'var(--emerald)':'var(--rose)'],
    ];

  // ── Camera ─────────────────────────────────────────────────────────────
  const handleScan = async (result) => {
    setShowCamera(false);
    if (result.name)    setItemName(result.name);
    if (result.setName) setItemSet(result.setName);
    if (result.grade)   { setItemGrade(result.grade); setItemType('slab'); }
    else if (result.itemType) setItemType(result.itemType);
    if (isOnline && result.name && !result.manual) {
      setLoading(true);
      const data = await getEbayPrice(result.name, result.setName, result.grade);
      if (data) { setEbayData(data); setRefPrice(data.median?.toFixed(2) || ''); }
      setLoading(false);
    }
  };

  // ── eBay lookup ────────────────────────────────────────────────────────
  const lookupEbay = async () => {
    if (!itemName || !isOnline) return;
    setLoading(true);
    try {
      const data = await getEbayPrice(itemName, itemSet, itemGrade);
      if (data) {
        setEbayData(data);
        setRefPrice(data.median?.toFixed(2) || '');
        showToast(`eBay AU: A$${data.median?.toFixed(2)} median (${data.count} listings)`, 'success');
      } else {
        showToast('No eBay AU listings found', 'info');
      }
    } catch { showToast('eBay lookup failed', 'error'); }
    setLoading(false);
  };

  // ── Trade-in management ────────────────────────────────────────────────
  const addTradeIn = () => setTradeIns(p => [...p, {
    id: `ti_${Date.now()}`, name:'', condition:'Near Mint', grade:'', marketValue:'', offerValue:'',
  }]);
  const updateTI = (id, k, v) => setTradeIns(p => p.map(t => t.id===id ? {...t,[k]:v} : t));
  const removeTI = (id)       => setTradeIns(p => p.filter(t => t.id!==id));

  // ── Bundle management ──────────────────────────────────────────────────
  const addToBundle    = (item) => { if (!bundleItems.find(i => i.id === item.id)) setBundleItems(p => [...p, item]); };
  const removeFromBundle = (id) => setBundleItems(p => p.filter(i => i.id !== id));

  // ── Square deep link ───────────────────────────────────────────────────
  const openSquare = () => {
    const amtCents = Math.round(squareAmount * 100);
    const payload  = JSON.stringify({
      amount_money: { amount: amtCents, currency_code: 'AUD' },
      callback_url: 'vendrpro://payment-complete',
      version: '1.1',
    });
    window.location.href = `square-commerce-v1://payment/create?data=${btoa(payload)}`;
    setSquareLaunched(true);
  };

  // ── Complete ───────────────────────────────────────────────────────────
  const complete = () => {
    const effName = bundleMode
      ? (bundleName.trim() || `Bundle x${bundleItems.length} cards`)
      : itemName.trim();

    if (!effName && txType !== 'buy') { showToast('Enter item name', 'error'); return; }
    if (txType === 'buy' && tradeIns.length === 0 && !itemName) { showToast('Add at least one card received', 'error'); return; }
    if (bundleMode && bundleItems.length === 0) { showToast('Add at least one card to the bundle', 'error'); return; }

    let finalPayMethod = payMethod;
    if (payMethod === 'Split') {
      const s1 = parseFloat(splitAmount1) || 0;
      const s2 = Math.max(0, squareAmount - s1);
      if (squareAmount > 0 && s1 > squareAmount) { showToast('Split amount exceeds total', 'error'); return; }
      finalPayMethod = `Split: ${splitMethod1} A$${s1.toFixed(2)} + ${splitMethod2} A$${s2.toFixed(2)}`;
    }

    const tx = {
      type: txType,
      itemName: effName,
      itemSet:  bundleMode ? '' : itemSet,
      itemGrade: bundleMode ? '' : itemGrade,
      itemType:  bundleMode ? 'bundle' : itemType,
      costOfGoods: cost, revenue,
      cashReceived: cash, cashPaid: paid,
      tradeValueIn: tval, salePrice: sale,
      refPrice: ref, cashPct, tradePct, notes, tradeIns,
      paymentMethod: finalPayMethod,
      bundleItems: bundleMode
        ? bundleItems.map(i => ({ id: i.id, name: i.name, costBasis: i.costBasis || 0 }))
        : undefined,
    };
    const saved = addTransaction(tx);

    if (cash > 0 || paid > 0) updateSessionCash(cash, paid);

    tradeIns.forEach(ti => {
      if (ti.name) addInventoryItem({
        name: ti.name, condition: ti.grade || ti.condition,
        grade: ti.grade, costBasis: parseFloat(ti.offerValue) || 0,
        marketValue: parseFloat(ti.marketValue) || 0,
        itemType: ti.grade ? 'slab' : 'single',
      });
    });

    if (txType === 'buy' && itemName) {
      addInventoryItem({ name:itemName, set:itemSet, grade:itemGrade,
        condition:itemCond, costBasis:cost, itemType });
    }

    if (bundleMode) {
      bundleItems.forEach(item => {
        if (txType === 'sale' || txType === 'trade_in') markItemSold(item.id, saved.id, null);
        else markItemTraded(item.id, saved.id);
      });
    } else if (selInvItem) {
      if (txType === 'sale' || txType === 'trade_in') markItemSold(selInvItem.id, saved.id, sale);
      else markItemTraded(selInvItem.id, saved.id);
    }

    updateSettings({ cashPct, tradePct, lastCondition: itemCond });
    showToast('Transaction logged!', 'success');
    setPage('dashboard');
  };

  // ── Batch scanner overlay ──────────────────────────────────────────────
  if (showBatch) return <BatchScanner onClose={() => setShowBatch(false)} />;

  // ── Type selection ─────────────────────────────────────────────────────
  if (step === 'type') return (
    <div className="page">
      <div className="page-header">
        <button className="btn btn-ghost btn-sm" onClick={() => setPage('dashboard')}>← Back</button>
        <h2>New Transaction</h2>
      </div>
      <div className="page-body">
        <p className="section-label">Transaction type</p>
        <div style={{ display:'flex',flexDirection:'column',gap:10 }}>
          {TX_TYPES.map(t => (
            <button key={t.id} className="card"
              onClick={() => {
                if (t.id === 'batch_buy') { setShowBatch(true); return; }
                setTxType(t.id); setStep('form'); setPage('transaction'); setShowOfferCalc(false);
                setBundleMode(false); setBundleItems([]); setBundleName('');
                setPayMethod('Cash'); setSplitAmount1(''); setSquareLaunched(false);
              }}
              style={{ textAlign:'left',border:'none',cursor:'pointer',
                borderLeft:`3px solid ${txType===t.id?'var(--gold)':'transparent'}` }}>
              <p style={{ fontWeight:700,fontSize:'1.05rem',marginBottom:4 }}>{t.label}</p>
              <p style={{ color:'var(--grey)',fontSize:'.82rem' }}>{t.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Inventory picker ───────────────────────────────────────────────────
  if (showInvPick) {
    const inv = getAvailableInventory();
    if (bundleMode) {
      return (
        <div className="page">
          <div className="page-header">
            <h2>Add to Bundle</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowInvPick(false)}>
              Done {bundleItems.length > 0 ? `(${bundleItems.length})` : ''}
            </button>
          </div>
          <div className="page-body">
            {inv.length === 0 ? (
              <p style={{ color:'var(--grey)',textAlign:'center',padding:'40px 0' }}>No available inventory</p>
            ) : (
              <div className="card" style={{ padding:0 }}>
                {inv.map(item => {
                  const selected = !!bundleItems.find(i => i.id === item.id);
                  return (
                    <button key={item.id} onClick={() => selected ? removeFromBundle(item.id) : addToBundle(item)}
                      style={{ display:'flex',alignItems:'center',gap:12,padding:'12px 16px',
                        width:'100%',background:selected?'rgba(245,166,35,.08)':'none',border:'none',
                        borderBottom:'1px solid var(--navy-light)',cursor:'pointer',textAlign:'left' }}>
                      <div style={{ width:22,height:22,borderRadius:'50%',flexShrink:0,
                        background:selected?'var(--gold)':'transparent',
                        border:`2px solid ${selected?'var(--gold)':'var(--grey)'}`,
                        display:'flex',alignItems:'center',justifyContent:'center',
                        fontSize:'.75rem',color:'var(--navy)',fontWeight:700 }}>
                        {selected && '✓'}
                      </div>
                      <div>
                        <p style={{ color:'var(--white)',fontWeight:600 }}>{item.name}</p>
                        <p style={{ color:'var(--grey)',fontSize:'.78rem' }}>
                          {item.grade||item.condition} · Cost: A${(item.costBasis||0).toFixed(2)}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="page">
        <div className="page-header">
          <h2>Select Item</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowInvPick(false)}>Cancel</button>
        </div>
        <div className="page-body">
          {inv.length === 0 ? (
            <p style={{ color:'var(--grey)',textAlign:'center',padding:'40px 0' }}>No available inventory</p>
          ) : (
            <div className="card" style={{ padding:0 }}>
              {inv.map(item => (
                <button key={item.id} onClick={() => {
                  setSelInvItem(item); setItemName(item.name);
                  setItemSet(item.set||''); setItemGrade(item.grade||'');
                  setCostBasis(String(item.costBasis||''));
                  setShowInvPick(false);
                }} style={{ display:'flex',alignItems:'center',gap:12,padding:'12px 16px',
                  width:'100%',background:'none',border:'none',
                  borderBottom:'1px solid var(--navy-light)',cursor:'pointer',textAlign:'left' }}>
                  <div>
                    <p style={{ color:'var(--white)',fontWeight:600 }}>{item.name}</p>
                    <p style={{ color:'var(--grey)',fontSize:'.78rem' }}>
                      {item.grade||item.condition} · Cost: A${(item.costBasis||0).toFixed(2)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Main form ──────────────────────────────────────────────────────────
  const txLabel = TX_TYPES.find(t => t.id === txType)?.label || '';

  return (
    <div className="page" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {showCamera && <CameraScanner onResult={handleScan} onClose={() => setShowCamera(false)} itemType={itemType} />}
      {showOffer && (
        <OfferScreen itemName={itemName} refPrice={ref||null} cashPct={cashPct} tradePct={tradePct}
          onAcceptCash={() => { setShowOffer(false); showToast('Cash offer accepted', 'success'); }}
          onAcceptTrade={() => { setShowOffer(false); showToast('Trade offer accepted', 'success'); }}
          onDecline={() => setShowOffer(false)} />
      )}

      <div className="page-header">
        <div>
          <p style={{ color:'var(--grey)',fontSize:'.75rem',textTransform:'uppercase' }}>{txLabel}</p>
          <h2>Transaction Details</h2>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => { setStep('type'); setPage('transaction-type'); }}>← Back</button>
      </div>

      <div className="page-body">

        {/* ── Item ── */}
        <div className="card" style={{ marginBottom:14 }}>
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12 }}>
            <p className="section-label" style={{ margin:0 }}>
              {txType === 'buy'       ? 'Card Being Bought'
             : txType === 'trade_out' ? 'Item Traded Away (Optional)'
             : 'Item Being Sold / Traded'}
            </p>
            <div style={{ display:'flex',gap:8 }}>
              {showInvSelector && !bundleMode && (
                <button className="btn btn-secondary btn-sm" onClick={() => setShowInvPick(true)}>📋 Inventory</button>
              )}
              {isOnline && !bundleMode && (
                <button className="btn btn-secondary btn-sm" onClick={() => setShowCamera(true)}>📷 Scan</button>
              )}
            </div>
          </div>

          {/* Bundle / Single toggle */}
          {showInvSelector && (
            <div style={{ display:'flex',gap:8,marginBottom:12 }}>
              <button className={`btn btn-sm${!bundleMode?' btn-primary':' btn-secondary'}`} style={{ flex:1 }}
                onClick={() => { setBundleMode(false); setBundleItems([]); setBundleName(''); }}>
                Single Item
              </button>
              <button className={`btn btn-sm${bundleMode?' btn-primary':' btn-secondary'}`} style={{ flex:1 }}
                onClick={() => { setBundleMode(true); setSelInvItem(null); setCostBasis(''); }}>
                📦 Bundle
              </button>
            </div>
          )}

          {/* Bundle UI */}
          {bundleMode ? (
            <>
              <div className="field" style={{ marginBottom:10 }}>
                <label>Bundle Name</label>
                <input value={bundleName} onChange={e => setBundleName(e.target.value)}
                  placeholder={`Bundle x${bundleItems.length || 0} cards`} />
              </div>
              {bundleItems.length === 0 ? (
                <p style={{ color:'var(--grey)',fontSize:'.82rem',textAlign:'center',padding:'8px 0' }}>
                  Tap + Add Cards to select inventory items
                </p>
              ) : (
                <div style={{ marginBottom:10 }}>
                  {bundleItems.map(item => (
                    <div key={item.id} style={{ display:'flex',justifyContent:'space-between',
                      alignItems:'center',padding:'7px 0',borderBottom:'1px solid var(--navy-light)' }}>
                      <div>
                        <p style={{ fontSize:'.9rem',fontWeight:600 }}>{item.name}</p>
                        <p style={{ color:'var(--grey)',fontSize:'.75rem' }}>Cost: A${(item.costBasis||0).toFixed(2)}</p>
                      </div>
                      <button onClick={() => removeFromBundle(item.id)}
                        style={{ background:'none',border:'none',color:'var(--rose)',cursor:'pointer',padding:'4px 8px' }}>✕</button>
                    </div>
                  ))}
                  <div style={{ display:'flex',justifyContent:'space-between',paddingTop:8 }}>
                    <p style={{ color:'var(--grey)',fontSize:'.82rem' }}>Combined Cost Basis</p>
                    <p style={{ color:'var(--gold)',fontWeight:700,fontSize:'.9rem' }}>A${bundleCost.toFixed(2)}</p>
                  </div>
                </div>
              )}
              <button className="btn btn-secondary btn-full" onClick={() => setShowInvPick(true)}
                style={{ fontSize:'.85rem',minHeight:42 }}>
                + Add Cards from Inventory
              </button>
            </>
          ) : (
            <>
              {ebayData && (
                <div style={{ background:'rgba(5,150,105,.1)',border:'1px solid var(--emerald)',
                  borderRadius:'var(--radius-sm)',padding:'8px 12px',marginBottom:12,
                  fontSize:'.8rem',color:'#34D399' }}>
                  ✅ eBay AU: A${parseFloat(refPrice).toFixed(2)} median · {ebayData.count} listings
                </div>
              )}
              {selInvItem && (
                <div style={{ background:'rgba(245,166,35,.1)',border:'1px solid var(--gold)',
                  borderRadius:'var(--radius-sm)',padding:'8px 12px',marginBottom:12,
                  fontSize:'.8rem',color:'var(--gold)',display:'flex',justifyContent:'space-between' }}>
                  <span>📋 From inventory · cost A${(selInvItem.costBasis||0).toFixed(2)}</span>
                  <button onClick={() => { setSelInvItem(null); setCostBasis(''); }}
                    style={{ background:'none',border:'none',color:'var(--grey)',cursor:'pointer' }}>✕</button>
                </div>
              )}
              <div className="field" style={{ marginBottom:10 }}>
                <label>{txType === 'trade_out' ? 'Card / Product Name (optional)' : 'Card / Product Name'}</label>
                <input value={itemName} onChange={e => setItemName(e.target.value)} placeholder="e.g. Charizard ex" />
              </div>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10 }}>
                <div className="field" style={{ margin:0 }}>
                  <label>Set</label>
                  <input value={itemSet} onChange={e => setItemSet(e.target.value)} placeholder="e.g. Scarlet & Violet" />
                </div>
                <div className="field" style={{ margin:0 }}>
                  <label>Category</label>
                  <select value={itemType} onChange={e => setItemType(e.target.value)}>
                    <option value="single">Single</option>
                    <option value="slab">Slab</option>
                    <option value="sealed">Sealed</option>
                  </select>
                </div>
              </div>
              {itemType === 'slab' && (
                <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:10 }}>
                  <div className="field" style={{ margin:0 }}>
                    <label>Grader</label>
                    <select value={itemGrade.split(' ')[0]||''}
                      onChange={e => setItemGrade(`${e.target.value} ${itemGrade.split(' ')[1]||''}`.trim())}>
                      <option value="">Select</option>
                      {GRADERS.map(g => <option key={g}>{g}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ margin:0 }}>
                    <label>Grade</label>
                    <select value={itemGrade.split(' ')[1]||''}
                      onChange={e => setItemGrade(`${itemGrade.split(' ')[0]||''} ${e.target.value}`.trim())}>
                      <option value="">Select</option>
                      {GRADES.map(g => <option key={g}>{g}</option>)}
                    </select>
                  </div>
                </div>
              )}
              {itemType === 'single' && txType !== 'trade_out' && (
                <div className="field" style={{ marginTop:10,marginBottom:0 }}>
                  <label>Condition</label>
                  <select value={itemCond} onChange={e => setItemCond(e.target.value)}>
                    {CONDITIONS.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              )}
              {isOnline && (
                <button className="btn btn-secondary btn-full" onClick={lookupEbay} disabled={loading||!itemName}
                  style={{ marginTop:12,fontSize:'.85rem',minHeight:42 }}>
                  {loading ? '🔍 Searching eBay AU...' : '🔍 Look up eBay AU price'}
                </button>
              )}
            </>
          )}
        </div>

        {/* ── Reference price + offer wheels ── */}
        <div className="card" style={{ marginBottom:14 }}>
          <div className="field" style={{ marginBottom: showWheels ? 14 : 0 }}>
            <label>Reference Price (A$)</label>
            <input type="number" inputMode="decimal" value={refPrice}
              onChange={e => setRefPrice(e.target.value)}
              placeholder="Enter or auto-fill from eBay"
              style={{ fontSize:'1.2rem',fontWeight:700,textAlign:'center' }} />
          </div>
          {showWheels && (
            txType === 'buy' && !showOfferCalc ? (
              <button className="btn btn-secondary btn-full" onClick={() => setShowOfferCalc(true)}
                style={{ fontSize:'.85rem' }}>
                % Calculate offer from market value
              </button>
            ) : (
              <>
                <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:16 }}>
                  <ScrollWheel label="Cash %" value={cashPct} onChange={setCashPct} />
                  <ScrollWheel label="Trade %" value={tradePct} onChange={setTradePct} />
                </div>
                {ref > 0 && (
                  <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:14 }}>
                    <div style={{ background:'rgba(245,166,35,.1)',borderRadius:'var(--radius-sm)',
                      padding:12,textAlign:'center',border:'1px solid rgba(245,166,35,.3)' }}>
                      <p style={{ color:'var(--grey)',fontSize:'.7rem',marginBottom:4 }}>CASH OFFER</p>
                      <p style={{ color:'var(--gold)',fontSize:'1.5rem',fontWeight:700 }}>
                        A${(ref*cashPct/100).toFixed(2)}
                      </p>
                    </div>
                    <div style={{ background:'rgba(0,178,202,.1)',borderRadius:'var(--radius-sm)',
                      padding:12,textAlign:'center',border:'1px solid rgba(0,178,202,.3)' }}>
                      <p style={{ color:'var(--grey)',fontSize:'.7rem',marginBottom:4 }}>TRADE OFFER</p>
                      <p style={{ color:'var(--teal)',fontSize:'1.5rem',fontWeight:700 }}>
                        A${(ref*tradePct/100).toFixed(2)}
                      </p>
                    </div>
                  </div>
                )}
                <button className="btn btn-secondary btn-full" onClick={() => setShowOffer(true)}
                  style={{ marginTop:12,fontSize:'.88rem' }}>
                  👤 Show Offer to Customer
                </button>
              </>
            )
          )}
        </div>

        {/* ── Payment amounts ── */}
        <div className="card" style={{ marginBottom:14 }}>
          <p className="section-label" style={{ marginBottom:12 }}>Payment</p>
          {txType === 'buy' && <>
            <div className="field" style={{ marginBottom:0 }}>
              <label>Offer / Cost (A$)</label>
              <input type="number" inputMode="decimal" value={costBasis}
                onChange={e => setCostBasis(e.target.value)} placeholder="What you're paying"
                style={{ fontSize:'1.1rem',textAlign:'center' }} />
            </div>
            <div className="field" style={{ marginBottom:0,marginTop:10 }}>
              <label>Cash Paid Out (A$)</label>
              <input type="number" inputMode="decimal" value={cashOut}
                onChange={e => setCashOut(e.target.value)} placeholder="0.00"
                style={{ fontSize:'1.1rem',textAlign:'center' }} />
            </div>
          </>}
          {txType === 'sale' && <>
            <div className="field" style={{ marginBottom:0 }}>
              <label>Sale Price (A$)</label>
              <input type="number" inputMode="decimal" value={saleValue}
                onChange={e => setSaleValue(e.target.value)} placeholder="0.00"
                style={{ fontSize:'1.1rem',textAlign:'center' }} />
            </div>
            <div className="field" style={{ marginBottom:0,marginTop:10 }}>
              <label>Cash Received (A$)</label>
              <input type="number" inputMode="decimal" value={cashIn}
                onChange={e => setCashIn(e.target.value)} placeholder="0.00"
                style={{ fontSize:'1.1rem',textAlign:'center' }} />
            </div>
          </>}
          {txType === 'trade_in' && <>
            <div className="field" style={{ marginBottom:0 }}>
              <label>Market Value of Your Card (A$)</label>
              <input type="number" inputMode="decimal" value={saleValue}
                onChange={e => setSaleValue(e.target.value)} placeholder="0.00"
                style={{ fontSize:'1.1rem',textAlign:'center' }} />
            </div>
            <div className="field" style={{ marginBottom:0,marginTop:10 }}>
              <label>Cash Received — Top-up (A$)</label>
              <input type="number" inputMode="decimal" value={cashIn}
                onChange={e => setCashIn(e.target.value)} placeholder="0.00"
                style={{ fontSize:'1.1rem',textAlign:'center' }} />
            </div>
            <div className="field" style={{ marginBottom:0,marginTop:10 }}>
              <label>Total Trade Value Received (A$)</label>
              <input type="number" inputMode="decimal" value={tradeValIn}
                onChange={e => setTradeValIn(e.target.value)} placeholder="0.00"
                style={{ fontSize:'1.1rem',textAlign:'center' }} />
            </div>
          </>}
          {txType === 'trade_even' && <>
            <div className="field" style={{ marginBottom:0 }}>
              <label>Market Value of Your Card (A$)</label>
              <input type="number" inputMode="decimal" value={saleValue}
                onChange={e => setSaleValue(e.target.value)} placeholder="0.00"
                style={{ fontSize:'1.1rem',textAlign:'center' }} />
            </div>
            <div className="field" style={{ marginBottom:0,marginTop:10 }}>
              <label>Total Trade Value Received (A$)</label>
              <input type="number" inputMode="decimal" value={tradeValIn}
                onChange={e => setTradeValIn(e.target.value)} placeholder="0.00"
                style={{ fontSize:'1.1rem',textAlign:'center' }} />
            </div>
          </>}
          {txType === 'trade_out' && <>
            <div className="field" style={{ marginBottom:0 }}>
              <label>Cash Paid Out (A$)</label>
              <input type="number" inputMode="decimal" value={cashOut}
                onChange={e => setCashOut(e.target.value)} placeholder="0.00"
                style={{ fontSize:'1.1rem',textAlign:'center' }} />
            </div>
            <div className="field" style={{ marginBottom:0,marginTop:10 }}>
              <label>Total Trade Value Received (A$)</label>
              <input type="number" inputMode="decimal" value={tradeValIn}
                onChange={e => setTradeValIn(e.target.value)} placeholder="0.00"
                style={{ fontSize:'1.1rem',textAlign:'center' }} />
            </div>
          </>}
        </div>

        {/* ── Cards Received ── */}
        {showCardsRcvd && (
          <div className="card" style={{ marginBottom:14 }}>
            <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12 }}>
              <p className="section-label" style={{ margin:0 }}>Cards Received</p>
              <button className="btn btn-secondary btn-sm" onClick={addTradeIn}>+ Add Card</button>
            </div>
            {tradeIns.length === 0 ? (
              <p style={{ color:'var(--grey)',fontSize:'.82rem',textAlign:'center',padding:'10px 0' }}>
                Tap + Add Card for each card received
              </p>
            ) : tradeIns.map((ti, idx) => (
              <div key={ti.id} style={{ borderTop:'1px solid var(--navy-light)',paddingTop:12,marginTop:12 }}>
                <div style={{ display:'flex',justifyContent:'space-between',marginBottom:8 }}>
                  <p style={{ color:'var(--grey)',fontSize:'.8rem',fontWeight:600 }}>Card {idx+1}</p>
                  <button onClick={() => removeTI(ti.id)}
                    style={{ background:'none',border:'none',color:'var(--rose)',cursor:'pointer',fontSize:'.85rem' }}>
                    Remove
                  </button>
                </div>
                <div className="field" style={{ marginBottom:8 }}>
                  <label>Card Name</label>
                  <input value={ti.name} onChange={e => updateTI(ti.id,'name',e.target.value)}
                    placeholder="e.g. Pikachu ex" />
                </div>
                <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8 }}>
                  <div className="field" style={{ margin:0 }}>
                    <label>Market Value (A$)</label>
                    <input type="number" inputMode="decimal" value={ti.marketValue}
                      onChange={e => updateTI(ti.id,'marketValue',e.target.value)} placeholder="0.00" />
                  </div>
                  <div className="field" style={{ margin:0 }}>
                    <label>Your Offer (A$)</label>
                    <input type="number" inputMode="decimal" value={ti.offerValue}
                      onChange={e => updateTI(ti.id,'offerValue',e.target.value)} placeholder="0.00" />
                  </div>
                </div>
                <div className="field" style={{ marginBottom:0,marginTop:8 }}>
                  <label>Condition / Grade (e.g. Near Mint or PSA 10)</label>
                  <input value={ti.grade||ti.condition}
                    onChange={e => updateTI(ti.id,'grade',e.target.value)}
                    placeholder="Near Mint / PSA 10 / BGS 9.5" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Notes ── */}
        <div className="field" style={{ marginBottom:14 }}>
          <label>Notes (optional)</label>
          <input value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Any notes about this transaction" />
        </div>

        {/* ── Summary ── */}
        <div className="card" style={{ marginBottom:14 }}>
          <p className="section-label" style={{ marginBottom:10 }}>Summary</p>
          {summaryRows.map(([label,value,color]) => (
            <div key={label} style={{ display:'flex',justifyContent:'space-between',marginBottom:8 }}>
              <p style={{ color:'var(--grey)',fontSize:'.9rem' }}>{label}</p>
              <p style={{ color,fontWeight:700,fontSize:'.9rem' }}>{value}</p>
            </div>
          ))}
        </div>

        {/* ── Payment Method ── */}
        <div className="card" style={{ marginBottom:16 }}>
          <p className="section-label" style={{ marginBottom:10 }}>Payment Method</p>
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8 }}>
            {PAY_METHODS.map(m => (
              <button key={m}
                className={`btn btn-sm${payMethod===m?' btn-primary':' btn-secondary'}`}
                onClick={() => setPayMethod(m)}>
                {m}
              </button>
            ))}
          </div>
          <button className={`btn btn-sm btn-full${payMethod==='Split'?' btn-primary':' btn-secondary'}`}
            onClick={() => setPayMethod('Split')}>
            ⚡ Split Payment
          </button>

          {payMethod === 'Card (Square)' && squareAmount > 0 && (
            <button className="btn btn-teal btn-full" onClick={openSquare}
              style={{ marginTop:10 }}>
              🔵 Open Square — A${squareAmount.toFixed(2)}
            </button>
          )}

          {payMethod === 'Split' && (
            <div style={{ marginTop:12 }}>
              {squareAmount > 0 && (
                <p style={{ color:'var(--grey)',fontSize:'.78rem',marginBottom:8,textAlign:'center' }}>
                  Total: A${squareAmount.toFixed(2)}
                </p>
              )}
              <p style={{ color:'var(--grey)',fontSize:'.72rem',marginBottom:6,textTransform:'uppercase',letterSpacing:'.05em' }}>Method 1</p>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8 }}>
                {PAY_METHODS.map(m => (
                  <button key={m}
                    className={`btn btn-sm${splitMethod1===m?' btn-primary':' btn-secondary'}`}
                    onClick={() => { setSplitMethod1(m); if (m === splitMethod2) setSplitMethod2(PAY_METHODS.find(x => x !== m)); }}>
                    {m}
                  </button>
                ))}
              </div>
              <div className="field" style={{ marginBottom:10 }}>
                <label>Amount via {splitMethod1} (A$)</label>
                <input type="number" inputMode="decimal" value={splitAmount1}
                  onChange={e => setSplitAmount1(e.target.value)} placeholder="0.00"
                  style={{ textAlign:'center' }} />
              </div>
              <p style={{ color:'var(--grey)',fontSize:'.72rem',marginBottom:6,textTransform:'uppercase',letterSpacing:'.05em' }}>Method 2</p>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8 }}>
                {PAY_METHODS.filter(m => m !== splitMethod1).map(m => (
                  <button key={m}
                    className={`btn btn-sm${splitMethod2===m?' btn-primary':' btn-secondary'}`}
                    onClick={() => setSplitMethod2(m)}>
                    {m}
                  </button>
                ))}
              </div>
              {squareAmount > 0 && (
                <div style={{ textAlign:'center',padding:'8px 12px',background:'rgba(245,166,35,.08)',
                  borderRadius:'var(--radius-sm)',color:'var(--gold)',fontSize:'.85rem',fontWeight:600 }}>
                  {splitMethod2}: A${Math.max(0, squareAmount - (parseFloat(splitAmount1)||0)).toFixed(2)}
                </div>
              )}
            </div>
          )}
        </div>

        <button className="btn btn-primary btn-full" onClick={complete}
          style={{ minHeight:60,fontSize:'1.1rem',marginBottom:10 }}>
          ✅ Complete Transaction
        </button>
        <div style={{ height:8 }} />
      </div>

      {/* Swipe-up handle */}
      <div style={{ position:'fixed',bottom:0,left:0,right:0,height:20,display:'flex',
        justifyContent:'center',alignItems:'center',pointerEvents:'none',zIndex:50 }}>
        <div style={{ width:36,height:4,borderRadius:2,background:'rgba(255,255,255,0.18)' }} />
      </div>

      {navPeek && <BottomNav page={page} setPage={peekSetPage} />}

      {/* Square confirmation overlay */}
      {squareLaunched && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.82)',
          display:'flex',alignItems:'center',justifyContent:'center',
          padding:24,zIndex:600 }}>
          <div className="card" style={{ width:'100%',maxWidth:340,textAlign:'center',padding:28 }}>
            <p style={{ fontSize:'1.1rem',fontWeight:700,marginBottom:8 }}>💳 Square Payment</p>
            <p style={{ color:'var(--grey)',fontSize:'.9rem',marginBottom:24 }}>
              Did the A${squareAmount.toFixed(2)} payment go through?
            </p>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10 }}>
              <button className="btn btn-ghost"
                onClick={() => { setSquareLaunched(false); setPayMethod('Cash'); }}>
                ✗ No
              </button>
              <button className="btn btn-success"
                onClick={() => { setSquareLaunched(false); complete(); }}>
                ✓ Yes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
