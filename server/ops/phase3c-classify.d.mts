// Type declarations for the throwaway ESM ops classifier (phase3c-classify.mjs), so
// the unit test (src/phase3c.test.ts) type-checks under `tsc --noEmit` without
// enabling allowJs for the whole project. The .mjs file is the source of truth.

export interface Phase3cBlocker {
  store: 'prisma' | 'supabase'
  table: string
  count: number
}

export interface Phase3cResult {
  decision: 'SAFE_NOOP' | 'BLOCK'
  safe: boolean
  message: string
  blocking: Phase3cBlocker[]
}

/** Deterministic, pure cutover classifier. See phase3c-classify.mjs for behavior. */
export function classifyPhase3c(
  prismaCounts: Record<string, unknown> | null | undefined,
  supabaseCounts: Record<string, unknown> | null | undefined,
): Phase3cResult

export const PRISMA_BUSINESS_TABLES: string[]
export const SUPABASE_BUSINESS_TABLES: string[]
export const IGNORED_TABLES: Set<string>
