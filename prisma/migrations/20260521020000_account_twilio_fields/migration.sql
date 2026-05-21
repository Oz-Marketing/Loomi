-- Per-sub-account Twilio credentials for direct SMS sending. accountSid
-- + authToken are stored as AES-256-GCM ciphertext via the same helper
-- as the SendGrid key (src/lib/esp/encryption.ts). phoneNumber +
-- messagingServiceSid are non-sensitive routing metadata so they stay
-- cleartext. When neither is configured the SMS worker falls back to
-- the legacy GHL Conversations API path.
ALTER TABLE "Account"
  ADD COLUMN "twilioAccountSid"          TEXT,
  ADD COLUMN "twilioAuthToken"           TEXT,
  ADD COLUMN "twilioPhoneNumber"         TEXT,
  ADD COLUMN "twilioMessagingServiceSid" TEXT;
