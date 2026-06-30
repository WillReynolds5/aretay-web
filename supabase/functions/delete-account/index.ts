// delete-account edge function
//
// Deletes the calling user's auth record. The caller must provide their
// current session JWT as a Bearer token. All user data cascades automatically
// (course_enrollments, card_states, review_logs all have ON DELETE CASCADE
// on the user_id foreign key).
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by
// the Supabase runtime — no .env file needed.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Missing or invalid Authorization header' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey    = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Verify identity: use the caller's JWT to resolve their user record.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })

  const { data: { user }, error: identityError } = await userClient.auth.getUser()

  if (identityError || !user) {
    return new Response(
      JSON.stringify({ error: 'Could not verify identity', detail: identityError?.message }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Delete the user using the service role (requires admin privilege).
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id)

  if (deleteError) {
    console.error('delete-account: failed to delete user', user.id, deleteError.message)
    return new Response(
      JSON.stringify({ error: 'Failed to delete account', detail: deleteError.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  console.log('delete-account: deleted user', user.id)
  return new Response(
    JSON.stringify({ success: true }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
