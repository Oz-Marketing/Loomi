-- Per-subaccount sender identity for Loomi-native email sends.
-- All nullable: existing accounts keep working with the SMTP_FROM env fallback
-- in src/lib/services/email-campaigns.ts until each pilot subaccount is
-- configured with its own sending domain (DKIM/SPF/DMARC in client DNS).
ALTER TABLE "Account"
  ADD COLUMN "senderEmail"   TEXT,
  ADD COLUMN "senderName"    TEXT,
  ADD COLUMN "sendingDomain" TEXT,
  ADD COLUMN "replyToEmail"  TEXT;
