/**
 * Tiny bridge so out-of-graph UI (the command palette) can drive the React
 * Flow instance, which only exposes its API inside its provider. The graph
 * registers its fitView here on mount.
 */
export const graphBus: { fitView?: () => void } = {}
