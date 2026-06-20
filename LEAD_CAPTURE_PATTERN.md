# Lead Capture Pattern (own your data, no GoHighLevel, no Zapier)

Drop-in pattern for any project. Every form posts to one endpoint that **stores
the lead in your own Vercel Blob** and (optionally) **emails it to you** via
Resend. Comes with an admin dashboard to view and export. Works on any static
site (GitHub Pages, etc.) with a Vercel project attached for the `/api` folder.

## How it works
```
[ any form ] --POST--> /api/lead --> stores leads.json in Vercel Blob
                                  \-> emails you via Resend (optional)
[ leads.html ] --GET (password)--> /api/lead --> view + CSV export
```

## 1. Add the endpoint: `api/lead.js`
```js
import { put, list } from '@vercel/blob';
const LEADS_KEY = 'leads.json';
const allowedOrigins = ['https://YOURDOMAIN.com', 'https://www.YOURDOMAIN.com'];

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.BLOB_READ_WRITE_TOKEN;

  if (req.method === 'GET') { // admin: read stored leads
    const admin = process.env.ADMIN_TOKEN || 'changeme';
    if ((req.query.password || '') !== admin) return res.status(401).json({ error: 'Unauthorized' });
    if (!token) return res.status(200).json({ leads: [] });
    return res.status(200).json({ leads: await readLeads(token) });
  }

  if (req.method === 'POST') { // public: create a lead
    const body = (req.body && typeof req.body === 'object') ? req.body : JSON.parse(req.body || '{}');
    const rec = {
      id: 'L-' + Date.now() + '-' + Math.round(Math.random() * 1e6),
      type: (body.type || 'lead').toString().slice(0, 60),
      name: (body.name || '').toString().slice(0, 200),
      phone: (body.phone || '').toString().slice(0, 60),
      email: (body.email || '').toString().slice(0, 200),
      message: (body.message || '').toString().slice(0, 4000),
      fields: (body.fields && typeof body.fields === 'object') ? body.fields : {},
      createdAt: new Date().toISOString(), source: origin || 'unknown'
    };
    let stored = false;
    if (token) { try {
      const leads = await readLeads(token); leads.unshift(rec);
      await put(LEADS_KEY, JSON.stringify(leads), { access:'public', contentType:'application/json',
        addRandomSuffix:false, allowOverwrite:true, cacheControlMaxAge:0, token });
      stored = true;
    } catch (e) { console.error('store failed', e); } }

    let emailed = false;
    const key = process.env.RESEND_API_KEY, to = process.env.LEAD_EMAIL_TO || 'you@YOURDOMAIN.com';
    if (key) { try {
      const r = await fetch('https://api.resend.com/emails', { method:'POST',
        headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ from:'leads@YOURDOMAIN.com', to, reply_to: rec.email || undefined,
          subject:`New ${rec.type} lead: ${rec.name || rec.phone}`,
          text: JSON.stringify(rec, null, 2) }) });
      emailed = r.ok;
    } catch (e) { console.error('email failed', e); } }
    else { console.log('LEAD (no email configured):', JSON.stringify(rec)); }

    return res.status(200).json({ success:true, stored, emailed, id: rec.id });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function readLeads(token) {
  const { blobs } = await list({ prefix: LEADS_KEY, token });
  const f = blobs.find(b => b.pathname === LEADS_KEY);
  if (!f) return [];
  const r = await fetch(f.url + '?t=' + Date.now(), { cache:'no-store' });
  const d = await r.json();
  return Array.isArray(d) ? d : [];
}
```

## 2. Point any form at it
```js
await fetch('https://YOURPROJECT.vercel.app/api/lead', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'contact',                 // label this form (contact, driver-signup, quote...)
    name: name, phone: phone, email: email,
    message: message,
    fields: { anyExtra: 'value' }    // anything else, free-form
  })
});
// response: { success, stored, emailed, id }
// Tip: if (!data.stored && !data.emailed) fall back to a mailto so nothing is lost.
```

## 3. Add `@vercel/blob` to `package.json`
```json
{ "dependencies": { "@vercel/blob": "^0.27.0" } }
```

## 4. Dashboard
Copy `leads.html` from this repo. It logs in with the admin password, calls
`GET /api/lead?password=...`, and renders the leads with type filters, search,
and a CSV export. Change the `LEAD_API` constant at the top to your project URL.

## 5. Vercel setup (one time per project)
1. **Storage tab** -> connect a **Blob store** (auto-adds `BLOB_READ_WRITE_TOKEN`).
2. Add env `ADMIN_TOKEN` = your dashboard password.
3. **Email (optional, later):** add `RESEND_API_KEY` and verify YOURDOMAIN.com in
   Resend so `leads@YOURDOMAIN.com` can send. Until then leads still store; the
   email just stays off.
4. Redeploy.

## Notes
- Replace `YOURDOMAIN.com`, `YOURPROJECT`, and `you@YOURDOMAIN.com` throughout.
- Blob is public-but-unguessable; fine for normal lead data. For sensitive data
  move to a private store or a real DB later. The dashboard read is password-gated.
- This is the bridge to AutoCloud: same JSON shape can feed the central CRM later.
