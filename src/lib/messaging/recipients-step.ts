// The audience the Recipients step edits — shared by the email, text, and
// email + text pages so all three read a draft, write a draft, and decide
// "is anyone selected?" the same way.
//
// THE RULE THIS EXISTS TO HOLD: an empty hand-picked selection means NOBODY.
// The pages used to fall back to "All Contacts" when the last contact was
// unchecked, so the sendable count wouldn't sit at zero — which turned an
// empty selection into a send to the entire account. And a draft saved with
// an empty selection rehydrated as "All Contacts" too, so the next Continue
// wrote that back. Now an empty selection stays empty, Continue refuses it,
// and the server resolves it to no one (see audienceSelectionFromDraft).

import type { FilterDefinition } from '@/lib/smart-list-types';
import { LIFECYCLE_PRESETS } from '@/lib/smart-list-presets';
import {
  audienceSelectionFromDraft,
  type AudienceDraftFields,
  type AudienceSelection,
} from '@/lib/segments/selection';
import { AUDIENCE_CONFIRMED_KEY } from './blast-builder-steps';

/** What the picker shows. Lists and segments carry a display name. */
export type BuilderAudience =
  | { kind: 'all' }
  | { kind: 'list'; id: string; name: string }
  | { kind: 'segment'; id: string; name: string; filter: FilterDefinition }
  // Hand-picked contacts. An empty `ids` is a real state: nobody chosen.
  | { kind: 'contacts'; ids: string[] };

export const NOBODY: BuilderAudience = { kind: 'contacts', ids: [] };

export interface AudienceDraftColumns extends AudienceDraftFields {
  sourceAudienceId?: string | null;
}

/** Shown when Continue is refused for an empty selection. */
export const EMPTY_AUDIENCE_MESSAGE =
  'No one is selected. Pick at least one contact, or choose All Contacts.';

/**
 * Read a draft's saved audience into picker state.
 *
 * Goes through audienceSelectionFromDraft — the function the send itself uses
 * — so the page can never show a different audience than the one that would
 * go out. In particular a saved-but-empty contact list stays empty, and a
 * segment whose filter can't be parsed shows as nobody rather than everybody.
 */
export function audienceFromDraft(draft: AudienceDraftColumns): BuilderAudience {
  const selection = audienceSelectionFromDraft(draft);
  if (!selection) return NOBODY;
  switch (selection.kind) {
    case 'all':
      return { kind: 'all' };
    case 'list':
      // The real name arrives with the lists fetch; the page swaps it in.
      return { kind: 'list', id: selection.listId, name: 'List' };
    case 'contacts':
      return { kind: 'contacts', ids: selection.ids };
    case 'filter': {
      const id = draft.sourceAudienceId || 'saved-segment';
      const preset = LIFECYCLE_PRESETS.find((p) => p.id === id);
      return {
        kind: 'segment',
        id,
        name: preset?.name || 'Saved segment',
        filter: selection.definition,
      };
    }
  }
}

export type AudienceTab = 'lists' | 'segments' | 'contacts';

/** The picker tab a saved audience lives on. */
export function audienceTab(audience: BuilderAudience): AudienceTab {
  if (audience.kind === 'list') return 'lists';
  if (audience.kind === 'contacts') return 'contacts';
  return 'segments';
}

/** True when the selection resolves to no one at all. */
export function isAudienceEmpty(audience: BuilderAudience): boolean {
  return audience.kind === 'contacts' && audience.ids.length === 0;
}

/** The selection in the shape POST /api/segments/recipients counts. */
export function toServerSelection(audience: BuilderAudience): AudienceSelection {
  switch (audience.kind) {
    case 'all':
      return { kind: 'all' };
    case 'list':
      return { kind: 'list', listId: audience.id };
    case 'contacts':
      return { kind: 'contacts', ids: audience.ids };
    case 'segment':
      return { kind: 'filter', definition: audience.filter };
  }
}

/**
 * The PATCH body that saves `audience` for `accountKey`.
 *
 * The three source columns are mutually exclusive, so every unused one is
 * cleared — stale state from a previous mode must not leak into the send.
 * `confirmed` is whether the user has actually chosen (see
 * AUDIENCE_CONFIRMED_KEY); an empty selection is never confirmed, whatever
 * the caller says.
 */
export function audiencePatch(
  audience: BuilderAudience,
  accountKey: string,
  confirmed: boolean,
): Record<string, unknown> {
  return {
    accountKeys: accountKey ? [accountKey] : [],
    sourceAudienceId: audience.kind === 'segment' ? audience.id : null,
    sourceFilter: audience.kind === 'segment' ? JSON.stringify(audience.filter) : null,
    sourceListId: audience.kind === 'list' ? audience.id : null,
    sourceContactIds: audience.kind === 'contacts' ? JSON.stringify(audience.ids) : null,
    metadataPatch: {
      [AUDIENCE_CONFIRMED_KEY]: confirmed && !isAudienceEmpty(audience),
    },
  };
}

/** Same audience? Names don't count — only what would be saved. */
export function sameAudience(a: BuilderAudience, b: BuilderAudience): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'all') return true;
  if (a.kind === 'list' && b.kind === 'list') return a.id === b.id;
  if (a.kind === 'segment' && b.kind === 'segment') {
    return a.id === b.id && JSON.stringify(a.filter) === JSON.stringify(b.filter);
  }
  if (a.kind === 'contacts' && b.kind === 'contacts') {
    if (a.ids.length !== b.ids.length) return false;
    const set = new Set(a.ids);
    return b.ids.every((id) => set.has(id));
  }
  return false;
}

/**
 * What a picker should hold after the user moves the draft to another account.
 *
 * Hand-picked contacts and lists belong to the account they came from, so
 * they can't follow — and they become NOBODY, not "All Contacts", so the
 * switch never widens the audience on its own. "All Contacts" and segments
 * are rules rather than rows and apply to the new account as they stand.
 */
export function audienceAfterAccountChange(audience: BuilderAudience): BuilderAudience {
  return audience.kind === 'contacts' || audience.kind === 'list' ? NOBODY : audience;
}
