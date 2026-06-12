/**
 * Tiny bridge so out-of-graph UI (the command palette, filter bar) can drive
 * the React Flow instance, which only exposes its API inside its provider.
 * The graph registers its handlers here on mount.
 */
export const graphBus: {
  fitView?: () => void
  focusMatches?: () => void
} = {}
