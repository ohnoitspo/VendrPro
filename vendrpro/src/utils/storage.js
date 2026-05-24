// ── Keys ──────────────────────────────────────────────────────────────
const K = {
  SESSION:      'vp_session',
  INVENTORY:    'vp_inventory',
  TRANSACTIONS: 'vp_transactions',
  SETTINGS:     'vp_settings',
  PIN:          'vp_pin',
};

// ── Helpers ───────────────────────────────────────────────────────────
const ls = {
  get:    (key, fb = null) => { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fb; } catch { return fb; } },
  set:    (key, val)       => { try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; } },
  remove: (key)            => { try { localStorage.removeItem(key); } catch {} },
};

// ── PIN ───────────────────────────────────────────────────────────────
export const getPin      = ()    => ls.get(K.PIN, null);
export const setPin      = (pin) => ls.set(K.PIN, pin);
export const hasPin      = ()    => !!ls.get(K.PIN, null);
export const checkPin    = (pin) => ls.get(K.PIN, null) === pin;
export const removePin   = ()    => ls.remove(K.PIN);

// ── Settings ──────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  cashPct:       80,
  tradePct:      85,
  lastCondition: 'Near Mint',
  lastCategory:  'single',
  theme:         'dark',
};
export const getSettings    = ()       => ls.get(K.SETTINGS, DEFAULT_SETTINGS);
export const updateSettings = (patch)  => { const s = { ...getSettings(), ...patch }; ls.set(K.SETTINGS, s); return s; };

// ── Session ───────────────────────────────────────────────────────────
export const getSession = () => ls.get(K.SESSION, null);

export const startSession = (startingFloat, { showName = '', showDate = '', showLocation = '' } = {}) => {
  const s = {
    id:            Date.now().toString(),
    startedAt:     new Date().toISOString(),
    startingFloat: parseFloat(startingFloat) || 0,
    cashIn:        0,
    cashOut:       0,
    active:        true,
    showName,
    showDate,
    showLocation,
  };
  ls.set(K.SESSION, s);
  return s;
};

export const updateSessionCash = (cashIn = 0, cashOut = 0) => {
  const s = getSession();
  if (!s) return null;
  s.cashIn  += cashIn;
  s.cashOut += cashOut;
  ls.set(K.SESSION, s);
  return s;
};

export const endSession  = ()  => { const s = getSession(); if (s) { s.active = false; s.endedAt = new Date().toISOString(); ls.set(K.SESSION, s); } return s; };
export const clearSession = () => { ls.remove(K.SESSION); ls.remove(K.INVENTORY); ls.remove(K.TRANSACTIONS); };
export const getCurrentFloat = () => { const s = getSession(); return s ? s.startingFloat + s.cashIn - s.cashOut : 0; };

// ── Inventory ─────────────────────────────────────────────────────────
export const getInventory = () => ls.get(K.INVENTORY, []);

export const addInventoryItem = (item) => {
  const inv  = getInventory();
  const newItem = {
    ...item,
    id:      item.id || `inv_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,
    addedAt: new Date().toISOString(),
    status:  item.status || 'available',
    source:  item.source || 'acquired',
  };
  inv.push(newItem);
  ls.set(K.INVENTORY, inv);
  return newItem;
};

export const updateInventoryItem = (id, patch) => {
  const inv = getInventory().map(i => i.id === id ? { ...i, ...patch } : i);
  ls.set(K.INVENTORY, inv);
};

export const markItemSold   = (id, txId, salePrice) => updateInventoryItem(id, { status: 'sold',   soldAt:   new Date().toISOString(), txId, salePrice });
export const markItemTraded = (id, txId)             => updateInventoryItem(id, { status: 'traded', tradedAt: new Date().toISOString(), txId });

export const getAvailableInventory = () => getInventory().filter(i => i.status === 'available');

export const importFromCollectr = (items) => {
  const existing = getInventory().filter(i => i.source !== 'imported');
  const imported = items.map(item => ({
    ...item,
    id:      `imp_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,
    addedAt: new Date().toISOString(),
    status:  'available',
    source:  'imported',
  }));
  ls.set(K.INVENTORY, [...existing, ...imported]);
  return imported.length;
};

// ── Transactions ──────────────────────────────────────────────────────
export const getTransactions = () => ls.get(K.TRANSACTIONS, []);

export const addTransaction = (tx) => {
  const txns  = getTransactions();
  const newTx = { ...tx, id: `tx_${Date.now()}_${Math.random().toString(36).substr(2,5)}`, createdAt: new Date().toISOString() };
  txns.push(newTx);
  ls.set(K.TRANSACTIONS, txns);
  return newTx;
};

// ── EOD ───────────────────────────────────────────────────────────────
export const getEODSummary = () => {
  const session      = getSession();
  const inventory    = getInventory();
  const transactions = getTransactions();
  const soldItems    = inventory.filter(i => i.status === 'sold');
  const tradedItems  = inventory.filter(i => i.status === 'traded');
  const acquiredUnsold = inventory.filter(i => i.source === 'acquired' && i.status === 'available');
  const totalRevenue = transactions.reduce((s, tx) => s + (tx.revenue || 0), 0);
  const totalCost    = transactions.reduce((s, tx) => s + (tx.costOfGoods || 0), 0);
  const grossProfit  = totalRevenue - totalCost;
  return {
    session, transactions, inventory,
    soldItems, tradedItems, acquiredUnsold,
    totalRevenue, totalCost, grossProfit,
    cashIn:       session?.cashIn  || 0,
    cashOut:      session?.cashOut || 0,
    currentFloat: getCurrentFloat(),
    txCount:      transactions.length,
  };
};

