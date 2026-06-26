/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    // Tokens live as CSS variables in index.css (single source of truth);
    // Tailwind just maps utility names onto them.
    extend: {
      colors: {
        // Layered near-black foundation — `black` deliberately remapped onto
        // the theme token (RGB triplet keeps `black/40` alpha utilities
        // working). True black stays available as `pure-black` for phone glass.
        black: 'rgb(var(--bg-base-rgb) / <alpha-value>)',
        'pure-black': '#000000',
        canvas: 'var(--canvas)',
        panel: 'var(--panel)',
        elevated: 'var(--elevated)',
        hover: 'var(--bg-hover)',
        line: 'var(--border)', // hairline border color (avoids clashing with `border` width utils)
        fg: {
          DEFAULT: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        status: {
          online: 'var(--status-online)',
          busy: 'var(--status-busy)',
          warming: 'var(--status-warming)',
          offline: 'var(--status-offline)',
          error: 'var(--status-error)',
        },
        accent: 'var(--accent)',
      },
      borderColor: {
        DEFAULT: 'var(--border)',
      },
      borderRadius: {
        card: '10px',
        control: '6px',
      },
      fontFamily: {
        // Global UI font: Helvetica everywhere (self-hosted Arimo is the metric-identical off-Mac fallback).
        sans: ['Helvetica', '"Helvetica Neue"', 'Arimo', 'Arial', 'sans-serif'],
        // Monospace stays Geist/JetBrains — intentional for IDs / logs / telemetry / technical labels.
        mono: ['"Geist Mono"', '"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        label: '0.12em',
      },
      transitionTimingFunction: {
        'expo-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'ring-pulse': {
          '0%, 100%': { opacity: '0.9', transform: 'scale(1)' },
          '50%': { opacity: '0.35', transform: 'scale(1.09)' },
        },
        'spinner-fade': {
          '0%': { opacity: '1' },
          '100%': { opacity: '0.15' },
        },
      },
      animation: {
        'ring-pulse': 'ring-pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spinner-fade': 'spinner-fade 1.2s linear infinite',
      },
    },
  },
  plugins: [],
}
