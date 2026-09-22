import { createClient } from '@supabase/supabase-js';

// The staff dashboard's own Supabase Auth client — separate from the API's.
// Only ever given the public anon key (see web/.env.example); the
// service-role key lives solely in the server's own .env and is never
// exposed to a browser build.
//
// Missing config only matters once someone actually opens /staff (this app
// is lazy-loaded — see App.jsx), so it throws lazily here rather than
// breaking the customer app if it's ever unset.
export function createStaffAuthClient() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set — copy web/.env.example to web/.env and fill them in.',
    );
  }
  return createClient(url, anonKey);
}
