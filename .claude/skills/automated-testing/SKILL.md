---
name: automated-testing
description: Use when writing, expanding, or evaluating tests — unit, integration, end-to-end, regression. Apply when shipping a feature, fixing a bug (add a guarding test), or judging coverage quality. Favors fast deterministic tests of real behavior over brittle snapshots or coverage theater.
---

# Automated Testing

Tests that catch real regressions, run fast, and don't lie.

## Test the right thing at the right level (pyramid)
- **Unit (most):** pure logic — calculations, transforms, authorization,
  date/range math, reducers. Fast, deterministic, no DOM/network. This is where
  correctness lives; cover edge cases and boundaries.
- **Integration (some):** a few units wired together; a store + selector; a
  component with its real hooks.
- **E2E (few, high-value):** real user journeys + the things only the assembled
  app reveals — permission/role scenarios, scope filtering, navigation, "the
  sensitive value is masked for role X".

## Principles
- **Test behavior, not implementation.** Assert observable outcomes; don't pin
  internal structure (brittle). Snapshot tests sparingly and meaningfully.
- **Deterministic.** No reliance on real time/random/network. Inject `now`; seed
  data; stub the clock. Flaky tests are worse than no tests.
- **One reason to fail.** Each test targets one behavior; name it as the
  expected behavior ("denies a viewer the financial tab").
- **Arrange–Act–Assert.** Build realistic fixtures (long names, zero, missing
  fields, duplicates), act, assert the contract.
- **Edge cases are the point:** empty, single, many, boundary, null/absent,
  permission-denied, previous-period-zero, timezone edges.

## Process
1. For a bug: write a failing test that reproduces it first, then fix.
2. For a feature: list the contract (inputs→outputs, who can/can't), test each.
3. Cover the security/permission matrix explicitly (each role's allowed/denied).
4. Run the full suite + typecheck + lint + build; fix everything you introduced.
5. Keep tests fast; gate slow E2E behind a separate project/command.

## Anti-patterns
- Coverage chasing: tests that execute code without asserting meaning.
- Asserting on `Date.now()`/random output; sleeping to "fix" flakiness.
- Giant E2E that re-tests pure logic better covered by a unit test.
- Tests so coupled to markup that any refactor breaks them.

## Definition of done
Behavior + edge cases covered at the cheapest sufficient level; deterministic;
security/permission paths asserted; whole suite green alongside typecheck, lint,
and build; new bug guarded by a regression test.
