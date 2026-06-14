import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase browser client. Created only when both env vars are present, so the
 * app still runs in its standalone mock/demo mode (no backend, no login) when
 * Supabase isn't configured — auth is enabled exactly when it's wired up.
 *
 * Set in `.env` / Vercel:
 *   VITE_SUPABASE_URL=https://<project>.supabase.co
 *   VITE_SUPABASE_ANON_KEY=<anon public key>
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null
