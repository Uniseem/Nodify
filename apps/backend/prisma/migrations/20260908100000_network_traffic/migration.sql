ALTER TABLE "NodifyServer" ADD COLUMN "networkTraffic" JSONB NOT NULL DEFAULT '{}';
CREATE TABLE "NodifyNetworkBatch" (
  "serverId" TEXT NOT NULL,
  "session" TEXT NOT NULL,
  "sequence" BIGINT NOT NULL,
  "bootId" TEXT NOT NULL,
  "collectedAt" DATETIME NOT NULL,
  "accountingDay" TEXT NOT NULL,
  "timeSource" TEXT NOT NULL,
  "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("serverId", "session", "sequence"),
  FOREIGN KEY ("serverId") REFERENCES "NodifyServer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "NodifyNetworkDaily" (
  "serverId" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "interface" TEXT NOT NULL,
  "upload" TEXT NOT NULL DEFAULT '0',
  "download" TEXT NOT NULL DEFAULT '0',
  "reports" INTEGER NOT NULL DEFAULT 0,
  "discontinuities" INTEGER NOT NULL DEFAULT 0,
  "crossDateReports" INTEGER NOT NULL DEFAULT 0,
  "receivedDateReports" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" DATETIME NOT NULL,
  PRIMARY KEY ("serverId", "day", "interface"),
  FOREIGN KEY ("serverId") REFERENCES "NodifyServer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "NodifyNetworkDaily_day_serverId_idx" ON "NodifyNetworkDaily"("day", "serverId");
