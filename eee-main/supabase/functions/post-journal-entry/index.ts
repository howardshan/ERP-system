/**
 * Edge Function: post-journal-entry
 *
 * Thin HTTP wrapper around the post_journal_entry() SQL RPC.
 * The real business logic (BR-F1..F5) lives in the SQL function.
 * This edge function exists only when you need an HTTP endpoint
 * callable from outside the Supabase client SDK (e.g., webhooks,
 * external integrations, cron services).
 *
 * Deploy:  supabase functions deploy post-journal-entry
 * Invoke:  POST /functions/v1/post-journal-entry
 *          Body: { "entry_id": 123 }
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { entry_id } = await req.json();
    if (!entry_id) {
      return new Response(JSON.stringify({ error: 'entry_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { error } = await supabase.rpc('post_journal_entry', { p_entry_id: entry_id });

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, entry_id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
