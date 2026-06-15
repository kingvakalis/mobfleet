import { test, expect } from 'playwright/test'
import { passwordResetRedirectUrl } from '../src/lib/auth-redirect'

/**
 * Pure-function tests (no browser, no server) for the password-reset redirect URL
 * builder — the value handed to Supabase's resetPasswordForEmail. Runs in the
 * Playwright `engine` project. The resulting URLs are the ones that must be
 * allow-listed in the Supabase dashboard's Redirect URLs.
 */

test('uses VITE_APP_URL (the deploy URL) when set', () => {
  expect(passwordResetRedirectUrl('https://mobfleet.co', 'http://localhost:5173')).toBe(
    'https://mobfleet.co/reset-password',
  )
})

test('falls back to the current origin in dev (→ localhost:5173)', () => {
  expect(passwordResetRedirectUrl(undefined, 'http://localhost:5173')).toBe(
    'http://localhost:5173/reset-password',
  )
})

test('treats a blank/whitespace app URL as unset and uses the origin', () => {
  expect(passwordResetRedirectUrl('', 'http://localhost:5173')).toBe('http://localhost:5173/reset-password')
  expect(passwordResetRedirectUrl('   ', 'http://localhost:5173')).toBe('http://localhost:5173/reset-password')
  expect(passwordResetRedirectUrl(null, 'https://mobfleet.co')).toBe('https://mobfleet.co/reset-password')
})

test('does not double the slash when the base has a trailing slash', () => {
  expect(passwordResetRedirectUrl('https://mobfleet.co/', 'x')).toBe('https://mobfleet.co/reset-password')
  expect(passwordResetRedirectUrl('https://mobfleet.co///', 'x')).toBe('https://mobfleet.co/reset-password')
})
