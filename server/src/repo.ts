import { PrismaClient } from '@prisma/client'
import type { Device, DeviceStatus, Job, JobStatus, Proxy, ProxyStatus, TaskType } from '../../src/shared/types'
import type { SeedData } from './seed'

const prisma = new PrismaClient()

/** Persistence boundary — swap PrismaRepo for a Postgres-backed one in prod by
 *  changing only DATABASE_URL + the schema provider. The rest of the app is
 *  unaware of the storage engine. */
export const repo = {
  async load(): Promise<SeedData> {
    const [devices, jobs, proxies] = await Promise.all([
      prisma.device.findMany(),
      prisma.job.findMany(),
      prisma.proxy.findMany(),
    ])
    return {
      devices: devices.map((d) => ({ ...d, status: d.status as DeviceStatus })) as Device[],
      jobs: jobs.map((j) => ({ ...j, status: j.status as JobStatus, type: j.type as TaskType })) as Job[],
      proxies: proxies.map((p) => ({ ...p, status: p.status as ProxyStatus })) as Proxy[],
    }
  },

  /** Full write-through sync: upsert everything present, delete what's gone. */
  async persist(s: SeedData): Promise<void> {
    const deviceIds = s.devices.map((d) => d.id)
    const jobIds = s.jobs.map((j) => j.id)
    const proxyIps = s.proxies.map((p) => p.ip)
    await prisma.$transaction([
      ...s.devices.map((d) => prisma.device.upsert({ where: { id: d.id }, create: d, update: d })),
      prisma.device.deleteMany({ where: { id: { notIn: deviceIds.length ? deviceIds : ['__none__'] } } }),
      ...s.jobs.map((j) => prisma.job.upsert({ where: { id: j.id }, create: j, update: j })),
      prisma.job.deleteMany({ where: { id: { notIn: jobIds.length ? jobIds : ['__none__'] } } }),
      ...s.proxies.map((p) => prisma.proxy.upsert({ where: { ip: p.ip }, create: p, update: p })),
      prisma.proxy.deleteMany({ where: { ip: { notIn: proxyIps.length ? proxyIps : ['__none__'] } } }),
    ])
  },
}
