// Token cache — persists for the lifetime of warm function instance
let cachedToken = null;
let tokenExpiry  = 0;

async function getToken(appId, certId) {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const creds = Buffer.from(`${appId}:${certId}`).toString('base64');
  const res   = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });
  if (!res.ok) throw new Error('eBay auth failed');
  const data   = await res.json();
  cachedToken  = data.access_token;
  tokenExpiry  = Date.now() + (data.expires_in - 300) * 1000; // expire 5 min early
  return cachedToken;
}

export default async function handler(req, res) {
  const origin  = req.headers.origin || '';
  const allowed = ['https://vendrpro.vercel.app', 'http://localhost:3000'];
  if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { query } = req.body || {};
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return res.status(400).json({ error: 'Invalid query' });
  }
  // Sanitise query
  const safeQuery = query.trim().substring(0, 100);

  const appId  = process.env.EBAY_APP_ID;
  const certId = process.env.EBAY_CERT_ID;
  if (!appId || !certId) return res.status(500).json({ error: 'eBay not configured' });

  try {
    const token  = await getToken(appId, certId);
    const params = new URLSearchParams({
      q:               `${safeQuery} pokemon tcg`,
      marketplace_ids: 'EBAY_AU',
      limit:           '10',
    });

    const searchRes = await fetch(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
      {
        headers: {
          'Authorization':           `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_AU',
          'Content-Type':            'application/json',
        },
      }
    );

    const data = await searchRes.json();
    if (!searchRes.ok) return res.status(searchRes.status).json({ error: 'eBay search failed' });

    const results = (data.itemSummaries || []).map(item => ({
      id:        item.itemId,
      title:     item.title,
      price:     parseFloat(item.price?.value || 0),
      currency:  item.price?.currency || 'AUD',
      condition: item.condition,
      imageUrl:  item.image?.imageUrl || '',
    }));

    const prices = results.map(r => r.price).filter(p => p > 0).sort((a, b) => a - b);
    const median = prices.length ? prices[Math.floor(prices.length / 2)] : null;
    const lowest = prices.length ? prices[0] : null;
    const avg    = prices.length ? prices.reduce((s, p) => s + p, 0) / prices.length : null;

    return res.status(200).json({ results, median, lowest, avg, count: prices.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
