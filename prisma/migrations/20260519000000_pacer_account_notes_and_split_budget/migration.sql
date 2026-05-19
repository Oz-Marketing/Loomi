-- AlterTable
ALTER TABLE "MetaAdsPacerAd" ADD COLUMN     "splitBaseAmount" TEXT;

-- CreateTable
CREATE TABLE "MetaAdsPacerAccountNote" (
    "id" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "authorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaAdsPacerAccountNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetaAdsPacerAccountNote_accountKey_createdAt_idx" ON "MetaAdsPacerAccountNote"("accountKey", "createdAt");

-- AddForeignKey
ALTER TABLE "MetaAdsPacerAccountNote" ADD CONSTRAINT "MetaAdsPacerAccountNote_accountKey_fkey" FOREIGN KEY ("accountKey") REFERENCES "Account"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaAdsPacerAccountNote" ADD CONSTRAINT "MetaAdsPacerAccountNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
