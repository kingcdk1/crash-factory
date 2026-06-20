// Vercel serverless function for The Crash Factory parts store
// Shared parts catalog so every customer sees the same inventory (fixes the
// old localStorage bug where parts only showed on the admin's own device).
//
// GET  /api/parts            -> { parts: [...] }   (public, read-only)
// POST /api/parts            -> { success:true }   (admin only, replaces catalog)
//        body: { password, parts: [...] }
//
// REQUIRED ENVIRONMENT VARIABLES (set in Vercel project settings):
//   BLOB_READ_WRITE_TOKEN  - auto-added when you connect a Vercel Blob store
//   ADMIN_TOKEN            - password the parts page must send to write
//                           (defaults to 'crashfactory2026' to match the site)

import { put, list } from '@vercel/blob';

const BLOB_KEY = 'parts.json';

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'Storage not configured: connect a Vercel Blob store so BLOB_READ_WRITE_TOKEN is set.' });
  }

  // ---- READ (public) ----
  if (req.method === 'GET') {
    try {
      const { blobs } = await list({ prefix: BLOB_KEY, token });
      const found = blobs.find(b => b.pathname === BLOB_KEY);
      if (!found) {
        return res.status(200).json({ parts: [] });
      }
      // Cache-bust so an overwrite is read immediately, not from the CDN edge.
      const r = await fetch(found.url + '?t=' + Date.now(), { cache: 'no-store' });
      const parts = await r.json();
      return res.status(200).json({ parts: Array.isArray(parts) ? parts : [] });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ---- WRITE (admin) ----
  if (req.method === 'POST') {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : JSON.parse(req.body || '{}');
      const adminToken = process.env.ADMIN_TOKEN || 'crashfactory2026';

      if (body.password !== adminToken) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      if (!Array.isArray(body.parts)) {
        return res.status(400).json({ error: 'parts must be an array' });
      }

      await put(BLOB_KEY, JSON.stringify(body.parts), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 0,
        token
      });

      return res.status(200).json({ success: true, count: body.parts.length });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
