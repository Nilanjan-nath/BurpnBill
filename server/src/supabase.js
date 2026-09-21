import { createClient } from '@supabase/supabase-js';

// Service-role client: bypasses RLS, so it must never leave the backend.
// Used only to verify staff access tokens (see middleware/auth.js).
export function createSupabaseAdmin({ supabaseUrl, supabaseServiceRoleKey }) {
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
