-- ─────────────────────────────────────────────────────
-- Landing Page templates (system + sub-account).
--
-- LP templates become first-class LandingPage rows flagged isTemplate,
-- so the existing LP editor edits them in place (no editor changes) and
-- the system/sub-account split mirrors Forms: accountKey = null is a
-- global system/library template; accountKey set is sub-account-owned.
-- Templates are excluded from public /lp/[slug] serving and the LP list.
--
-- Existing dealer-saved templates in AccountLandingPageTemplate are
-- migrated into LandingPage isTemplate rows by a one-time script
-- (scripts/migrate-lp-templates.ts). The old table is kept as a backup.
-- ─────────────────────────────────────────────────────

ALTER TABLE "LandingPage" ADD COLUMN "isTemplate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LandingPage" ALTER COLUMN "accountKey" DROP NOT NULL;

CREATE INDEX "LandingPage_accountKey_isTemplate_idx" ON "LandingPage" ("accountKey", "isTemplate");
