import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  createChannelRegistry,
  registryFromRows,
  SEED_INTAKE_KINDS,
  SEED_CHANNEL_RECORDS,
  type ChannelRecord,
} from './channel-registry';

/**
 * These tests run against the SEED, not the table.
 *
 * The seed is what a fresh install gets and what an empty table falls back to,
 * so its invariants still have to hold — and they're the ones that used to be
 * guaranteed by the list being code. What an agency does to its own channels
 * afterwards is its business; what the write path lets it do is tested through
 * the service.
 */
const seed = createChannelRegistry(SEED_CHANNEL_RECORDS);

/**
 * The Oz Reports channel ids present in `channels` as of the 2026-07 export.
 * Every one must resolve, or its budget lines land nowhere on import — which
 * is silent money loss, so it's pinned here rather than trusted.
 */
const OZ_CHANNEL_IDS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24,
  25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44,
];

describe('seed channels', () => {
  it('has unique keys', () => {
    const keys = SEED_CHANNEL_RECORDS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never maps one Oz id to two channels', () => {
    const all = SEED_CHANNEL_RECORDS.flatMap((c) => c.externalIds);
    expect(new Set(all).size).toBe(all.length);
  });

  it('covers every Oz Reports channel id', () => {
    const unmapped = OZ_CHANNEL_IDS.filter((id) => seed.fromExternalId(id) == null);
    expect(unmapped).toEqual([]);
  });

  it('collapses the duplicated Management Fee ids onto one channel', () => {
    // 30 and 40 are both "Management Fee" in Oz Reports — the table's one true
    // duplicate. Two entries would show the same thing twice in the hub.
    expect(seed.fromExternalId(30)).toBe('management_fee');
    expect(seed.fromExternalId(40)).toBe('management_fee');
  });

  it('points every rate card reference at a real seed category', () => {
    // A channel billing at a card that doesn't exist falls silently back to the
    // agency default — the one-size-fits-all behaviour rate cards replaced.
    // The service validates this on write; the seed has to be right on its own.
    const cards = new Set([
      'digital',
      'mass_media',
      'pr',
      'swag',
      'print_event',
      'production',
      'development',
    ]);
    const dangling = SEED_CHANNEL_RECORDS.filter(
      (c) => c.billingKey != null && !cards.has(c.billingKey),
    ).map((c) => `${c.key} → ${c.billingKey}`);
    expect(dangling).toEqual([]);
  });
});

describe('registry lookups', () => {
  it('resolves known keys and rejects unknown ones', () => {
    expect(seed.has('meta')).toBe(true);
    expect(seed.has('nope')).toBe(false);
    expect(seed.has(null)).toBe(false);
    expect(seed.get('nope')).toBeNull();
  });

  it('returns null for an unmapped or absent external id', () => {
    // Oz allows channel_id 0/NULL — three live lines carry it. The importer
    // has to see null and report them, not guess a home for real money.
    expect(seed.fromExternalId(0)).toBeNull();
    expect(seed.fromExternalId(null)).toBeNull();
    expect(seed.fromExternalId(999)).toBeNull();
  });

  it('labels an unassigned channel rather than returning a raw key', () => {
    expect(seed.label('meta')).toBe('Meta');
    expect(seed.label(null)).toBe('Unassigned');
    expect(seed.category('radio')).toBe('Traditional');
    expect(seed.category(null)).toBeNull();
  });

  it('answers for archived channels but keeps them out of the pickers', () => {
    // A line placed on a channel that was later retired still has to render
    // and reconcile. Only what a user can CHOOSE narrows.
    // Both are intake channels for the same kind; only one is archived.
    // Archiving has to win, on the list AND on the per-kind lookup.
    const records: ChannelRecord[] = [
      { ...SEED_CHANNEL_RECORDS[0]!, key: 'live', label: 'Live', intakeKinds: ['ads'], archived: false },
      { ...SEED_CHANNEL_RECORDS[0]!, key: 'gone', label: 'Gone', intakeKinds: ['ads'], archived: true },
    ];
    const reg = createChannelRegistry(records);
    expect(reg.label('gone')).toBe('Gone');
    expect(reg.has('gone')).toBe(true);
    expect(reg.active.map((c) => c.key)).toEqual(['live']);
    expect(reg.intake.map((c) => c.key)).toEqual(['live']);
    expect(reg.forKind('ads')).toEqual(['live']);
  });

  it('derives display groups in sort order, not from a hardcoded list', () => {
    const reg = createChannelRegistry([
      { ...SEED_CHANNEL_RECORDS[0]!, key: 'b', category: 'Second', sortOrder: 1 },
      { ...SEED_CHANNEL_RECORDS[0]!, key: 'a', category: 'First', sortOrder: 0 },
      { ...SEED_CHANNEL_RECORDS[0]!, key: 'c', category: 'First', sortOrder: 2 },
    ]);
    expect(reg.categories()).toEqual(['First', 'Second']);
  });

  it('falls back to the seed for an empty table, never to an empty registry', () => {
    // An empty registry rejects every channel key as unknown, which on a write
    // path is indistinguishable from data corruption.
    expect(registryFromRows([]).has('meta')).toBe(true);
    expect(createChannelRegistry([]).has('meta')).toBe(false);
  });
});

