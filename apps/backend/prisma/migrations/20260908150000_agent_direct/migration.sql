CREATE TABLE "NodifyAgentConnection" (
  "serverId" TEXT NOT NULL PRIMARY KEY,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "encryptedData" TEXT NOT NULL,
  "lastContactAt" DATETIME,
  "lastError" TEXT NOT NULL DEFAULT '',
  "leaseOwner" TEXT,
  "leaseUntil" DATETIME,
  CONSTRAINT "NodifyAgentConnection_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "NodifyServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
