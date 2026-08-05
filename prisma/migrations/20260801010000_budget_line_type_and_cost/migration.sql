-- Phase A of the budget-model modernisation (docs/budget-module.md §9).
--
-- lineType makes the agency's P&L explicit: media, agency fees, resold vendor
-- services and production all sat in one flat `channel` list, so gross margin
-- was uncomputable. `cost` replaces markup as the universal mechanism —
-- a percentage is right for media and wrong for a resold service, where the
-- cost is a number someone was invoiced.
--
-- Additive. Existing rows default to 'unclassified' and null cost; the
-- backfill script assigns types from each line's channel.
ALTER TABLE "BudgetLine" ADD COLUMN "lineType" TEXT NOT NULL DEFAULT 'unclassified';
ALTER TABLE "BudgetLine" ADD COLUMN "cost" DECIMAL(12,2);
CREATE INDEX "BudgetLine_accountKey_lineType_idx" ON "BudgetLine"("accountKey", "lineType");
