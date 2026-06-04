-- ─────────────────────────────────────────────────────
-- Forms → CRM lead routing (Tekion / VinSolutions via ADF email).
--
-- CrmDestination: per-account CRM lead-intake config — the provider and
-- the CRM's ADF lead email address. CrmDelivery: one row per
-- (destination, submission) send attempt — the audit/retry log. The
-- per-form `Form.forwardToCrm` flag gates whether a submission is
-- forwarded at all. submissionId is intentionally NOT a foreign key so
-- pruning submissions never cascades away the delivery history.
-- ─────────────────────────────────────────────────────

ALTER TABLE "Form" ADD COLUMN "forwardToCrm" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "CrmDestination" (
  "id"              TEXT      PRIMARY KEY,
  "accountKey"      TEXT      NOT NULL,
  "provider"        TEXT      NOT NULL,
  "leadEmail"       TEXT      NOT NULL,
  "enabled"         BOOLEAN   NOT NULL DEFAULT true,
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CrmDestination_accountKey_fkey" FOREIGN KEY ("accountKey") REFERENCES "Account" ("key") ON DELETE CASCADE ON UPDATE CASCADE
);

-- One destination per CRM per account (each provider is a single connect).
CREATE UNIQUE INDEX "CrmDestination_accountKey_provider_key" ON "CrmDestination" ("accountKey", "provider");
CREATE INDEX "CrmDestination_accountKey_enabled_idx" ON "CrmDestination" ("accountKey", "enabled");

CREATE TABLE "CrmDelivery" (
  "id"            TEXT      PRIMARY KEY,
  "destinationId" TEXT      NOT NULL,
  "submissionId"  TEXT      NOT NULL,
  "status"        TEXT      NOT NULL DEFAULT 'pending',
  "attempts"      INTEGER   NOT NULL DEFAULT 0,
  "messageId"     TEXT,
  "lastError"     TEXT,
  "createdAt"     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt"        TIMESTAMP,

  CONSTRAINT "CrmDelivery_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "CrmDestination" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CrmDelivery_destinationId_createdAt_idx" ON "CrmDelivery" ("destinationId", "createdAt");
CREATE INDEX "CrmDelivery_submissionId_idx" ON "CrmDelivery" ("submissionId");
