import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from './db'

/**
 * Durable agent-command queue (Prisma). The "agent" IS the device — commands are
 * addressed by deviceId and authorized by that device's API key. The DB row is
 * the source of truth; delivery happens via an instant WS push (device-hub) OR
 * the agent's HTTP poll, and the agent ACKs the result. Every query is scoped by
 * teamId (tenant isolation) and, for agent-facing ops, by deviceId (own-rows).
 */

export type AgentCommandStatus = 'pending' | 'delivered' | 'acked' | 'failed'

/** Default time-to-deliver: an undelivered command older than this is considered
 *  expired and is never handed out (the agent was offline too long). */
const DEFAULT_TTL_MS = 10 * 60_000

/** A command marked `delivered` but not acked within this window is re-handed-out
 *  on the next poll — the durable safety net for a lost WS push / dropped frame /
 *  agent restart. Kept comfortably above the agent's command timeout (60s) so an
 *  in-flight command isn't re-delivered while still running. The agent dedups by
 *  commandId, so a re-delivered-but-already-run command is a harmless no-op. */
const REDELIVER_MS = 90_000

const newCommandId = () => `cmd-${randomUUID().replace(/-/g, '').slice(0, 16)}`

/** The command frame shape the agent already parses (agentCommandSchema). */
export interface CommandFrame {
  type: 'command'
  commandId: string
  deviceId: string
  action: string
  payload?: unknown
  issuedAt: number
  expiresAt?: number
}

type Row = {
  id: string
  deviceId: string
  action: string
  payload: Prisma.JsonValue | null
  createdAt: number
  expiresAt: number | null
}

export function toFrame(row: Row): CommandFrame {
  return {
    type: 'command',
    commandId: row.id,
    deviceId: row.deviceId,
    action: row.action,
    payload: row.payload ?? undefined,
    issuedAt: row.createdAt,
    expiresAt: row.expiresAt ?? undefined,
  }
}

/** Queue a command for a device. Returns the created row (id + frame). */
export async function queueCommand(input: {
  teamId: string
  deviceId: string
  action: string
  payload?: unknown
  issuedBy?: string
  now: number
  ttlMs?: number
}): Promise<Row & { teamId: string; status: AgentCommandStatus }> {
  const ttl = input.ttlMs ?? DEFAULT_TTL_MS
  const row = await prisma.agentCommand.create({
    data: {
      id: newCommandId(),
      teamId: input.teamId,
      deviceId: input.deviceId,
      action: input.action,
      payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      status: 'pending',
      issuedBy: input.issuedBy,
      createdAt: input.now,
      expiresAt: input.now + ttl,
    },
  })
  return row as unknown as Row & { teamId: string; status: AgentCommandStatus }
}

/**
 * Atomically hand the device its deliverable, unexpired commands and return
 * exactly the rows this call claimed — so two concurrent polls never
 * double-deliver. Deliverable = `pending`, OR `delivered` whose deliveredAt is
 * older than REDELIVER_MS (the lease expired → the prior delivery was lost, so
 * re-hand-it-out). Each claim is a conditional update keyed on the row's CURRENT
 * status, so a racing poll/push can't grab the same row. Scoped by teamId +
 * deviceId (own-rows).
 */
export async function takePendingForDevice(teamId: string, deviceId: string, now: number): Promise<CommandFrame[]> {
  const leaseFloor = now - REDELIVER_MS
  const candidates = await prisma.agentCommand.findMany({
    where: {
      teamId,
      deviceId,
      expiresAt: { gt: now },
      OR: [{ status: 'pending' }, { status: 'delivered', deliveredAt: { lt: leaseFloor } }],
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, status: true },
    take: 100,
  })
  const claimed: CommandFrame[] = []
  for (const c of candidates) {
    // Claim keyed on the status we read, so a concurrent poll/ack/push that moved
    // the row makes this update a no-op (count 0) instead of double-delivering.
    const res = await prisma.agentCommand.updateMany({
      where: { teamId, id: c.id, status: c.status },
      data: { status: 'delivered', deliveredAt: now },
    })
    if (res.count === 1) {
      const row = await prisma.agentCommand.findUnique({ where: { teamId_id: { teamId, id: c.id } } })
      if (row) claimed.push(toFrame(row as unknown as Row))
    }
  }
  return claimed
}

