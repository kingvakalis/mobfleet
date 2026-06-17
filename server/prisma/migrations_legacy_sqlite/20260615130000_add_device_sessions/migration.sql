-- CreateTable
CREATE TABLE "DeviceSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "startedAt" REAL NOT NULL,
    "endedAt" REAL,
    "agentVersion" TEXT,
    CONSTRAINT "DeviceSession_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DeviceSession_deviceId_startedAt_idx" ON "DeviceSession"("deviceId", "startedAt");

-- CreateIndex
CREATE INDEX "DeviceSession_teamId_startedAt_idx" ON "DeviceSession"("teamId", "startedAt");
