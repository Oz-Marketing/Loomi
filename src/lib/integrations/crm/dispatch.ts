/**
 * Form-submission → CRM lead dispatch (enqueue side).
 *
 * Called from src/lib/forms/submit.ts after the submission is persisted.
 * Only fires when the form has `forwardToCrm` enabled; then writes a
 * `pending` CrmDelivery row per enabled CrmDestination on the account and
 * enqueues a pg-boss job to send the ADF email. The actual send happens
 * in the worker (deliver.ts) so a slow mail provider never adds latency
 * to — or fails — the public submit request.
 */
import type { Form, FormSubmission } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getBoss } from '@/lib/queue/boss';
import { parseLeadEmails } from './lead-emails';

export const DELIVER_CRM_LEAD_QUEUE = 'loomi.deliver-crm-lead';

/** pg-boss job payload — kept tiny; the worker re-loads fresh state. */
export interface DeliverCrmLeadJob {
  deliveryId: string;
}

/**
 * Total send attempts before a delivery is marked `failed`. The pg-boss
 * job is sent with a matching retryLimit + exponential backoff; deliver.ts
 * self-terminates at this count so the two stay aligned.
 */
export const MAX_DELIVERY_ATTEMPTS = 5;

// pg-boss requires a queue to exist before send(). The worker creates it
// on boot, but the web process enqueues too — guard so we only pay the
// idempotent createQueue round-trip once per process.
let queueEnsured = false;
async function ensureQueue(): Promise<void> {
  if (queueEnsured) return;
  const boss = await getBoss();
  await boss.createQueue(DELIVER_CRM_LEAD_QUEUE);
  queueEnsured = true;
}

export async function enqueueFormSubmissionCrmLeads(args: {
  form: Pick<Form, 'id' | 'accountKey' | 'forwardToCrm'>;
  submission: Pick<FormSubmission, 'id'>;
}): Promise<void> {
  const { form, submission } = args;

  // Per-form gate: leads only leave Loomi when the form opts in.
  if (!form.forwardToCrm) return;
  // Account-less system templates never forward (and can't enable it).
  if (!form.accountKey) return;
  const accountKey = form.accountKey;

  const destinations = await prisma.crmDestination.findMany({
    where: { accountKey, enabled: true },
    select: { id: true, provider: true, leadEmails: true },
  });
  if (destinations.length === 0) return;

  // Build the delivery targets per destination:
  //   • API providers (hubspot) → one delivery, no recipient address. The
  //     worker upserts the contact by email (idempotent), so there's nothing
  //     to fan out.
  //   • ADF providers → one delivery per intake address. Tracking each address
  //     separately means a retry only re-sends to the address that failed, not
  //     to every inbox on the destination.
  const targets: { destinationId: string; recipientEmail: string | null }[] = [];
  for (const destination of destinations) {
    if (destination.provider === 'hubspot') {
      targets.push({ destinationId: destination.id, recipientEmail: null });
      continue;
    }
    for (const recipientEmail of parseLeadEmails(destination.leadEmails)) {
      targets.push({ destinationId: destination.id, recipientEmail });
    }
  }
  if (targets.length === 0) return;

  for (const target of targets) {
    const delivery = await prisma.crmDelivery.create({
      data: {
        destinationId: target.destinationId,
        source: 'form',
        submissionId: submission.id,
        recipientEmail: target.recipientEmail,
      },
      select: { id: true },
    });
    try {
      await enqueueCrmDeliveryJob(delivery.id);
    } catch (err) {
      // The row was created before the enqueue; if the enqueue fails we
      // mark it failed rather than leave an orphaned `pending` row that no
      // worker will ever pick up. Other destinations still get their shot.
      //
      // This only covers the enqueue THROWING. If the process is killed in
      // the gap between create() and a successful enqueue, the row is left
      // `pending` with no backing job. That's a rare crash window; a future
      // reconciliation sweep (re-enqueue or expire pending rows older than
      // N minutes) would close it — tracked as a follow-up.
      await prisma.crmDelivery
        .update({
          where: { id: delivery.id },
          data: {
            status: 'failed',
            lastError: err instanceof Error ? `enqueue failed: ${err.message}` : 'enqueue failed',
          },
        })
        .catch(() => {});
    }
  }
}

/**
 * Enqueue the pg-boss delivery job for an already-created CrmDelivery row.
 * Shared by the form-submission dispatch above and the push_to_crm flow node
 * so both go through the worker (and its retry/backoff) the same way.
 *
 * retryLimit is retries ON TOP of the initial run, so MAX-1 retries = MAX
 * total executions — matching deliver.ts's attempt cap.
 */
export async function enqueueCrmDeliveryJob(deliveryId: string): Promise<void> {
  await ensureQueue();
  const boss = await getBoss();
  const job: DeliverCrmLeadJob = { deliveryId };
  await boss.send(DELIVER_CRM_LEAD_QUEUE, job, {
    retryLimit: MAX_DELIVERY_ATTEMPTS - 1,
    retryDelay: 30,
    retryBackoff: true,
  });
}
