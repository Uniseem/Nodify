ALTER TABLE "NodifyWebsite" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NodifyWebsite" ADD COLUMN "appliedVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NodifyWebsite" ADD COLUMN "deployment" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NodifyWebsite" ADD COLUMN "appliedDeployment" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NodifyWebsite" ADD COLUMN "appliedConfig" TEXT;
ALTER TABLE "NodifyWebsite" ADD COLUMN "operationId" TEXT;
CREATE TABLE "NodifyWebsiteRevision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "websiteId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "config" JSON NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NodifyWebsiteRevision_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "NodifyWebsite"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NodifyWebsiteRevision_websiteId_version_key" ON "NodifyWebsiteRevision"("websiteId", "version");