/**
 * Server-wide reaper: fail any command (pending OR delivered) past its expiry, so
 * a command the agent never completed becomes terminal instead of lingering
 * forever (and the row table can be purged). Global + tenant-safe — it only
 * transitions already-expired rows and reads/writes no cross-team data.
 */
export async function failExpiredCommands(now: number): Promise<number> {
  const res = await prisma.agentCommand.updateMany({
    where: { status: { in: ['pending', 'delivered'] }, expiresAt: { lte: now } },
    data: { status: 'failed', error: 'expired before completion', ackedAt: now },
  })
  return res.count
}

/** Start the periodic expiry reaper (unref'd so it never holds the process open). */
export function startAgentCommandCleanup(intervalMs = 60_000): void {
  const sweep = () => void failExpiredCommands(Date.now()).catch((e) => console.error('[agent-cmd-cleanup]', e))
  const timer = setInterval(sweep, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
}

/** Mark a single command delivered (used when pushed over the live WS). No-op if
 *  it isn't still pending (already delivered/acked/failed). */
export async function markDelivered(teamId: string, deviceId: string, id: string, now: number): Promise<void> {
  await prisma.agentCommand.updateMany({
    where: { teamId, deviceId, id, status: 'pending' },
    data: { status: 'delivered', deliveredAt: now },
  })
}

/** Authoritative command context returned by ackCommand on a real transition —
 *  the DB row is the source of truth for teamId/deviceId/action/payload/status,
 *  so the completion broadcast never trusts agent-supplied team/device ids. */
export interface AckedCommand {
  teamId: string
  deviceId: string
  action: string
  payload: Prisma.JsonValue | null
  status: AgentCommandStatus
}

/**
 * Record the agent's result for a command. Transitions pending|delivered →
 * acked|failed and (optionally) persists the validated CommandResultBody into
 * AgentCommand.result. Returns:
 *  - outcome 'updated' — this call transitioned the row (+ the authoritative command)
 *  - outcome 'noop'    — the row exists for this device but was already terminal (the
 *                        other half of the dual WS+HTTP ack already recorded it) — success
 *  - outcome 'missing' — no such command for this team+device
 * Scoped by teamId + deviceId (own-rows). The 'noop' distinction lets the ack
 * endpoint return success on the (expected) second ack instead of a spurious 404,
 * AND lets the caller broadcast completion ONLY on a new transition (no dup logs).
 */
export async function ackCommand(
  teamId: string,
  deviceId: string,
  commandId: string,
  status: 'acked' | 'failed',
  error: string | undefined,
  now: number,
  result?: unknown,
): Promise<{ outcome: 'updated' | 'noop' | 'missing'; command: AckedCommand | null }> {
  const res = await prisma.agentCommand.updateMany({
    where: { teamId, deviceId, id: commandId, status: { in: ['pending', 'delivered'] } },
    data: {
      status,
      error: error?.slice(0, 2000),
      ackedAt: now,
      // Only set the column when a result was supplied (HTTP-only acks may omit it).
      result: (result ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  })
  if (res.count === 1) {
    const row = await prisma.agentCommand.findUnique({ where: { teamId_id: { teamId, id: commandId } } })
    const command: AckedCommand | null = row
      ? { teamId: row.teamId, deviceId: row.deviceId, action: row.action, payload: row.payload, status: row.status as AgentCommandStatus }
      : null
    return { outcome: 'updated', command }
  }
  const existing = await prisma.agentCommand.findFirst({ where: { teamId, deviceId, id: commandId }, select: { id: true } })
  return { outcome: existing ? 'noop' : 'missing', command: null }
}
