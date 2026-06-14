/** App catalogue rendered on the live phone's springboard and dock. */

export interface AppDef {
  name: string
  abbr: string
  bg: string
  border?: string
  textColor?: string
}

export const GRID_APPS: AppDef[] = [
  { name: 'Messages',  abbr: 'Me', bg: '#22c55e' },
  { name: 'Safari',    abbr: 'Sa', bg: 'linear-gradient(135deg,#0ea5e9,#2dd4bf)' },
  { name: 'Instagram', abbr: 'In', bg: 'linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045)' },
  { name: 'TikTok',    abbr: 'Ti', bg: '#000', border: '#ff0050' },
  { name: 'Telegram',  abbr: 'Te', bg: '#2aabee' },
  { name: 'WhatsApp',  abbr: 'Wh', bg: '#25d366' },
  { name: 'Facebook',  abbr: 'Fb', bg: '#1877f2' },
  { name: 'Photos',    abbr: 'Ph', bg: 'linear-gradient(135deg,#ff9500,#ff2d55,#af52de,#32ade6)' },
  { name: 'Settings',  abbr: 'Se', bg: '#636366' },
  { name: 'Mail',      abbr: 'Ma', bg: '#0a84ff' },
  { name: 'Notes',     abbr: 'No', bg: '#ffd60a', textColor: '#000' },
  { name: 'Files',     abbr: 'Fi', bg: '#1d6ce6' },
]

export const DOCK_APPS: AppDef[] = [
  { name: 'Phone',    abbr: 'Ph', bg: '#22c55e' },
  { name: 'Safari',   abbr: 'Sa', bg: '#0a84ff' },
  { name: 'Messages', abbr: 'Me', bg: '#22c55e' },
  { name: 'Music',    abbr: 'Mu', bg: 'linear-gradient(135deg,#ff2d55,#ff9500)' },
]

export const ALL_APPS: AppDef[] = [
  ...GRID_APPS,
  ...DOCK_APPS.filter((d) => !GRID_APPS.some((g) => g.name === d.name)),
]
