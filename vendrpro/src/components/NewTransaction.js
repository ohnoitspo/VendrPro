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

const CONDITIONS = ['Near Mint','Lightly Played','Moderately Played','Heavily Played','Damaged','New/Sealed','Graded'];
const GRADERS    = ['PSA','BGS','CGC','TAG'];
const GRADES     = ['10','9.5','9','8.5','8','7','6','5','4','3','2','1'];
const TX_TYPES   = [
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

  // Item being sold/traded away
  const [itemName,    setItemName]   = useState('');
  const [itemSet,     setItemSet]    = useState('');
  const [itemGrade,   setItemGrade]  = useState('');
  const [itemCond,    setItemCond]   = useState(s.lastCondition || 'Near Mint');
  const [itemType,    setItemType]   = useState('single');
  const [costBasis,   setCostBasis]  = useState('');
  const [saleValue,   setSaleValue]  = useState('');

  // Price reference + offer %
  const [refPrice,    setRefPrice]   = useState('');
  const [cashPct,     setCashPct]    = useState(s.cashPct  || 80);
  const [tradePct,    setTradePct]   = useState(s.tradePct || 85);
  const [ebayData,    setEbayData]   = useState(null);

  // Payment
  const [cashIn,      setCashIn]     = useState('');
  const [cashOut,     setCashOut]    = useState('');
  const [tradeValIn,  setTradeValIn] = useState('');

  // Trade-in cards received
  const [tradeIns,    setTradeIns]   = useState([]);
  const [notes,       setNotes]      = useState('');
  const [loading,     setLoading]    = useState(false);

  // Selected inventory item (for sales/trades)
  const [selInvItem,  setSelInvItem] = useState(null);
  const [showInvPick, setShowInvPick]= useState(false);

  const [showOfferCalc, setShowOfferCalc] = useState(false);

  // Swipe-up peek nav (form step only)
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

  const ref  = parseFloat(refPrice)   || 0;
  const cash = parseFloat(cashIn)     || 0;
  const paid = parseFloat(cashOut)    || 0;
  const tval = parseFloat(tradeValIn) || 0;
  const sale = parseFloat(saleValue)  || 0;
  const cost = parseFloat(costBasis)  || selInvItem?.costBasis || 0;

  const revenue  = txType === 'buy'        ? 0
                 : txType === 'sale'       ? sale
                 : txType === 'trade_in'   ? sale + cash
                 : txType === 'trade_even' ? sale
                 : sale; // trade_out
  const netCash  = cash - paid;
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

  // ── Camera ────────────────────────────────────────────────────────
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

  // ── eBay lookup ───────────────────────────────────────────────────
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

  // ── Trade-in management ───────────────────────────────────────────
  const addTradeIn = () => setTradeIns(p => [...p, {
    id: `ti_${Date.now()}`, name:'', condition:'Near Mint', grade:'', marketValue:'', offerValue:'',
  }]);
  const updateTI = (id, k, v) => setTradeIns(p => p.map(t => t.id===id ? {...t,[k]:v} : t));
  const removeTI = (id)       => setTradeIns(p => p.filter(t => t.id!==id));

  // ── Complete ──────────────────────────────────────────────────────
  const complete = () => {
    if (!itemName.trim() && txType !== 'buy') { showToast('Enter item name', 'error'); return; }
    if (txType === 'buy' && tradeIns.length === 0 && !itemName) { showToast('Add at least one card received', 'error'); return; }

    const tx = {
      type: txType, itemName: itemName.trim(), itemSet, itemGrade, itemType,
      costOfGoods: cost, revenue, cashReceived: cash, cashPaid: paid,
      tradeValueIn: tval, salePrice: sale, refPrice: ref, cashPct, tradePct, notes, tradeIns,
    };
    const saved = addTransaction(tx);

    // Float update
    if (cash > 0 || paid > 0) updateSessionCash(cash, paid);

    // Add trade-ins to inventory
    tradeIns.forEach(ti => {
      if (ti.name) addInventoryItem({
        name: ti.name, condition: ti.grade || ti.condition,
        grade: ti.grade, costBasis: parseFloat(ti.offerValue) || 0,
        marketValue: parseFloat(ti.marketValue) || 0,
        itemType: ti.grade ? 'slab' : 'single',
      });
    });

    // For pure buy, add main item if entered
    if (txType === 'buy' && itemName) {
      addInventoryItem({ name:itemName, set:itemSet, grade:itemGrade,
        condition:itemCond, costBasis:cost, itemType });
    }

    // Mark inventory item as sold/traded
    if (selInvItem) {
      if (txType === 'sale' || txType === 'trade_in') markItemSold(selInvItem.id, saved.id, sale);
      else markItemTraded(selInvItem.id, saved.id);
    }

    updateSettings({ cashPct, tradePct, lastCondition: itemCond });
    showToast('Transaction logged!', 'success');
    setPage('dashboard');
  };

  // ── Batch scanner overlay ─────────────────────────────────────────
  if (showBatch) return <BatchScanner onClose={() => setShowBatch(false)} />;

  // ── Type selection ────────────────────────────────────────────────
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

  // ── Inventory picker ──────────────────────────────────────────────
  if (showInvPick) {
    const inv = getAvailableInventory();
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

  // ── Main form ─────────────────────────────────────────────────────
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
              {showInvSelector && (
                <button className="btn btn-secondary btn-sm" onClick={() => setShowInvPick(true)}>📋 Inventory</button>
              )}
              {isOnline && (
                <button className="btn btn-secondary btn-sm" onClick={() => setShowCamera(true)}>📷 Scan</button>
              )}
            </div>
          </div>

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

        {/* ── Payment ── */}
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
        <div className="card" style={{ marginBottom:16 }}>
          <p className="section-label" style={{ marginBottom:10 }}>Summary</p>
          {summaryRows.map(([label,value,color]) => (
            <div key={label} style={{ display:'flex',justifyContent:'space-between',marginBottom:8 }}>
              <p style={{ color:'var(--grey)',fontSize:'.9rem' }}>{label}</p>
              <p style={{ color,fontWeight:700,fontSize:'.9rem' }}>{value}</p>
            </div>
          ))}
        </div>

        <button className="btn btn-primary btn-full" onClick={complete}
          style={{ minHeight:60,fontSize:'1.1rem',marginBottom:10 }}>
          ✅ Complete Transaction
        </button>
        <div style={{ height:8 }} />
      </div>

      {/* Swipe-up handle indicator */}
      <div style={{ position:'fixed',bottom:0,left:0,right:0,height:20,display:'flex',
        justifyContent:'center',alignItems:'center',pointerEvents:'none',zIndex:50 }}>
        <div style={{ width:36,height:4,borderRadius:2,background:'rgba(255,255,255,0.18)' }} />
      </div>

      {/* Peek nav — revealed by swipe up near bottom edge */}
      {navPeek && <BottomNav page={page} setPage={peekSetPage} />}
    </div>
  );
}
