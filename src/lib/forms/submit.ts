/**
 * Form submission pipeline.
 *
 * Glues together validation → Contact upsert → list attach → FormSubmission
 * write → counter increment → flow-trigger hook. The public POST endpoint
 * is a thin wrapper around `submitForm` so the orchestration is testable
 * in isolation.
 */
import type { Form, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { parseFormTemplate } from './types';
import { validateSubmission, FormValidationError } from './validate';
import { enrollContactForFormSubmission } from '@/lib/services/loomi-flows';
import {
  TURNSTILE_RESPONSE_FIELD,
  isTurnstileConfigured,
  verifyTurnstileToken,
} from './turnstile';

export interface SubmitContext {
  ipAddress?: string | null;
  userAgent?: string | null;
  referrer?: string | null;
  /** Landing-page attribution — set when the submission came from a
   *  form embedded on a Loomi LP. Stored alongside the submission so
   *  reports can answer "which page generated this lead". */
  lpId?: string | null;
  lpSlug?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
}

export interface SubmissionResult {
  submissionId: string;
  contactId: string | null;
  redirectUrl: string | null;
  successMessage: string | null;
}

export class FormSubmitError extends Error {
  constructor(
    message: string,
    public status = 400,
    public errors?: { field: string; message: string }[],
  ) {
    super(message);
    this.name = 'FormSubmitError';
  }
}

/**
 * Run a submission through the full pipeline.
 *
 * Throws `FormValidationError` (from `validate`) on field errors and
 * `FormSubmitError` for orchestration failures (form missing, db errors).
 * The route handler converts these to JSON responses with the right HTTP
 * status code.
 */
export async function submitForm(args: {
  form: Form;
  rawData: Record<string, unknown>;
  context: SubmitContext;
}): Promise<SubmissionResult> {
  const { form, rawData, context } = args;

  const template = parseFormTemplate(form.schema as unknown);
  if (!template) {
    throw new FormSubmitError('Form schema is malformed', 500);
  }

  // CAPTCHA verification runs before schema validation so a failed
  // challenge doesn't leak which fields are required (and so we don't
  // burn a Prisma round-trip on a bot submission). When Turnstile
  // isn't configured we skip silently and fall back to honeypot-only.
  //
  // The token is plucked off rawData before validation regardless of
  // configuration so it never ends up in submission.data — the
  // honeypot pattern.
  const turnstileToken =
    typeof rawData[TURNSTILE_RESPONSE_FIELD] === 'string'
      ? (rawData[TURNSTILE_RESPONSE_FIELD] as string)
      : null;
  delete rawData[TURNSTILE_RESPONSE_FIELD];

  if (isTurnstileConfigured()) {
    const verdict = await verifyTurnstileToken(turnstileToken, context.ipAddress);
    if (!verdict.ok) {
      throw new FormSubmitError(
        verdict.message || 'Verification failed. Please try again.',
        400,
        [{ field: '_form', message: verdict.message || 'Verification failed.' }],
      );
    }
  }

  // Validate first — throws FormValidationError on bad input.
  const { values, identifiers } = validateSubmission(template, rawData);

  // Upsert the Contact if we have an identifier. Anonymous submissions
  // (no email + no phone) still get stored, just without a contact link.
  const contactId = await upsertContactFromSubmission({
    accountKey: form.accountKey,
    email: identifiers.email,
    phone: identifiers.phone,
    firstName: identifiers.firstName,
    lastName: identifiers.lastName,
  });

  // Attach to the configured list. Idempotent — composite PK on
  // ContactListMembership prevents duplicate rows for the same pair.
  if (contactId && form.listId) {
    await attachContactToList(contactId, form.listId, form.accountKey);
  }

  // Write the raw submission + bump the form's counter. The LP
  // attribution and UTM fields are nullable — they only land when the
  // request came from an LP-embedded form (the client passes them via
  // hidden meta fields in the submit payload).
  const submission = await prisma.formSubmission.create({
    data: {
      formId: form.id,
      contactId,
      data: values as unknown as Prisma.InputJsonValue,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      referrer: context.referrer ?? null,
      lpId: context.lpId ?? null,
      lpSlug: context.lpSlug ?? null,
      utmSource: context.utmSource ?? null,
      utmMedium: context.utmMedium ?? null,
      utmCampaign: context.utmCampaign ?? null,
      utmTerm: context.utmTerm ?? null,
      utmContent: context.utmContent ?? null,
    },
  });

  await prisma.form.update({
    where: { id: form.id },
    data: { submissionCount: { increment: 1 } },
  });

  // Fire any form_submission flow triggers attached to this form.
  // Wrapped in try/catch so a flow-runner failure can't roll back the
  // already-persisted submission — the submission is the source of truth
  // and a missing enrollment can be backfilled.
  if (contactId) {
    try {
      await enrollContactForFormSubmission({
        formId: form.id,
        contactId,
        accountKey: form.accountKey,
      });
    } catch (err) {
      console.error('[forms/submit] flow-trigger enrollment failed', err);
    }
  }

  return {
    submissionId: submission.id,
    contactId,
    redirectUrl: form.redirectUrl,
    successMessage: form.successMessage,
  };
}

// ── Internal helpers ──────────────────────────────────────────────

async function upsertContactFromSubmission(args: {
  accountKey: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
}): Promise<string | null> {
  const { accountKey, email, phone, firstName, lastName } = args;

  // No identifier → no Contact link. Submission still gets stored
  // anonymously by the caller.
  if (!email && !phone) return null;

  const writeFields: Record<string, unknown> = {
    source: 'form',
  };
  if (firstName) writeFields.firstName = firstName;
  if (lastName) writeFields.lastName = lastName;
  if (firstName || lastName) {
    writeFields.fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  }

  // Email match first (the strong identifier).
  if (email) {
    const existing = await prisma.contact.findUnique({
      where: { accountKey_email: { accountKey, email } },
      select: { id: true },
    });
    if (existing) {
      // No-overwrite semantics — match the importContacts list-targeted
      // behavior. The Contact already exists; just return its id so we
      // can link the submission + attach to the list.
      return existing.id;
    }
    // Create. Set both email + phone if we have phone too.
    const created = await prisma.contact.create({
      data: { accountKey, email, phone: phone ?? null, ...writeFields },
      select: { id: true },
    });
    return created.id;
  }

  // Phone-only path.
  if (phone) {
    const existing = await prisma.contact.findUnique({
      where: { accountKey_phone: { accountKey, phone } },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await prisma.contact.create({
      data: { accountKey, phone, ...writeFields },
      select: { id: true },
    });
    return created.id;
  }

  return null;
}

async function attachContactToList(
  contactId: string,
  listId: string,
  accountKey: string,
): Promise<void> {
  // Guard against listId pointing at another account's list. The settings
  // PATCH already validates this at edit time, but a list could have been
  // moved or deleted since.
  const list = await prisma.contactList.findUnique({
    where: { id: listId },
    select: { id: true, accountKey: true },
  });
  if (!list || list.accountKey !== accountKey) return;

  // Composite PK (listId, contactId) makes this a no-op if the contact
  // is already a member.
  await prisma.contactListMembership.upsert({
    where: { listId_contactId: { listId, contactId } },
    create: { listId, contactId },
    update: {},
  });
}

export { FormValidationError };
