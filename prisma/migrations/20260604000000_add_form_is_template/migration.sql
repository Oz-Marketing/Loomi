-- ─────────────────────────────────────────────────────
-- Form templates.
--
-- `isTemplate` flags a Form row as a reusable template (authored from
-- the Forms tab of the unified /templates page) rather than a live,
-- publicly-served form. Templates are excluded from the normal forms
-- list and from public /f/[slug] serving. "Save as template" clones an
-- existing form's schema into a new isTemplate row, scoped to the same
-- account. The compound index keeps the templates-vs-forms split cheap.
-- ─────────────────────────────────────────────────────

ALTER TABLE "Form" ADD COLUMN "isTemplate" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Form_accountKey_isTemplate_idx" ON "Form" ("accountKey", "isTemplate");
