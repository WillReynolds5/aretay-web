// Shared helpers for the live-voice-review Edge Functions.
//
// SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are injected
// automatically by the Supabase runtime — no .env file needed.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export type AuthContext = {
  userId: string
  /** Service-role client — bypasses RLS. Learners are not course owners, so
   *  reads of shared course content (cards, curriculum) need this; every write
   *  is still scoped to the verified userId. */
  admin: SupabaseClient
}

/**
 * Verifies the caller's JWT (Bearer) and returns their user id plus a
 * service-role client. Returns a Response on any auth failure so callers can
 * `if (ctx instanceof Response) return ctx`.
 */
export async function authenticate(req: Request): Promise<AuthContext | Response> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Missing or invalid Authorization header' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })

  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) {
    return json({ error: 'Could not verify identity', detail: error?.message }, 401)
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  return { userId: user.id, admin }
}

/** Standard preflight + method guard shared by every function. */
export function guardMethod(req: Request, method = 'POST'): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== method) return json({ error: 'Method not allowed' }, 405)
  return null
}
