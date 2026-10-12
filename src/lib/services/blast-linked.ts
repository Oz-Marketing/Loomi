/**
 * Archive, restore, delete and duplicate over a multi-channel PAIR.
 *
 * An "Email + Text" blast is two rows — one EmailBlast, one SmsBlast,
 * cross-linked through `metadata.linkedSmsBlastId` / `linkedEmailBlastId` —
 * and the Blasts list shows the pair as ONE row anchored on the email half,
 * hiding the SMS row entirely (see blast-cancel.ts, which established this for
 * cancel). Every row action has to act on the pair or it leaves the hidden
 * half behind:
 *
 *  - deleting or archiving only the email half left a scheduled text that
 *    still went out, and then reappeared as a standalone SMS row;
 *  - duplicating copied the email's metadata wholesale — link included — so
 *    the copy edited and sent the ORIGINAL's text.
 *
 * Both halves are checked BEFORE either is changed, so a refusal (a half that
 * is still scheduled) changes nothing rather than half the pair.
 */

import { prisma } from '@/lib/prisma';
import { parseLinkedId, type BlastChannel } from './blast-cancel';
import {
  deleteEmailBlast,
  duplicateEmailBlast,
  getEmailBlast,
  metadataForCopy,
  restoreEmailBlast,
  setEmailBlastArchived,
  type EmailBlastSummary,
} from './email-blasts';
import {
  deleteSmsBlast,
  duplicateSmsBlast,
  getSmsBlast,
  restoreSmsBlast,
  setSmsBlastArchived,
  smsMetadataForCopy,
  type SmsBlastSummary,
} from './sms-blasts';

type AnySummary = EmailBlastSummary | SmsBlastSummary;

export interface LinkedActionResult<T extends AnySummary = AnySummary> {
  /** The row the caller named, after the action (absent for a delete). */
  primary?: T;
  /** The linked half, when there is one. */
  partner?: AnySummary;
  /**
   * A linked half that could not be acted on after the primary already was.
   * Reported rather than thrown — the primary's change is real.
   */
  partnerError?: string;
}

const CAN_STILL_SEND = new Set(['queued', 'scheduled', 'processing']);

async function loadPair(channel: BlastChannel, id: string) {
  const primary = channel === 'email' ? await getEmailBlast(id) : await getSmsBlast(id);
  if (!primary) throw new Error('Campaign not found');
  const partnerId = parseLinkedId(
    primary.metadata,
    channel === 'email' ? 'linkedSmsBlastId' : 'linkedEmailBlastId',
  );
  const partner = partnerId
    ? channel === 'email'
      ? await getSmsBlast(partnerId)
      : await getEmailBlast(partnerId)
    : null;
  return { primary, partner, partnerChannel: (channel === 'email' ? 'sms' : 'email') as BlastChannel };
}

function refuseIfSending(rows: (AnySummary | null)[], verb: string) {
  if (rows.some((row) => row && CAN_STILL_SEND.has(row.status))) {
    throw new Error(`This blast is scheduled or sending. Cancel it first, then ${verb} it.`);
  }
}

export async function archiveBlastWithLinkedChannels(
  channel: BlastChannel,
  id: string,
  archived: boolean,
): Promise<LinkedActionResult> {
  const { primary, partner, partnerChannel } = await loadPair(channel, id);
  if (archived) refuseIfSending([primary, partner], 'archive');

  const archive = (ch: BlastChannel, rowId: string) =>
    ch === 'email' ? setEmailBlastArchived(rowId, archived) : setSmsBlastArchived(rowId, archived);

  const result: LinkedActionResult = { primary: await archive(channel, id) };
  if (partner) {
    try {
      result.partner = await archive(partnerChannel, partner.id);
    } catch (err) {
      result.partnerError = err instanceof Error ? err.message : String(err);
    }
  }
  return result;
}

export async function restoreBlastWithLinkedChannels(
  channel: BlastChannel,
  id: string,
): Promise<LinkedActionResult> {
  const { partner, partnerChannel } = await loadPair(channel, id);
  const result: LinkedActionResult = {
    primary: channel === 'email' ? await restoreEmailBlast(id) : await restoreSmsBlast(id),
  };
  if (partner) {
    try {
      // The partner may already be un-archived; that isn't an error here.
      result.partner =
        partnerChannel === 'email'
          ? await setEmailBlastArchived(partner.id, false)
          : await setSmsBlastArchived(partner.id, false);
    } catch (err) {
      result.partnerError = err instanceof Error ? err.message : String(err);
    }
  }
  return result;
}

export async function deleteBlastWithLinkedChannels(
  channel: BlastChannel,
  id: string,
): Promise<LinkedActionResult> {
  const { primary, partner, partnerChannel } = await loadPair(channel, id);
  refuseIfSending([primary, partner], 'delete');

  if (channel === 'email') await deleteEmailBlast(id);
  else await deleteSmsBlast(id);

  const result: LinkedActionResult = {};
  if (partner) {
    try {
      if (partnerChannel === 'email') await deleteEmailBlast(partner.id);
      else await deleteSmsBlast(partner.id);
    } catch (err) {
      result.partnerError = err instanceof Error ? err.message : String(err);
    }
  }
  return result;
}

function withLink(metadata: string | null, key: string, value: string): string {
  let base: Record<string, unknown> = {};
  if (metadata) {
    try {
      const parsed = JSON.parse(metadata) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>;
      }
    } catch {
      // Unparseable: start fresh — metadataForCopy would have dropped it too.
    }
  }
  return JSON.stringify({ ...base, multiChannel: true, [key]: value });
}

/**
 * Duplicate a blast; a multi-channel pair is duplicated as a NEW pair, linked
 * to each other and to nothing else.
 */
export async function duplicateBlastWithLinkedChannels(
  channel: BlastChannel,
  id: string,
  options?: { createdByUserId?: string; createdByRole?: string },
): Promise<{ email?: EmailBlastSummary; sms?: SmsBlastSummary }> {
  const { primary, partner } = await loadPair(channel, id);
  if (!partner) {
    return channel === 'email'
      ? { email: await duplicateEmailBlast(id, options) }
      : { sms: await duplicateSmsBlast(id, options) };
  }

  const emailSource = (channel === 'email' ? primary : partner) as EmailBlastSummary;
  const smsSource = (channel === 'email' ? partner : primary) as SmsBlastSummary;

  const emailCopy = await duplicateEmailBlast(emailSource.id, {
    ...options,
    metadata: metadataForCopy(emailSource.metadata),
  });
  let smsCopy: SmsBlastSummary;
  try {
    smsCopy = await duplicateSmsBlast(smsSource.id, {
      ...options,
      metadata: withLink(smsMetadataForCopy(smsSource.metadata), 'linkedEmailBlastId', emailCopy.id),
    });
  } catch (err) {
    // Don't leave half a pair behind.
    await deleteEmailBlast(emailCopy.id).catch(() => undefined);
    throw err;
  }
  await prisma.emailBlast.update({
    where: { id: emailCopy.id },
    data: { metadata: withLink(metadataForCopy(emailSource.metadata), 'linkedSmsBlastId', smsCopy.id) },
  });
  return {
    email: (await getEmailBlast(emailCopy.id)) ?? emailCopy,
    sms: smsCopy,
  };
}
