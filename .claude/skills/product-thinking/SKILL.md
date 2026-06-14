---
name: product-thinking
description: Use when deciding WHAT to build and why — scoping a feature, prioritizing, cutting/clarifying requirements, evaluating whether a metric/screen earns its place, or turning a vague ask into a sharp deliverable. Apply before large builds and when a request is ambiguous or risks becoming a vanity feature.
---

# Product Thinking

Build the right thing: every feature/metric/screen earns its place by serving a
real user job.

## Start from the job, not the artifact
- Ask: who is the user, what are they trying to accomplish, and how will they
  know they succeeded? Design back from that.
- Translate a vague ask ("make a dashboard") into concrete questions it must
  answer in seconds ("is the fleet healthy? what needs action now?").

## Every element must justify itself
For each KPI/chart/screen/control, require:
- a clear definition + source + how it's calculated,
- the decision or action it informs,
- a drill-down to the underlying records,
- otherwise: cut it. No vanity metrics, no decorative charts, no arbitrary
  "scores" that don't map to a real, explainable fact.

## Honesty about data & capability
- Use real data where it exists; never fabricate analytics, revenue, or
  telemetry. If a source isn't connected, say "not connected / not available"
  and outline the integration — don't show a fake number.
- Distinguish 0 vs unknown vs unauthorized vs not-connected.
- Don't present unpersisted/mock values as production-ready.

## Scope & prioritization
- Find the smallest version that delivers the core value; sequence the rest.
- Prefer reversible, high-leverage moves; flag one-way doors for explicit
  decision.
- Cut ruthlessly: complexity the user won't feel is cost without benefit.
- Surface tradeoffs and a recommendation, not an exhaustive option dump.

## Edges & lifecycle
- Design empty, loading, error, partial, and permission-restricted states — the
  product is judged on its bad days too.
- Consider who can see/do what (roles), and what happens at scale and over time.

## Process
1. Restate the user goal + the 1–3 questions the work must answer.
2. List candidate elements; kill any that fail the "earns its place" test.
3. Define the smallest valuable slice; note what's deferred and why.
4. Specify states, permissions, and the honest data story.
5. Define "done" as an observable user outcome, not a checklist of widgets.

## Anti-patterns
- Feature/metric soup; dashboards full of un-actionable numbers.
- Fake AI insights, invented growth %, unexplained engagement scores.
- Building the maximal version when a focused one wins.

## Definition of done
The user can accomplish the job quickly; every shown element is defined,
sourced, and actionable; data is honest; states + roles handled; scope is the
right size.
