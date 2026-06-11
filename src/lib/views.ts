export type ViewId =
  | 'fleet'
  | 'phones'
  | 'groups'
  | 'proxies'
  | 'automations'
  | 'jobs'
  | 'scale'
  | 'logs';

export interface ViewMeta {
  id: ViewId;
  label: string;
  icon: string;
}

export const VIEWS: ViewMeta[] = [
  { id: 'fleet',       label: 'Fleet',       icon: 'network' },
  { id: 'phones',      label: 'Phones',      icon: 'smartphone' },
  { id: 'groups',      label: 'Groups',      icon: 'layers' },
  { id: 'proxies',     label: 'Proxies',     icon: 'shield' },
  { id: 'automations', label: 'Automations', icon: 'zap' },
  { id: 'jobs',        label: 'Jobs',        icon: 'briefcase' },
  { id: 'scale',       label: 'Scale',       icon: 'sliders' },
  { id: 'logs',        label: 'Logs',        icon: 'terminal' },
];
