import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { itSkip, testDb } from './it-support'
import { loadTransactionalEmailPreferences, saveTransactionalEmailPreferences } from './email-settings'
import { DEFAULT_EMAIL_PREFERENCES } from '../../src/lib/email/preferences'

// DB-backed transactional email preferences (Team.notificationPrefs JSONB). Requires
// TEST_DATABASE_URL; the pg-itest harness also pins DATABASE_URL at the same disposable
// DB so the email-settings helpers' global prisma client is safe. Proves: a NULL column
// yields safe defaults, save round-trips the normalized contract, and a partial/corrupt
// stored blob is normalized to a complete object on read.

async function freshTeam(): Promise<string> {
  const id = `team_${randomUUID()}`
  await testDb().team.create({ data: { id, name: 'Prefs Co', createdAt: Date.now() } })
  return id
}

test('email prefs: NULL notificationPrefs → safe defaults (all enabled)', { skip: itSkip }, async () => {
  const teamId = await freshTeam()
  assert.deepEqual(await loadTransactionalEmailPreferences(teamId), DEFAULT_EMAIL_PREFERENCES)
})

test('email prefs: save persists and GET/load round-trips the same normalized contract', { skip: itSkip }, async () => {
  const teamId = await freshTeam()
  const desired = { teamInvitesEnabled: false, passwordResetEnabled: true, welcomeEmailEnabled: false }
  const saved = await saveTransactionalEmailPreferences(teamId, desired)
  assert.deepEqual(saved, desired)
  assert.deepEqual(await loadTransactionalEmailPreferences(teamId), desired)
})

test('email prefs: a partial/corrupt stored blob normalizes to a complete object on read', { skip: itSkip }, async () => {
  const teamId = await freshTeam()
  // Persist a partial blob directly (only one key set) — read must fill the rest with defaults.
  await testDb().$executeRawUnsafe(`UPDATE "Team" SET "notificationPrefs" = '{"teamInvitesEnabled": false}'::jsonb WHERE id = $1`, teamId)
  const prefs = await loadTransactionalEmailPreferences(teamId)
  assert.equal(prefs.teamInvitesEnabled, false)
  assert.equal(prefs.welcomeEmailEnabled, true) // defaulted
  assert.equal(prefs.passwordResetEnabled, true) // defaulted
})
