/**
 * Build the password-reset redirect URL. Uses the deployment URL (VITE_APP_URL)
 * when configured, otherwise the current browser origin — so local dev resolves
 * to http://localhost:5173/reset-password while production uses the real domain.
 *
 * Pure (origin/appUrl passed in) so it is unit-testable without import.meta/window.
 *
 * SUPABASE DASHBOARD: the resulting URLs must be allow-listed under
 * Authentication → URL Configuration → Redirect URLs, or Supabase rejects the
 * recovery link:
 *   http://localhost:5173/reset-password
 *   http://mobfleet.co/reset-password
 *   https://mobfleet.co/reset-password
 */
export function passwordResetRedirectUrl(appUrl: string | undefined | null, origin: string): string {
  const base = appUrl && appUrl.trim() ? appUrl.trim() : origin
  return `${base.replace(/\/+$/, '')}/reset-password`
}
