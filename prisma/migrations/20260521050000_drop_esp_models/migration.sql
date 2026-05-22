-- ─────────────────────────────────────────────────────
-- Drop the ESP framework tables + Account.espProvider column.
--
-- The contact + connection migration is complete: all consumers point
-- at /api/contacts and the Loomi-native SendGrid/Twilio engines.
-- These tables no longer back any feature.
--
-- Tables dropped:
--   * EspConnection                — API-key provider creds (legacy)
--   * EspOAuthConnection           — per-sub-account OAuth tokens
--   * EspProviderOAuthCredential   — agency-level OAuth tokens
--   * EspAccountProviderLink       — account ↔ remote-location mapping
--   * EspTemplate                  — remote template mirror
--   * EspTemplateFolder            — remote template folder mirror
--   * CampaignEmailStats           — LCEmailStats webhook cache (already gone from schema; drop if still present)
--
-- Column dropped:
--   * Account.espProvider          — active provider for the account
-- ─────────────────────────────────────────────────────

DROP TABLE IF EXISTS "EspTemplate" CASCADE;
DROP TABLE IF EXISTS "EspTemplateFolder" CASCADE;
DROP TABLE IF EXISTS "EspAccountProviderLink" CASCADE;
DROP TABLE IF EXISTS "EspProviderOAuthCredential" CASCADE;
DROP TABLE IF EXISTS "EspOAuthConnection" CASCADE;
DROP TABLE IF EXISTS "EspConnection" CASCADE;
DROP TABLE IF EXISTS "CampaignEmailStats" CASCADE;

ALTER TABLE "Account" DROP COLUMN IF EXISTS "espProvider";