// ── CSV Export ────────────────────────────────────────────────────────
export const exportCSV = () => {
  const { session, transactions, soldItems, tradedItems, acquiredUnsold, inventory } = getEODSummary();
  const fallbackDate = new Date().toLocaleDateString('en-AU').replace(/\//g, '-');

  const showName     = session?.showName     || '';
  const showDate     = session?.showDate     || fallbackDate;
  const showLocation = session?.showLocation || '';
  const showFloat    = (session?.startingFloat || 0).toFixed(2);

  const slug = (s) => s.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  const namePart = slug(showName) || 'Show';
  const datePart = slug(showDate) || fallbackDate;

  const q     = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const toCSV = (headers, rows) =>
    [headers, ...rows].map(r => r.map(c => q(c)).join(',')).join('\n');

  const preamble = [
    `${q('Show Name')},${q(showName)}`,
    `${q('Date')},${q(showDate)}`,
    `${q('Location')},${q(showLocation)}`,
    `${q('Starting Float')},${q('A$' + showFloat)}`,
    '',
  ].join('\n');

  const txBody = toCSV(
    ['Date','Time','Type','Item','Cost Basis (A$)','Revenue (A$)','Cash In (A$)','Cash Out (A$)','Trade Value In (A$)','Net Cash (A$)','Gross Profit (A$)','Notes'],
    transactions.map(tx => [
      showDate,
      new Date(tx.createdAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }),
      tx.type, tx.itemName || '',
      tx.costOfGoods || 0, tx.revenue || 0,
      tx.cashReceived || 0, tx.cashPaid || 0, tx.tradeValueIn || 0,
      (tx.cashReceived || 0) - (tx.cashPaid || 0),
      (tx.revenue || 0) - (tx.costOfGoods || 0),
      tx.notes || '',
    ])
  );

  const txCSV = preamble + txBody;

  const rows = [];
  soldItems.filter(i => i.source === 'imported').forEach(i =>
    rows.push(['🔴 REMOVE', i.name, i.grade || i.condition, i.costBasis || 0, i.salePrice || '', 'Sold']));
  tradedItems.filter(i => i.source === 'imported').forEach(i =>
    rows.push(['🔴 REMOVE', i.name, i.grade || i.condition, i.costBasis || 0, '', 'Traded away']));
  acquiredUnsold.forEach(i =>
    rows.push(['🟢 ADD', i.name, i.grade || i.condition, i.costBasis || 0, '', 'Acquired at show']));
  inventory.filter(i => i.source === 'imported' && i.status === 'available').forEach(i =>
    rows.push(['⚪ NO CHANGE', i.name, i.grade || i.condition, i.costBasis || 0, '', '']));

  const collectrCSV = toCSV(
    ['Action','Item','Grade/Condition','Your Cost (A$)','Sale Price (A$)','Notes'],
    rows
  );

  return {
    txCSV,
    collectrCSV,
    txFilename:       `${namePart}_${datePart}_transactions.csv`,
    collectrFilename: `${namePart}_${datePart}_collectr.csv`,
  };
};

export const downloadCSV = (content, filename) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

// ── Collectr CSV Parser ───────────────────────────────────────────────
export const parseCollectrCSV = (text) => {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);

  const idx = (name) => {
    const exact = headers.indexOf(name);
    if (exact !== -1) return exact;
    return headers.findIndex(h => h.startsWith(name));
  };

  const cols = {
    portfolio: idx('Portfolio Name'),
    set:       idx('Set'),
    name:      idx('Product Name'),
    cardNum:   idx('Card Number'),
    rarity:    idx('Rarity'),
    grade:     idx('Grade'),
    condition: idx('Card Condition'),
    cost:      idx('Average Cost Paid'),
    qty:       idx('Quantity'),
    market:    idx('Market Price'),
    date:      idx('Date Added'),
  };

  return lines.slice(1).map(line => {
    const c        = parseCSVLine(line);
    const gradeRaw = c[cols.grade] || '';
    const cardNum  = c[cols.cardNum] || '';
    const costRaw  = parseFloat(c[cols.cost]) || 0;
    const mktRaw   = parseFloat(c[cols.market]) || 0;

    let itemType = 'single';
    if (gradeRaw && gradeRaw !== 'Ungraded') itemType = 'slab';
    else if (!cardNum)                        itemType = 'sealed';

    let grade = '';
    if (itemType === 'slab') {
      const m = gradeRaw.match(/(PSA|BGS|CGC|TAG)\s+(\d+\.?\d*)/i);
      grade   = m ? `${m[1].toUpperCase()} ${parseFloat(m[2])}` : gradeRaw;
    }

    return {
      portfolio:   c[cols.portfolio] || '',
      set:         c[cols.set]       || '',
      name:        c[cols.name]      || '',
      cardNumber:  cardNum,
      grade,
      condition:   c[cols.condition] || 'Near Mint',
      costBasis:   costRaw,
      quantity:    parseInt(c[cols.qty]) || 1,
      marketPrice: mktRaw,
      itemType,
      uncosted:    costRaw === 0,
    };
  }).filter(i => i.name);
};

const parseCSVLine = (line) => {
  const result = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  result.push(cur.trim());
  return result;
};
