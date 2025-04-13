import { createClient } from '@supabase/supabase-js';

// Ensure these environment variables are set in your .env.local or environment
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL');
}
if (!supabaseServiceRoleKey) {
  throw new Error('Missing env var: SUPABASE_SERVICE_ROLE_KEY');
}

// Create a single supabase client for interacting with your database using admin privileges.
// Note: This client uses the Service Role key and bypasses RLS.
// DO NOT expose this client or the service role key to the browser!
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    // Required for service role key
    autoRefreshToken: false,
    persistSession: false
  }
}); 