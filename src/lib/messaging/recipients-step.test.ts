import { describe, expect, it } from 'vitest';
import { audienceSelectionFromDraft } from '@/lib/segments/selection';
import type { FilterDefinition } from '@/lib/smart-list-types';
import {
  NOBODY,
  audienceAfterAccountChange,
  audienceFromDraft,
  audiencePatch,
  isAudienceEmpty,
  sameAudience,
  toServerSelection,
  type BuilderAudience,
} from './recipients-step';
import { AUDIENCE_CONFIRMED_KEY } from './blast-builder-steps';

const FILTER: FilterDefinition = { version: 1, logic: 'AND', groups: [] };
const segment: BuilderAudience = { kind: 'segment', id: 'seg1', name: 'Lapsed', filter: FILTER };

describe('audienceFromDraft', () => {
  it('reads "All Contacts" from a draft with no source columns', () => {
    expect(audienceFromDraft({})).toEqual({ kind: 'all' });
  });

  // The bug: a saved-but-empty selection rehydrated as "All Contacts", and the
  // next Continue wrote that back — an empty pick became the whole account.
  it('keeps a saved empty hand-picked selection empty', () => {
    expect(audienceFromDraft({ sourceContactIds: '[]' })).toEqual(NOBODY);
  });

  it('reads hand-picked contacts, a list, and a segment', () => {
    expect(audienceFromDraft({ sourceContactIds: '["c1","c2"]' })).toEqual({
      kind: 'contacts',
      ids: ['c1', 'c2'],
    });
    expect(audienceFromDraft({ sourceListId: 'l1' })).toEqual({ kind: 'list', id: 'l1', name: 'List' });
    expect(
      audienceFromDraft({ sourceAudienceId: 'seg1', sourceFilter: JSON.stringify(FILTER) }),
    ).toMatchObject({ kind: 'segment', id: 'seg1', filter: FILTER });
  });

  it('shows an unreadable segment as nobody, never everybody', () => {
    expect(audienceFromDraft({ sourceAudienceId: 'x', sourceFilter: '{oops' })).toEqual(NOBODY);
  });

  it('uses the same precedence as the send', () => {
    // Stale columns from a mode switch: contacts win, as on the server.
    const draft = { sourceContactIds: '["c1"]', sourceListId: 'l1', sourceFilter: JSON.stringify(FILTER) };
    expect(audienceFromDraft(draft)).toEqual({ kind: 'contacts', ids: ['c1'] });
    expect(audienceSelectionFromDraft(draft)).toEqual({ kind: 'contacts', ids: ['c1'] });
  });
});

describe('isAudienceEmpty', () => {
  it('is true only for a hand-picked selection with nobody in it', () => {
    expect(isAudienceEmpty(NOBODY)).toBe(true);
    expect(isAudienceEmpty({ kind: 'contacts', ids: ['c1'] })).toBe(false);
    expect(isAudienceEmpty({ kind: 'all' })).toBe(false);
    expect(isAudienceEmpty(segment)).toBe(false);
  });
});

describe('audiencePatch', () => {
  it('clears every column the mode does not use', () => {
    expect(audiencePatch({ kind: 'list', id: 'l1', name: 'VIP' }, 'acct', true)).toEqual({
      accountKeys: ['acct'],
      sourceAudienceId: null,
      sourceFilter: null,
      sourceListId: 'l1',
      sourceContactIds: null,
      metadataPatch: { [AUDIENCE_CONFIRMED_KEY]: true },
    });
  });

  it('writes an empty hand-picked selection as [] — nobody — and never confirms it', () => {
    const patch = audiencePatch(NOBODY, 'acct', true);
    expect(patch.sourceContactIds).toBe('[]');
    expect(patch.metadataPatch).toEqual({ [AUDIENCE_CONFIRMED_KEY]: false });
    // And the send reads it back as nobody.
    expect(audienceSelectionFromDraft({ sourceContactIds: '[]' })).toEqual({ kind: 'contacts', ids: [] });
  });

  it('confirms only when the caller says the user chose', () => {
    expect(audiencePatch({ kind: 'all' }, 'acct', false).metadataPatch).toEqual({
      [AUDIENCE_CONFIRMED_KEY]: false,
    });
  });

  it('round-trips through audienceFromDraft', () => {
    for (const audience of [{ kind: 'all' } as const, segment, { kind: 'contacts' as const, ids: ['a'] }]) {
      const patch = audiencePatch(audience, 'acct', true) as Record<string, string | null>;
      expect(sameAudience(audienceFromDraft(patch), audience)).toBe(true);
    }
  });
});

describe('toServerSelection', () => {
  it('maps a segment to a filter and keeps ids', () => {
    expect(toServerSelection(segment)).toEqual({ kind: 'filter', definition: FILTER });
    expect(toServerSelection(NOBODY)).toEqual({ kind: 'contacts', ids: [] });
  });
});

describe('audienceAfterAccountChange', () => {
  // Switching accounts used to flip hand-picked contacts to "All Contacts".
  it('drops hand-picked contacts and lists to nobody, never to everyone', () => {
    expect(audienceAfterAccountChange({ kind: 'contacts', ids: ['c1'] })).toEqual(NOBODY);
    expect(audienceAfterAccountChange({ kind: 'list', id: 'l1', name: 'L' })).toEqual(NOBODY);
  });

  it('keeps rules that apply to any account', () => {
    expect(audienceAfterAccountChange({ kind: 'all' })).toEqual({ kind: 'all' });
    expect(audienceAfterAccountChange(segment)).toBe(segment);
  });
});

describe('sameAudience', () => {
  it('compares what would be saved, not display names', () => {
    expect(sameAudience({ kind: 'list', id: 'l1', name: 'A' }, { kind: 'list', id: 'l1', name: 'B' })).toBe(true);
    expect(sameAudience({ kind: 'contacts', ids: ['a', 'b'] }, { kind: 'contacts', ids: ['b', 'a'] })).toBe(true);
    expect(sameAudience({ kind: 'contacts', ids: ['a'] }, { kind: 'contacts', ids: ['b'] })).toBe(false);
    expect(sameAudience({ kind: 'all' }, NOBODY)).toBe(false);
  });
});
