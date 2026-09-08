ALTER TABLE "NodifySubscriptionSource" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "NodifySubscriptionSource" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "NodifySubscriptionSource" ADD COLUMN "tags" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "NodifySubscriptionSource" ADD COLUMN "nodeOverrides" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "NodifySubscriptionSource" ADD COLUMN "operationId" TEXT;
