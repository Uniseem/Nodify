CREATE TABLE "NodifySubscriptionFile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "entitlementId" TEXT NOT NULL,
  "templateId" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "nodeMode" TEXT NOT NULL DEFAULT 'all',
  "nodeIds" JSONB NOT NULL DEFAULT '[]',
  "tags" JSONB NOT NULL DEFAULT '[]',
  "ruleMode" TEXT NOT NULL DEFAULT 'all',
  "expiresAt" DATETIME,
  "tokenHash" TEXT NOT NULL,
  "encryptedToken" TEXT NOT NULL,
  "entitlementTokenHash" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY ("entitlementId") REFERENCES "NodifyEntitlement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("templateId") REFERENCES "NodifySubscriptionTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NodifySubscriptionFile_tokenHash_key" ON "NodifySubscriptionFile"("tokenHash");
CREATE INDEX "NodifySubscriptionFile_entitlementId_idx" ON "NodifySubscriptionFile"("entitlementId");
CREATE TABLE "NodifySubscriptionFileRule" (
  "fileId" TEXT NOT NULL,
  "ruleSetId" TEXT NOT NULL,
  PRIMARY KEY ("fileId", "ruleSetId"),
  FOREIGN KEY ("fileId") REFERENCES "NodifySubscriptionFile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("ruleSetId") REFERENCES "NodifyRuleSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
