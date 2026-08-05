import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  BUDGET_CHANNELS,
  INTAKE_CHANNELS,
  KIND_BUDGET_CHANNELS,
  budgetChannel,
  channelCategory,
  channelFromOzId,
  channelLabel,
  channelPacerPlatform,
  channelsForPlatform,
  isBudgetChannel,
  isPacedChannel,
} from './channels';

/**
 * The Oz Reports channel ids present in `channels` as of the 2026-07 export.
 * Every one must resolve, or its budget lines land nowhere on import — which
 * is silent money loss, so it's pinned here rather than trusted.
 */
const OZ_CHANNEL_IDS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24,
  25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44,
];

describe('channel registry', () => {
  it('has unique keys', () => {
    const keys = BUDGET_CHANNELS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never maps one Oz id to two channels', () => {
    const all = BUDGET_CHANNELS.flatMap((c) => c.ozIds);
    expect(new Set(all).size).toBe(all.length);
  });

  it('covers every Oz Reports channel id', () => {
    const unmapped = OZ_CHANNEL_IDS.filter((id) => channelFromOzId(id) == null);
    expect(unmapped).toEqual([]);
  });

  it('collapses the duplicated Management Fee ids onto one channel', () => {
    // 30 and 40 are both "Management Fee" in Oz Reports — the table's one true
    // duplicate. Two entries would show the same thing twice in the hub.
    expect(channelFromOzId(30)).toBe('management_fee');
    expect(channelFromOzId(40)).toBe('management_fee');
  });

  it('resolves known keys and rejects unknown ones', () => {
    expect(isBudgetChannel('meta')).toBe(true);
    expect(isBudgetChannel('nope')).toBe(false);
    expect(isBudgetChannel(null)).toBe(false);
    expect(budgetChannel('nope')).toBeNull();
  });

  it('returns null for an unmapped or absent Oz id', () => {
    // Oz allows channel_id 0/NULL — three live lines carry it. The importer
    // has to see null and report them, not guess a home for real money.
    expect(channelFromOzId(0)).toBeNull();
    expect(channelFromOzId(null)).toBeNull();
    expect(channelFromOzId(999)).toBeNull();
  });

  it('labels an unassigned channel rather than returning a raw key', () => {
    expect(channelLabel('meta')).toBe('Meta');
    expect(channelLabel(null)).toBe('Unassigned');
    expect(channelCategory('radio')).toBe('Traditional');
    expect(channelCategory(null)).toBeNull();
  });
});

describe('pacer platform mapping', () => {
  it('maps both Google-family channels onto the google pacer', () => {
    // The pacer's grain is the Google campaign and YouTube/Demand Gen live in
    // the same customer account, so the budget's planning split of
    // google/youtube must collapse to ONE platform on the rollup.
    expect(channelPacerPlatform('google')).toBe('google');
    expect(channelPacerPlatform('youtube')).toBe('google');
    expect(channelsForPlatform('google').sort()).toEqual(['google', 'youtube']);
  });

  it('maps meta to its own platform', () => {
    expect(channelsForPlatform('meta')).toEqual(['meta']);
  });

  it('paces only the three ad channels', () => {
    // Everything else — fees, services, traditional, production — has no
    // platform to sync spend from and settles by hand.
    const paced = BUDGET_CHANNELS.filter((c) => isPacedChannel(c.key)).map((c) => c.key);
    expect(paced.sort()).toEqual(['google', 'meta', 'youtube']);
  });
});

describe('intake subset', () => {
  it('is a strict subset of the registry', () => {
    expect(INTAKE_CHANNELS.length).toBeLessThan(BUDGET_CHANNELS.length);
    for (const c of INTAKE_CHANNELS) expect(isBudgetChannel(c.key)).toBe(true);
  });

  it('never offers a fee or a vendor service to a rep', () => {
    // A ticket is filed against work, not against an accounting bucket.
    for (const c of INTAKE_CHANNELS) {
      expect(['Fees', 'Services']).not.toContain(c.category);
    }
  });

  it('every KIND_BUDGET_CHANNELS entry is a real, rep-selectable channel', () => {
    // The one way intake can silently drop a rep's money: offer an input for a
    // channel the server then rejects as unknown.
    const intakeKeys = new Set(INTAKE_CHANNELS.map((c) => c.key));
    for (const [kind, channels] of Object.entries(KIND_BUDGET_CHANNELS)) {
      for (const ch of channels) {
        expect(isBudgetChannel(ch), `${kind} → ${ch}`).toBe(true);
        expect(intakeKeys.has(ch), `${kind} → ${ch} is not rep-selectable`).toBe(true);
      }
    }
  });
});

describe('server-safety', () => {
  it("is not marked 'use client'", () => {
    // It was, once. Under Next's bundler that turns every export into a client
    // reference which THROWS when a route handler calls it — so the Oz Reports
    // import 500'd on all 19 batches while 988 tests passed, because vitest
    // runs plain Node where the directive is inert.
    const src = readFileSync('src/lib/budget/channels.ts', 'utf8');
    expect(src.trimStart().startsWith("'use client'")).toBe(false);
    expect(src.trimStart().startsWith('"use client"')).toBe(false);
  });

  it('keeps every server-imported budget module free of the directive', () => {
    for (const f of [
      'src/lib/budget/channels.ts',
      'src/lib/budget/period.ts',
      'src/lib/budget/settlement.ts',
      'src/lib/budget/term.ts',
      'src/lib/services/budget.ts',
    ]) {
      const first = readFileSync(f, 'utf8').trimStart().slice(0, 20);
      expect(first, f).not.toMatch(/^['"]use client['"]/);
    }
  });
});
