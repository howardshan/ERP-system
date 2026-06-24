/**
 * Edge Function: reset-user-mfa  (EF-005)
 * Removes ALL MFA (TOTP) factors of a Supabase Auth user using the service
 * role key, so a user who lost their authenticator can re-enroll on next login.
 * Only callable by authenticated users (admins; app gates with auth.users.reset_mfa).
 *
 * Request:
 *   POST /functions/v1/reset-user-mfa
 *   Authorization: Bearer <JWT>
 *   { "auth_user_id": "<uuid>" }
 *
 * Response:
 *   { "success": true, "removed": <n> }
 *   { "error": "..." }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify caller is authenticated.
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { auth_user_id } = await req.json();
    if (!auth_user_id) {
      return new Response(JSON.stringify({ error: 'auth_user_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: list, error: listErr } = await adminClient.auth.admin.mfa.listFactors({ userId: auth_user_id });
    if (listErr) {
      return new Response(JSON.stringify({ error: listErr.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let removed = 0;
    for (const f of list?.factors ?? []) {
      const { error: delErr } = await adminClient.auth.admin.mfa.deleteFactor({ id: f.id, userId: auth_user_id });
      if (delErr) {
        return new Response(JSON.stringify({ error: delErr.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      removed++;
    }

    return new Response(JSON.stringify({ success: true, removed }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
