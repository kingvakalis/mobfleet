-- Audited PostgreSQL baseline for the Railway/Prisma production target.
--
-- SOURCE OF TRUTH: the Step 0 production read-only audit (database "railway", 2026-06-16) --
-- NOT schema.postgres.prisma. The desired Prisma schema contains LATER objects that must NOT
-- appear here: Team.supabaseTeamId / Team.archivedAt, MigrationRecord, AgentCommand,
-- DeviceSession, TeamEmailSettings, Membership.overrides. Those arrive in later migrations
-- (the future 20260616110000_reconcile_legacy_objects and the existing Phase 3A
-- 20260616120000_add_migration_mapping_and_audit_schema). This baseline reproduces the live
-- schema EXACTLY so the history can be honestly baselined (`migrate resolve --applied`) later.
--
-- Audited specifics preserved verbatim:
--   * Invite.invitedByUserId is NOT NULL; Invite_invitedByUserId_fkey is ON DELETE RESTRICT
--     ON UPDATE CASCADE (Phase 3A relaxes both later).
--   * Composite PKs: Device/Job/Automation = (teamId, id); Proxy = (teamId, ip).
--   * id DEFAULT '' on Device/Job/Automation; Membership.status DEFAULT 'active',
--     Membership.scopeType DEFAULT 'workspace'.
--   * All other FKs are ON UPDATE CASCADE ON DELETE CASCADE.
-- ASCII-only so it applies under any DB encoding.

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "authProviderId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "scopeType" TEXT NOT NULL DEFAULT 'workspace',
    "scopeGroups" JSONB,
    "scopePhones" JSONB,
    "createdAt" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "result" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "createdAt" DOUBLE PRECISION NOT NULL,
    "expiresAt" DOUBLE PRECISION NOT NULL,
    "acceptedAt" DOUBLE PRECISION,
    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL DEFAULT '',
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "osVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "proxy" TEXT NOT NULL,
    "battery" INTEGER NOT NULL,
    "group" TEXT NOT NULL,
    "assignedUser" TEXT,
    "jobId" TEXT,
    "createdAt" DOUBLE PRECISION NOT NULL,
    "udid" TEXT,
    "platform" TEXT,
    "ipAddress" TEXT,
    "wdaPort" INTEGER,
    "lastHeartbeat" DOUBLE PRECISION,
    "cpuUsage" DOUBLE PRECISION,
    "memoryUsage" DOUBLE PRECISION,
    CONSTRAINT "Device_pkey" PRIMARY KEY ("teamId", "id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL DEFAULT '',
    "teamId" TEXT NOT NULL,
    "deviceId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" DOUBLE PRECISION NOT NULL,
    "createdAt" DOUBLE PRECISION NOT NULL,
    "startedAt" DOUBLE PRECISION,
    "finishedAt" DOUBLE PRECISION,
    "error" TEXT,
    "config" JSONB,
    CONSTRAINT "Job_pkey" PRIMARY KEY ("teamId", "id")
);

-- CreateTable
CREATE TABLE "Proxy" (
    "ip" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "assignedTo" TEXT,
    "status" TEXT NOT NULL,
    "latency" INTEGER NOT NULL,
    "lastCheck" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "Proxy_pkey" PRIMARY KEY ("teamId", "ip")
);

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL DEFAULT '',
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "successRate" DOUBLE PRECISION NOT NULL,
    "runs" INTEGER NOT NULL,
    "lastRun" TEXT NOT NULL,
    CONSTRAINT "Automation_pkey" PRIMARY KEY ("teamId", "id")
);

-- CreateTable
CREATE TABLE "DevicePairingToken" (
    "token" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" DOUBLE PRECISION NOT NULL,
    "expiresAt" DOUBLE PRECISION NOT NULL,
    "claimedByDeviceId" TEXT,
    CONSTRAINT "DevicePairingToken_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "DeviceApiKey" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdAt" DOUBLE PRECISION NOT NULL,
    "lastUsedAt" DOUBLE PRECISION,
    CONSTRAINT "DeviceApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_authProviderId_key" ON "User"("authProviderId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_teamId_idx" ON "Membership"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_teamId_key" ON "Membership"("userId", "teamId");

-- CreateIndex
CREATE INDEX "AuditLog_teamId_idx" ON "AuditLog"("teamId");

-- CreateIndex
CREATE INDEX "AuditLog_teamId_createdAt_idx" ON "AuditLog"("teamId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_token_key" ON "Invite"("token");

-- CreateIndex
CREATE INDEX "Invite_teamId_idx" ON "Invite"("teamId");

-- CreateIndex
CREATE INDEX "Invite_email_idx" ON "Invite"("email");

-- CreateIndex
CREATE INDEX "Device_teamId_idx" ON "Device"("teamId");

-- CreateIndex
CREATE INDEX "Job_teamId_idx" ON "Job"("teamId");

-- CreateIndex
CREATE INDEX "Proxy_teamId_idx" ON "Proxy"("teamId");

-- CreateIndex
CREATE INDEX "Automation_teamId_idx" ON "Automation"("teamId");

-- CreateIndex
CREATE INDEX "DevicePairingToken_teamId_idx" ON "DevicePairingToken"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceApiKey_keyHash_key" ON "DeviceApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "DeviceApiKey_teamId_idx" ON "DeviceApiKey"("teamId");

-- CreateIndex
CREATE INDEX "DeviceApiKey_deviceId_idx" ON "DeviceApiKey"("deviceId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proxy" ADD CONSTRAINT "Proxy_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevicePairingToken" ADD CONSTRAINT "DevicePairingToken_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceApiKey" ADD CONSTRAINT "DeviceApiKey_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
