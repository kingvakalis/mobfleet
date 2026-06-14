/**
 * Controlled theme system. Every preset only swaps the shared CSS variables —
 * no component owns theme values. Semantic status colors are NOT themeable
 * (online stays green, warning amber, error red, busy blue).
 *
 * `--bg-base-rgb` is an R G B triplet so Tailwind's `black/<alpha>` utilities
 * keep working across themes.
 */

import type { WorkspaceSettings } from '@/state/settings-store'

export type ThemeId = 'obsidian' | 'graphite' | 'midnight' | 'titanium' | 'oled'
export type AccentId = 'teal' | 'cyan' | 'blue' | 'emerald' | 'mono'

interface ThemeVars {
  base: string
  baseRgb: string
  surface: string
  elevated: string
  hover: string
  border: string
  borderBright: string
}

export const THEMES: Record<ThemeId, { label: string; desc: string; vars: ThemeVars }> = {
  obsidian: {
    label: 'Obsidian',
    desc: 'Near-black, cool borders',
    vars: {
      base: '#07090D', baseRgb: '7 9 13',
      surface: '#0B0F15', elevated: '#0E131B', hover: '#121924',
      border: 'rgba(148,163,184,0.10)', borderBright: 'rgba(148,163,184,0.22)',
    },
  },
  graphite: {
    label: 'Graphite',
    desc: 'Layered dark gray, minimal glow',
    vars: {
      base: '#0B0C0E', baseRgb: '11 12 14',
      surface: '#101214', elevated: '#15171A', hover: '#1A1D21',
      border: 'rgba(170,175,185,0.10)', borderBright: 'rgba(170,175,185,0.22)',
    },
  },
  midnight: {
    label: 'Midnight',
    desc: 'Deep navy, atmospheric',
    vars: {
      base: '#060A16', baseRgb: '6 10 22',
      surface: '#0A101F', elevated: '#0D1527', hover: '#111B31',
      border: 'rgba(125,150,200,0.12)', borderBright: 'rgba(125,150,200,0.26)',
    },
  },
  titanium: {
    label: 'Titanium',
    desc: 'Dark metallic, silver borders',
    vars: {
      base: '#0C0D0F', baseRgb: '12 13 15',
      surface: '#121316', elevated: '#17181C', hover: '#1D1F24',
      border: 'rgba(200,205,215,0.10)', borderBright: 'rgba(200,205,215,0.24)',
    },
  },
  oled: {
    label: 'OLED Black',
    desc: 'True black, high contrast',
    vars: {
      base: '#000000', baseRgb: '0 0 0',
      surface: '#060606', elevated: '#0B0B0B', hover: '#121212',
      border: 'rgba(160,165,175,0.14)', borderBright: 'rgba(160,165,175,0.30)',
    },
  },
}

interface AccentVars {
  accent: string
  soft: string
  border: string
  text: string
}

export const ACCENTS: Record<AccentId, { label: string; vars: AccentVars }> = {
  teal:    { label: 'Teal',    vars: { accent: '#2dd4bf', soft: 'rgba(45,212,191,0.12)',  border: 'rgba(45,212,191,0.35)',  text: '#7ce8da' } },
  cyan:    { label: 'Cyan',    vars: { accent: '#22d3ee', soft: 'rgba(34,211,238,0.12)',  border: 'rgba(34,211,238,0.35)',  text: '#7de7f7' } },
  blue:    { label: 'Blue',    vars: { accent: '#60a5fa', soft: 'rgba(96,165,250,0.12)',  border: 'rgba(96,165,250,0.35)',  text: '#a5c9fd' } },
  emerald: { label: 'Emerald', vars: { accent: '#34d399', soft: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.35)',  text: '#86eac1' } },
  mono:    { label: 'Mono',    vars: { accent: '#e5e7eb', soft: 'rgba(229,231,235,0.10)', border: 'rgba(229,231,235,0.30)', text: '#f3f4f6' } },
}

/** Group highlight palette — controlled, theme-agnostic, readable on dark. */
export const GROUP_PALETTE = ['#2dd4bf', '#60a5fa', '#f59e0b', '#a78bfa', '#f472b6', '#34d399'] as const

type AppearanceSlice = Pick<WorkspaceSettings, 'theme' | 'accent' | 'surface' | 'density'>

/** Write a preset's variables onto any element (documentElement for the app,
 *  a preview container for the Settings live preview). */
export function appearanceStyle(a: AppearanceSlice): Record<string, string> {
  const t = THEMES[a.theme]?.vars ?? THEMES.obsidian.vars
  const ac = ACCENTS[a.accent]?.vars ?? ACCENTS.teal.vars
  return {
    '--bg-base': t.base,
    '--bg-base-rgb': t.baseRgb,
    '--bg-surface': t.surface,
    '--bg-elevated': t.elevated,
    '--bg-card': t.elevated,
    '--bg-hover': t.hover,
    '--border': t.border,
    '--border-bright': t.borderBright,
    '--canvas': t.base,
    '--panel': t.surface,
    '--elevated': t.elevated,
    '--color-surface': t.surface,
    '--color-surface-2': t.elevated,
    '--color-border': t.border,
    '--accent': ac.accent,
    '--accent-soft': ac.soft,
    '--accent-border': ac.border,
    '--accent-text': ac.text,
    '--color-accent': ac.accent,
  }
}

/** Apply appearance globally. Called before first render and on every change. */
export function applyAppearance(a: AppearanceSlice) {
  const root = document.documentElement
  for (const [k, v] of Object.entries(appearanceStyle(a))) root.style.setProperty(k, v)
  root.dataset.theme = a.theme
  root.dataset.surface = a.surface
  root.dataset.density = a.density
}
