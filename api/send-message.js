// /api/send-message.js
// Vercel Serverless Function — sends real SMS via Beem Africa.
// Beem credentials live ONLY here as environment variables — never in admin.html.
//
// Why Beem instead of Twilio: Twilio charges roughly $0.43 per SMS to Tanzania
// (it routes internationally). Beem connects directly to Tanzanian carriers
// (Vodacom, Tigo, Airtel, Halotel) so it costs a small fraction of that per message.
//
// Required Vercel env vars (Project Settings -> Environment Variables):
//   BEEM_API_KEY            from Beem dashboard -> API Settings
//   BEEM_SECRET_KEY         from Beem dashboard -> API Settings
//   BEEM_SENDER_NAME        your approved Sender Name (use "INFO" until yours is approved)
//   SUPABASE_URL            same project URL used in admin.html
//   SUPABASE_SERVICE_ROLE_KEY   Supabase Project Settings -> API -> service_role key
//                                (NOT the anon key — this one bypasses RLS, keep it secret)
//
// NOTE: WhatsApp is not wired up yet. If type is 'whatsapp' or 'both', those jobs
// are skipped with a clear reason in the response — add a WhatsApp provider later
// without touching the SMS path below.

const { createClient } = require('@supabase/supabase-js');

const MAX_RECIPIENTS_PER_REQUEST = 500;
const BATCH_SIZE = 20; // chunk sends to stay well under payload/time limits

function normalizeTanzanianPhone(raw) {
  if (!raw) return null;
  let p = String(raw).trim().replace(/[\s\-().]/g, '');
  if (p.startsWith('+')) return p.slice(1);
  if (p.startsWith('00')) return p.slice(2);
  if (p.startsWith('255')) return p;
  if (p.startsWith('0')) return '255' + p.slice(1);
  if (/^[67]\d{8}$/.test(p)) return '255' + p; // bare 9-digit local number
  return null; // couldn't confidently normalize
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const {
    BEEM_API_KEY,
    BEEM_SECRET_KEY,
    BEEM_SENDER_NAME,
  } = process.env;

  // Accept either naming — this project already has Supabase vars prefixed with VITE_
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

  if (!BEEM_API_KEY || !BEEM_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const missing = [];
    if (!BEEM_API_KEY) missing.push('BEEM_API_KEY');
    if (!BEEM_SECRET_KEY) missing.push('BEEM_SECRET_KEY');
    if (!SUPABASE_URL) missing.push('SUPABASE_URL (or VITE_SUPABASE_URL)');
    if (!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_SERVICE_ROLE_KEY)');
    res.status(500).json({ error: 'Server is missing required environment variables: ' + missing.join(', ') });
    return;
  }

  // ---- 1. Authenticate the caller (must be a logged-in admin/general overseer) ----
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Missing Authorization token.' });
    return;
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData || !userData.user) {
    res.status(401).json({ error: 'Invalid or expired session.' });
    return;
  }
  const callerId = userData.user.id;

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('members')
    .select('role, leadership_role')
    .eq('id', callerId)
    .single();

  const { data: activeRoleRows } = await supabaseAdmin
    .from('member_leadership_roles')
    .select('leadership_role')
    .eq('member_id', callerId)
    .eq('is_active', true);

  const activeRoles = [profile ? profile.leadership_role : null]
    .concat((activeRoleRows || []).map(r => r.leadership_role))
    .filter(Boolean);
  const isAllowed = !profileErr && profile && (profile.role === 'admin' || activeRoles.includes('general_overseer'));

  if (!isAllowed) {
    res.status(403).json({ error: 'You do not have permission to send messages.' });
    return;
  }

  // ---- 2. Validate the request body ----
  const body = req.body || {};
  const type = body.type;
  const content = body.content;
  const recipients = body.recipients;

  if (['sms', 'whatsapp', 'both'].indexOf(type) === -1) {
    res.status(400).json({ error: 'Invalid message type.' });
    return;
  }
  if (!content || !String(content).trim()) {
    res.status(400).json({ error: 'Message content is required.' });
    return;
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    res.status(400).json({ error: 'No recipients provided.' });
    return;
  }
  if (recipients.length > MAX_RECIPIENTS_PER_REQUEST) {
    res.status(400).json({
      error: `Too many recipients in one send (${recipients.length}). Max is ${MAX_RECIPIENTS_PER_REQUEST} — please split into smaller groups.`,
    });
    return;
  }

  const wantsSms = type === 'sms' || type === 'both';
  const wantsWhatsapp = type === 'whatsapp' || type === 'both';

  // ---- 3. Build the recipient list for Beem (SMS only — WhatsApp not wired up yet) ----
  const validRecipients = [];
  const skipped = [];

  recipients.forEach(function (r, idx) {
    const localDigits = normalizeTanzanianPhone(r.phone); // Beem wants digits only, no leading +
    if (!localDigits) {
      skipped.push({ name: r.full_name, channel: 'sms', reason: 'Invalid or missing phone number' });
      return;
    }
    validRecipients.push({ recipient_id: String(idx + 1), dest_addr: localDigits, name: r.full_name });
  });

  if (wantsWhatsapp) {
    recipients.forEach(function (r) {
      skipped.push({ name: r.full_name, channel: 'whatsapp', reason: 'WhatsApp sending is not configured yet' });
    });
  }

  const authHeaderValue = 'Basic ' + Buffer.from(BEEM_API_KEY + ':' + BEEM_SECRET_KEY).toString('base64');

  let sent = 0;
  const failures = [];

  if (wantsSms && validRecipients.length) {
    for (let i = 0; i < validRecipients.length; i += BATCH_SIZE) {
      const batch = validRecipients.slice(i, i + BATCH_SIZE);
      try {
        const beemRes = await fetch('https://apisms.beem.africa/v1/send', {
          method: 'POST',
          headers: {
            'Authorization': authHeaderValue,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            source_addr: BEEM_SENDER_NAME || 'INFO',
            encoding: 0,
            schedule_time: '',
            message: content,
            recipients: batch.map(function (b) { return { recipient_id: b.recipient_id, dest_addr: b.dest_addr }; }),
          }),
        });

        let beemJson = {};
        try { beemJson = await beemRes.json(); } catch (e) { /* leave as {} */ }

        if (beemRes.ok && (beemJson.successful === true || beemJson.code === 100)) {
          sent += batch.length;
        } else {
          batch.forEach(function (b) {
            failures.push({ name: b.name, channel: 'sms', reason: beemJson.message || ('Beem error (HTTP ' + beemRes.status + ')') });
          });
        }
      } catch (err) {
        batch.forEach(function (b) {
          failures.push({ name: b.name, channel: 'sms', reason: err.message });
        });
      }
    }
  }

  skipped.forEach(function (s) { failures.push(s); });

  const totalAttempted = sent + failures.length;

  res.status(200).json({
    sent: sent,
    failedCount: failures.length,
    totalAttempted: totalAttempted,
    failures: failures.slice(0, 25),
  });
};
