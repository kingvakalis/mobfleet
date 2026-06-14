---
name: accessibility
description: Use when building or reviewing any UI for keyboard, screen-reader, contrast, motion, and semantic correctness. Apply to forms, modals/drawers, tables, charts, menus, custom controls, and any "make it accessible / a11y review" request. Targets WCAG 2.1 AA.
---

# Accessibility (WCAG 2.1 AA)

Make interfaces usable by keyboard, screen reader, and assistive tech — built in,
not bolted on.

## When to use
Every interactive component, plus a dedicated pass before shipping a feature.

## Non-negotiables
- **Keyboard:** every action reachable and operable without a mouse; logical tab
  order; visible `:focus-visible`; no keyboard traps. Custom controls handle
  Enter/Space/Arrow/Escape as a native one would.
- **Semantics:** use the right element (`button` for actions, `a` for nav, real
  `table/th[scope]`, `label` tied to inputs). Reach for ARIA only when no native
  element fits; a wrong role is worse than none.
- **Names:** every control/icon-button/image has an accessible name
  (`aria-label`, label text, or alt). Decorative elements get `aria-hidden`.
- **Status beyond color:** never encode meaning by color alone — pair with text,
  icon, or shape. (Status pills, risk badges, progress.)
- **Contrast:** text ≥ 4.5:1 (≥ 3:1 for large/UI affordances). Verify accent-on-
  dark and muted text.
- **Reduced motion:** honor `prefers-reduced-motion`; provide a static path for
  every animation.

## Component patterns
- **Modal/drawer:** `role="dialog" aria-modal`, labelled by its title, Escape
  closes, focus moves in and is restored on close, background inert.
- **Tabs:** `role="tablist"/"tab"` with `aria-selected`; arrow-key navigation.
- **Menu/listbox/combobox:** correct roles + arrow/typeahead + `aria-expanded`.
- **Charts/visualizations:** never the *only* way to read data — add an
  `sr-only` text summary or an equivalent table; give bars/segments labels.
- **Progress bars:** `role="progressbar"` + `aria-valuenow/min/max` + label.
- **Live regions:** announce async results/toasts with `aria-live` politely.
- **Tables:** `<th scope="col|row">`, caption/labelled region, real header rows.

## Process
1. Build with native semantics first.
2. Tab through the whole feature; confirm focus order + visible focus + Escape.
3. Check every icon-only button has a name; every chart has a text equivalent.
4. Verify no color-only status; check contrast on text and key affordances.
5. Toggle reduced-motion and confirm nothing breaks/disappears.

## Anti-patterns
- `div`/`span` with `onClick` and no role/tabindex/key handling.
- Placeholder used as the only label; icon buttons with no `aria-label`.
- Focus lost into the void after closing a dialog.
- Color-only success/error; 2px low-contrast focus rings removed for looks.

## Definition of done
Fully keyboard-operable with visible focus; SR-meaningful names + text
equivalents for visuals; status conveyed beyond color; AA contrast; reduced-
motion safe.
