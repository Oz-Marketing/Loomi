import { canAccessAccount, getAccountScope } from '@/lib/api-auth';
import { getEmailBlast } from '@/lib/services/email-blasts';
import { loadPreviewAccountData, resolvePreviewTokens } from './preview-substitute';

type Session = Parameters<typeof getAccountScope>[0];

export type BlastPreviewResult =
  | { ok: true; name: string; html: string }
  | { ok: false; status: number; error: string };

/**
 * A Loomi email blast's HTML as the Blasts list shows it — in the Preview
 * modal, and rendered to a PNG by Download Email. One function so the two
 * can't disagree about who may see a blast or how its merge tags read.
 *
 * The stored htmlContent still carries its merge tags; substitution is a
 * per-recipient step inside the send loop. A preview isn't per-recipient, so
 * it resolves against the blast's account. A blast spanning several accounts
 * renders as the first one the viewer is scoped to see.
 */
export async function loadBlastPreview(session: Session, campaignId: string): Promise<BlastPreviewResult> {
  const campaign = await getEmailBlast(campaignId);
  if (!campaign) return { ok: false, status: 404, error: 'Blast not found.' };

  // Clients can only see blasts scoped to one of their accounts.
  if (session.user.role === 'client') {
    const allowed = new Set(session.user.accountKeys ?? []);
    const visible =
      campaign.accountKeys.length === 0 || campaign.accountKeys.some((key) => allowed.has(key));
    if (!visible) return { ok: false, status: 403, error: 'Access denied' };
  }

  if (!campaign.htmlContent.trim()) {
    return {
      ok: false,
      status: 422,
      error: 'This blast has no email content yet. Add it in the Message step.',
    };
  }

  const scope = getAccountScope(session);
  const accountKey =
    campaign.accountKeys.find((key) => canAccessAccount(scope, key)) ?? campaign.accountKeys[0];
  const accountData = accountKey ? await loadPreviewAccountData(accountKey) : null;

  return {
    ok: true,
    name: campaign.name || 'campaign',
    html: resolvePreviewTokens(campaign.htmlContent, accountData),
  };
}
