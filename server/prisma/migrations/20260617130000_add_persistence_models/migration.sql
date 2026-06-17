-- War-Room server persistence: team-scoped business data that replaces frontend
-- localStorage authority. ADDITIVE ONLY -- four new tables (Account, WorkspaceSettings,
-- Shift, UserPreference) with their indexes + FKs to Team/User (ON DELETE CASCADE).
-- No drops, no column changes, no data loss; existing rows unaffected. ASCII-only.
-- One-active-shift is enforced in the application (transactional read-then-create in
-- shifts.ts); a partial unique index is intentionally OMITTED so `prisma migrate diff`
-- stays empty (Prisma cannot express a filtered index in the schema).

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "phone" TEXT,
    "assignedPhone" TEXT,
    "group" TEXT NOT NULL DEFAULT 'Unassigned',
    "owner" TEXT NOT NULL DEFAULT 'Unassigned',
    "twoFA" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'warming',
    "tags" JSONB,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" DOUBLE PRECISION NOT NULL,
    "updatedAt" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceSettings" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "updatedAt" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "WorkspaceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" DOUBLE PRECISION NOT NULL,
    "endedAt" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'active',
    "correctedBy" TEXT,
    "correctedAt" DOUBLE PRECISION,
    "note" TEXT,
    "createdAt" DOUBLE PRECISION NOT NULL,
    "updatedAt" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "preferences" JSONB NOT NULL,
    "updatedAt" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Account_teamId_idx" ON "Account"("teamId");

-- CreateIndex
CREATE INDEX "Account_teamId_updatedAt_idx" ON "Account"("teamId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Account_teamId_username_key" ON "Account"("teamId", "username");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceSettings_teamId_key" ON "WorkspaceSettings"("teamId");

-- CreateIndex
CREATE INDEX "WorkspaceSettings_teamId_idx" ON "WorkspaceSettings"("teamId");

-- CreateIndex
CREATE INDEX "Shift_teamId_idx" ON "Shift"("teamId");

-- CreateIndex
CREATE INDEX "Shift_teamId_userId_idx" ON "Shift"("teamId", "userId");

-- CreateIndex
CREATE INDEX "Shift_teamId_userId_status_idx" ON "Shift"("teamId", "userId", "status");

-- CreateIndex
CREATE INDEX "Shift_teamId_startedAt_idx" ON "Shift"("teamId", "startedAt");

-- CreateIndex
CREATE INDEX "UserPreference_teamId_idx" ON "UserPreference"("teamId");

-- CreateIndex
CREATE INDEX "UserPreference_userId_idx" ON "UserPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_teamId_userId_key" ON "UserPreference"("teamId", "userId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSettings" ADD CONSTRAINT "WorkspaceSettings_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
