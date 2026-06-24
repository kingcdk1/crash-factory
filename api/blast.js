// The Crash Factory - simple text blast via RingCentral.
// Sends ONE message to many numbers. Admin-gated. Logs to Blob. Honors a simple
// opt-out list. Deliberately minimal (no scheduling / inbox / analytics like PCS Blast).
//
// POST /api/blast   body: { message, numbers:[...], appendOptOut?:bool, sentBy?, password? }
//   -> { ok, sent, skipped, failed, results:[...] }
// GET  /api/blast   (admin) -> { log:[...], optout:[...] }    recent sends + opt-out list
//
// ENVIRONMENT VARIABLES (set in Vercel, NEVER hardcode these):
//   RC_CLIENT_ID, RC_CLIENT_SECRET, RC_JWT  - RingCentral app creds for the
//                                             Crash Factory line (JWT auth flow)
//   RC_FROM        - the SMS-capable from number, e.g. +12145096194
//   RC_SERVER      - RingCentral platform URL (default https://platform.ringcentral.com)
//   BLOB_READ_WRITE_TOKEN - already set (logs + opt-out list live in Blob)
//   plus the shared Supabase vars for token auth (already defaulted in code)

import { put, list } from '@vercel/blob';

const allowedOrigins = [
  'https://thecrashfactory.com',
  'https://www.thecrashfactory.com',
  'https://kingcdk1.github.io'
];

const RC_SERVER = process.env.RC_SERVER || 'https://platform.ringcentral.com';
const LOG_KEY = 'blast-log.json';
const OPTOUT_KEY = 'blast-optout.json';

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ---- history (admin) ----
  if (req.method === 'GET') {
    if (!(await isAdminRequest(req, {}))) return res.status(401).json({ error: 'Unauthorized' });
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    const log = token ? await readBlobJson(LOG_KEY, token) : [];
    const optout = token ? await readBlobJson(OPTOUT_KEY, token) : [];
    return res.status(200).json({ log: Array.isArray(log) ? log.slice(0, 50) : [], optout: Array.isArray(optout) ? optout : [] });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : JSON.parse(req.body || '{}');
    if (!(await isAdminRequest(req, body))) return res.status(401).json({ error: 'Unauthorized' });

    const message = (body.message || '').toString().trim();
    if (!message) return res.status(400).json({ error: 'Message is empty' });
    if (!Array.isArray(body.numbers) || !body.numbers.length) return res.status(400).json({ error: 'No recipients' });

    const from = process.env.RC_FROM;
    if (!process.env.RC_CLIENT_ID || !process.env.RC_CLIENT_SECRET || !process.env.RC_JWT || !from) {
      return res.status(500).json({ error: 'Texting not configured yet: set RC_CLIENT_ID, RC_CLIENT_SECRET, RC_JWT and RC_FROM in Vercel.' });
    }

    const text = body.appendOptOut ? (message + '\n\nReply STOP to opt out.') : message;
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

    // normalize + dedupe recipients
    const seen = {};
    const targets = [];
    body.numbers.forEach(n => { const e = toE164(n); if (e && !seen[e]) { seen[e] = 1; targets.push(e); } });

    // opt-out list
    const optout = blobToken ? (await readBlobJson(OPTOUT_KEY, blobToken)) : [];
    const optset = {}; (Array.isArray(optout) ? optout : []).forEach(o => { const e = toE164(o); if (e) optset[e] = 1; });

    const rcToken = await getRcToken();
    const results = [];
    let sent = 0, skipped = 0, failed = 0;

    for (const to of targets) {
      if (optset[to]) { results.push({ to, status: 'skipped', reason: 'opted out' }); skipped++; continue; }
      const r = await rcSend(rcToken, from, to, text);
      if (r.ok) { results.push({ to, status: 'sent', id: r.id }); sent++; }
      else { results.push({ to, status: 'failed', error: r.error }); failed++; }
      await sleep(550); // gentle pacing for RingCentral rate limits
    }

    // log this blast (best effort)
    if (blobToken) {
      try {
        const log = await readBlobJson(LOG_KEY, blobToken);
        const arr = Array.isArray(log) ? log : [];
        arr.unshift({ at: new Date().toISOString(), sentBy: (body.sentBy || '').toString().slice(0, 120), message: text, total: targets.length, sent, skipped, failed });
        await put(LOG_KEY, JSON.stringify(arr.slice(0, 200)), { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0, token: blobToken });
      } catch (e) { console.error('blast log failed', e); }
    }

    return res.status(200).json({ ok: true, total: targets.length, sent, skipped, failed, results });
  } catch (e) {
    console.error('blast error', e);
    return res.status(500).json({ error: e.message });
  }
}

// ---- RingCentral (JWT auth, env creds) ----
async function getRcToken() {
  const auth = Buffer.from(process.env.RC_CLIENT_ID + ':' + process.env.RC_CLIENT_SECRET).toString('base64');
  const r = await fetch(RC_SERVER + '/restapi/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + auth },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: process.env.RC_JWT })
  });
  if (!r.ok) throw new Error('RingCentral auth failed: ' + r.status);
  const d = await r.json();
  return d.access_token;
}
async function rcSend(token, from, to, text) {
  try {
    const r = await fetch(RC_SERVER + '/restapi/v1.0/account/~/extension/~/sms', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: { phoneNumber: from }, to: [{ phoneNumber: to }], text })
    });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, id: d.id, error: r.ok ? null : (d.message || ('HTTP ' + r.status)) };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ---- helpers ----
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function toE164(raw) {
  const d = String(raw || '').replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d[0] === '+') return d;
  const digits = d.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return null; // unknown shape, skip rather than send garbage
}
async function readBlobJson(key, token) {
  try {
    const { blobs } = await list({ prefix: key, token });
    const f = blobs.find(b => b.pathname === key);
    if (!f) return [];
    const r = await fetch(f.url + '?t=' + Date.now(), { cache: 'no-store' });
    return await r.json();
  } catch (e) { return []; }
}

// ---- admin auth (Supabase token admin/manager OR legacy password) ----
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gcrzmiwgjvuujffbqjbq.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjcnptaXdnanZ1dWpmZmJxamJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MjQyODYsImV4cCI6MjA5NzQwMDI4Nn0.6Rol3Pxmh8kC_bvr5XkWa3k5s0gRcK9jfLKYmCHM1Ns';
async function isAdminRequest(req, body) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const role = await supabaseRole(auth.slice(7));
    return role === 'admin' || role === 'manager';
  }
  const adminToken = process.env.ADMIN_TOKEN || 'crashfactory2026';
  return body && body.password === adminToken;
}
async function supabaseRole(accessToken) {
  try {
    const ures = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + accessToken } });
    if (!ures.ok) return null;
    const user = await ures.json();
    if (!user || !user.id) return null;
    const pres = await fetch(SUPABASE_URL + '/rest/v1/profiles?id=eq.' + user.id + '&select=role', { headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + accessToken } });
    if (!pres.ok) return null;
    const rows = await pres.json();
    return (rows[0] && rows[0].role) || 'staff';
  } catch (e) { return null; }
}
