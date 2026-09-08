-- CreateTable
CREATE TABLE "NodifyServer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nodeUuid" TEXT NOT NULL,
    "tokenHash" TEXT,
    "nextTokenHash" TEXT,
    "enrollmentHash" TEXT,
    "enrollmentExpiresAt" DATETIME,
    "lastSeenAt" DATETIME,
    "version" TEXT,
    "hostname" TEXT,
    "metrics" JSON NOT NULL DEFAULT '{}',
    "desiredVersion" INTEGER NOT NULL DEFAULT 0,
    "appliedVersion" INTEGER NOT NULL DEFAULT 0,
    "policyHash" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NodifyServer_nodeUuid_fkey" FOREIGN KEY ("nodeUuid") REFERENCES "nodes" ("uuid") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "NodifyAgentSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" TEXT NOT NULL,
    FOREIGN KEY ("serverId") REFERENCES "NodifyServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "NodifyAgentSession_serverId_lastSeenAt_idx" ON "NodifyAgentSession"("serverId", "lastSeenAt");

-- CreateTable
CREATE TABLE "NodifyConfigRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSON NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'draft',
    "message" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NodifyConfigRevision_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "NodifyServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NodifyOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "message" TEXT NOT NULL DEFAULT '',
    "result" JSON NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "finishedAt" DATETIME,
    CONSTRAINT "NodifyOperation_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "NodifyServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NodifyInbound" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "hostUuid" TEXT NOT NULL,
    "config" JSON NOT NULL,
    CONSTRAINT "NodifyInbound_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "NodifyServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NodifyInbound_hostUuid_fkey" FOREIGN KEY ("hostUuid") REFERENCES "hosts" ("uuid") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NodifyWebsite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "config" JSON NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    CONSTRAINT "NodifyWebsite_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "NodifyServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NodifyCertificate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "domains" JSON NOT NULL,
    "certPem" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "encryptedAccount" TEXT,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "NodifyPackage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "config" JSON NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "NodifyEntitlement" (
    "generation" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" BIGINT NOT NULL,
    "packageId" TEXT NOT NULL,
    "snapshot" JSON NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "anytlsPassword" TEXT NOT NULL,
    "usedBytes" BIGINT NOT NULL DEFAULT 0,
    "uploadBytes" BIGINT NOT NULL DEFAULT 0,
    "downloadBytes" BIGINT NOT NULL DEFAULT 0,
    "nextResetAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NodifyEntitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NodifyEntitlement_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "NodifyPackage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NodifyTrafficBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "session" TEXT NOT NULL,
    "sequence" BIGINT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NodifyTrafficBatch_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "NodifyServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NodifySubscriptionSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "encryptedUrl" TEXT NOT NULL,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 360,
    "nodes" JSON NOT NULL DEFAULT '[]',
    "lastSyncedAt" DATETIME,
    "lastAttemptAt" DATETIME,
    "lastError" TEXT
);

-- CreateTable
CREATE TABLE "NodifyBackup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'running',
    "message" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "NodifySetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "NodifyServer_nodeUuid_key" ON "NodifyServer"("nodeUuid");

-- CreateIndex
CREATE UNIQUE INDEX "NodifyServer_tokenHash_key" ON "NodifyServer"("tokenHash");
CREATE UNIQUE INDEX "NodifyServer_nextTokenHash_key" ON "NodifyServer"("nextTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "NodifyServer_enrollmentHash_key" ON "NodifyServer"("enrollmentHash");

-- CreateIndex
CREATE UNIQUE INDEX "NodifyConfigRevision_serverId_version_key" ON "NodifyConfigRevision"("serverId", "version");

-- CreateIndex
CREATE INDEX "NodifyOperation_serverId_state_idx" ON "NodifyOperation"("serverId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "NodifyInbound_hostUuid_key" ON "NodifyInbound"("hostUuid");

-- CreateIndex
CREATE UNIQUE INDEX "NodifyWebsite_serverId_domain_key" ON "NodifyWebsite"("serverId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "NodifyEntitlement_userId_key" ON "NodifyEntitlement"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NodifyEntitlement_tokenHash_key" ON "NodifyEntitlement"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "NodifyTrafficBatch_serverId_session_sequence_key" ON "NodifyTrafficBatch"("serverId", "session", "sequence");

