-- Stable identity in the source system for imported lines
-- ("ozreports:account_budgets:<id>"), so the Oz Reports migration upserts
-- rather than duplicating the ledger on a re-run. Additive and nullable —
-- everything created in Loomi leaves it null.
ALTER TABLE "BudgetLine" ADD COLUMN "externalId" TEXT;
CREATE UNIQUE INDEX "BudgetLine_externalId_key" ON "BudgetLine"("externalId");
