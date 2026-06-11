-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" REAL NOT NULL
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" REAL NOT NULL,
    "createdAt" REAL NOT NULL,
    "startedAt" REAL,
    "finishedAt" REAL,
    "error" TEXT
);

-- CreateTable
CREATE TABLE "Proxy" (
    "ip" TEXT NOT NULL PRIMARY KEY,
    "region" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "assignedTo" TEXT,
    "status" TEXT NOT NULL,
    "latency" INTEGER NOT NULL,
    "lastCheck" REAL NOT NULL
);
