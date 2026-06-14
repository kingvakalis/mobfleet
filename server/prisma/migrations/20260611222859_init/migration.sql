-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "successRate" REAL NOT NULL,
    "runs" INTEGER NOT NULL,
    "lastRun" TEXT NOT NULL
);
