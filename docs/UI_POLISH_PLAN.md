# UI Polish Plan — phone-farm-app

**Scope:** presentation + interaction pass only. Behavior-preserving. No data-flow / API / business-logic / route / state-shape changes. Branch: `ui-polish` (never prod/main).

## 0 · Recon (read-only findings)

- **Stack:** React 19 + Vite + TypeScript + Tailwind 3. (Not RN / Svelte.)
- **Animation lib already present:** **Framer Motion** (`framer-motion@12`) — used in my parts (warp-in, drawer, palette, view transitions, rolling counters) and a few v2 parts (toast, submit-job dialog, phones-view, phone-frame). Also `three` / `@react-three/fiber|drei` / `gsap` / `leva` for the collaborator's **3D fleet view** (leave that engine alone).
- **grug decision:** ONE animation approach — **Framer Motion** for all UI motion. No new animation lib.
- **Reduced-motion:** `MotionConfig reducedMotion="user"` already wraps the whole app (`main.tsx`); `useReducedMotion()` used in hot components; `prefers-reduced-motion` media query in `index.css`; `AmbientBackground` honors it. Good foundation — every new animation must degrade to instant.
- **Already animated (leave/verify only):** toasts (Framer, enter+exit), submit-job dialog, my drawer/palette/scale overlays, header rolling counters, fleet warp-in/dissolve/edge-pulse.
- **NOT animated (targets):** sidebar view switch is an abrupt swap; v2 card grids (Groups, Automations) and tables (Proxies, Jobs, Phones, Logs) pop in with no motion; Live Activity feed hard-swaps rows; phone-control-page tabs have no animated indicator/crossfade.
- **Tooling note:** `claude-mux`/tmux is **not available on this Windows box** (no tmux/bun — see env memory). I'll run the dev server in the background + `npm run build` (tsc + vite) as the watch/typecheck instead — same guarantee, captured per chunk.

---

## A · Animations to add (Framer Motion · 150–250ms · transforms/opacity only · reduced-motion-safe)

Priority order:

1. **View transitions (sidebar nav).** Crossfade + 8px directional slide when the active view changes in `AppShell` (currently an abrupt swap). `AnimatePresence mode="wait"`, ~200ms. *High impact, low risk.*
2. **Card-grid stagger enter** — Groups, Automations (and any card view). Children stagger 30–40ms, fade + rise 8px. Cap stagger for large grids.
3. **Table row enter + interaction polish** — Proxies, Jobs, Phones, Logs. Subtle first-load row fade/stagger (capped) + hover/press states.
4. **Live Activity feed** — animate new entries in (fade/slide), exit on drop, instead of hard-swapping.
5. **Modal/sheet motion from source + scrim** — verify phone-control-page and any sheets animate in from their trigger with a blur/fade scrim (submit-job dialog already does).
6. **phone-control-page tabs** — animated active indicator (`layoutId` underline) + crossfade between panels (Apps/Automations/Sessions/Logs).
7. **Micro-feedback everywhere tappable** — press scale ~0.97 (active), hover elevation, `:focus-visible` rings. Apply via shared classes / the `Button` primitive.
8. **Skeletons, not spinners** — when `snapshot.ready === false` (first WS connect), v2 data views show skeleton cards/rows instead of empty/blank.
9. **Tabular numbers on KPIs** — Groups/Proxies/Automations "Total/Active/…" stats use `tabular-nums` (and optional count-up) so live updates don't jitter.

> Easing: ease-out enter, snappier exit (~60–70% of enter). Animate 1–2 key elements per view; no chained delays that block input; all interruptible.

---

## B · Drag & Drop — only where it earns its place

- ✅ **PROPOSED (genuine): drag a phone → a group to reassign.** Persists through the **existing** `assignGroup(ids, group)` data layer — no logic change; optimistic update + rollback toast on failure (toast system already exists). Location: Phones view (drag phone cards onto a compact group drop-rail) or group dropzones. Pairs with the existing multi-select for bulk drag.
  - **Needs a new dep:** `@dnd-kit/core` + `@dnd-kit/sortable` (small, tree-shakeable, **accessible**: keyboard reordering + ARIA live announcements + handles). **Flagged for your approval.**
- ⚠️ **Bulk-select → drag to group** — same data layer; natural extension of the above.
- ❌ **Automation builder steps reorder** — the builder is a *static preview*; there is no automation-steps data model. DnD here would be decorative and require new logic/state. **Skip** (or tell me to build the steps model — that's a feature, not polish).
- ❌ **Jobs queue priority reorder** — the queue is FIFO with no order/priority field in the model or backend. Reordering ⇒ logic + backend change. **Skip** (or ask).
- ❌ Nav reorder / table column reorder / dashboard widget reorder — no persisted order ⇒ gimmicky. **Skip.**

**Honest take (grug):** this app's data model has very few naturally-orderable lists, so DnD's footprint is intentionally **one** genuine interaction (phone→group). I will not sprinkle DnD elsewhere just to add it.

---

## C · Standard good-UI gaps (ui-ux-pro-max rubric)

- **Loading / empty / error on every surface** — skeleton on first load; "No groups/jobs yet" + CTA empty states; error state with retry. (No raw spinners-as-content, no dead ends.)
- **Focus-visible rings + full keyboard nav** (§1) — sidebar items, cards, table action buttons. Verify v2 components inherit the base `:focus-visible`; add where missing.
- **Touch targets ≥44px** (§2) — several v2 buttons are `text-[10px] py-1.5`; expand hit area via padding without changing layout.
- **Press / active / disabled states** (§2) on everything tappable — active scale, disabled opacity 0.4 + cursor.
- **AA contrast** (§1/§6) — v2 leans on `text-white/25…35`; bump the lowest so secondary text ≥3:1 and body ≥4.5:1 on dark.
- **Tabular figures** (§6) on all data/number columns to prevent layout shift on live ticks.
- **aria-live** on toasts (verify) + Live Activity; labels on icon-only buttons.
- **Primitive consistency** — nudge obvious one-off buttons toward the shared `Button` (only where trivial; don't force a rewrite).

---

## D · Risk flags (I will STOP and ask if a polish goal needs logic)

- Automation-steps reorder, job-priority reorder → need a data model → **not touched**; asked above.
- 3D fleet (three/r3f/gsap) → entrance/reduced-motion polish only if safe; **no WebGL refactor**.
- `provider` / `fleet-store` / `fleet-adapter` / `use-fleet` / `ui-store` → **off limits** (data + state). Polish is presentation-only; I wrap/enhance, never rewrite.

---

## E · New dependency (approval needed)

- **`@dnd-kit/core` + `@dnd-kit/sortable`** — *only* if you approve the phone→group DnD (B). Otherwise **zero** new deps; Framer Motion (already installed) covers every animation.

---

## F · Execution & self-check (per chunk)

1. Small, additive, reversible commits on `ui-polish`.
2. `npm run build` (tsc -b + vite build) passes; fix anything introduced.
3. Re-read the diff as a hostile reviewer — confirm **no** data flow / logic / state-shape touched.
4. Screenshot via existing `scripts/shot*.mjs`; verify the **reduced-motion** path degrades to instant.
5. Real loading/empty/error verified on each surface touched.

---

## Proposed order of work (after your go)
1. View transitions + card/row stagger + micro-feedback (biggest perceived-quality lift, zero new deps).
2. Skeletons + empty/error states on v2 data views.
3. phone-control-page tabs + Live Activity feed motion.
4. A11y/contrast/touch-target sweep.
5. *(If approved)* phone→group DnD via @dnd-kit.

**Awaiting your "go" before any feature code.**
