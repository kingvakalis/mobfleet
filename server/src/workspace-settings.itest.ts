import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PrismaClient } from '@prisma/client'
import {
  DEFAULT_WORKSPACE_SETTINGS,
  loadWorkspaceSettings,
  saveWorkspaceSettings,
  type WorkspaceSettingsDb,
} from './workspace-settings'
import { itSkip, testDb, resetDb, seedUser, seedMembership } from './it-support'

/**
 * PostgreSQL integration tests for per-team workspace settings. DOUBLE-GATED on
 * itSkip + the proposed `WorkspaceSettings` table existing (skips until the lead adds
 * the model). Drives the logic through the injectable port. Run via `npm run test:it`.
 */

async function tableExists(db: PrismaClient, table: string): Promise<boolean> {
  try {
    const rows = await db.$queryRawUnsafe<{ exists: boolean }[]>(`SELECT to_regclass('"${table}"') IS NOT NULL AS exists`)
    return Boolean(rows[0]?.exists)
  } catch {
    return false
  }
}

let present: boolean | null = null
async function skipReason(): Promise<false | string> {
  if (itSkip) return itSkip
  if (present === null) present = await tableExists(testDb(), 'WorkspaceSettings')
  return present ? false : 'WorkspaceSettings model not yet in the schema (see PROPOSALS.md)'
}

const port = (): WorkspaceSettingsDb => testDb() as unknown as WorkspaceSettingsDb

test('workspace settings: defaults when unset, then upsert is one row per team', async (t) => {
  const reason = await skipReason()
  if (reason) return t.skip(reason)
  const db = testDb(); await resetDb(db)
  await db.$executeRawUnsafe('TRUNCATE TABLE "WorkspaceSettings" CASCADE').catch(() => {})
  const u = await seedUser(db)
  const { team } = await seedMembership(db, u.id)

  // No row yet → defaults.
  assert.deepEqual(await loadWorkspaceSettings(team.id, port()), DEFAULT_WORKSPACE_SETTINGS)

  const saved = await saveWorkspaceSettings(team.id, { ...DEFAULT_WORKSPACE_SETTINGS, theme: 'midnight', workspaceName: 'Acme' }, Date.now(), port())
  assert.equal(saved.theme, 'midnight')

  // Re-save is an UPSERT (still one row, true upsert on the unique teamId).
  await saveWorkspaceSettings(team.id, { ...saved, theme: 'oled' }, Date.now(), port())
  const reloaded = await loadWorkspaceSettings(team.id, port())
  assert.equal(reloaded.theme, 'oled')
  assert.equal(reloaded.workspaceName, 'Acme')

  const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*)::bigint AS n FROM "WorkspaceSettings" WHERE "teamId" = '${team.id}'`)
  assert.equal(Number(rows[0].n), 1) // never a second row
})

test('workspace settings: strictly team-scoped', async (t) => {
  const reason = await skipReason()
  if (reason) return t.skip(reason)
  const db = testDb(); await resetDb(db)
  await db.$executeRawUnsafe('TRUNCATE TABLE "WorkspaceSettings" CASCADE').catch(() => {})
  const a = await seedMembership(db, (await seedUser(db)).id)
  const b = await seedMembership(db, (await seedUser(db)).id)
  await saveWorkspaceSettings(a.team.id, { ...DEFAULT_WORKSPACE_SETTINGS, workspaceName: 'A-team' }, Date.now(), port())
  assert.equal((await loadWorkspaceSettings(a.team.id, port())).workspaceName, 'A-team')
  assert.equal((await loadWorkspaceSettings(b.team.id, port())).workspaceName, DEFAULT_WORKSPACE_SETTINGS.workspaceName) // B unaffected
})
