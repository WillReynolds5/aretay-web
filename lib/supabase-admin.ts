import { createClient } from "@supabase/supabase-js";

export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const ownerId = process.env.SUPABASE_ADMIN_OWNER_ID;

  if (!url || !key) {
    throw new Error("SUPABASE_SECRET_KEY is not configured");
  }
  if (!ownerId) {
    throw new Error("SUPABASE_ADMIN_OWNER_ID is not configured");
  }

  return {
    client: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
    ownerId,
  };
}
