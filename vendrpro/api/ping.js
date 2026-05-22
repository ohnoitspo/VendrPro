export default function handler(req, res) {
  const origin  = req.headers.origin || '';
  const allowed = ['https://vendrpro.vercel.app', 'http://localhost:3000'];
  if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  return res.status(200).json({ status: 'ok', ts: Date.now() });
}
