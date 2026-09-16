import { cancelEmailBlast, getEmailBlast } from './email-blasts';
import { cancelSmsBlast, getSmsBlast } from './sms-blasts';

/**
 * Cancel a blast and whatever else is part of the same logical send.
 *
 * A multi-channel blast is TWO rows — one EmailBlast, one SmsBlast, cross-
 * linked through `metadata.linkedSmsBlastId` / `linkedEmailBlastId` — but the
 * Blasts list deliberately collapses the pair into a single row anchored on
 * the email half and drops the SMS row entirely. Cancelling only the row the
 * user clicked would therefore stop the emails and leave the texts sending,
 * with no row left anywhere in the UI to stop them from.
 *
 * So cancellation is defined over the pair, not the row. This sits above both
 * services rather than inside either one: the single-channel functions stay
 * free of cross-channel knowledge, and there is no import cycle between them.
 *
 * The cascade is exactly one hop — it calls the raw per-channel functions,
 * which do not themselves cascade — so the two halves cannot bounce back and
 * forth.
 */

export type BlastChannel = 'email' | 'sms';

export interface CancelBlastResult {
  /** Channels that were actually stopped by this call. */
  canceledChannels: BlastChannel[];
  /**
   * A linked half that could not be stopped. The blast the user asked about
   * is still canceled — this reports the part that needs saying out loud
   * rather than swallowing it.
   */
  partnerError?: string;
}

function parseLinkedId(
  metadata: string | null | undefined,
  key: 'linkedSmsBlastId' | 'linkedEmailBlastId',
): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.multiChannel !== true) return null;
    const id = parsed[key];
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/**
 * Cancel the blast the caller named, then its linked partner if it has one.
 *
 * Throws if the named blast can't be canceled (already sent, still a draft,
 * not found). A partner that can't be canceled does NOT throw — the primary
 * cancel already happened and reporting it as a failure would be a lie — so
 * it comes back in `partnerError` for the caller to surface.
 */
export async function cancelBlastWithLinkedChannels(
  channel: BlastChannel,
  id: string,
): Promise<CancelBlastResult> {
  if (channel === 'email') {
    // Read the metadata BEFORE cancelling: the cancel itself doesn't touch
    // the linkage, but reading first keeps the partner lookup independent of
    // whatever the write returns.
    const existing = await getEmailBlast(id);
    const partnerId = parseLinkedId(existing?.metadata, 'linkedSmsBlastId');

    await cancelEmailBlast(id);
    const result: CancelBlastResult = { canceledChannels: ['email'] };
    if (!partnerId) return result;

    try {
      // A partner that already finished, or was canceled on its own, is not
      // an error — the send is stopped either way, which is what was asked.
      const partner = await getSmsBlast(partnerId);
      if (partner && partner.status !== 'canceled') {
        await cancelSmsBlast(partnerId);
      }
      result.canceledChannels.push('sms');
    } catch (err) {
      result.partnerError =
        err instanceof Error ? err.message : 'Failed to cancel the linked text blast.';
    }
    return result;
  }

  const existing = await getSmsBlast(id);
  const partnerId = parseLinkedId(existing?.metadata, 'linkedEmailBlastId');

  await cancelSmsBlast(id);
  const result: CancelBlastResult = { canceledChannels: ['sms'] };
  if (!partnerId) return result;

  try {
    const partner = await getEmailBlast(partnerId);
    if (partner && partner.status !== 'canceled') {
      await cancelEmailBlast(partnerId);
    }
    result.canceledChannels.push('email');
  } catch (err) {
    result.partnerError =
      err instanceof Error ? err.message : 'Failed to cancel the linked email blast.';
  }
  return result;
}
