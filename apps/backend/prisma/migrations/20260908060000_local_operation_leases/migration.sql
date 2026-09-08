ALTER TABLE "NodifyOperation" ADD COLUMN "executor" TEXT NOT NULL DEFAULT 'agent';
ALTER TABLE "NodifyOperation" ADD COLUMN "localKey" TEXT;
ALTER TABLE "NodifyOperation" ADD COLUMN "leaseOwner" TEXT;
ALTER TABLE "NodifyOperation" ADD COLUMN "leaseUntil" DATETIME;
ALTER TABLE "NodifyOperation" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NodifyOperation" ADD COLUMN "retryOf" TEXT;
CREATE UNIQUE INDEX "NodifyOperation_localKey_key" ON "NodifyOperation"("localKey");
CREATE UNIQUE INDEX "NodifyOperation_retryOf_key" ON "NodifyOperation"("retryOf");
CREATE INDEX "NodifyOperation_executor_state_leaseUntil_idx" ON "NodifyOperation"("executor", "state", "leaseUntil");
