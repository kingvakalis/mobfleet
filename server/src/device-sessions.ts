import { randomUUID } from 'node:crypto'
import { prisma } from './db'
import type { DeviceSessionRecord } from '../../src/shared/types'

/**
 * Device-agent connection sessions. One row per authenticated /ws?deviceKey=…
 * connection: opened when the agent authenticates, closed (endedAt set) when
 * that exact socket disconnects. Timestamps are epoch ms (Date.now()), matching
 * every other Float timestamp in this backend.
 *
 * Persistence here is NON-CRITICAL (it's connection history) — a failure must
 * never break the live socket, so open/close swallow + log their errors (never
 * the device key).
 */

/** The minimal row shape the mapper needs (a superset of the Prisma model). */
export interface DeviceSessionRow {
  id: string
  deviceId: string
  startedAt: number
  endedAt: number | null
  agentVersion: string | null
}

/**
 * Open one session row for an authenticated device-agent connection. Returns the
 * new id, or null if persistence failed (logged safely). The caller stores the id
 * on that specific socket's context and closes exactly that row on disconnect.
 */
export async function openDeviceSession(input: {
  teamId: string
  deviceId: string
  agentVersion: string | null
  now: number
}): Promise<string | null> {
  const id = `devsess_${randomUUID()}`
  try {
    await prisma.deviceSession.create({
      data: {
        id,
        teamId: input.teamId,
        deviceId: input.deviceId,
        startedAt: input.now,
        endedAt: null,
        agentVersion: input.agentVersion,
      },
    })
    console.log(JSON.stringify({ event: 'device.session.open', teamId: input.teamId, deviceId: input.deviceId, sessionId: id }))
    return id
  } catch (err) {
    // Never log the device key; session history is non-critical → continue.
    console.error(JSON.stringify({
      event: 'device.session.open.error',
      teamId: input.teamId,
      deviceId: input.deviceId,
      error: err instanceof Error ? err.message : 'error',
    }))
    return null
  }
}

/**
 * Close a SPECIFIC session by id. Idempotent: the `endedAt: null` filter means a
 * duplicate/late close never overwrites the first end timestamp, and closing a
 * session some OTHER socket already reconnected past is impossible (we close only
 * the id this connection opened). Never throws.
 */
export async function closeDeviceSession(sessionId: string, now: number): Promise<void> {
  try {
    await prisma.deviceSession.updateMany({
      where: { id: sessionId, endedAt: null },
      data: { endedAt: now },
    })
  } catch (err) {
    console.error(JSON.stringify({
      event: 'device.session.close.error',
      sessionId,
      error: err instanceof Error ? err.message : 'error',
    }))
  }
}

/** The latest 20 sessions for a device WITHIN a team. The teamId condition is
 *  kept (defense in depth) even though the caller already proved ownership. */
export function listDeviceSessions(teamId: string, deviceId: string): Promise<DeviceSessionRow[]> {
  return prisma.deviceSession.findMany({
    where: { teamId, deviceId },
    orderBy: { startedAt: 'desc' },
    take: 20,
  })
}

/** Map a row to the shared DeviceSessionRecord. Computes durationMs (null while
 *  the session is still open); never exposes teamId. */
export function toDeviceSessionRecord(row: DeviceSessionRow): DeviceSessionRecord {
  return {
    id: row.id,
    deviceId: row.deviceId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationMs: row.endedAt === null ? null : row.endedAt - row.startedAt,
    agentVersion: row.agentVersion,
  }
}
