-- Adds the lead-notification recipient email(s) to Form, so a submission can
-- alert an inbox in addition to (or instead of) CRM forwarding. Additive +
-- nullable; IF NOT EXISTS keeps it idempotent across environments.
ALTER TABLE "Form" ADD COLUMN IF NOT EXISTS "notificationEmail" TEXT;
