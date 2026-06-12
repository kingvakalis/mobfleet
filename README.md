# MobFleet — Cloud-Phone Fleet

A control-plane dashboard for a fleet of rented iOS cloud phones: watch the fleet as a
live node constellation, drill into any device, dispatch content-upload jobs at scale,
and provision/retire capacity — all visually.

**Live:** https://phone-farm-app.vercel.app

## Design

"Mission control meets Vercel" — pure-black cinematic canvas, hairline HUD framing,
monospace telemetry, and crisp geometric cards. All motion is expo-out, 60fps, and
respects `prefers-reduced-motion`.

## Features

- **Fleet graph** — every phone is a node (live screen, status ring, region) wired to a
  central orchestrator core. Pan/zoom/fit, warp-in on provision, dissolve on retire,
  data-pulses along active edges.
- **Device console** — double-click a phone for a right-side drawer with an interactive
  phone (tap · home · wake/lock · screenshot), full telemetry, and a live log stream.
- **Jobs** — Vercel-style pipeline table with filters, durations, retry, and a dispatch flow.
- **Scale** — provision/retire the pool with live animation and a max-capacity guard.
- **Command palette** — `⌘/Ctrl-K` for every action; fully keyboard-navigable.
- **Every state designed** — loading, empty, error, offline node, failed job.

## Stack

React 19 · TypeScript · Vite · Tailwind · React Flow (`@xyflow/react`) · Framer Motion ·
zustand · cmdk · self-hosted Geist / JetBrains Mono.

The entire backend is mocked behind a typed `ProviderClient`
([`src/lib/provider`](src/lib/provider)) with an in-memory adapter + a self-driving live
feed, so the UI runs standalone. Point that one seam at a real API to go live — the UI
doesn't change.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build
```

The design-system reference lives at `/#style`.
