// Vercel serverless function for The Crash Factory parts store
// Stores a part photo in Vercel Blob and returns a public URL, so photos are
// no longer crammed into the browser's localStorage (which capped out ~5MB
// and silently dropped pictures).
//
// POST /api/upload   body: { password, dataUrl }   -> { url }
//   dataUrl is a base64 data URI, e.g. "data:image/jpeg;base64,...."
//
// REQUIRED ENVIRONMENT VARIABLES:
//   BLOB_READ_WRITE_TOKEN  - auto-added when you connect a Vercel Blob store
//   ADMIN_TOKEN            - password the parts page must send (defaults to 'crashfactory2026')

import { put } from '@vercel/blob';

const allowedOrigins = [
  'https://thecrashfactory.com',
  'https://www.thecrashfactory.com',
  'https://kingcdk1.github.io'
];

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'Storage not configured: connect a Vercel Blob store so BLOB_READ_WRITE_TOKEN is set.' });
  }

  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : JSON.parse(req.body || '{}');
    const adminToken = process.env.ADMIN_TOKEN || 'crashfactory2026';

    if (body.password !== adminToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const dataUrl = body.dataUrl || '';
    const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!m) {
      return res.status(400).json({ error: 'Invalid image data' });
    }

    const contentType = m[1];
    const buffer = Buffer.from(m[2], 'base64');
    const ext = contentType.split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const name = 'photos/part-' + Date.now() + '-' + Math.round(Math.random() * 1e6) + '.' + ext;

    const blob = await put(name, buffer, {
      access: 'public',
      contentType,
      token
    });

    return res.status(200).json({ url: blob.url });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
