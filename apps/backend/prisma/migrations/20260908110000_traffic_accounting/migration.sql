ALTER TABLE "NodifyServer" ADD COLUMN "trafficEpoch" INTEGER NOT NULL DEFAULT 1;
CREATE TABLE "NodifyTrafficAccounting" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "serverId" TEXT NOT NULL,
  "epoch" INTEGER NOT NULL,
  "periodStart" TEXT NOT NULL,
  "periodEnd" TEXT,
  "settings" JSONB NOT NULL,
  "baselineUpload" TEXT NOT NULL DEFAULT '0',
  "baselineDownload" TEXT NOT NULL DEFAULT '0',
  "adjustment" TEXT NOT NULL DEFAULT '0',
  "calibrated" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY ("serverId") REFERENCES "NodifyServer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NodifyTrafficAccounting_serverId_epoch_periodStart_key" ON "NodifyTrafficAccounting"("serverId", "epoch", "periodStart");
CREATE TABLE "NodifyTrafficAdjustment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountingId" TEXT NOT NULL,
  "request" JSONB NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("accountingId") REFERENCES "NodifyTrafficAccounting"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "NodifyTrafficAdjustment_accountingId_createdAt_idx" ON "NodifyTrafficAdjustment"("accountingId", "createdAt");
