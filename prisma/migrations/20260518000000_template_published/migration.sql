-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "published" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "publishedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "Template_published_idx" ON "Template"("published");

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
