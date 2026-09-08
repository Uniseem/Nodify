CREATE TABLE "NodifyTerminalSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "serverId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'pending',
  "reason" TEXT NOT NULL DEFAULT '',
  "encryptedData" TEXT NOT NULL,
  "inputSequence" INTEGER NOT NULL DEFAULT 0,
  "inputAck" INTEGER NOT NULL DEFAULT 0,
  "outputSequence" INTEGER NOT NULL DEFAULT 0,
  "outputBytes" INTEGER NOT NULL DEFAULT 0,
  "exitCode" INTEGER,
  "agentSeenAt" DATETIME,
  "clientUntil" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME NOT NULL,
  CONSTRAINT "NodifyTerminalSession_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "NodifyServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NodifyTerminalSession_operationId_key" ON "NodifyTerminalSession"("operationId");
CREATE INDEX "NodifyTerminalSession_serverId_state_idx" ON "NodifyTerminalSession"("serverId", "state");
CREATE INDEX "NodifyTerminalSession_expiresAt_idx" ON "NodifyTerminalSession"("expiresAt");
CREATE TABLE "NodifyTerminalOutput" (
  "sessionId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "encryptedData" TEXT NOT NULL,
  PRIMARY KEY ("sessionId", "sequence"),
  CONSTRAINT "NodifyTerminalOutput_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "NodifyTerminalSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
