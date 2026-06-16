-- Step 3A: Supabase-to-Prisma migration mapping + audit schema (additive, safe).
-- Generated from schema.postgres.prisma via `prisma migrate diff`. Applied in
-- production with `prisma migrate deploy` (after the history is baselined; see the
-- Step 3 plan). All changes are backwards-compatible: new nullable columns, a
-- relaxed (now-optional) Invite.invitedBy FK, and a new table -- existing rows and
-- the running server (which never references these yet) are unaffected.
-- NOTE: keep this file ASCII-only so it applies cleanly under any DB encoding.

-- DropForeignKey
ALTER TABLE "Invite" DROP CONSTRAINT "Invite_invitedByUserId_fkey";

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "archivedAt" DOUBLE PRECISION,
ADD COLUMN     "supabaseTeamId" TEXT;

-- AlterTable
ALTER TABLE "Invite" ALTER COLUMN "invitedByUserId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "MigrationRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "supabaseId" TEXT,
    "prismaId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "error" TEXT,
    "createdAt" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "MigrationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MigrationRecord_batchId_idx" ON "MigrationRecord"("batchId");

-- CreateIndex
CREATE INDEX "MigrationRecord_entity_prismaId_idx" ON "MigrationRecord"("entity", "prismaId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_supabaseTeamId_key" ON "Team"("supabaseTeamId");

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
