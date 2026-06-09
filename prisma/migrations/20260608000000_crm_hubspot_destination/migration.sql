-- ─────────────────────────────────────────────────────
-- HubSpot CRM destination + flow-triggered deliveries.
--
-- Extends the Forms→CRM lead routing to a second delivery shape: pushing a
-- contact into HubSpot over its REST API (vs. ADF email for Tekion /
-- VinSolutions). All changes are additive so the deploy is safe:
--
--   CrmDestination
--     • accessToken — encrypted HubSpot Private App token (AES-256-GCM, same
--       as Account.sendgridApiKey). NULL for ADF providers.
--     • portalId    — HubSpot account id (informational).
--     • config      — optional JSON: field mapping + { pipelineId, stageId }.
--
--   CrmDelivery
--     • source        — "form" (a submission) or "flow" (a push_to_crm node).
--     • contactId     — the contact for flow-triggered pushes (no submission).
--     • submissionId  — relaxed to nullable so flow pushes can omit it.
-- ─────────────────────────────────────────────────────

ALTER TABLE "CrmDestination" ADD COLUMN "accessToken" TEXT;
ALTER TABLE "CrmDestination" ADD COLUMN "portalId" TEXT;
ALTER TABLE "CrmDestination" ADD COLUMN "config" JSONB;

ALTER TABLE "CrmDelivery" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'form';
ALTER TABLE "CrmDelivery" ADD COLUMN "contactId" TEXT;
ALTER TABLE "CrmDelivery" ALTER COLUMN "submissionId" DROP NOT NULL;

CREATE INDEX "CrmDelivery_contactId_idx" ON "CrmDelivery" ("contactId");
