import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from 'astro:env/server';

// Lazy singleton. Created on first use so a missing env surfaces as a caught
// runtime error (handled by the pages) instead of crashing module imports.
let _client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!_client) {
    // Service-role client. SERVER ONLY. Bypasses RLS — never ship to client.
    _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}
