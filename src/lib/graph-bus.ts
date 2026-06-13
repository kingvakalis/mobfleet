/**
 * Tiny bridge so out-of-graph UI (the command palette, filter bar, info card)
 * can drive the React Flow instance, which only exposes its API inside its
 * provider. The graph registers its handlers here on mount.
 */
export const graphBus: {
  fitView?: () => void
  focusMatches?: () => void
  togglePin?: (id: string) => void
  isPinned?: (id: string) => boolean
  unpinAll?: () => void
} = {}
