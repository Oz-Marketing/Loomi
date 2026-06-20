-- The `customFonts` field (uploaded brand/OEM font files, JSON) was added to
-- the Account model for the Ad Generator but never migrated, so the column was
-- missing in the database. Any query selecting all Account columns (e.g.
-- accountService.getAccounts) then 500'd, which broke the account switcher.
-- Additive + nullable; IF NOT EXISTS keeps it idempotent across environments.
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "customFonts" TEXT;
