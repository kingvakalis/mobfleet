---
name: performance-optimization
description: Use when something is slow, janky, or memory-heavy, or to proactively keep a feature fast — render performance, re-render storms, large lists/datasets, bundle size, expensive computation, animation jank, network/query cost. Apply before shipping data-heavy or animated UI. Measure first; optimize the real bottleneck.
---

# Performance Optimization

Make it fast where it matters, guided by measurement — never by guesswork.

## Golden rule
**Measure first.** Identify the actual bottleneck (profiler, timings, bundle
analyzer) before changing code. Optimizing the wrong thing adds complexity for
no gain. Confirm a win by measuring again.

## Rendering (React)
- Don't re-render the whole tree on one small change; subscribe narrowly
  (selectors), split state, lift expensive subtrees out of hot paths.
- `useMemo`/`useCallback` for genuinely expensive work or stable identities fed
  to memoized children — with correct, stable deps (no fresh objects/arrays).
- Don't drive layout from a value that changes every frame via React state; use
  refs/motion values for high-frequency animation.
- Decouple live (high-frequency) updates from historical/expensive derivations:
  coarse-tick the expensive ones so they don't recompute on every stream tick.

## Lists & data
- Virtualize long lists/tables; paginate; cap what reaches the browser.
- Aggregate on the backend where possible; don't ship the whole dataset to
  compute a count client-side. Filter at the selector boundary.
- Avoid N+1 data access; build lookup maps once (`Map` by id) instead of
  `.find()` in a loop.

## Bundle & load
- Lazy-load heavy/optional routes & libs; code-split. Don't import a charting/3D
  lib for a screen that doesn't show it.
- Prefer existing deps over adding new ones; watch the cost of a dependency.
- Debounce/throttle expensive event handlers (search, resize, filter).

## Animation
- Animate compositor-friendly props (`transform`, `opacity`); avoid animating
  layout (width/top/box-shadow) in hot loops.
- Cap simulation/raf work to frame budget; clamp dt; stop loops when idle.

## Process
1. Reproduce + measure (what's slow, how slow, where).
2. Form a hypothesis about the bottleneck; confirm it's the real cost.
3. Apply the smallest targeted fix.
4. Re-measure; verify no correctness/UX regression.
5. Note any deliberate cap/tradeoff (e.g. "top 50 rows") so it isn't mistaken
   for completeness.

## Anti-patterns
- Memoizing everything (premature; adds churn and bugs).
- Putting unstable values in dependency arrays (defeats memoization silently).
- Rerendering a dashboard every second; recomputing analytics each provider tick.
- Adding a heavy dependency to save 10 lines.

## Definition of done
The measured bottleneck is gone; interaction stays smooth (~60fps) with
realistic data volume; no correctness regression; tradeoffs documented.
