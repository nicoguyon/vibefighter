import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl) {
  throw new Error('Missing env.NEXT_PUBLIC_SUPABASE_URL');
}
if (!supabaseAnonKey) {
  throw new Error('Missing env.NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

// Create a single supabase client for interacting with your database
// Note: This client uses the Anon key and respects RLS. 
// For server-side actions requiring admin rights, create a separate client 
// using the SERVICE_ROLE_KEY in your API routes.
export const supabase = createClient(supabaseUrl, supabaseAnonKey); 