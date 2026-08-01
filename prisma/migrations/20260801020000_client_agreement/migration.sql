-- Phase B: the agreement layer (docs/budget-module.md §9).
--
-- Replaces year-keyed BudgetPlan with a term-based ClientAgreement. Agreements
-- don't respect calendar years — a term running Mar 2026 – Feb 2027 can't be a
-- row per year — so the term is real dates and a year's share is derived.
--
-- Existing BudgetPlan rows are MIGRATED, not dropped: each becomes an agreement
-- spanning Jan 1 – Dec 31 of its year, and a monthlyRetainer becomes a fee row.

CREATE TABLE "ClientAgreement" (
    "id" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "committedAmount" DECIMAL(12,2),
    "status" TEXT NOT NULL DEFAULT 'active',
    "defaultMarkup" DOUBLE PRECISION,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClientAgreement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgreementFee" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "monthlyAmount" DECIMAL(12,2) NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgreementFee_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientAgreement_accountKey_status_idx" ON "ClientAgreement"("accountKey", "status");
CREATE INDEX "ClientAgreement_accountKey_startDate_endDate_idx" ON "ClientAgreement"("accountKey", "startDate", "endDate");
CREATE INDEX "ClientAgreement_archivedAt_idx" ON "ClientAgreement"("archivedAt");
CREATE INDEX "AgreementFee_agreementId_idx" ON "AgreementFee"("agreementId");

ALTER TABLE "ClientAgreement" ADD CONSTRAINT "ClientAgreement_accountKey_fkey"
  FOREIGN KEY ("accountKey") REFERENCES "Account"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgreementFee" ADD CONSTRAINT "AgreementFee_agreementId_fkey"
  FOREIGN KEY ("agreementId") REFERENCES "ClientAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BudgetLine" ADD COLUMN "agreementId" TEXT;
CREATE INDEX "BudgetLine_agreementId_idx" ON "BudgetLine"("agreementId");
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_agreementId_fkey"
  FOREIGN KEY ("agreementId") REFERENCES "ClientAgreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Carry any existing plans across. Guarded so this is a no-op where BudgetPlan
-- was never created.
DO $$
BEGIN
  IF to_regclass('public."BudgetPlan"') IS NOT NULL THEN
    INSERT INTO "ClientAgreement" (
      "id", "accountKey", "name", "startDate", "endDate",
      "committedAmount", "status", "defaultMarkup", "notes",
      "createdByUserId", "createdAt", "updatedAt"
    )
    SELECT
      'agr_' || p."id",
      p."accountKey",
      p."year" || ' Agreement',
      make_date(p."year", 1, 1),
      make_date(p."year", 12, 31),
      p."declaredTotal",
      'active',
      p."defaultMarkup",
      p."notes",
      p."createdByUserId",
      p."createdAt",
      p."updatedAt"
    FROM "BudgetPlan" p;

    -- A monthlyRetainer becomes a fee row. Channel is unknown at this point —
    -- the old field never recorded one — so it lands on managed_marketing_services,
    -- which is what that money almost always was.
    INSERT INTO "AgreementFee" ("id", "agreementId", "channel", "monthlyAmount", "label", "createdAt", "updatedAt")
    SELECT
      'fee_' || p."id",
      'agr_' || p."id",
      'managed_marketing_services',
      p."monthlyRetainer",
      'Migrated from monthly retainer',
      p."createdAt",
      p."updatedAt"
    FROM "BudgetPlan" p
    WHERE p."monthlyRetainer" IS NOT NULL AND p."monthlyRetainer" > 0;

    DROP TABLE "BudgetPlan";
  END IF;
END $$;
