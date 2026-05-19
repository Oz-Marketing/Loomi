-- AlterTable
ALTER TABLE "EspTemplate" ADD COLUMN "folderId" TEXT;

-- CreateTable
CREATE TABLE "EspTemplateFolder" (
    "id" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "remoteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EspTemplateFolder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EspTemplate_folderId_idx" ON "EspTemplate"("folderId");

-- CreateIndex
CREATE INDEX "EspTemplateFolder_accountKey_idx" ON "EspTemplateFolder"("accountKey");

-- CreateIndex
CREATE INDEX "EspTemplateFolder_parentId_idx" ON "EspTemplateFolder"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "EspTemplateFolder_accountKey_remoteId_key" ON "EspTemplateFolder"("accountKey", "remoteId");

-- AddForeignKey
ALTER TABLE "EspTemplate" ADD CONSTRAINT "EspTemplate_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "EspTemplateFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EspTemplateFolder" ADD CONSTRAINT "EspTemplateFolder_accountKey_fkey" FOREIGN KEY ("accountKey") REFERENCES "Account"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EspTemplateFolder" ADD CONSTRAINT "EspTemplateFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "EspTemplateFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
