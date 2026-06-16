import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma, PrismaClient } from '@prisma/client'
import { teamRelations } from './relations'

// Pure tests (no DB) for the Team-relation inventory. Guarantees the inventory is derived
// from the live Prisma DMMF and can never silently miss a Team relation.

/** The current expected Team relations (snapshot for human review). Adding a model with a
 *  Team FK SHOULD make this list grow AND must keep the DMMF-vs-implementation test below
 *  green automatically (the implementation derives from DMMF). */
const KNOWN = [
  'AgentCommand', 'AuditLog', 'Automation', 'Device', 'DeviceApiKey', 'DevicePairingToken',
  'DeviceSession', 'Invite', 'Job', 'Membership', 'Proxy', 'TeamEmailSettings',
].sort()

test('teamRelations() exactly matches the Team relations declared in the Prisma DMMF', () => {
  // Independently derive the truth from DMMF, then assert the implementation returns ALL of it.
  // FAILS if a new Team relation is added to the schema but the inventory implementation
  // (relations.ts) is ever changed to a stale/hardcoded/filtered list that misses it.
  const team = Prisma.dmmf.datamodel.models.find((m) => m.name === 'Team')
  assert.ok(team, 'Team model present in DMMF')
  const expected = team!.fields.filter((f) => f.kind === 'object').map((f) => f.type).sort()
  const got = teamRelations().map((r) => r.model).sort()
  assert.deepEqual(got, expected, 'every Team relation in the schema must be inventoried')
})

test('teamRelations() snapshot matches the known current set (review aid)', () => {
  assert.deepEqual(teamRelations().map((r) => r.model).sort(), KNOWN)
})

test('every inventoried relation resolves a Team FK field and a real Prisma delegate', () => {
  const client = new PrismaClient() // construction is lazy; no DB connection is opened here
  for (const r of teamRelations()) {
    assert.ok(r.teamFkField && typeof r.teamFkField === 'string', `${r.model} has a resolved Team FK field`)
    const delegate = (client as unknown as Record<string, { count?: unknown }>)[r.delegate]
    assert.equal(typeof delegate?.count, 'function', `${r.model} maps to a real Prisma delegate (${r.delegate}.count)`)
  }
})
