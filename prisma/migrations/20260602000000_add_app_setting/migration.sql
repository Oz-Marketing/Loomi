-- Singleton key/value store for app-level settings that previously lived as
-- files on the release filesystem and were lost on every deploy (the app
-- builds each release from `git archive`, so runtime file writes don't
-- survive). First tenant: the "loomi-knowledge" key, holding the AI
-- knowledge-base markdown formerly at loomi-knowledge.md.
--
-- NOTE: production applies schema changes via `prisma db push` in the build
-- step, not `prisma migrate deploy`. This file is kept for history/parity
-- with the rest of prisma/migrations only.
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);
