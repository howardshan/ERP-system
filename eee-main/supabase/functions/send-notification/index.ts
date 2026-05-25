/**
 * Edge Function: send-notification  (EF-004)
 * Sends ERP notification emails via the SMTP2Go HTTP API.
 *
 * Phase 1 handles the QC "test result" notification: it is invoked by an
 * AFTER INSERT trigger on qc_inspection_record (M-083) through pg_net, so it
 * fires automatically on every recorded QC test.
 *
 * Auth: this function is invoked by a DB trigger (no end-user JWT), so it must
 * be deployed with --no-verify-jwt and instead validates a shared secret:
 *   supabase functions deploy send-notification --no-verify-jwt
 * The trigger sends header `x-notify-secret`; it must equal NOTIFY_WEBHOOK_SECRET.
 *
 * Required secrets (supabase secrets set ...):
 *   SMTP2GO_API_KEY        — SMTP2Go API key
 *   NOTIFY_SENDER_EMAIL    — from address, e.g. noreply@crave-cook.com
 *   NOTIFY_WEBHOOK_SECRET  — shared secret matching app.notify_webhook_secret
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — auto-injected by Supabase
 *
 * Request body:
 *   { "type_key": "qc_test_result", "inspection_id": "<uuid>" }
 * Response:
 *   { "sent": [{ "to": "...", "ok": true }] }  |  { "skipped": "..." }  |  { "error": "..." }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SMTP2GO_URL = 'https://api.smtp2go.com/v3/email/send';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

interface Batch {
  sub_lot_code?: string;
  sku_code?: string;
  sku_name?: string;
  lot_number?: string;
  aw?: number;
  result?: 'pass' | 'fail';
  current_status?: string;
  submitted_at?: string;
  inspector?: string;
  sample_id?: string;
}
interface Stats {
  awaiting_sample?: number;
  awaiting_wa_result?: number;
  passed_today?: number;
  failed_today?: number;
  currently_drying?: number;
  pass_rate_pct?: number | null;
}

function renderQcTestResult(payload: { batch: Batch; stats: Stats }) {
  const b = payload.batch ?? {};
  const s = payload.stats ?? {};
  const pass = b.result === 'pass';
  const color = pass ? '#16a34a' : '#dc2626';
  const resultLabel = pass ? 'PASS' : 'FAIL';
  const awaitingTotal = (s.awaiting_sample ?? 0) + (s.awaiting_wa_result ?? 0);

  const subject =
    `[QC ${resultLabel}] ${b.sub_lot_code ?? ''} ${b.sku_name ?? ''}`.trim() +
    (b.aw != null ? ` — Aw ${b.aw}` : '');

  const submitted = b.submitted_at ? new Date(b.submitted_at).toLocaleString() : '';

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
    <h2 style="margin:0 0 4px">QC Test Result</h2>
    <p style="margin:0 0 16px;color:#64748b;font-size:13px">${esc(submitted)}</p>

    <div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:20px">
      <div style="background:${color};color:#fff;padding:10px 16px;font-weight:700;font-size:15px">
        ${resultLabel} &nbsp;·&nbsp; Aw ${esc(b.aw)}
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:8px 16px;color:#64748b">Sub-lot</td><td style="padding:8px 16px;font-weight:600">${esc(b.sub_lot_code)}</td></tr>
        <tr><td style="padding:8px 16px;color:#64748b">Product</td><td style="padding:8px 16px">${esc(b.sku_name)} ${b.sku_code ? '(' + esc(b.sku_code) + ')' : ''}</td></tr>
        <tr><td style="padding:8px 16px;color:#64748b">Lot</td><td style="padding:8px 16px">${esc(b.lot_number)}</td></tr>
        <tr><td style="padding:8px 16px;color:#64748b">Sample</td><td style="padding:8px 16px">${esc(b.sample_id)}</td></tr>
        <tr><td style="padding:8px 16px;color:#64748b">Status</td><td style="padding:8px 16px">${esc(b.current_status)}</td></tr>
        <tr><td style="padding:8px 16px;color:#64748b">Inspector</td><td style="padding:8px 16px">${esc(b.inspector)}</td></tr>
      </table>
    </div>

    <h3 style="margin:0 0 8px;font-size:14px;color:#334155">Today so far</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e2e8f0;border-radius:8px">
      <tr><td style="padding:8px 16px;color:#64748b">Passed today</td><td style="padding:8px 16px;font-weight:700;color:#16a34a">${esc(s.passed_today ?? 0)}</td></tr>
      <tr><td style="padding:8px 16px;color:#64748b">Failed today</td><td style="padding:8px 16px;font-weight:700;color:#dc2626">${esc(s.failed_today ?? 0)}</td></tr>
      <tr><td style="padding:8px 16px;color:#64748b">Awaiting test</td><td style="padding:8px 16px;font-weight:700">${esc(awaitingTotal)} <span style="color:#94a3b8;font-weight:400">(sample ${esc(s.awaiting_sample ?? 0)} · result ${esc(s.awaiting_wa_result ?? 0)})</span></td></tr>
      <tr><td style="padding:8px 16px;color:#64748b">Currently drying</td><td style="padding:8px 16px">${esc(s.currently_drying ?? 0)}</td></tr>
      <tr><td style="padding:8px 16px;color:#64748b">Pass rate</td><td style="padding:8px 16px">${s.pass_rate_pct != null ? esc(s.pass_rate_pct) + '%' : '—'}</td></tr>
    </table>

    <p style="margin:20px 0 0;color:#94a3b8;font-size:12px">Automated message from the ERP QC module. Do not reply.</p>
  </div>`;

  const text =
    `QC Test Result — ${resultLabel} (Aw ${b.aw})\n` +
    `Sub-lot: ${b.sub_lot_code}\nProduct: ${b.sku_name} (${b.sku_code})\nLot: ${b.lot_number}\n` +
    `Sample: ${b.sample_id}\nStatus: ${b.current_status}\nInspector: ${b.inspector}\n` +
    `Time: ${submitted}\n\n` +
    `Today so far:\n  Passed: ${s.passed_today ?? 0}\n  Failed: ${s.failed_today ?? 0}\n` +
    `  Awaiting test: ${awaitingTotal} (sample ${s.awaiting_sample ?? 0}, result ${s.awaiting_wa_result ?? 0})\n` +
    `  Currently drying: ${s.currently_drying ?? 0}\n  Pass rate: ${s.pass_rate_pct != null ? s.pass_rate_pct + '%' : '—'}\n`;

  return { subject, html, text };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1) Validate shared secret (function deployed with --no-verify-jwt)
    const expected = Deno.env.get('NOTIFY_WEBHOOK_SECRET');
    if (expected && req.headers.get('x-notify-secret') !== expected) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const { type_key, inspection_id } = await req.json();
    if (!type_key || !inspection_id) {
      return json({ error: 'type_key and inspection_id are required' }, 400);
    }
    if (type_key !== 'qc_test_result') {
      return json({ error: `Unsupported type_key: ${type_key}` }, 400);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // 2) Resolve recipients by effective-enabled rule
    const { data: recips, error: rErr } = await admin.rpc('notification_recipients', {
      p_type_key: type_key,
    });
    if (rErr) return json({ error: `recipients: ${rErr.message}` }, 500);
    const emails: string[] = (recips ?? []).map((r: { email: string }) => r.email).filter(Boolean);
    if (emails.length === 0) return json({ skipped: 'no recipients enabled' }, 200);

    // 3) Assemble the email payload (batch detail + today's stats)
    const { data: payload, error: pErr } = await admin.rpc('qc_test_result_email', {
      p_inspection_id: inspection_id,
    });
    if (pErr) return json({ error: `payload: ${pErr.message}` }, 500);
    if (!payload || !payload.batch) return json({ error: 'inspection not found' }, 404);

    const { subject, html, text } = renderQcTestResult(payload);

    const apiKey = Deno.env.get('SMTP2GO_API_KEY');
    const sender = Deno.env.get('NOTIFY_SENDER_EMAIL') ?? 'noreply@crave-cook.com';
    if (!apiKey) return json({ error: 'SMTP2GO_API_KEY not configured' }, 500);

    // 4) Send one email per recipient + log each outcome
    const results: { to: string; ok: boolean }[] = [];
    for (const to of emails) {
      let ok = false;
      let providerResponse = '';
      try {
        const res = await fetch(SMTP2GO_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Smtp2go-Api-Key': apiKey },
          body: JSON.stringify({ sender, to: [to], subject, html_body: html, text_body: text }),
        });
        providerResponse = await res.text();
        ok = res.ok;
      } catch (e) {
        providerResponse = String(e);
      }
      await admin.from('notification_log').insert({
        type_key,
        recipient_email: to,
        subject,
        status: ok ? 'sent' : 'failed',
        provider_response: providerResponse.slice(0, 2000),
        context: { inspection_id },
      });
      results.push({ to, ok });
    }

    return json({ sent: results }, 200);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
