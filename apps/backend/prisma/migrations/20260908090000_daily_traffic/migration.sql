ALTER TABLE "NodifyServer" ADD COLUMN "ledgerStartedAt" DATETIME;
ALTER TABLE "NodifyTrafficBatch" ADD COLUMN "collectedAt" DATETIME;
ALTER TABLE "NodifyTrafficBatch" ADD COLUMN "accountingDay" TEXT;
ALTER TABLE "NodifyTrafficBatch" ADD COLUMN "timeSource" TEXT NOT NULL DEFAULT 'unavailable';
CREATE TABLE "NodifyDailyTraffic" (
  "serverId" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "upload" TEXT NOT NULL DEFAULT '0',
  "download" TEXT NOT NULL DEFAULT '0',
  "charged" TEXT NOT NULL DEFAULT '0',
  "rated" TEXT NOT NULL DEFAULT '0',
  "unratedRaw" TEXT NOT NULL DEFAULT '0',
  "unchargedRaw" TEXT NOT NULL DEFAULT '0',
  "reports" INTEGER NOT NULL DEFAULT 0,
  "receivedDateReports" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" DATETIME NOT NULL,
  PRIMARY KEY ("serverId","day","userId"),
  FOREIGN KEY ("serverId") REFERENCES "NodifyServer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "NodifyDailyTraffic_userId_day_idx" ON "NodifyDailyTraffic"("userId","day");
CREATE INDEX "NodifyDailyTraffic_day_idx" ON "NodifyDailyTraffic"("day");
