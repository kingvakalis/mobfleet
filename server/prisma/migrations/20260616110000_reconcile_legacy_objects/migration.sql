-- Schema Reconciliation Checkpoint 2: add the desired objects that exist in
-- schema.postgres.prisma but are absent from the audited production baseline AND are NOT handled
-- by Phase 3A (20260616120000). Runs AFTER the baseline and BEFORE Phase 3A.
--
-- This migration adds ONLY:
--   * table "AgentCommand"      (full, incl. the "result" column from the start)
--   * table "DeviceSession"
--   * table "TeamEmailSettings"
--   * column "Membership"."overrides" JSONB NULL
--
-- It deliberately does NOT add Team.supabaseTeamId, Team.archivedAt, MigrationRecord, or the
-- nullable Invite.invitedByUserId / relaxed FK -- those remain EXCLUSIVELY in Phase 3A.
--
-- PostgreSQL dialect only (DOUBLE PRECISION / JSONB / INTEGER, named CONSTRAINT pkeys). No SQLite
-- syntax. Additive only: CREATE TABLE on absent tables + one nullable ADD COLUMN. No drops, no data
-- loss. ASCII-only.

-- CreateTable
CREATE TABLE "AgentCommand" (
    "id" TEXT NOT NULL DEFAULT '',
    "teamId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "result" JSONB,
    "issuedBy" TEXT,
    "createdAt" DOUBLE PRECISION NOT NULL,
    "deliveredAt" DOUBLE PRECISION,
    "ackedAt" DOUBLE PRECISION,
    "expiresAt" DOUBLE PRECISION,
    CONSTRAINT "AgentCommand_pkey" PRIMARY KEY ("teamId", "id")
);

-- CreateTable
CREATE TABLE "DeviceSession" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "startedAt" DOUBLE PRECISION NOT NULL,
    "endedAt" DOUBLE PRECISION,
    "agentVersion" TEXT,
    CONSTRAINT "DeviceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamEmailSettings" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "resendApiKey" TEXT NOT NULL,
    "updatedAt" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "TeamEmailSettings_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN "overrides" JSONB;

-- CreateIndex
CREATE INDEX "AgentCommand_teamId_deviceId_status_idx" ON "AgentCommand"("teamId", "deviceId", "status");

-- CreateIndex
CREATE INDEX "DeviceSession_deviceId_startedAt_idx" ON "DeviceSession"("deviceId", "startedAt");

-- CreateIndex
CREATE INDEX "DeviceSession_teamId_startedAt_idx" ON "DeviceSession"("teamId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamEmailSettings_teamId_key" ON "TeamEmailSettings"("teamId");

-- AddForeignKey
ALTER TABLE "AgentCommand" ADD CONSTRAINT "AgentCommand_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceSession" ADD CONSTRAINT "DeviceSession_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamEmailSettings" ADD CONSTRAINT "TeamEmailSettings_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
