import { randomUUID, randomBytes, createHash } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { prisma } from './db'
import { env } from './env'
import { HttpError } from './http-error'
import type { EngineRegistry } from './tenancy/engine-registry'
import type { Device } from '../../src/shared/types'
import type { ClaimDeviceBody } from '../../src/shared/schemas'

/**
 * Device provisioning: mint a short-lived pairing token (shown as a QR), then
 * let a device exchange it for a real device record + a long-lived API key it
 * uses to authenticate its heartbeat WebSocket. Tenant isolation is preserved
 * throughout — a token carries its team, and the claimed device is created in
 * exactly that team's engine.
 */

// ── crypto helpers ────────────────────────────────────────────────────────────
const id = (prefix: string) => `${prefix}_${randomUUID()}`
/** A device id for a claimed device (opaque; not parsed anywhere). */
const newDeviceId = () => `dev-${randomUUID().replace(/-/g, '').slice(0, 12)}`
/** The QR pairing token — an unguessable UUID. */
const newPairingToken = () => randomUUID()
/** A device API key (high-entropy). Returned ONCE; only its hash is stored. */
const newApiKey = () => randomBytes(32).toString('base64url')
/** SHA-256 of an API key — what we persist + look up by. */
export const hashApiKey = (key: string): string => createHash('sha256').update(key).digest('hex')

// ── pure validation (unit-tested) ─────────────────────────────────────────────
export type TokenCheck = { ok: true } | { ok: false; status: number; reason: string }

/** Validate a pairing-token row against the clock. Pure → unit-testable. */
export function isPairingTokenValid(
  row: { expiresAt: number; claimedByDeviceId: string | null } | null,
  now: number,
): TokenCheck {
  if (!row) return { ok: false, status: 400, reason: 'invalid pairing token' }
  if (row.claimedByDeviceId) return { ok: false, status: 409, reason: 'pairing token already claimed' }
  if (row.expiresAt <= now) return { ok: false, status: 410, reason: 'pairing token expired' }
  return { ok: true }
}

/** Build the Device record for a claimed device. Pure → unit-testable. A freshly
 *  claimed device has no heartbeat yet, so it starts offline and comes online on
 *  its first heartbeat. */
export function buildClaimedDevice(body: ClaimDeviceBody, deviceId: string, now: number): Device {
  return {
    id: deviceId,
    name: body.name?.trim() || `Device ${deviceId.slice(-4).toUpperCase()}`,
    status: 'offline',
    region: '',
    osVersion: body.osVersion ?? '',
    model: body.platform ? body.platform.toUpperCase() : '',
    proxy: '',
    battery: 0,
    group: 'Unassigned',
    assignedUser: null,
    jobId: null,
    createdAt: now,
    udid: body.udid,
    platform: body.platform ?? 'ios',
    lastHeartbeat: null,
    cpuUsage: null,
    memoryUsage: null,
  }
}

// ── public server URL for the QR ──────────────────────────────────────────────
/**
 * Where a device should POST /v1/devices/claim (embedded in the QR). The
 * explicit PUBLIC_SERVER_URL always wins. When it is unset we deliberately do
 * NOT trust x-forwarded-* headers — an attacker could forge Host/x-forwarded-host
 * to poison the QR so a device claims against an attacker server, leaking the
 * pairing token + API key. Behind a reverse proxy you MUST set PUBLIC_SERVER_URL
 * (production enforces this at boot, see assertProvisioningConfig). So this
 * derivation is a dev-only convenience using the direct connection host.
 */
export function publicServerUrl(req: FastifyRequest): string {
  if (env.publicServerUrl) return env.publicServerUrl.replace(/\/$/, '')
  const proto = (req.protocol || 'http').split(',')[0].trim()
  const host = (req.headers.host || `localhost:${env.port}`).trim()
  return `${proto}://${host}`
}

// ── DB operations ─────────────────────────────────────────────────────────────
/** Mint a pairing token for a team (expires after env.pairingTtlMs). */
export async function createPairingToken(teamId: string, now: number) {
  return prisma.devicePairingToken.create({
    data: { token: newPairingToken(), teamId, createdAt: now, expiresAt: now + env.pairingTtlMs },
  })
}

/**
 * Exchange a pairing token for a device + API key. Race-safe: the token is
 * claimed via a conditional updateMany (claimedByDeviceId null AND not expired),
 * so two concurrent claims can never both succeed and no second device is
 * created. The device is added to the team's in-memory store, which broadcasts
 * it to every connected dashboard (real-time appearance) and persists it.
 */
export async function claimDevice(
  registry: EngineRegistry,
  body: ClaimDeviceBody,
  now: number,
): Promise<{ deviceId: string; apiKey: string }> {
  const row = await prisma.devicePairingToken.findUnique({ where: { token: body.pairingToken } })
  const check = isPairingTokenValid(row, now)
  if (!check.ok) throw new HttpError(check.status, check.reason)
  const teamId = row!.teamId

  // Enforce a per-team device quota BEFORE consuming the token (abuse backstop:
  // a compromised provisioner can't flood a team with unbounded devices).
  const engine = await registry.get(teamId)
  if (engine.store.listDevices().length >= env.maxDevicesPerTeam) {
    throw new HttpError(429, 'team device quota exceeded')
  }

  const deviceId = newDeviceId()
  // Atomically reserve the token to THIS claim. count===1 means we won.
  const reserved = await prisma.devicePairingToken.updateMany({
    where: { token: body.pairingToken, claimedByDeviceId: null, expiresAt: { gt: now } },
    data: { claimedByDeviceId: deviceId },
  })
  if (reserved.count !== 1) throw new HttpError(409, 'pairing token already claimed')

  // Token won → create the device in its team's engine (broadcasts + persists).
  engine.store.putDevice(buildClaimedDevice(body, deviceId, now))

  // Issue the API key (store only its hash; return plaintext once).
  const apiKey = newApiKey()
  await prisma.deviceApiKey.create({
    data: { id: id('dak'), teamId, deviceId, keyHash: hashApiKey(apiKey), createdAt: now },
  })

  return { deviceId, apiKey }
}

/** Resolve a device API key (from /ws?deviceKey=…) to its team + device. Returns
 *  null when unknown. Updates lastUsedAt best-effort. */
export async function resolveDeviceKey(rawKey: string): Promise<{ teamId: string; deviceId: string } | null> {
  const row = await prisma.deviceApiKey.findUnique({ where: { keyHash: hashApiKey(rawKey) } })
  if (!row) return null
  void prisma.deviceApiKey.update({ where: { id: row.id }, data: { lastUsedAt: Date.now() } }).catch(() => {})
  return { teamId: row.teamId, deviceId: row.deviceId }
}

/** Delete expired, never-claimed pairing tokens so the table can't grow without
 *  bound. Runs on an interval (unref'd so it never holds the process open). */
export function startPairingTokenCleanup(intervalMs = 60 * 60 * 1000): void {
  const sweep = () =>
    void prisma.devicePairingToken
      .deleteMany({ where: { claimedByDeviceId: null, expiresAt: { lt: Date.now() } } })
      .catch((e) => console.error('[pairing-cleanup]', e))
  const timer = setInterval(sweep, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
}
