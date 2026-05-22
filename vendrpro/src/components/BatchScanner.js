import React, { useRef, useState, useContext } from 'react';
import { Ctx } from '../App';
import { identifyCard, compressImage, getEbayPrice } from '../utils/api';
import { getSettings, updateSettings, addTransaction, updateSessionCash, addInventoryItem } from '../utils/storage';
import { ScrollWheel } from './ScrollWheel';

const CONDITIONS = ['Near Mint','Lightly Played','Moderately Played','Heavily Played','Damaged','New/Sealed','Graded'];
const MAX = 10;

export default function BatchScanner({ onClose }) {
  const { showToast, setPage, isOnline } = useContext(Ctx);
  const fileRef = useRef(null);
  const { cashPct } = getSettings();

  const [screen,      setScreen]      = useState('scan');   // 'scan' | 'review'
  const [cards,       setCards]       = useState([]);
  const [processing,  setProcessing]  = useState(false);
  const [pending,     setPending]     = useState(null);
  const [pendingName, setPendingName] = useState('');
  const [offerPct,    setOfferPct]    = useState(cashPct || 80);

  const updateCard = (id, patch) =>
    setCards(p => p.map(c => c.id === id ? { ...c, ...patch } : c));

  // ── Photo capture ─────────────────────────────────────────────────────
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const thumbUrl = await new Promise(r => {
      const fr = new FileReader();
      fr.onload = ev => r(ev.target.result);
      fr.readAsDataURL(file);
    });

    const id = `b_${Date.now()}`;

    if (!isOnline) {
      setPending({ id, thumbUrl, name: '', setName: '', grade: '', itemType: 'single', confidence: 'manual' });
      setPendingName('');
      return;
    }

    setProcessing(true);
    try {
      const compressed = await compressImage(thumbUrl.split(',')[1]);
      const result     = await identifyCard(compressed);
      setPending({ ...result, id, thumbUrl });
      setPendingName(result.name || '');
    } catch (err) {
      setPending({ id, thumbUrl, name: '', setName: '', grade: '', itemType: 'single', confidence: 'low', error: err.message });
      setPendingName('');
    }
    setProcessing(false);
  };

  const confirmPending = () => {
    if (!pending) return;
    setCards(p => [...p, {
      id:          pending.id,
      thumbUrl:    pending.thumbUrl,
      name:        pendingName.trim() || 'Unknown',
      set:         pending.setName  || '',
      grade:       pending.grade    || '',
      condition:   'Near Mint',
      itemType:    pending.itemType || 'single',
      confidence:  pending.confidence,
      marketValue: '',
      offerValue:  '',
      ebayLoading: false,
    }]);
    setPending(null);
    setPendingName('');
  };

  const discardPending = () => { setPending(null); setPendingName(''); };
  const removeCard     = (id) => setCards(p => p.filter(c => c.id !== id));

  // ── eBay per-card ─────────────────────────────────────────────────────
  const lookupEbay = async (id) => {
    const card = cards.find(c => c.id === id);
    if (!card?.name || !isOnline) return;
    updateCard(id, { ebayLoading: true });
    const data = await getEbayPrice(card.name, card.set, card.grade);
    if (data?.median) {
      const mv = data.median.toFixed(2);
      const ov = (data.median * offerPct / 100).toFixed(2);
      updateCard(id, { ebayLoading: false, marketValue: mv, offerValue: ov });
    } else {
      updateCard(id, { ebayLoading: false });
    }
  };

  // ── Global offer % ────────────────────────────────────────────────────
  const changeOfferPct = (pct) => {
    setOfferPct(pct);
    setCards(p => p.map(c => ({
      ...c,
      offerValue: c.marketValue ? (parseFloat(c.marketValue) * pct / 100).toFixed(2) : c.offerValue,
    })));
  };

  const totalOffer = cards.reduce((s, c) => s + (parseFloat(c.offerValue) || 0), 0);

  // ── Complete ──────────────────────────────────────────────────────────
  const completeBatch = () => {
    cards.forEach(card => {
      const cost = parseFloat(card.offerValue) || 0;
      addTransaction({
        type: 'buy', itemName: card.name, itemSet: card.set,
        itemGrade: card.grade, itemType: card.itemType,
        costOfGoods: cost, revenue: 0, cashReceived: 0, cashPaid: cost,
        tradeValueIn: 0, salePrice: 0, refPrice: parseFloat(card.marketValue) || 0,
        cashPct: offerPct, tradePct: offerPct, notes: 'Batch buy', tradeIns: [],
      });
      addInventoryItem({
        name: card.name, set: card.set, grade: card.grade,
        condition: card.grade ? 'Graded' : card.condition,
        costBasis: parseFloat(card.offerValue) || 0,
        marketValue: parseFloat(card.marketValue) || 0,
        itemType: card.itemType,
      });
    });
    if (totalOffer > 0) updateSessionCash(0, totalOffer);
    updateSettings({ cashPct: offerPct });
    showToast(`${cards.length} card${cards.length !== 1 ? 's' : ''} logged!`, 'success');
    setPage('dashboard');
  };

  // ════════════════════════════════════════════════════════════════════
  // REVIEW SCREEN
  // ════════════════════════════════════════════════════════════════════
  if (screen === 'review') return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div className="page-header">
        <button className="btn btn-ghost btn-sm" onClick={() => setScreen('scan')}>← Back</button>
        <div style={{ textAlign: 'center' }}>
          <h2>Review Batch</h2>
          <p style={{ color: 'var(--grey)', fontSize: '.72rem' }}>
            {cards.length} card{cards.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div style={{ width: 60 }} />
      </div>

      <div className="page-body">
        {/* Global offer wheel */}
        <div className="card" style={{ marginBottom: 16 }}>
          <ScrollWheel label="Offer %" value={offerPct} onChange={changeOfferPct} />
          <p style={{ color: 'var(--grey)', fontSize: '.74rem', textAlign: 'center', marginTop: 8 }}>
            Applies to all cards — updates prices automatically
          </p>
        </div>

        {/* Per-card editors */}
        {cards.map((card, idx) => (
          <div key={card.id} className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {card.thumbUrl && (
                  <img src={card.thumbUrl} alt=""
                    style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                )}
                <span className="section-label" style={{ margin: 0 }}>Card {idx + 1}</span>
              </div>
              <button onClick={() => removeCard(card.id)}
                style={{ background: 'none', border: 'none', color: 'var(--rose)', cursor: 'pointer', fontSize: '.85rem' }}>
                Remove
              </button>
            </div>

            <div className="field" style={{ marginBottom: 8 }}>
              <label>Name</label>
              <input value={card.name}
                onChange={e => updateCard(card.id, { name: e.target.value })}
                placeholder="Card name" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Set</label>
                <input value={card.set}
                  onChange={e => updateCard(card.id, { set: e.target.value })}
                  placeholder="e.g. SV" />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Condition</label>
                <select value={card.condition}
                  onChange={e => updateCard(card.id, { condition: e.target.value })}>
                  {CONDITIONS.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: 1, margin: 0 }}>
                <label>Market Value (A$)</label>
                <input type="number" inputMode="decimal" value={card.marketValue}
                  onChange={e => {
                    const mv = e.target.value;
                    const ov = mv ? (parseFloat(mv) * offerPct / 100).toFixed(2) : '';
                    updateCard(card.id, { marketValue: mv, offerValue: ov });
                  }}
                  placeholder="0.00" />
              </div>
              {isOnline && (
                <button className="btn btn-secondary btn-sm"
                  onClick={() => lookupEbay(card.id)}
                  disabled={card.ebayLoading || !card.name}
                  style={{ flexShrink: 0, marginBottom: 0 }}>
                  {card.ebayLoading ? '…' : '🔍 eBay'}
                </button>
              )}
            </div>

            {card.marketValue ? (
              <div style={{ marginTop: 10, background: 'rgba(245,166,35,.08)',
                border: '1px solid rgba(245,166,35,.2)', borderRadius: 8,
                padding: '8px 12px', display: 'flex', justifyContent: 'space-between' }}>
                <p style={{ color: 'var(--grey)', fontSize: '.78rem' }}>Offer ({offerPct}%)</p>
                <p style={{ color: 'var(--gold)', fontWeight: 700 }}>
                  A${(parseFloat(card.marketValue) * offerPct / 100).toFixed(2)}
                </p>
              </div>
            ) : null}
          </div>
        ))}

        {/* Summary + complete */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <p style={{ color: 'var(--grey)' }}>Cards in batch</p>
            <p style={{ fontWeight: 700 }}>{cards.length}</p>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <p style={{ color: 'var(--grey)' }}>Total offer</p>
            <p style={{ color: 'var(--gold)', fontWeight: 700, fontSize: '1.2rem' }}>
              {totalOffer > 0 ? `A$${totalOffer.toFixed(2)}` : '—'}
            </p>
          </div>
        </div>

        <button className="btn btn-primary btn-full" onClick={completeBatch}
          disabled={cards.length === 0}
          style={{ minHeight: 60, fontSize: '1.1rem', marginBottom: 10 }}>
          ✅ Complete Batch Buy ({cards.length} card{cards.length !== 1 ? 's' : ''})
        </button>
        <button className="btn btn-ghost btn-full" onClick={onClose}>Cancel</button>
        <div style={{ height: 20 }} />
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════════════
  // SCAN SCREEN
  // ════════════════════════════════════════════════════════════════════
  const canScan = !processing && !pending && cards.length < MAX;

  const pendingBorderColor = !pending ? 'transparent'
    : (!pending.name && pending.confidence !== 'manual') ? 'var(--rose)'
    : (pending.confidence === 'low' || pending.confidence === 'manual') ? 'var(--amber)'
    : 'var(--emerald)';

  const pendingStatusColor = !pending ? ''
    : (!pending.name && pending.confidence !== 'manual') ? 'var(--rose)'
    : (pending.confidence === 'low' || pending.confidence === 'manual') ? 'var(--amber)'
    : '#34D399';

  const pendingStatusText = !pending ? ''
    : pending.confidence === 'manual' ? 'Enter card name'
    : !pending.name ? 'Could not identify — enter name below'
    : pending.confidence === 'low' ? 'Uncertain — please verify'
    : 'Card identified';

  const pendingIcon = !pending ? ''
    : (!pending.name && pending.confidence !== 'manual') ? '❌'
    : (pending.confidence === 'low' || pending.confidence === 'manual') ? '⚠️'
    : '✅';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--navy)', zIndex: 300,
      display: 'flex', flexDirection: 'column',
      paddingTop: 'env(safe-area-inset-top)' }}>

      <input ref={fileRef} type="file" accept="image/*" capture="environment"
        style={{ display: 'none' }} onChange={handleFile} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '12px 16px', borderBottom: '1px solid var(--navy-light)', flexShrink: 0 }}>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>← Cancel</button>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontWeight: 700, fontSize: '1rem' }}>Batch Buy</p>
          <p style={{ color: 'var(--grey)', fontSize: '.72rem' }}>
            {cards.length}/{MAX} scanned
          </p>
        </div>
        {cards.length > 0
          ? <button className="btn btn-secondary btn-sm" onClick={() => setScreen('review')}>Review →</button>
          : <div style={{ width: 72 }} />}
      </div>

      {/* Thumbnail strip */}
      {cards.length > 0 && (
        <div style={{ flexShrink: 0, padding: '10px 16px',
          borderBottom: '1px solid var(--navy-light)', background: 'var(--navy-card)' }}>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
            {cards.map((c, i) => (
              <div key={c.id} style={{ flexShrink: 0, textAlign: 'center' }}>
                <div style={{ width: 52, height: 52, borderRadius: 6, overflow: 'hidden',
                  border: '2px solid var(--navy-light)', background: 'var(--navy-light)' }}>
                  {c.thumbUrl
                    ? <img src={c.thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: '.7rem', color: 'var(--grey)' }}>{i + 1}</div>
                  }
                </div>
                <p style={{ fontSize: '.58rem', color: 'var(--grey)', marginTop: 2,
                  width: 52, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {c.name || '?'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px',
        display: 'flex', flexDirection: 'column' }}>

        {/* Empty state */}
        {cards.length === 0 && !processing && !pending && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 10, color: 'var(--grey)', textAlign: 'center' }}>
            <p style={{ fontSize: '2.5rem' }}>📦</p>
            <p style={{ fontWeight: 600, color: 'var(--white)' }}>No cards scanned yet</p>
            <p style={{ fontSize: '.82rem' }}>
              Tap the button below to photograph cards one by one
            </p>
          </div>
        )}

        {/* Processing spinner */}
        {processing && (
          <div style={{ display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 16, padding: '40px 0' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%',
              border: '4px solid var(--gold)', borderTopColor: 'transparent',
              animation: 'spin 1s linear infinite' }} />
            <p style={{ color: 'var(--gold)', fontWeight: 600 }}>🔍 Identifying card...</p>
          </div>
        )}

        {/* Pending result */}
        {pending && (
          <div className="card" style={{ border: `1px solid ${pendingBorderColor}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: '1.1rem' }}>{pendingIcon}</span>
              <p style={{ fontWeight: 600, fontSize: '.85rem', color: pendingStatusColor }}>
                {pendingStatusText}
              </p>
            </div>

            {pending.thumbUrl && (
              <img src={pending.thumbUrl} alt=""
                style={{ width: '100%', height: 130, objectFit: 'cover', borderRadius: 8, marginBottom: 12 }} />
            )}

            <div className="field" style={{ marginBottom: 12 }}>
              <label>Card Name</label>
              <input value={pendingName} onChange={e => setPendingName(e.target.value)}
                placeholder="e.g. Charizard ex" autoFocus />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button className="btn btn-primary" onClick={confirmPending}>✓ Add</button>
              <button className="btn btn-ghost" onClick={discardPending}>✕ Discard</button>
            </div>
          </div>
        )}

        <div style={{ flex: 1 }} />
      </div>

      {/* Bottom action bar */}
      <div style={{ flexShrink: 0, background: 'var(--navy-card)',
        borderTop: '1px solid var(--navy-light)',
        padding: '12px 16px',
        paddingBottom: 'max(14px,env(safe-area-inset-bottom))' }}>

        {cards.length > 0 && !pending && (
          <div style={{ display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', marginBottom: 10 }}>
            <p style={{ color: 'var(--grey)', fontSize: '.82rem' }}>
              {cards.length} card{cards.length !== 1 ? 's' : ''} ready
            </p>
            <button className="btn btn-secondary btn-sm" onClick={() => setScreen('review')}>
              Review & Price →
            </button>
          </div>
        )}

        {cards.length < MAX ? (
          <button className="btn btn-primary btn-full"
            onClick={() => fileRef.current?.click()}
            disabled={!canScan}
            style={{ minHeight: 56 }}>
            {processing ? '🔍 Identifying...'
              : `📷 Take Photo${cards.length > 0 ? ` (${cards.length}/${MAX})` : ''}`}
          </button>
        ) : (
          <button className="btn btn-success btn-full"
            onClick={() => setScreen('review')}
            style={{ minHeight: 56 }}>
            ✅ Review {MAX} Cards →
          </button>
        )}
      </div>
    </div>
  );
}