describe('pacer platform mapping', () => {
  it('maps both Google-family channels onto the google pacer', () => {
    // The pacer's grain is the Google campaign and YouTube/Demand Gen live in
    // the same customer account, so the budget's planning split of
    // google/youtube must collapse to ONE platform on the rollup.
    expect(seed.pacerPlatform('google')).toBe('google');
    expect(seed.pacerPlatform('youtube')).toBe('google');
    expect(seed.forPlatform('google').sort()).toEqual(['google', 'youtube']);
  });

  it('maps meta to its own platform', () => {
    expect(seed.forPlatform('meta')).toEqual(['meta']);
  });

  it('paces only the three ad channels', () => {
    // Everything else — fees, services, traditional, production — has no
    // platform to sync spend from and settles by hand.
    const paced = SEED_CHANNEL_RECORDS.filter((c) => seed.isPaced(c.key)).map((c) => c.key);
    expect(paced.sort()).toEqual(['google', 'meta', 'youtube']);
  });
});

describe('intake subset', () => {
  it('is a strict subset of the registry', () => {
    expect(seed.intake.length).toBeLessThan(seed.all.length);
    for (const c of seed.intake) expect(seed.has(c.key)).toBe(true);
  });

  it('never offers a fee or a vendor service to a rep', () => {
    // A ticket is filed against work, not against an accounting bucket.
    for (const c of seed.intake) {
      expect(['Fees', 'Services']).not.toContain(c.category);
    }
  });

  it('every seeded kind→channel pair survives the inversion onto the channel', () => {
    // The one way intake can silently drop a rep's money: offer an input for a
    // channel the server then rejects as unknown. SEED_INTAKE_KINDS is the
    // pre-table map; every pair in it must still be answerable by the registry.
    for (const [kind, channels] of Object.entries(SEED_INTAKE_KINDS)) {
      for (const ch of channels) {
        expect(seed.has(ch), `${kind} → ${ch}`).toBe(true);
        expect(seed.forKind(kind), `${kind} → ${ch}`).toContain(ch);
      }
    }
  });

  it('offers a channel at intake only where a task kind asks for it', () => {
    // `intake` used to be its own boolean, and it disagreed with the kind map:
    // 18 of the 36 channels it flagged were offered on no kind at all, so the
    // checkbox promised an input that never rendered. One field now.
    for (const c of seed.intake) {
      expect(c.intakeKinds.length, c.key).toBeGreaterThan(0);
      for (const kind of c.intakeKinds) {
        expect(seed.forKind(kind), `${c.key} on ${kind}`).toContain(c.key);
      }
    }
    expect(seed.spendsBudget('ads')).toBe(true);
    expect(seed.spendsBudget('generic')).toBe(false);
    expect(seed.spendsBudget(null)).toBe(false);
  });
});

describe('server-safety', () => {
  it("is not marked 'use client'", () => {
    // It was, once. Under Next's bundler that turns every export into a client
    // reference which THROWS when a route handler calls it — so the Oz Reports
    // import 500'd on all 19 batches while 988 tests passed, because vitest
    // runs plain Node where the directive is inert.
    for (const f of ['src/lib/budget/channels.ts', 'src/lib/budget/channel-registry.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src.trimStart().startsWith("'use client'"), f).toBe(false);
      expect(src.trimStart().startsWith('"use client"'), f).toBe(false);
    }
  });

  it('keeps every server-imported budget module free of the directive', () => {
    for (const f of [
      'src/lib/budget/channels.ts',
      'src/lib/budget/channel-registry.ts',
      'src/lib/budget/period.ts',
      'src/lib/budget/settlement.ts',
      'src/lib/budget/term.ts',
      'src/lib/services/budget.ts',
      'src/lib/services/budget-channels.ts',
    ]) {
      const first = readFileSync(f, 'utf8').trimStart().slice(0, 20);
      expect(first, f).not.toMatch(/^['"]use client['"]/);
    }
  });

  it('leaves no synchronous channel lookup behind for someone to reach for', () => {
    // The whole point of the move: a function that answers from a hardcoded
    // list is indistinguishable from a correct one until a channel is renamed.
    const src = readFileSync('src/lib/budget/channels.ts', 'utf8');
    for (const gone of ['BUDGET_CHANNELS', 'channelLabel', 'isPacedChannel', 'channelFromOzId']) {
      expect(src.includes(`export function ${gone}`), gone).toBe(false);
      expect(src.includes(`export const ${gone}`), gone).toBe(false);
    }
  });
});
