-- ─────────────────────────────────────────────────────
-- System form templates.
--
-- A system/library form template has no owning sub-account
-- (accountKey = null) — it's the global, admin-curated master that
-- sub-accounts copy from. Live forms and sub-account templates keep a
-- real accountKey. The existing FK already permits NULL once the
-- NOT NULL constraint is dropped, and public /f/[slug] serving +
-- the submission pipeline only ever touch non-template rows.
-- ─────────────────────────────────────────────────────

ALTER TABLE "Form" ALTER COLUMN "accountKey" DROP NOT NULL;
