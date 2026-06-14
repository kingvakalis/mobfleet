import { prisma } from './db'
import type { Automation, Device, DeviceStatus, Job, JobStatus, Proxy, ProxyStatus, TaskType } from '../../src/shared/types'
import type { SeedData } from './seed'
import { persistPlan } from './persist-plan'

/**
 * Persistence boundary — TENANT-SCOPED. Every read and write is filtered by
 * teamId. Composite primary keys ([teamId, id] / [teamId, ip]) make it
 * impossible for one team's rows to collide with another's, and the
 * "delete what's gone" sweep is scoped to the team so persisting team A's
 * snapshot can NEVER touch team B's data.
 */

const stripTeam = <T extends { teamId: string }>(row: T): Omit<T, 'teamId'> => {
  const { teamId: _t, ...rest } = row
  return rest
}

export const repo = {
  async load(teamId: string): Promise<SeedData> {
    const [devices, jobs, proxies, automations] = await Promise.all([
      prisma.device.findMany({ where: { teamId } }),
      prisma.job.findMany({ where: { teamId } }),
      prisma.proxy.findMany({ where: { teamId } }),
      prisma.automation.findMany({ where: { teamId } }),
    ])
    return {
      devices: devices.map((d) => ({ ...stripTeam(d), status: d.status as DeviceStatus })) as Device[],
      jobs: jobs.map((j) => ({ ...stripTeam(j), status: j.status as JobStatus, type: j.type as TaskType })) as Job[],
      proxies: proxies.map((p) => ({ ...stripTeam(p), status: p.status as ProxyStatus })) as Proxy[],
      automations: automations.map((a) => ({ ...stripTeam(a), taskType: a.taskType as TaskType })) as Automation[],
    }
  },

  /** Full write-through sync for ONE team: upsert everything present, delete
   *  what's gone — both strictly scoped to teamId via the pure persistPlan
   *  (see persist-plan.ts + repo tests for the tenant-isolation invariant). */
  async persist(teamId: string, s: SeedData): Promise<void> {
    // Prisma's per-model delegates have divergent arg types; the plan is proven
    // team-scoped by persist-plan tests, so a narrow cast here is safe.
    const delegate: Record<string, { upsert: (a: unknown) => unknown; deleteMany: (a: unknown) => unknown }> = {
      device: prisma.device as never,
      job: prisma.job as never,
      proxy: prisma.proxy as never,
      automation: prisma.automation as never,
    }
    const tx = persistPlan(teamId, s).map((op) =>
      op.kind === 'upsert'
        ? delegate[op.model].upsert({ where: op.where, create: op.data, update: op.data })
        : delegate[op.model].deleteMany({ where: op.where }),
    )
    await prisma.$transaction(tx as never)
  },
}
