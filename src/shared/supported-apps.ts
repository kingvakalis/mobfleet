/**
 * SHARED supported-app catalog — the single source of truth for which apps the device
 * agent probes for installation and how the dashboard labels them. Alias-free (no `@/`)
 * so the Node device-agent imports it directly, exactly like shared/schemas.ts.
 *
 * IMPORTANT: this is only the set of bundle ids the agent KNOWS HOW TO CHECK. An app is
 * shown in the UI ONLY if the agent detected it installed on that specific device
 * (device_apps.installed = true) — never because it's in this list.
 */
export interface SupportedApp {
  /** Reverse-DNS iOS bundle id (what Appium activates / queries / terminates). */
  bundleId: string
  name: string
  /** 2-char label for the icon tile. */
  abbr: string
  /** CSS background (solid or gradient) for the icon tile. */
  color: string
}

export const SUPPORTED_APPS: readonly SupportedApp[] = [
  { bundleId: 'com.burbn.instagram',     name: 'Instagram', abbr: 'In', color: 'linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045)' },
  { bundleId: 'ph.telegra.Telegraph',    name: 'Telegram',  abbr: 'Te', color: '#2aabee' }, // real Telegram iOS id (reverse-DNS of telegra.ph); NOT ph.telegram.Telegraph
  { bundleId: 'com.facebook.Facebook',   name: 'Facebook',  abbr: 'Fb', color: '#1877f2' },
  { bundleId: 'net.whatsapp.WhatsApp',   name: 'WhatsApp',  abbr: 'Wh', color: '#25d366' },
  { bundleId: 'com.zhiliaoapp.musically', name: 'TikTok',   abbr: 'Ti', color: '#000000' },
  { bundleId: 'com.apple.mobilesafari',  name: 'Safari',    abbr: 'Sa', color: '#0a84ff' },
  { bundleId: 'com.apple.Preferences',   name: 'Settings',  abbr: 'Se', color: '#636366' },
  { bundleId: 'com.apple.AppStore',      name: 'App Store', abbr: 'AS', color: 'linear-gradient(135deg,#1d6ce6,#0a84ff)' },
] as const

/** A bundle id is "system" (Apple) when it lives under com.apple.* */
export function appSource(bundleId: string): 'system' | 'detected' {
  return bundleId.startsWith('com.apple.') ? 'system' : 'detected'
}

export const SUPPORTED_BUNDLE_IDS: readonly string[] = SUPPORTED_APPS.map((a) => a.bundleId)
