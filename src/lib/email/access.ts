import type { Member } from '@/lib/authorization'

/**
 * Who may view and edit workspace email settings.
 *
 * MOBFLEET has no granular `settings.email.*` permission, so access mirrors the
 * established team-view pattern: restricted to Owner and Admin, resolved from
 * the authenticated access context (`useActingEmployee`) — never from
 * localStorage and never from a client role string treated as truth.
 *
 * BACKEND ENFORCEMENT: when the email-settings API ships, GET/PATCH
 * /v1/settings/email MUST also enforce Owner/Admin server-side. This client
 * check is only a UI guard, not a security boundary.
 */
export function canAccessEmailSettings(member: Member): boolean {
  if (member.suspended) return false
  return member.role === 'owner' || member.role === 'admin'
}
