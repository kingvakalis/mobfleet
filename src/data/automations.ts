import type { TaskType } from '@/lib/provider/types'

export interface Automation {
  id: string
  name: string
  description: string
  /** Maps to the underlying job task type. */
  taskType: TaskType
  successRate: number
  runs: number
  lastRun: string
}

/** Pre-built flows operators run across devices or groups. */
export const AUTOMATIONS: Automation[] = [
  {
    id: 'ig-warmup',
    name: 'Instagram Warmup',
    description: 'Human-like browsing, likes, and story views to age accounts safely.',
    taskType: 'warmup',
    successRate: 98,
    runs: 1240,
    lastRun: '4 min ago',
  },
  {
    id: 'tiktok-warmup',
    name: 'TikTok Warmup',
    description: 'Scroll, watch, and engage loop tuned per region and device.',
    taskType: 'warmup',
    successRate: 95,
    runs: 880,
    lastRun: '12 min ago',
  },
  {
    id: 'content-upload',
    name: 'Content Upload',
    description: 'Publishes queued media with captions across assigned accounts.',
    taskType: 'upload',
    successRate: 96,
    runs: 2025,
    lastRun: 'just now',
  },
  {
    id: 'account-check',
    name: 'Account Check',
    description: 'Verifies login state, shadow-ban signals, and challenge prompts.',
    taskType: 'engage',
    successRate: 99,
    runs: 3010,
    lastRun: '1 hour ago',
  },
  {
    id: 'app-install',
    name: 'App Install Flow',
    description: 'Installs and configures target apps from a clean state.',
    taskType: 'post',
    successRate: 92,
    runs: 410,
    lastRun: 'yesterday',
  },
  {
    id: 'proxy-rotation',
    name: 'Proxy Rotation',
    description: 'Rotates proxies on schedule with health verification.',
    taskType: 'engage',
    successRate: 100,
    runs: 2200,
    lastRun: '30 min ago',
  },
]

export function automationById(id: string): Automation | undefined {
  return AUTOMATIONS.find((a) => a.id === id)
}
