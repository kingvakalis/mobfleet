import { useEffect, useState } from 'react'

/**
 * A clock that re-renders on an interval, so time-derived UI (e.g. heartbeat
 * freshness: "green if < 30s since last beat, else red") keeps updating even
 * when no new data arrives — a device that goes silent turns red on its own.
 * Returns the current epoch ms.
 */
export function useNow(periodMs = 2000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), periodMs)
    return () => clearInterval(id)
  }, [periodMs])
  return now
}
