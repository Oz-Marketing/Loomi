/**
 * CRM lead delivery (worker side).
 *
 * Runs inside the pg-boss `loomi.deliver-crm-lead` consumer. Loads the
 * delivery + its destination + the lead's source record fresh (so retries
 * reflect current state), then hands off to the provider-specific sender:
 *
 *   • ADF email (tekion / vinsolutions) — build the ADF document and email it
 *     to the CRM intake address on the delivery.
 *   • HubSpot API (hubspot) — upsert the contact (and optionally a deal) over
 *     HubSpot's REST API using the destination's encrypted token.
 *
 * Both record the outcome on the CrmDelivery row.
 *
 * Failure semantics: on a transient send error we record the attempt and THROW
 * so pg-boss reschedules with backoff — until `attempts` reaches
 * MAX_DELIVERY_ATTEMPTS, at which point we mark the delivery `failed` and
 * return normally (terminal — no further retry). Config errors that won't fix
 * themselves (no sender, bad/expired token, missing scope) fail terminally on
 * the first attempt.
 *
 * Delivery is AT-LEAST-ONCE, not exactly-once. For ADF a rare duplicate email
 * is acceptable (CRMs dedupe on contact). For HubSpot the push is an upsert by
 * email, so a re-run just re-writes the same contact — also safe.
 */
import type { Contact } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/crypto/encryption';
import { buildAdfXml, buildAdfSubject, hasUsableProspect } from './adf';
import { sendLeadEmail, LeadEmailError } from './send-lead-email';
import { parseLeadEmails } from './lead-emails';
import {
  HubspotError,
  buildHubspotProperties,
  createHubspotDeal,
  parseHubspotConfig,
  shouldCreateDeal,
  upsertHubspotContact,
} from './hubspot';
import { MAX_DELIVERY_ATTEMPTS } from './dispatch';

/** Thrown to signal pg-boss the job should be retried. */
class RetryableDeliveryError extends Error {}

type DeliveryWithDestination = NonNullable<
  Awaited<ReturnType<typeof loadDelivery>>
>;

function loadDelivery(deliveryId: string) {
  return prisma.crmDelivery.findUnique({
    where: { id: deliveryId },
    include: { destination: true },
  });
}

export async function deliverCrmLead(deliveryId: string): Promise<void> {
  const delivery = await loadDelivery(deliveryId);
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

  if (destination.provider === 'hubspot') {
    await deliverHubspotLead(delivery, attempt, isFinalAttempt);
    return;
  }

  await deliverAdfLead(delivery, attempt, isFinalAttempt);
}

// ── HubSpot (API) ────────────────────────────────────────────────────────

async function deliverHubspotLead(
  delivery: DeliveryWithDestination,
  attempt: number,
  isFinalAttempt: boolean,
): Promise<void> {
  const { destination } = delivery;

  // Resolve the contact: flow pushes carry contactId directly; form pushes
  // carry a submission we read the contactId (and the per-form gate) from.
  let contactId = delivery.contactId;
  if (!contactId && delivery.submissionId) {
    const submission = await prisma.formSubmission.findUnique({
      where: { id: delivery.submissionId },
      select: { contactId: true, formId: true },
    });
    if (!submission) {
      await markTerminal(delivery.id, attempt, 'Submission no longer exists');
      return;
    }
    // Re-check the per-form gate — the operator may have toggled forwarding
    // off after the lead was enqueued.
    const form = await prisma.form.findUnique({
      where: { id: submission.formId },
      select: { forwardToCrm: true },
    });
    if (!form) {
      await markTerminal(delivery.id, attempt, 'Form no longer exists');
      return;
    }
    if (!form.forwardToCrm) {
      await markTerminal(delivery.id, attempt, 'Forwarding disabled before delivery');
      return;
    }
    contactId = submission.contactId;
  }
  if (!contactId) {
    await markTerminal(delivery.id, attempt, 'No contact to push to HubSpot');
    return;
  }

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact) {
    await markTerminal(delivery.id, attempt, 'Contact no longer exists');
    return;
  }
  // Defensive scoping: never push a contact from another account into this
  // destination's HubSpot (shouldn't happen — both are account-scoped).
  if (contact.accountKey !== destination.accountKey) {
    await markTerminal(delivery.id, attempt, 'Contact does not belong to this account');
    return;
  }

  const email = (contact.email ?? '').trim();
  if (!email) {
    await markTerminal(delivery.id, attempt, 'Contact has no email — cannot push to HubSpot');
    return;
  }

  if (!destination.accessToken) {
    await markTerminal(delivery.id, attempt, 'HubSpot is not connected (no access token)');
    return;
  }
  let token: string;
  try {
    token = decryptToken(destination.accessToken);
  } catch {
    await markTerminal(delivery.id, attempt, 'Failed to decrypt HubSpot token');
    return;
  }

  const config = parseHubspotConfig(destination.config);
  const properties = buildHubspotProperties(contact, config);

  try {
    const { contactId: hubspotContactId } = await upsertHubspotContact({
      token,
      email,
      properties,
    });
    let messageId = `contact:${hubspotContactId}`;

    if (shouldCreateDeal(config)) {
      try {
        const { dealId } = await createHubspotDeal({
          token,
          contactId: hubspotContactId,
          dealName: buildDealName(contact, config.dealNamePrefix),
          pipelineId: config.pipelineId!,
          stageId: config.stageId!,
        });
        messageId += ` deal:${dealId}`;
      } catch (dealErr) {
        // The contact is already in HubSpot — a deal failure must NOT drop the
        // lead or trigger a re-upsert. Record it as sent with a note so the
        // operator can see the deal didn't get created.
        const note = dealErr instanceof Error ? dealErr.message : 'deal create failed';
        await prisma.crmDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'sent',
            attempts: attempt,
            messageId,
            lastError: `contact ok; deal failed: ${note}`,
            sentAt: new Date(),
          },
        });
        return;
      }
    }

    await prisma.crmDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'sent',
        attempts: attempt,
        messageId,
        lastError: null,
        sentAt: new Date(),
      },
    });
  } catch (err) {
    // Config errors (bad token, missing scope, malformed request) won't fix
    // themselves on retry — fail terminally.
    if (err instanceof HubspotError && !err.retryable) {
      await markTerminal(delivery.id, attempt, err.message);
      return;
    }
    const message = err instanceof Error ? err.message : 'HubSpot push failed';
    await recordFailure(delivery.id, attempt, isFinalAttempt, message);
  }
}

