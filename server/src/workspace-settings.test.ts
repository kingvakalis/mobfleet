import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_WORKSPACE_SETTINGS,
  workspaceSettingsPatch,
  normalizeWorkspaceSettings,
  applyWorkspaceSettingsPatch,
} from './workspace-settings'

// ── normalizeWorkspaceSettings: any blob → complete, valid object ─────────────
test('normalizeWorkspaceSettings returns the defaults for null/garbage', () => {
  assert.deepEqual(normalizeWorkspaceSettings(null), DEFAULT_WORKSPACE_SETTINGS)
  assert.deepEqual(normalizeWorkspaceSettings('nope'), DEFAULT_WORKSPACE_SETTINGS)
  assert.deepEqual(normalizeWorkspaceSettings([1, 2, 3]), DEFAULT_WORKSPACE_SETTINGS)
})

test('normalizeWorkspaceSettings coerces invalid enum/number values to defaults', () => {
  const n = normalizeWorkspaceSettings({
    theme: 'neon', accent: 'gold', motion: 'turbo', density: 'nope',
    defaultStreamQuality: 500, defaultStreamFps: 0, reduceMotion: 'yes',
  })
  assert.equal(n.theme, DEFAULT_WORKSPACE_SETTINGS.theme)
  assert.equal(n.accent, DEFAULT_WORKSPACE_SETTINGS.accent)
  assert.equal(n.motion, DEFAULT_WORKSPACE_SETTINGS.motion)
  assert.equal(n.density, DEFAULT_WORKSPACE_SETTINGS.density)
  assert.equal(n.defaultStreamQuality, 100) // clamped to max
  assert.equal(n.defaultStreamFps, 1) // 0 is finite → clamped to the min (1), not default
  assert.equal(n.reduceMotion, DEFAULT_WORKSPACE_SETTINGS.reduceMotion) // non-bool → default

  // A non-finite number DOES fall back to the default (distinct from clamping).
  assert.equal(normalizeWorkspaceSettings({ defaultStreamFps: 'x' }).defaultStreamFps, DEFAULT_WORKSPACE_SETTINGS.defaultStreamFps)
})

test('normalizeWorkspaceSettings keeps valid values and clamps numeric ranges', () => {
  const n = normalizeWorkspaceSettings({
    workspaceName: '  Acme  ', theme: 'midnight', accent: 'cyan', motion: 'off',
    defaultStreamQuality: 80, defaultStreamFps: 30, confirmDestructive: false,
  })
  assert.equal(n.workspaceName, 'Acme') // trimmed
  assert.equal(n.theme, 'midnight')
  assert.equal(n.accent, 'cyan')
  assert.equal(n.motion, 'off')
  assert.equal(n.defaultStreamQuality, 80)
  assert.equal(n.defaultStreamFps, 30)
  assert.equal(n.confirmDestructive, false)
})

test('normalizeWorkspaceSettings: blank string falls back to default', () => {
  assert.equal(normalizeWorkspaceSettings({ workspaceName: '   ' }).workspaceName, DEFAULT_WORKSPACE_SETTINGS.workspaceName)
})

// ── applyWorkspaceSettingsPatch: merge over base, then normalize ──────────────
test('applyWorkspaceSettingsPatch merges a partial patch over the base', () => {
  const base = normalizeWorkspaceSettings({ theme: 'oled', workspaceName: 'Base' })
  const next = applyWorkspaceSettingsPatch(base, { theme: 'graphite' })
  assert.equal(next.theme, 'graphite') // patched
  assert.equal(next.workspaceName, 'Base') // preserved
})

// ── Zod patch validation ─────────────────────────────────────────────────────
test('workspaceSettingsPatch is fully partial and enforces enums + bounds', () => {
  assert.equal(workspaceSettingsPatch.safeParse({}).success, true)
  assert.equal(workspaceSettingsPatch.safeParse({ theme: 'midnight' }).success, true)
  assert.equal(workspaceSettingsPatch.safeParse({ theme: 'neon' }).success, false)
  assert.equal(workspaceSettingsPatch.safeParse({ defaultStreamQuality: 101 }).success, false)
  assert.equal(workspaceSettingsPatch.safeParse({ defaultStreamFps: 0 }).success, false)
  assert.equal(workspaceSettingsPatch.safeParse({ workspaceName: '' }).success, false)
})
