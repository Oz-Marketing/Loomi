/**
 * Form-submission → CRM lead delivery (worker side).
 *
 * Runs inside the pg-boss `loomi.deliver-crm-lead` consumer. Loads the
 * delivery + its destination + the submission fresh (so retries reflect
 * current state), builds the ADF document, emails it to the CRM intake
 * address, and records the outcome on the CrmDelivery row.
 *
 * Failure semantics: on a send error we record the attempt and THROW so
 * pg-boss reschedules with backoff — until `attempts` reaches
 * MAX_DELIVERY_ATTEMPTS, at which point we mark the delivery `failed` and
 * return normally (terminal — no further retry).
 *
 * Delivery is AT-LEAST-ONCE, not exactly-once. If the email send succeeds
 * but the subsequent `status: 'sent'` write fails (or the worker dies in
 * between), pg-boss re-runs the job and the lead is emailed again — a
 * duplicate in the dealer's CRM. We accept this tradeoff: for lead capture,
 * a rare duplicate is far better than a dropped lead, and ADF receivers
 * generally dedupe on contact. (Exactly-once would need an idempotency key
 * the receiver honors, which neither CRM exposes for ADF email.)
 */
import { prisma } from '@/lib/prisma';
import { buildAdfXml, buildAdfSubject, hasUsableProspect } from './adf';
import { sendLeadEmail, LeadEmailError } from './send-lead-email';
import { parseLeadEmails } from './lead-emails';
import { MAX_DELIVERY_ATTEMPTS } from './dispatch';

/** Thrown to signal pg-boss the job should be retried. */
class RetryableDeliveryError extends Error {}

export async function deliverCrmLead(deliveryId: string): Promise<void> {
  const delivery = await prisma.crmDelivery.findUnique({
    where: { id: deliveryId },
    include: { destination: true },
  });
  if (!delivery) return; // delivery row gone — nothing to do
  if (delivery.status === 'sent') return; // already sent — idempotent

  const { destination } = delivery;
  const attempt = delivery.attempts + 1;
  const isFinalAttempt = attempt >= MAX_DELIVERY_ATTEMPTS;

  // Re-check the destination is still enabled — it may have been disabled
  // between enqueue and this run (incl. across backoff retries). "Off"
  // should be authoritative for in-flight leads too.
  if (!destination.enabled) {
    await markTerminal(deliveryId, attempt, 'Destination disabled before delivery');
    return;
  }

  const submission = await prisma.formSubmission.findUnique({
    where: { id: delivery.submissionId },
  });
  if (!submission) {
    await markTerminal(deliveryId, attempt, 'Submission no longer exists');
    return;
  }

  const form = await prisma.form.findUnique({
    where: { id: submission.formId },
    select: { name: true, accountKey: true, forwardToCrm: true },
  });
  if (!form) {
    await markTerminal(deliveryId, attempt, 'Form no longer exists');
    return;
  }

  // Re-check the per-form gate — the operator may have toggled forwarding
  // off after the lead was enqueued.
  if (!form.forwardToCrm) {
    await markTerminal(deliveryId, attempt, 'Forwarding disabled before delivery');
    return;
  }

  const account = await prisma.account.findUnique({
    where: { key: form.accountKey },
    select: { dealer: true },
  });

  const contact = submission.contactId
    ? await prisma.contact.findUnique({ where: { id: submission.contactId } })
    : null;

  const adfInput = {
    dealerName: account?.dealer || form.accountKey,
    formName: form.name,
    submission,
    contact,
  };

  // ADF requires a populated <contact>; a lead with no name/email/phone is
  // useless to the CRM. Don't email an empty-contact document — record it
  // terminally (the submission still lives in Loomi).
  if (!hasUsableProspect(adfInput)) {
    await markTerminal(deliveryId, attempt, 'No contact details to forward');
    return;
  }

  const xml = buildAdfXml(adfInput);
  const subject = buildAdfSubject(adfInput);

  try {
    const { messageId } = await sendLeadEmail({
      accountKey: form.accountKey,
      to: parseLeadEmails(destination.leadEmails),
      subject,
      xml,
    });
    await prisma.crmDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'sent',
        attempts: attempt,
        messageId,
        lastError: null,
        sentAt: new Date(),
      },
    });
  } catch (err) {
    // A missing sender config won't fix itself on retry — fail terminally.
    if (err instanceof LeadEmailError) {
      await markTerminal(deliveryId, attempt, err.message);
      return;
    }
    const message = err instanceof Error ? err.message : 'Send failed';
    await recordFailure(deliveryId, attempt, isFinalAttempt, message);
  }
}

async function recordFailure(
  deliveryId: string,
  attempt: number,
  isFinalAttempt: boolean,
  lastError: string,
): Promise<void> {
  await prisma.crmDelivery.update({
    where: { id: deliveryId },
    data: { status: isFinalAttempt ? 'failed' : 'pending', attempts: attempt, lastError },
  });
  if (!isFinalAttempt) {
    throw new RetryableDeliveryError(lastError);
  }
}

async function markTerminal(
  deliveryId: string,
  attempt: number,
  lastError: string,
): Promise<void> {
  await prisma.crmDelivery.update({
    where: { id: deliveryId },
    data: { status: 'failed', attempts: attempt, lastError },
  });
}
