ALTER TABLE "NodifySubscriptionFile" ADD COLUMN "displayTrafficLimitBytes" TEXT;
CREATE TABLE "NodifySubscriptionAlias" (
  "hash" TEXT NOT NULL PRIMARY KEY,
  "fileId" TEXT,
  "encryptedAlias" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("fileId") REFERENCES "NodifySubscriptionFile"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NodifySubscriptionAlias_fileId_key" ON "NodifySubscriptionAlias"("fileId");
