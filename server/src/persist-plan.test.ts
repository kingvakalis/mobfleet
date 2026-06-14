import { test } from 'node:test'
import assert from 'node:assert/strict'
import { persistPlan } from './persist-plan'
import type { SeedData } from './seed'

const sample = (over: Partial<SeedData> = {}): SeedData =>
  ({
    devices: [{ id: 'd1' } as never],
    jobs: [{ id: 'j1' } as never],
    proxies: [{ ip: '1.1.1.1' } as never],
    automations: [{ id: 'a1' } as never],
    ...over,
  })

function whereTeamId(where: Record<string, unknown>): string | undefined {
  if (typeof where.teamId === 'string') return where.teamId
  const ti = where.teamId_id as { teamId?: string } | undefined
  if (ti?.teamId) return ti.teamId
  const tp = where.teamId_ip as { teamId?: string } | undefined
  return tp?.teamId
}

test('every operation in the plan carries the teamId (no cross-tenant op)', () => {
  const ops = persistPlan('team-A', sample())
  assert.ok(ops.length > 0)
  for (const op of ops) {
    assert.equal(whereTeamId(op.where), 'team-A', `${op.kind} ${op.model} not scoped: ${JSON.stringify(op.where)}`)
  }
})

test('every "delete what is gone" sweep is team-scoped (never a global wipe)', () => {
  const ops = persistPlan('team-A', sample())
  const deletes = ops.filter((o) => o.kind === 'deleteMany')
  assert.equal(deletes.length, 4) // device, job, proxy, automation
  for (const d of deletes) assert.equal((d.where as { teamId?: string }).teamId, 'team-A')
})

test('upserted rows are stamped with the teamId', () => {
  const ops = persistPlan('team-A', sample())
  for (const op of ops) {
    if (op.kind === 'upsert') assert.equal((op.data as { teamId?: string }).teamId, 'team-A')
  }
})

test('empty collections still emit a team-scoped delete guard (cannot wipe siblings)', () => {
  const ops = persistPlan('team-A', { devices: [], jobs: [], proxies: [], automations: [] })
  const del = ops.find((o) => o.kind === 'deleteMany' && o.model === 'device')!
  const where = del.where as { teamId: string; id: { notIn: string[] } }
  assert.equal(where.teamId, 'team-A')
  assert.deepEqual(where.id.notIn, ['__none__'])
})

test('two teams produce disjoint, independently-scoped plans', () => {
  const a = persistPlan('team-A', sample())
  const b = persistPlan('team-B', sample())
  assert.ok(a.every((o) => whereTeamId(o.where) === 'team-A'))
  assert.ok(b.every((o) => whereTeamId(o.where) === 'team-B'))
})
