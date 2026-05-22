-- ─────────────────────────────────────────────────────
-- Local Contact storage (Loomi-native, replaces GHL/Klaviyo reads).
--
-- Schema mirrors the canonical Contact interface used by the
-- existing filter engine and contacts UI (smart-list-types.ts +
-- contacts-table.tsx), so consumers don't need to learn a new shape.
--
-- Two relief valves:
--   * customFields  — jsonb blob for CSV columns we didn't anticipate
--                     (dealer-specific data, vehicle service history, etc.)
--   * dnd           — jsonb blob for { email?: bool, sms?: bool } opt-outs
--                     (the 7-channel GHL DND grid does not survive the cut).
--
-- Email and phone are independently optional but a contact must have
-- at least one (enforced at the API/import layer, not via CHECK so
-- bulk import dry-runs can stage partial rows). Postgres treats NULLs
-- as distinct in unique constraints, so a plain UNIQUE permits any
-- number of email-less / phone-less rows per account. The importer
-- normalises email to lowercase and phone to E.164 before write, so
-- the index is effectively case-folded without a partial expression.
-- ─────────────────────────────────────────────────────

CREATE TABLE "Contact" (
  "id"                TEXT      PRIMARY KEY,
  "accountKey"        TEXT      NOT NULL,
  "email"             TEXT,
  "phone"             TEXT,
  "firstName"         TEXT,
  "lastName"          TEXT,
  "fullName"          TEXT,
  "address1"          TEXT,
  "city"              TEXT,
  "state"             TEXT,
  "postalCode"        TEXT,
  "country"           TEXT,
  "source"            TEXT,
  "tags"              JSONB     NOT NULL DEFAULT '[]'::jsonb,
  "dateAdded"         TIMESTAMP,

  "vehicleYear"       TEXT,
  "vehicleMake"       TEXT,
  "vehicleModel"      TEXT,
  "vehicleVin"        TEXT,
  "vehicleMileage"    TEXT,

  "lastServiceDate"   TIMESTAMP,
  "nextServiceDate"   TIMESTAMP,
  "leaseEndDate"      TIMESTAMP,
  "warrantyEndDate"   TIMESTAMP,
  "purchaseDate"      TIMESTAMP,

  "customFields"      JSONB,
  "dnd"               JSONB,

  "createdAt"         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "Contact_accountKey_email_key" ON "Contact" ("accountKey", "email");
CREATE UNIQUE INDEX "Contact_accountKey_phone_key" ON "Contact" ("accountKey", "phone");

CREATE INDEX "Contact_accountKey_idx" ON "Contact" ("accountKey");
CREATE INDEX "Contact_accountKey_dateAdded_idx" ON "Contact" ("accountKey", "dateAdded");

ALTER TABLE "Contact"
  ADD CONSTRAINT "Contact_accountKey_fkey"
  FOREIGN KEY ("accountKey") REFERENCES "Account" ("key")
  ON DELETE CASCADE ON UPDATE CASCADE;
