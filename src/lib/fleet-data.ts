export type PhoneStatus = 'online' | 'offline' | 'warning' | 'booting' | 'running'
export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'OK'

export type Phone = {
  id: string
  name: string
  group: string
  status: PhoneStatus
  os: string
  model: string
  region: string
  proxyIp: string
  proxyStatus: 'healthy' | 'issue' | 'disconnected'
  uptime: string
  lastActivity: string
  job: string
  battery: number
  assignedUser: string
}

export type Proxy = {
  id: string
  ip: string
  port: number
  region: string
  provider: string
  latencyMs: number
  status: 'healthy' | 'failing' | 'unassigned'
  assignedTo: string | null
}

export type Group = {
  id: string
  name: string
  description: string
  phoneCount: number
  activeJobs: number
}

export type Automation = {
  id: string
  name: string
  description: string
  status: 'active' | 'paused'
  lastRun: string
  successRate: number
  totalRuns: number
  tags: string[]
}

export type LogEntry = {
  id: string
  ts: string
  level: LogLevel
  device: string
  message: string
}

const REGIONS = ['AP-SOUTH', 'EU-WEST', 'US-EAST', 'US-WEST', 'SA-EAST']
const OS_VERSIONS = ['iOS 17.5.1', 'iOS 17.4', 'iOS 16.7', 'iOS 17.5.1', 'iOS 17.5.1']
const MODELS = ['iPhone SE', 'iPhone 12', 'iPhone 13', 'iPhone 14', 'iPhone 11']
const GROUPS = ['Instagram Farm', 'TikTok Farm', 'Warmup Pool', 'Carolina', 'Lucia']
const JOBS = ['ig-warmup', 'story-view', 'follow-flow', 'dm-sequence', 'idle', 'app-check']
const USERS = ['dimitris', 'carolina', 'lucia', 'amber', 'polina']

function rng(seed: number) {
  let s = seed
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return Math.abs(s) / 0x7fffffff }
}

