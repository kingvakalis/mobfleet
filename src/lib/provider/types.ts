/**
 * The fleet domain model + ProviderClient contract now live in the shared
 * layer (imported by both the React client and the Node server). This module
 * re-exports them so every existing `@/lib/provider/types` import is unchanged.
 */
export * from '@/shared/types'