/** Deal name from the contact's name (or email), with an optional prefix. */
function buildDealName(
  contact: Pick<Contact, 'firstName' | 'lastName' | 'fullName' | 'email'>,
  prefix?: string,
): string {
  const who =
    contact.fullName?.trim() ||
    [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() ||
    contact.email?.trim() ||
    'New lead';
  return `${prefix?.trim() || 'New consultation'} — ${who}`;
}

// ── ADF email (Tekion / VinSolutions) ─────────────────────────────────────

async function deliverAdfLead(
  delivery: DeliveryWithDestination,
  attempt: number,
  isFinalAttempt: boolean,
): Promise<void> {
  const { destination } = delivery;

  if (!delivery.submissionId) {
    // ADF deliveries are always form-triggered; a missing submission is a
    // misrouted row we can't act on.
    await markTerminal(delivery.id, attempt, 'No submission for ADF delivery');
    return;
  }

  const submission = await prisma.formSubmission.findUnique({
    where: { id: delivery.submissionId },
  });
  if (!submission) {
    await markTerminal(delivery.id, attempt, 'Submission no longer exists');
    return;
  }

  const form = await prisma.form.findUnique({
    where: { id: submission.formId },
    select: { name: true, accountKey: true, forwardToCrm: true },
  });
  if (!form) {
    await markTerminal(delivery.id, attempt, 'Form no longer exists');
    return;
  }

  // Re-check the per-form gate — the operator may have toggled forwarding
  // off after the lead was enqueued.
  if (!form.forwardToCrm) {
    await markTerminal(delivery.id, attempt, 'Forwarding disabled before delivery');
    return;
  }
  // Account-less system templates can't forward; guard + narrow.
  if (!form.accountKey) {
    await markTerminal(delivery.id, attempt, 'Form has no owning account');
    return;
  }
  const accountKey = form.accountKey;

  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { dealer: true },
  });

  const contact = submission.contactId
    ? await prisma.contact.findUnique({ where: { id: submission.contactId } })
    : null;

  const adfInput = {
    dealerName: account?.dealer || accountKey,
    formName: form.name,
    submission,
    contact,
  };

  // ADF requires a populated <contact>; a lead with no name/email/phone is
  // useless to the CRM. Don't email an empty-contact document — record it
  // terminally (the submission still lives in Loomi).
  if (!hasUsableProspect(adfInput)) {
    await markTerminal(delivery.id, attempt, 'No contact details to forward');
    return;
  }

  const xml = buildAdfXml(adfInput);
  const subject = buildAdfSubject(adfInput);

  try {
    // This delivery targets one address (the fan-out in dispatch). Legacy rows
    // created before the fan-out have no recipientEmail — fall back to all of
    // the destination's addresses so in-flight leads still go out.
    const recipients = delivery.recipientEmail
      ? [delivery.recipientEmail]
      : parseLeadEmails(destination.leadEmails);

    const { messageId } = await sendLeadEmail({
      accountKey,
      to: recipients,
      subject,
      xml,
    });
    await prisma.crmDelivery.update({
      where: { id: delivery.id },
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
      await markTerminal(delivery.id, attempt, err.message);
      return;
    }
    const message = err instanceof Error ? err.message : 'Send failed';
    await recordFailure(delivery.id, attempt, isFinalAttempt, message);
  }
}

// ── Shared outcome writers ─────────────────────────────────────────────────

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
