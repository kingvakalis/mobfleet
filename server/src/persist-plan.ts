import type { SeedData } from './seed'

/**
 * Pure builder for the team-scoped write-through plan. Extracted from repo.ts so
 * the tenant-isolation invariant can be unit-tested WITHOUT a database: EVERY
 * operation it emits (upsert and the "delete what's gone" sweep) must carry the
 * teamId, so persisting one team's snapshot can never read or delete another
 * tenant's rows. (No runtime imports — the SeedData import is type-only.)
 */
export type PersistModel = 'device' | 'job' | 'proxy' | 'automation'

export type PersistOp =
  | { kind: 'upsert'; model: PersistModel; where: Record<string, unknown>; data: Record<string, unknown> }
  | { kind: 'deleteMany'; model: PersistModel; where: Record<string, unknown> }

const NONE = '__none__'

export function persistPlan(teamId: string, s: SeedData): PersistOp[] {
  const ops: PersistOp[] = []

  for (const d of s.devices) {
    ops.push({ kind: 'upsert', model: 'device', where: { teamId_id: { teamId, id: d.id } }, data: { ...d, teamId } })
  }
  ops.push({ kind: 'deleteMany', model: 'device', where: { teamId, id: { notIn: s.devices.length ? s.devices.map((d) => d.id) : [NONE] } } })

  for (const j of s.jobs) {
    ops.push({ kind: 'upsert', model: 'job', where: { teamId_id: { teamId, id: j.id } }, data: { ...j, teamId } })
  }
  ops.push({ kind: 'deleteMany', model: 'job', where: { teamId, id: { notIn: s.jobs.length ? s.jobs.map((j) => j.id) : [NONE] } } })

  for (const p of s.proxies) {
    ops.push({ kind: 'upsert', model: 'proxy', where: { teamId_ip: { teamId, ip: p.ip } }, data: { ...p, teamId } })
  }
  ops.push({ kind: 'deleteMany', model: 'proxy', where: { teamId, ip: { notIn: s.proxies.length ? s.proxies.map((p) => p.ip) : [NONE] } } })

  for (const a of s.automations) {
    ops.push({ kind: 'upsert', model: 'automation', where: { teamId_id: { teamId, id: a.id } }, data: { ...a, teamId } })
  }
  ops.push({ kind: 'deleteMany', model: 'automation', where: { teamId, id: { notIn: s.automations.length ? s.automations.map((a) => a.id) : [NONE] } } })

  return ops
}
