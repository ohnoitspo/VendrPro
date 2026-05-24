export default async function handler(req, res) {
  // Only allow from our own domain
  const origin = req.headers.origin || '';
  const allowed = [
    'https://vendrpro.vercel.app',
    'http://localhost:3000',
  ];
  if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { image } = req.body || {};
  if (!image) return res.status(400).json({ error: 'No image provided' });

  // Validate image size — max 4MB base64
  if (image.length > 5_500_000) {
    return res.status(413).json({ error: 'Image too large — max 4MB' });
  }

  const apiKey = process.env.VISION_API_KEY;
  if (!apiKey) {
    console.error('[vision] VISION_API_KEY env var is not set');
    return res.status(500).json({ error: 'Vision API not configured' });
  }
  console.log('[vision] image length:', image.length, 'apiKey present:', !!apiKey);

  try {
    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: image },
            features: [
              { type: 'TEXT_DETECTION', maxResults: 1 },
              { type: 'LABEL_DETECTION', maxResults: 5 },
            ],
          }],
        }),
      }
    );
    const data = await response.json();
    if (!response.ok) {
      console.error('[vision] Google error:', response.status, JSON.stringify(data));
      return res.status(response.status).json({ error: data.error?.message || 'Vision error', details: data.error });
    }
    console.log('[vision] success, responses:', data.responses?.length);
    return res.status(200).json(data);
  } catch (err) {
    console.error('[vision] fetch threw:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
