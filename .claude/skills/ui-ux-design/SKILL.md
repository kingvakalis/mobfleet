---
name: ui-ux-design
description: Use when designing, building, or reviewing any user-facing interface, layout, component, flow, visual styling, interaction, or motion. Apply for new screens/components, redesigns, "make this look better", and UX critiques. Enforces design-system fidelity, visual hierarchy, interaction states, and motion discipline.
---

# UI/UX Design

Senior product-design judgment for building interfaces that feel native to the
existing product — not generic templates.

## When to use
Any time the work touches what a user sees or does: a new component, a layout,
restyling, a flow, an empty/error state, or a "make it more premium/reactive"
request.

## First, absorb the existing system (never invent in a vacuum)
- Read the design tokens and shared primitives before writing UI: CSS variables
  (`--bg-*`, `--accent-*`, `--status-*`), shared `Card`/`Button`/`StatusDot`,
  spacing/radius scale, the `mono`/`label` type classes, motion easings.
- Reuse the page pattern that already exists (e.g. header → KPI row → toolbar →
  table/content → drawer). New screens should be indistinguishable in DNA from
  shipped ones.

## Core principles
- **Hierarchy first.** One primary action per view; size, weight, and contrast
  encode importance. If everything is bold, nothing is.
- **Clarity over decoration.** Every element earns its place by answering a user
  question. Delete ornament that doesn't.
- **Consistency is a feature.** Same control = same look/behavior everywhere.
  Borrow components; don't fork them.
- **Respect density.** Match the product's information density; don't drop a
  spacious marketing layout into a dense operations console (or vice versa).
- **State completeness.** Every interactive element designs all of: default,
  hover, focus-visible, active, disabled, loading, empty, error.
- **Content-true.** Design with realistic data (long names, zero, huge numbers,
  missing fields) — never lorem ipsum that hides overflow/wrap bugs.

## Motion discipline
- Motion clarifies cause→effect; it is never decoration. Use the product's
  shared easing (e.g. expo-out) and durations (150–400ms).
- Interactions should feel reactive: press feedback, springy drag, settle on
  release. Avoid bounce on functional UI; avoid gratuitous parallax/glow.
- Always honor `prefers-reduced-motion` — provide a static equivalent.

## Process
1. State the user's goal and the single most important thing this view must
   communicate within ~2 seconds.
2. Sketch hierarchy (what's primary/secondary/tertiary) before pixels.
3. Build with shared primitives + tokens; only introduce a new primitive when
   it'll be reused.
4. Walk every state (above) and every breakpoint.
5. Self-critique: squint test (does hierarchy survive?), contrast check, "could
   a new user act in 5s?".

## Anti-patterns
- Random accent colors / one-off hex values instead of tokens.
- Bright gradients, heavy glows, "gaming" aesthetics in a professional tool.
- Tiny unreadable charts, huge empty charts, pie charts for everything.
- Buttons that look identical but do different-severity things.
- Hover-only affordances (breaks touch + keyboard).

## Definition of done
Looks like it shipped with the rest of the product; hierarchy is obvious; all
states handled; motion purposeful and reduced-motion-safe; realistic content
doesn't break the layout.
