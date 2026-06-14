import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

/**
 * Supabase browser client (typed against the DB schema). Created only when both
 * env vars are present, so the app still runs in its standalone mock/demo mode
 * (no backend, no login) when Supabase isn't configured — auth + the live data
 * hooks are enabled exactly when it's wired up.
 *
 * Set in `.env.local` / Vercel:
 *   VITE_SUPABASE_URL=https://<project>.supabase.co
 *   VITE_SUPABASE_ANON_KEY=<anon public key>
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

export type TypedSupabaseClient = SupabaseClient<Database>

export const supabase: TypedSupabaseClient | null = isSupabaseConfigured
  ? createClient<Database>(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null
