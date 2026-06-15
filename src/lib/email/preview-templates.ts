/**
 * Frontend email previews — thin adapter over the shared template builders.
 *
 * BACKEND TEMPLATE PARITY: src/shared/email-templates.ts is the single source
 * of truth. Previews here use sample data; the live sender is server/src/mailer.ts.
 */

import {
  buildInviteEmail,
  buildResetEmail,
  buildWelcomeEmail,
  type InviteEmailData,
  type ResetEmailData,
  type WelcomeEmailData,
  type RenderedEmail,
} from '@/shared/email-templates'

export type EmailPreviewType = 'invite' | 'reset' | 'welcome'

export type InvitePreviewData = InviteEmailData
export type ResetPreviewData = ResetEmailData
export type WelcomePreviewData = WelcomeEmailData

export type { RenderedEmail }

export { buildInviteEmail, buildResetEmail, buildWelcomeEmail }

export const SAMPLE_INVITE: InvitePreviewData = {
  inviterName: 'Alex Morgan',
  workspaceName: 'MOBFLEET Operations',
  inviteUrl: '#',
  role: 'Operator',
}
export const SAMPLE_RESET: ResetPreviewData = { resetUrl: '#', expiresIn: '30 minutes' }
export const SAMPLE_WELCOME: WelcomePreviewData = { name: 'Alex', dashboardUrl: '#' }

/** Render a preview email document for the given tab using sample data. */
export function renderPreview(type: EmailPreviewType): RenderedEmail {
  switch (type) {
    case 'invite':
      return buildInviteEmail(SAMPLE_INVITE)
    case 'reset':
      return buildResetEmail(SAMPLE_RESET)
    case 'welcome':
      return buildWelcomeEmail(SAMPLE_WELCOME)
  }
}
