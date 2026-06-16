/**
 * Authoritative-state source flag for the Step 2 transition.
 *
 *   'supabase' (DEFAULT) — the gate, role, and backend `x-team-id` are derived from
 *                          Supabase business tables, exactly as before. This is the
 *                          ONLY value that may run in production until the Step 3
 *                          Supabase→Prisma data migration is completed AND verified.
 *   'me'                 — the gate + role are derived from the authoritative backend
 *                          `GET /v1/me` (Prisma); the Supabase data layer is left
 *                          untouched (it still keys every business screen on the
 *                          Supabase team id). Validated in NON-production only.
 *
 * The two team-id spaces are disjoint (Supabase bare-uuid vs Prisma `team_<uuid>` in a
 * separate database), so the flag also picks which provider owns `setActiveTeam` — the
 * id spaces are never cross-keyed. See the Step 2 plan + AuthzContext.
 */
export type AuthSource = 'me' | 'supabase'

export const AUTH_SOURCE: AuthSource =
  (import.meta.env.VITE_AUTH_SOURCE as string | undefined) === 'me' ? 'me' : 'supabase'
