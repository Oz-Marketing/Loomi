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

export interface SubmitContext {
  ipAddress?: string | null;
  userAgent?: string | null;
  referrer?: string | null;
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

  // Write the raw submission + bump the form's counter.
  const submission = await prisma.formSubmission.create({
    data: {
      formId: form.id,
      contactId,
      data: values as unknown as Prisma.InputJsonValue,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      referrer: context.referrer ?? null,
    },
  });

  await prisma.form.update({
    where: { id: form.id },
    data: { submissionCount: { increment: 1 } },
  });

  // PR5 hook: fire form_submission flow triggers. The function is a
  // no-op stub today and will be filled in when PR5 lands. Wrapping in
  // a try/catch keeps a flow misconfiguration from blocking the
  // submission — the submission is already persisted at this point.
  try {
    await fireFormSubmissionTriggers({
      formId: form.id,
      contactId,
      submissionId: submission.id,
    });
  } catch (err) {
    console.error('[forms/submit] flow-trigger hook failed', err);
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

/**
 * Placeholder for the PR5 flow-trigger hook. PR5 will:
 *   1. Find enabled LoomiFlowTriggers with type='form_submission' + formId
 *   2. Create LoomiFlowEnrollment rows for the contact (respecting re-entry policy)
 *   3. The existing flow runner picks them up on its next tick
 *
 * Keeping the hook in place now so PR4 lands with the call-site wired up
 * and PR5 only has to fill in the body.
 */
async function fireFormSubmissionTriggers(_args: {
  formId: string;
  contactId: string | null;
  submissionId: string;
}): Promise<void> {
  // Intentionally a no-op until PR5.
  return;
}

export { FormValidationError };
