// Resolve a blast draft's recipients on the SERVER, from the audience it has
// saved.
//
// The schedule routes used to take the recipient list in the request body,
// built by the browser. That capped what a blast could reach at whatever the
// browser could fetch and post back — 5,000 by design until 2026-10-12, when
// the per-campaign ceiling was removed — and it trusted a client-supplied list
// for something that sends real mail. The draft already records its audience
// (Recipients step), so the route reads it from there instead.

import { prisma } from '@/lib/prisma';
import { resolveFilterFields } from '@/lib/services/audience-fields';
import { getAncestorAccountKeys } from '@/lib/services/accounts';
import { LIFECYCLE_PRESETS } from '@/lib/smart-list-presets';
import type { FilterDefinition } from '@/lib/smart-list-types';
import { isSegmentVisibleTo } from './visibility';
import { isAudienceConfirmed } from '@/lib/messaging/blast-builder-steps';
import {
  formatFilterErrors,
  validateFilterDefinition,
} from '@/lib/smart-list-validate';
import { resolveRecipients } from './recipients';
import {
  audienceSelectionFromDraft,
  type AudienceDraftFields,
  type AudienceSelection,
  type RecipientRow,
} from './selection';

export type DraftAudienceResult =
  | { ok: true; recipients: RecipientRow[] }
  | { ok: false; error: string };

/**
 * The draft's audience, with a saved segment resolved to its CURRENT filter.
 *
 * The Recipients step stores a copy of the segment's filter beside its id,
 * and the send used to read only that copy — so fixing a mistake in a segment
 * after picking it was silently not applied, while the Recipients page
 * highlighted the live segment as if it were. A lifecycle preset is a code
 * constant and always current. A segment that was deleted, or that this
 * account can no longer see, falls back to the copy: the blast keeps the
 * audience it was built with rather than going to everyone or to no one.
 */
async function currentSelection(
  draft: AudienceDraftFields & { sourceAudienceId?: string | null },
  accountKey: string,
): Promise<AudienceSelection | null> {
  const selection = audienceSelectionFromDraft(draft);
  if (!selection || selection.kind !== 'filter' || !draft.sourceAudienceId) return selection;

  const preset = LIFECYCLE_PRESETS.find((p) => p.id === draft.sourceAudienceId);
  if (preset) return { kind: 'filter', definition: preset.definition };

  const segment = await prisma.audience.findUnique({
    where: { id: draft.sourceAudienceId },
    select: { filters: true, accountKey: true, sharedWithChildren: true },
  });
  if (!segment) return selection;
  const viewer = { accountKey, ancestors: await getAncestorAccountKeys(accountKey) };
  if (!isSegmentVisibleTo(segment, viewer)) return selection;
  try {
    const definition = JSON.parse(segment.filters) as FilterDefinition;
    if (definition && definition.version === 1 && Array.isArray(definition.groups)) {
      return { kind: 'filter', definition };
    }
  } catch {
    // Unreadable stored filter — keep the copy the draft was built with.
  }
  return selection;
}

export async function resolveDraftRecipients(
  draft: AudienceDraftFields & {
    accountKeys: string[];
    sourceAudienceId?: string | null;
    metadata?: string | null;
  },
  channel: 'email' | 'sms',
): Promise<DraftAudienceResult> {
  const accountKey = draft.accountKeys[0] || '';
  // Someone must actually have CHOSEN the audience. A draft is created with
  // its account already stamped and no source column set — which reads as
  // "every contact" — so a draft nobody took through the Recipients step
  // would otherwise send to the whole account.
  if (!accountKey || !isAudienceConfirmed(draft)) {
    return { ok: false, error: 'Pick recipients on the Recipients step first.' };
  }

  const selection = await currentSelection(draft, accountKey);
  if (!selection) {
    return { ok: false, error: 'Pick recipients on the Recipients step first.' };
  }

  const fields = await resolveFilterFields(accountKey);
  if (selection.kind === 'filter') {
    const validation = validateFilterDefinition(selection.definition, fields);
    if (!validation.ok) {
      return {
        ok: false,
        error: `The saved segment is invalid — ${formatFilterErrors(validation.errors)}`,
      };
    }
    selection.definition = validation.definition;
  }

  const { recipients } = await resolveRecipients(accountKey, selection, fields, {
    channel,
    limit: Number.POSITIVE_INFINITY,
  });
  return { ok: true, recipients };
}
