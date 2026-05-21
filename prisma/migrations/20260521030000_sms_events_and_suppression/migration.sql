-- One row per Twilio status-callback or inbound message webhook entry.
-- recipientId is nullable to accommodate inbound STOP messages (no
-- outbound row to join to) and out-of-band sends.
--
-- twilioMessageSid is unique: Twilio retries on 5xx and dedup is the
-- caller's problem. Status callbacks for the same SID arrive multiple
-- times as the message moves through states (queued → sent →
-- delivered), so the upsert key includes status to keep each
-- transition as its own row.
CREATE TABLE "SmsEvent" (
  "id"                  TEXT PRIMARY KEY,
  "campaignId"          TEXT,
  "recipientId"         TEXT,
  "accountKey"          TEXT,
  "eventType"           TEXT      NOT NULL,  -- queued|sent|delivered|undelivered|failed|received|stop|unsub
  "twilioMessageSid"    TEXT,
  "from"                TEXT,
  "to"                  TEXT,
  "body"                TEXT,
  "errorCode"           TEXT,
  "errorMessage"        TEXT,
  "raw"                 TEXT      NOT NULL,
  "timestamp"           TIMESTAMP NOT NULL,
  "createdAt"           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- (sid, eventType) is the de-dup key: same SID can produce multiple
-- terminal events (sent then delivered), so we don't make sid alone
-- unique.
CREATE UNIQUE INDEX "SmsEvent_twilioMessageSid_eventType_key"
  ON "SmsEvent" ("twilioMessageSid", "eventType")
  WHERE "twilioMessageSid" IS NOT NULL;

CREATE INDEX "SmsEvent_campaignId_eventType_idx" ON "SmsEvent" ("campaignId", "eventType");
CREATE INDEX "SmsEvent_recipientId_idx" ON "SmsEvent" ("recipientId");
CREATE INDEX "SmsEvent_accountKey_eventType_idx" ON "SmsEvent" ("accountKey", "eventType");
CREATE INDEX "SmsEvent_twilioMessageSid_idx" ON "SmsEvent" ("twilioMessageSid");
CREATE INDEX "SmsEvent_timestamp_idx" ON "SmsEvent" ("timestamp");

ALTER TABLE "SmsEvent"
  ADD CONSTRAINT "SmsEvent_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "SmsCampaignRecipient" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────
-- SMS suppression list. Sub-account scoped; the inbound webhook
-- populates it from STOP/STOPALL/UNSUBSCRIBE keywords, and the
-- campaign scheduler drops suppressed phones from future batches.
-- ─────────────────────────────────────────────────────
CREATE TABLE "SmsSuppression" (
  "id"         TEXT PRIMARY KEY,
  "accountKey" TEXT      NOT NULL,
  "phone"      TEXT      NOT NULL,
  "reason"     TEXT      NOT NULL,  -- stop | unsub | undelivered | manual
  "source"     TEXT      NOT NULL DEFAULT 'twilio', -- twilio | manual
  "raw"        TEXT,
  "createdAt"  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "SmsSuppression_accountKey_phone_key"
  ON "SmsSuppression" ("accountKey", "phone");
CREATE INDEX "SmsSuppression_phone_idx" ON "SmsSuppression" ("phone");