export const phones: Phone[] = Array.from({ length: 48 }, (_, i) => {
  const r = rng(i * 7 + 3)
  const statuses: PhoneStatus[] = ['online', 'online', 'online', 'running', 'running', 'warning', 'offline', 'booting']
  const proxyStatuses: Phone['proxyStatus'][] = ['healthy', 'healthy', 'healthy', 'issue', 'disconnected']
  return {
    id: \`phone-\${String(i + 1).padStart(3, '0')}\`,
    name: \`iPhone-\${String(i + 1).padStart(3, '0')}\`,
    group: GROUPS[Math.floor(r() * GROUPS.length)],
    status: statuses[Math.floor(r() * statuses.length)],
    os: OS_VERSIONS[Math.floor(r() * OS_VERSIONS.length)],
    model: MODELS[Math.floor(r() * MODELS.length)],
    region: REGIONS[Math.floor(r() * REGIONS.length)],
    proxyIp: \`\${Math.floor(r()*200)+10}.\${Math.floor(r()*255)}.\${Math.floor(r()*255)}.\${Math.floor(r()*255)}\`,
    proxyStatus: proxyStatuses[Math.floor(r() * proxyStatuses.length)],
    uptime: \`\${Math.floor(r() * 72)}h \${Math.floor(r() * 60)}m\`,
    lastActivity: \`\${Math.floor(r() * 30) + 1}m ago\`,
    job: JOBS[Math.floor(r() * JOBS.length)],
    battery: Math.floor(r() * 60) + 40,
    assignedUser: USERS[Math.floor(r() * USERS.length)],
  }
})

export const groups: Group[] = GROUPS.map((name, i) => ({
  id: \`g-\${i}\`,
  name,
  description: ['Instagram growth accounts', 'TikTok content farm', 'New account warmup', 'Carolina managed accounts', 'Lucia managed accounts'][i],
  phoneCount: phones.filter(p => p.group === name).length,
  activeJobs: phones.filter(p => p.group === name && (p.status === 'running' || p.status === 'online')).length,
}))

export const proxies: Proxy[] = [
  { id: 'px-1', ip: '104.18.32.11', port: 8080, region: 'US-East', provider: 'Bright Data', latencyMs: 42, status: 'healthy', assignedTo: 'iPhone-001' },
  { id: 'px-2', ip: '185.220.101.44', port: 8080, region: 'EU-NL', provider: 'Oxylabs', latencyMs: 67, status: 'healthy', assignedTo: 'iPhone-002' },
  { id: 'px-3', ip: '91.108.4.17', port: 3128, region: 'EU-DE', provider: 'Smartproxy', latencyMs: 134, status: 'failing', assignedTo: null },
  { id: 'px-4', ip: '172.64.80.1', port: 8888, region: 'APAC-SG', provider: 'Bright Data', latencyMs: 188, status: 'failing', assignedTo: 'iPhone-010' },
  { id: 'px-5', ip: '198.199.86.11', port: 8080, region: 'US-West', provider: 'Oxylabs', latencyMs: 55, status: 'healthy', assignedTo: null },
  { id: 'px-6', ip: '10.0.0.44', port: 1080, region: 'EU-PL', provider: 'IPRoyal', latencyMs: 0, status: 'unassigned', assignedTo: null },
  { id: 'px-7', ip: '203.0.113.88', port: 8080, region: 'APAC-JP', provider: 'Smartproxy', latencyMs: 210, status: 'healthy', assignedTo: 'iPhone-030' },
  { id: 'px-8', ip: '192.0.2.55', port: 3128, region: 'US-Central', provider: 'Bright Data', latencyMs: 48, status: 'healthy', assignedTo: 'iPhone-031' },
]

export const automations: Automation[] = [
  { id: 'a-1', name: 'Instagram Warmup', description: 'Scroll, like, and follow to warm up new accounts naturally', status: 'active', lastRun: '2m ago', successRate: 94, totalRuns: 1240, tags: ['ig', 'warmup'] },
  { id: 'a-2', name: 'Account Health Check', description: 'Verify login status, reach, and account standing', status: 'active', lastRun: '5m ago', successRate: 99, totalRuns: 3892, tags: ['health'] },
  { id: 'a-3', name: 'TikTok Warmup', description: 'Watch videos, follow creators, engage with feed', status: 'paused', lastRun: '1h ago', successRate: 88, totalRuns: 567, tags: ['tt', 'warmup'] },
  { id: 'a-4', name: 'App Install Flow', description: 'Install and configure apps on fresh devices', status: 'active', lastRun: '30m ago', successRate: 97, totalRuns: 204, tags: ['setup'] },
  { id: 'a-5', name: 'Story View', description: 'View stories from followed accounts naturally', status: 'active', lastRun: '8m ago', successRate: 96, totalRuns: 2110, tags: ['ig'] },
  { id: 'a-6', name: 'DM Sequence', description: 'Send scheduled DM sequences to target lists', status: 'paused', lastRun: '3h ago', successRate: 81, totalRuns: 389, tags: ['dm'] },
  { id: 'a-7', name: 'Refresh Session', description: 'Re-authenticate and refresh account sessions', status: 'active', lastRun: '15m ago', successRate: 93, totalRuns: 778, tags: ['auth'] },
]

const LOG_MSGS: Record<LogLevel, string[]> = {
  INFO:  ['Session started', 'App launched', 'Feed loaded', 'Story viewed', 'Follow action queued', 'Proxy connected', 'Heartbeat OK'],
  WARN:  ['Proxy latency high', 'Rate limit approaching', 'Battery below 20%', 'Slow response from server'],
  ERROR: ['Login failed', 'Proxy disconnected', 'App crash detected', 'Session expired'],
  OK:    ['Automation completed', 'Account check passed', 'Session refreshed', 'Job finished'],
}

export function buildLogs(count = 80): LogEntry[] {
  const levels: LogLevel[] = ['INFO','INFO','INFO','INFO','OK','WARN','ERROR']
  return Array.from({ length: count }, (_, i) => {
    const r = rng(i * 13 + 7)
    const level = levels[Math.floor(r() * levels.length)]
    const msgs = LOG_MSGS[level]
    const phone = phones[Math.floor(r() * phones.length)]
    const mins = Math.floor(r() * 60)
    const secs = Math.floor(r() * 60)
    return {
      id: \`log-\${i}\`,
      ts: \`\${mins}m \${secs}s ago\`,
      level,
      device: phone.name,
      message: msgs[Math.floor(r() * msgs.length)],
    }
  }).reverse()
}

export const statusMeta: Record<PhoneStatus, { label: string; color: string }> = {
  online:  { label: 'Online',  color: '#22c55e' },
  running: { label: 'Running', color: '#818cf8' },
  warning: { label: 'Warning', color: '#f59e0b' },
  offline: { label: 'Offline', color: '#6b7280' },
  booting: { label: 'Booting', color: '#38bdf8' },
}