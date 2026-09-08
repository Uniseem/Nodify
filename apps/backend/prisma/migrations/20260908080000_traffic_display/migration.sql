ALTER TABLE "NodifyServer" ADD COLUMN "protocolTraffic" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "NodifyServer" ADD COLUMN "trafficSettings" JSONB NOT NULL DEFAULT '{"direction":"both","limitBytes":null}';
ALTER TABLE "NodifyServer" ADD COLUMN "trafficSettingsVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "NodifySubscriptionSource" ADD COLUMN "traffic" JSONB;
ALTER TABLE "NodifySubscriptionSource" ADD COLUMN "trafficDirection" TEXT NOT NULL DEFAULT 'both';
ALTER TABLE "NodifySubscriptionSource" ADD COLUMN "trafficStale" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "NodifySubscriptionFile" ADD COLUMN "statisticServerIds" JSONB NOT NULL DEFAULT '[]';
