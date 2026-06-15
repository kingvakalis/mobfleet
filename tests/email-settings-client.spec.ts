import { test, expect } from 'playwright/test'
import { buildEmailSettingsUpdate } from '../src/services/email-settings-request'

/**
 * Pure-function tests (no browser, no server) for the email-settings POST-body
 * builder — the client-side rule that decides whether a new Resend key is sent.
 * Runs in the Playwright `engine` project.
 */

test('omits resendApiKey when the key field is blank (preserves the stored key)', () => {
  const req = buildEmailSettingsUpdate({ senderName: '  Ops  ', senderEmail: '  ops@acme.com ', newApiKey: '' })
  expect(req).toEqual({ senderName: 'Ops', senderEmail: 'ops@acme.com' })
  expect('resendApiKey' in req).toBe(false)
})

test('omits resendApiKey when the key field is whitespace only', () => {
  const req = buildEmailSettingsUpdate({ senderName: 'Ops', senderEmail: 'ops@acme.com', newApiKey: '   ' })
  expect('resendApiKey' in req).toBe(false)
})

test('includes a newly typed real key (trimmed)', () => {
  const req = buildEmailSettingsUpdate({ senderName: 'Ops', senderEmail: 'ops@acme.com', newApiKey: '  re_new_KEY_1234  ' })
  expect(req.resendApiKey).toBe('re_new_KEY_1234')
})

test('never submits a masked value as the key', () => {
  const req = buildEmailSettingsUpdate({ senderName: 'Ops', senderEmail: 'ops@acme.com', newApiKey: '••••1234' })
  expect('resendApiKey' in req).toBe(false)
})
