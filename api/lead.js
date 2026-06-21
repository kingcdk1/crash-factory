// Vercel serverless function for The Crash Factory - generic LEAD capture
// One endpoint every form on the site can POST to (TowZero driver signups,
// contact form, parts inquiries, etc.). For each submission it:
//   1. STORES the lead in Vercel Blob (your own data, no GoHighLevel/Zapier)
//   2. EMAILS the lead to the shop via Resend (like the old site did)
//   3. Degrades gracefully so a lead is never silently lost
//
// POST /api/lead
//   body: { type, name, phone, email, message, fields:{...} }
//   -> { success:true, stored:bool, emailed:bool, id }
//
// GET /api/lead?password=...   (admin only) -> { leads:[...] }
//
// ENVIRONMENT VARIABLES (set in Vercel project settings):
//   BLOB_READ_WRITE_TOKEN  - auto-added when a Vercel Blob store is connected
//   RESEND_API_KEY         - Resend.com key to email the leads (verify the
//                            thecrashfactory.com domain in Resend first)
//   LEAD_EMAIL_TO          - where leads go (defaults admin@thecrashfactory.com)
//   ADMIN_TOKEN            - password to read stored leads (defaults 'crashfactory2026')

import { put, list } from '@vercel/blob';

const LEADS_KEY = 'leads.json';

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

  // ---- READ stored leads (admin / manager) ----
  if (req.method === 'GET') {
    const authorized = await isAuthorizedReader(req);
    if (!authorized) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!token) {
      return res.status(200).json({ leads: [] });
    }
    try {
      const leads = await readLeads(token);
      return res.status(200).json({ leads });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ---- CREATE a lead (public) ----
  if (req.method === 'POST') {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : JSON.parse(req.body || '{}');

      const record = {
        id: 'L-' + Date.now() + '-' + Math.round(Math.random() * 1e6),
        type: (body.type || 'lead').toString().slice(0, 60),
        name: (body.name || '').toString().slice(0, 200),
        phone: (body.phone || '').toString().slice(0, 60),
        email: (body.email || '').toString().slice(0, 200),
        message: (body.message || '').toString().slice(0, 4000),
        fields: (body.fields && typeof body.fields === 'object') ? body.fields : {},
        createdAt: new Date().toISOString(),
        source: origin || 'unknown'
      };

      // 1) STORE - append to the master leads index (best effort)
      let stored = false;
      if (token) {
        try {
          const leads = await readLeads(token);
          leads.unshift(record);
          await put(LEADS_KEY, JSON.stringify(leads), {
            access: 'public',
            contentType: 'application/json',
            addRandomSuffix: false,
            allowOverwrite: true,
            cacheControlMaxAge: 0,
            token
          });
          stored = true;
        } catch (storeErr) {
          console.error('Lead store failed:', storeErr);
        }
      }

      // 2) EMAIL the lead to the shop (best effort)
      let emailed = false;
      const resendKey = process.env.RESEND_API_KEY;
      const leadEmailTo = process.env.LEAD_EMAIL_TO || 'admin@thecrashfactory.com';
      const emailBody = formatLeadEmail(record);

      if (resendKey) {
        try {
          const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
            body: JSON.stringify({
              from: 'leads@thecrashfactory.com',
              to: leadEmailTo,
              reply_to: record.email || undefined,
              subject: `New ${record.type} lead: ${record.name || record.phone || 'unknown'}`,
              text: emailBody
            })
          });
          emailed = r.ok;
        } catch (emailErr) {
          console.error('Lead email failed:', emailErr);
        }
      } else {
        console.log('LEAD (no email service configured):\n' + emailBody);
      }

      // 3) OPTIONAL FAN-OUT - forward a copy to GoHighLevel and/or Google Sheets.
      // These are downstream copies only. The lead is already stored + emailed
      // above, so we never depend on them. Each is off until its URL is set.
      const forwarded = { ghl: false, sheets: false };

      const ghlUrl = process.env.GHL_WEBHOOK_URL;
      if (ghlUrl) {
        try {
          const r = await fetch(ghlUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(record)
          });
          forwarded.ghl = r.ok;
        } catch (ghlErr) {
          console.error('GHL forward failed:', ghlErr);
        }
      }

      const sheetsUrl = process.env.SHEETS_WEBHOOK_URL;
      if (sheetsUrl) {
        try {
          const r = await fetch(sheetsUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(record)
          });
          forwarded.sheets = r.ok;
        } catch (sheetsErr) {
          console.error('Sheets forward failed:', sheetsErr);
        }
      }

      return res.status(200).json({ success: true, stored, emailed, forwarded, id: record.id });
    } catch (e) {
      console.error('Lead handler error:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// Shared Supabase identity (same project as Revenue Board). These are public.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gcrzmiwgjvuujffbqjbq.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjcnptaXdnanZ1dWpmZmJxamJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MjQyODYsImV4cCI6MjA5NzQwMDI4Nn0.6Rol3Pxmh8kC_bvr5XkWa3k5s0gRcK9jfLKYmCHM1Ns';

// A reader is allowed if they present a Supabase token for an admin/manager,
// OR (temporarily) the legacy shared password until auth is fully cut over.
async function isAuthorizedReader(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const role = await supabaseRole(auth.slice(7));
    return role === 'admin' || role === 'manager';
  }
  const adminToken = process.env.ADMIN_TOKEN || 'crashfactory2026';
  return (req.query.password || '') === adminToken;
}

// Validate a Supabase access token and return the user's role, or null.
async function supabaseRole(accessToken) {
  try {
    const ures = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + accessToken }
    });
    if (!ures.ok) return null;
    const user = await ures.json();
    if (!user || !user.id) return null;
    const pres = await fetch(SUPABASE_URL + '/rest/v1/profiles?id=eq.' + user.id + '&select=role', {
      headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + accessToken }
    });
    if (!pres.ok) return null;
    const rows = await pres.json();
    return (rows[0] && rows[0].role) || 'staff';
  } catch (e) {
    console.error('supabaseRole failed:', e);
    return null;
  }
}

async function readLeads(token) {
  const { blobs } = await list({ prefix: LEADS_KEY, token });
  const found = blobs.find(b => b.pathname === LEADS_KEY);
  if (!found) return [];
  const r = await fetch(found.url + '?t=' + Date.now(), { cache: 'no-store' });
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

function formatLeadEmail(rec) {
  const extra = Object.keys(rec.fields || {}).length
    ? '\nDETAILS\n-------\n' + Object.entries(rec.fields).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n'
    : '';
  return `NEW LEAD - The Crash Factory
====================================

Type: ${rec.type}
Received: ${new Date(rec.createdAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })}
Lead ID: ${rec.id}

CONTACT
-------
Name: ${rec.name || 'not given'}
Phone: ${rec.phone || 'not given'}
Email: ${rec.email || 'not given'}
${rec.message ? '\nMESSAGE\n-------\n' + rec.message + '\n' : ''}${extra}====================================
Stored in your site. Reply to this email to reach the lead.
`;
}
