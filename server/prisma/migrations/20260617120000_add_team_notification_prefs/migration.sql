-- Step: team-wide transactional email preferences (additive, safe).
-- Adds a single nullable JSONB column to Team holding the workspace's
-- EmailPreferences blob (teamInvitesEnabled / passwordResetEnabled /
-- welcomeEmailEnabled; see src/lib/email/preferences.ts). NULL means "all
-- defaults" (every transactional email enabled), so existing rows need no
-- backfill and the running server is unaffected until it reads the column.
-- Mirrors the Membership.overrides JSONB precedent. No drops, no data loss.
-- NOTE: keep this file ASCII-only so it applies cleanly under any DB encoding.

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "notificationPrefs" JSONB;
