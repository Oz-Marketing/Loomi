-- Date of Birth is a first-class Contact column (unlike the automotive
-- lifecycle fields, which live in customFields) so the birthday flow
-- trigger can match on month/day across the whole roster without
-- scanning the customFields JSON blob.
ALTER TABLE "Contact" ADD COLUMN "dateOfBirth" TIMESTAMP;
