-- Per-sub-account SendGrid configuration. The API key is stored as
-- AES-256-GCM ciphertext (iv:authTag:ciphertext, base64) via the helper in
-- src/lib/esp/encryption.ts. When sendgridApiKey is null the worker falls
-- back to the existing SMTP transport.
ALTER TABLE "Account"
  ADD COLUMN "sendgridApiKey"     TEXT,
  ADD COLUMN "sendgridFromDomain" TEXT;
