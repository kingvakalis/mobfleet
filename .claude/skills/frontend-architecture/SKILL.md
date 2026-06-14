---
name: frontend-architecture
description: Use when structuring a frontend feature or codebase — choosing component boundaries, state management, data flow, module layout, routing, shared abstractions, or evaluating a large UI change for maintainability. Apply before building multi-file features and when refactoring architecture.
---

# Frontend Architecture

Decide how a frontend feature is structured so it stays correct, testable, and
cheap to change.

## When to use
Before building any feature that spans more than ~2 files, when adding a new
top-level area, when state/data flow gets tangled, or when deciding "where does
this logic live".

## Layering (keep these separate)
- **Pure domain/logic layer** — framework-free functions (calculations,
  transforms, authorization, validation). Easy to unit-test; portable to a
  server. No React imports.
- **State layer** — stores (e.g. zustand) + selectors + persistence. One source
  of truth per concern; derive, don't duplicate.
- **Data/access layer** — a single seam to the backend/provider (`client`),
  so the UI never hard-codes transport details. Scope/permission filtering
  happens at this boundary, not scattered in components.
- **Presentation layer** — components consume already-shaped, already-scoped
  data via hooks/props. Thin; no business math inline.

## Principles
- **One source of truth.** A value is computed/owned in exactly one place;
  everything else derives from it (single metric/permission/format definition).
- **Stable contracts, then fan out.** Freeze shared types + APIs before building
  many consumers, so leaves don't diverge.
- **Composition over configuration.** Small composable pieces beat a mega-
  component with 20 boolean props.
- **Colocate by feature, share by intent.** Feature folders own their parts;
  promote to `shared/`/`ui/` only on real reuse.
- **Unidirectional data flow.** Props/state down, events up. No hidden two-way
  coupling between siblings.
- **Boundaries are where guarantees live** — permission checks, scope filters,
  input validation, and error handling belong at seams, enforced consistently.

## React specifics
- Keep components pure in render; side effects in effects; no `Date.now()` /
  random / ref reads during render.
- Memoize expensive derived data on real inputs; don't put unstable objects in
  dep arrays. Don't recompute heavy analytics on every high-frequency tick.
- Lazy-load heavy/optional routes; don't ship every module to open one.
- A file that exports a component should export only components (Fast-Refresh):
  move constants/helpers to a `.ts` module.

## Process
1. Identify the layers the feature touches; name the single owner of each piece
   of state/logic.
2. Define shared types + the data contract first.
3. Build the foundation (logic + state + shared UI) and verify it compiles/tests
   before fanning out leaves.
4. Wire leaves to the foundation; keep them thin.
5. Verify: typecheck, lint, build, tests — at each layer.

## Anti-patterns
- Business logic inside JSX; the same calc done differently in two components.
- Components reaching into global stores directly, bypassing the scope/selector
  boundary.
- Prop-drilling 8 levels (use context/store) — or context for everything (re-
  render storms).
- God components / 1000-line files mixing data, layout, and logic.

## Definition of done
Clear layer separation; one owner per concern; shared contracts; thin
permission/scope-aware leaves; passes typecheck + lint + build + tests.
