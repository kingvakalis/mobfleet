---
name: code-refactoring
description: Use when improving code structure without changing behavior — removing duplication, untangling a god component/function, clarifying names, extracting shared logic, reducing coupling, or paying down debt before/after a feature. Apply when code is hard to read, change, or test. Keep behavior identical; verify continuously.
---

# Code Refactoring

Improve internal structure while keeping observable behavior identical — safely,
in small verified steps.

## Prime directive
**Behavior must not change.** A refactor that alters output is a rewrite/bugfix
in disguise. Guard it: have tests (or add characterization tests) that pin the
current behavior before you start, and keep them green at every step.

## When it's worth it
- The same logic exists in 2+ places and drifts (single source of truth).
- A file/function does too many things; changes ripple unpredictably.
- Names mislead; you have to re-read to understand.
- You're about to build on top of it and the foundation is shaky.
Refactor opportunistically (Boy-Scout rule) — but don't gold-plate code that
isn't in your path.

## Moves (smallest first)
- Rename to intent; delete dead code & stale comments.
- Extract function/component/module; collapse duplication into one definition.
- Replace prop-soup with composition; replace conditionals with polymorphism/map.
- Push logic out of the view into a pure, testable layer.
- Introduce a seam (interface/adapter) to decouple from a concrete dependency.
- Tighten types; remove `any`; make illegal states unrepresentable.

## Process
1. Ensure a safety net (tests/typecheck). Add characterization tests if missing.
2. Make ONE small structural change.
3. Run typecheck + lint + tests + build. Green? Commit. Then next change.
4. Never mix a refactor and a behavior change in the same commit — separate them
   so review and bisect stay clean.

## Match the codebase
- Read neighbors first; mirror their idioms, naming, comment density, file
  layout. A refactor that introduces a new style is just different debt.
- Comment only to state constraints the code can't show — not narration.

## Anti-patterns
- Big-bang rewrites with no intermediate green state.
- "While I'm here" scope creep that balloons the diff and risk.
- Refactoring without tests, then asserting it's "equivalent".
- Abstracting too early (one use-site) — wait for the real second case.

## Definition of done
Cleaner structure, identical behavior, smaller or clearer code, all checks green,
changes split from any behavior edits, consistent with surrounding style.
