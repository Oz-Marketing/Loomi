-- CreateTable
CREATE TABLE "MetaAdsPacerBudgetLog" (
    "id" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "baseSpend" TEXT,
    "baseClientBudget" TEXT,
    "addedSpend" TEXT,
    "addedClientBudget" TEXT,
    "note" TEXT,
    "authorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaAdsPacerBudgetLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetaAdsPacerBudgetLog_accountKey_period_createdAt_idx" ON "MetaAdsPacerBudgetLog"("accountKey", "period", "createdAt");

-- AddForeignKey
ALTER TABLE "MetaAdsPacerBudgetLog" ADD CONSTRAINT "MetaAdsPacerBudgetLog_accountKey_fkey" FOREIGN KEY ("accountKey") REFERENCES "Account"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaAdsPacerBudgetLog" ADD CONSTRAINT "MetaAdsPacerBudgetLog_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
