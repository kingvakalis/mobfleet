import { useState, useEffect, useRef } from 'react'
import { client } from '@/lib/provider'

export interface ActivityEvent {
  id: string
  ts: string
  device: string
  type: string
  message: string
  level: 'OK' | 'INFO' | 'WARN' | 'ERROR'
}

const EVENT_POOL = [
  { type: 'Connected',    message: 'Device came online',         level: 'OK'    },
  { type: 'Automation',   message: 'Instagram warmup started',   level: 'INFO'  },
  { type: 'Screenshot',   message: 'Screen captured',            level: 'OK'    },
  { type: 'App Launch',   message: 'Instagram opened',            level: 'OK'    },
  { type: 'Warning',      message: 'High memory usage detected',  level: 'WARN'  },
  { type: 'Job Done',     message: 'Follow-flow completed',       level: 'OK'    },
  { type: 'Error',        message: 'Command failed: timeout',     level: 'ERROR' },
  { type: 'Session',      message: 'Session refreshed',          level: 'INFO'  },
  { type: 'Disconnected', message: 'Device went offline',        level: 'WARN'  },
]

export function useActivityFeed(paused: boolean) {
  const [events, setEvents] = useState<ActivityEvent[]>(() =>
    Array.from({ length: 12 }, (_, i) => makeEvent(i))
  )
  const counterRef = useRef(100)

  useEffect(() => {
    if (paused) return
    const iv = setInterval(() => {
      setEvents(prev => [makeEvent(counterRef.current++), ...prev].slice(0, 40))
    }, 2800)
    return () => clearInterval(iv)
  }, [paused])

  return events
}

// Device names from live snapshot, fallback to generic
const FALLBACK_NAMES = ['DEV-A1','DEV-B2','DEV-C3','DEV-D4','DEV-E5','DEV-F6','DEV-G7','DEV-H8']

function makeEvent(seed: number): ActivityEvent {
  const snapshot = client.getSnapshot()
  const devs = snapshot?.devices ?? []
  const pool = devs.length > 0 ? devs.map(d => ({ name: d.name })) : FALLBACK_NAMES.map(n => ({ name: n }))
  const device = pool[seed % pool.length]
  const evt = EVENT_POOL[seed % EVENT_POOL.length]
  const now = new Date()
  return {
    id: 'evt-' + seed + '-' + Date.now(),
    ts:
      now.getHours().toString().padStart(2, '0') +
      ':' +
      now.getMinutes().toString().padStart(2, '0') +
      ':' +
      now.getSeconds().toString().padStart(2, '0'),
    device: device.name,
    type: evt.type,
    message: evt.message,
    level: evt.level as ActivityEvent['level'],
  }
}
