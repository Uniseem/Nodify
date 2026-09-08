ALTER TABLE "NodifySubscriptionTemplate" ADD COLUMN "ruleMode" TEXT NOT NULL DEFAULT 'all';
CREATE TABLE "NodifySubscriptionTemplateRule" (
  "templateId" TEXT NOT NULL,
  "ruleSetId" TEXT NOT NULL,
  PRIMARY KEY ("templateId", "ruleSetId"),
  CONSTRAINT "NodifySubscriptionTemplateRule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "NodifySubscriptionTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NodifySubscriptionTemplateRule_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "NodifyRuleSet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "NodifySubscriptionTemplateRule_ruleSetId_idx" ON "NodifySubscriptionTemplateRule"("ruleSetId");
