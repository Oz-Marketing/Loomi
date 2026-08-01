-- Budget module: the media-dollar ledger. See docs/budget-module.md.
-- Purely additive: three new tables, their indexes, and outward FKs.

-- CreateTable
CREATE TABLE "BudgetPlan" (
    "id" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "declaredTotal" DECIMAL(12,2),
    "monthlyRetainer" DECIMAL(12,2),
    "defaultMarkup" DOUBLE PRECISION,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLine" (
    "id" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "spendAccountKey" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "period" TEXT,
    "channel" TEXT,
    "category" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "markupSnapshot" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'adhoc',
    "status" TEXT NOT NULL DEFAULT 'planned',
    "bucket" TEXT NOT NULL DEFAULT 'added',
    "initiativeId" TEXT,
    "taskId" TEXT,
    "batchId" TEXT,
    "linkedAssetType" TEXT,
    "linkedAssetId" TEXT,
    "actualAmount" DECIMAL(12,2),
    "settledAt" TIMESTAMP(3),
    "label" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLineEvent" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "fromValue" TEXT,
    "toValue" TEXT,
    "summary" TEXT NOT NULL,
    "counterpartyLineId" TEXT,
    "groupId" TEXT,
    "authorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetLineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BudgetPlan_year_idx" ON "BudgetPlan"("year");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetPlan_accountKey_year_key" ON "BudgetPlan"("accountKey", "year");

-- CreateIndex
CREATE INDEX "BudgetLine_accountKey_year_idx" ON "BudgetLine"("accountKey", "year");

-- CreateIndex
CREATE INDEX "BudgetLine_accountKey_period_idx" ON "BudgetLine"("accountKey", "period");

-- CreateIndex
CREATE INDEX "BudgetLine_spendAccountKey_period_channel_idx" ON "BudgetLine"("spendAccountKey", "period", "channel");

-- CreateIndex
CREATE INDEX "BudgetLine_accountKey_status_idx" ON "BudgetLine"("accountKey", "status");

-- CreateIndex
CREATE INDEX "BudgetLine_initiativeId_idx" ON "BudgetLine"("initiativeId");

-- CreateIndex
CREATE INDEX "BudgetLine_taskId_idx" ON "BudgetLine"("taskId");

-- CreateIndex
CREATE INDEX "BudgetLine_batchId_idx" ON "BudgetLine"("batchId");

-- CreateIndex
CREATE INDEX "BudgetLine_archivedAt_idx" ON "BudgetLine"("archivedAt");

-- CreateIndex
CREATE INDEX "BudgetLineEvent_lineId_createdAt_idx" ON "BudgetLineEvent"("lineId", "createdAt");

-- CreateIndex
CREATE INDEX "BudgetLineEvent_groupId_idx" ON "BudgetLineEvent"("groupId");

-- CreateIndex
CREATE INDEX "BudgetLineEvent_createdAt_idx" ON "BudgetLineEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "BudgetPlan" ADD CONSTRAINT "BudgetPlan_accountKey_fkey" FOREIGN KEY ("accountKey") REFERENCES "Account"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_accountKey_fkey" FOREIGN KEY ("accountKey") REFERENCES "Account"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_spendAccountKey_fkey" FOREIGN KEY ("spendAccountKey") REFERENCES "Account"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_initiativeId_fkey" FOREIGN KEY ("initiativeId") REFERENCES "Initiative"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLineEvent" ADD CONSTRAINT "BudgetLineEvent_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "BudgetLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLineEvent" ADD CONSTRAINT "BudgetLineEvent_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
