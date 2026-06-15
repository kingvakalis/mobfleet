-- CreateTable
CREATE TABLE "TeamEmailSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "resendApiKey" TEXT NOT NULL,
    "updatedAt" REAL NOT NULL,
    CONSTRAINT "TeamEmailSettings_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamEmailSettings_teamId_key" ON "TeamEmailSettings"("teamId");
