import { beforeEach, describe, expect, it, vi } from 'vitest';

// Wrapped in lambdas so the hoisted vi.mock factory doesn't touch these
// bindings before initialization — same pattern as blast-preflight.test.ts.
const accountFindUnique = vi.fn();
const footerFindMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    account: { findUnique: (...a: unknown[]) => accountFindUnique(...a) },
    accountEmailFooter: { findMany: (...a: unknown[]) => footerFindMany(...a) },
  },
}));

const { resolveAccountFooter, resolveAccountFooters } =
  await import('./account-footer');
const { DEFAULT_FOOTER_CONFIG } = await import('./unsubscribe-footer');

/** parents: child key → parent key (or null for a root). */
function mockHierarchy(parents: Record<string, string | null>) {
  accountFindUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
    if (!(where.key in parents)) return null;
    return { parentAccountKey: parents[where.key] };
  });
}

function mockOverrides(rows: { accountKey: string; config: unknown }[]) {
  footerFindMany.mockImplementation(async ({ where }: { where: { accountKey: { in: string[] } } }) => {
    const wanted = new Set(where.accountKey.in);
    return rows.filter((r) => wanted.has(r.accountKey));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveAccountFooter', () => {
  it('falls back to defaults when nothing in the chain has a row', async () => {
    mockHierarchy({ 'young-chevy': 'yag' , yag: null });
    mockOverrides([]);

    const out = await resolveAccountFooter('young-chevy');
    expect(out.config).toEqual(DEFAULT_FOOTER_CONFIG);
    expect(out.sourceAccountKey).toBeNull();
    expect(out.inherited).toBe(false);
  });

  it('uses the account own row when it has one', async () => {
    mockHierarchy({ 'young-chevy': 'yag', yag: null });
    mockOverrides([{ accountKey: 'young-chevy', config: { align: 'left' } }]);

    const out = await resolveAccountFooter('young-chevy');
    expect(out.config.align).toBe('left');
    expect(out.sourceAccountKey).toBe('young-chevy');
    expect(out.inherited).toBe(false);
  });

  it('inherits the parent row when the account has none', async () => {
    // The whole point: a footer on the group applies to every rooftop.
    mockHierarchy({ 'young-chevy': 'yag', yag: null });
    mockOverrides([{ accountKey: 'yag', config: { align: 'right' } }]);

    const out = await resolveAccountFooter('young-chevy');
    expect(out.config.align).toBe('right');
    expect(out.sourceAccountKey).toBe('yag');
    expect(out.inherited).toBe(true);
  });

  it('prefers the nearest ancestor over a more distant one', async () => {
    mockHierarchy({ rooftop: 'region', region: 'group', group: null });
    mockOverrides([
      { accountKey: 'group', config: { fontSizePx: 20 } },
      { accountKey: 'region', config: { fontSizePx: 14 } },
    ]);

    const out = await resolveAccountFooter('rooftop');
    expect(out.config.fontSizePx).toBe(14);
    expect(out.sourceAccountKey).toBe('region');
  });

  it('lets a rooftop override its group', async () => {
    mockHierarchy({ 'young-chevy': 'yag', yag: null });
    mockOverrides([
      { accountKey: 'yag', config: { align: 'right' } },
      { accountKey: 'young-chevy', config: { align: 'left' } },
    ]);

    const out = await resolveAccountFooter('young-chevy');
    expect(out.config.align).toBe('left');
    expect(out.inherited).toBe(false);
  });

  it('validates an inherited row rather than trusting it', async () => {
    mockHierarchy({ rooftop: 'group', group: null });
    mockOverrides([
      { accountKey: 'group', config: { fontSizePx: 900, textColor: 'red' } },
    ]);

    const out = await resolveAccountFooter('rooftop');
    expect(out.config.fontSizePx).toBe(24);
    expect(out.config.textColor).toBe(DEFAULT_FOOTER_CONFIG.textColor);
  });

  it('survives a parent cycle instead of spinning', async () => {
    // A.parent = B and B.parent = A is expressible in the schema, and one bad
    // row must not hang every send for that account.
    mockHierarchy({ a: 'b', b: 'a' });
    mockOverrides([]);

    const out = await resolveAccountFooter('a');
    expect(out.config).toEqual(DEFAULT_FOOTER_CONFIG);
  });

  it('handles a self-referencing parent', async () => {
    mockHierarchy({ a: 'a' });
    mockOverrides([]);
    await expect(resolveAccountFooter('a')).resolves.toBeTruthy();
  });
});

describe('resolveAccountFooters', () => {
  it('resolves a multi-rooftop blast in one override query', async () => {
    mockHierarchy({ chevy: 'yag', ford: 'yag', yag: null });
    mockOverrides([{ accountKey: 'yag', config: { align: 'right' } }]);

    const out = await resolveAccountFooters(['chevy', 'ford']);

    expect(out.get('chevy')?.config.align).toBe('right');
    expect(out.get('ford')?.config.align).toBe('right');
    expect(out.get('chevy')?.inherited).toBe(true);
    // One query for every override, not one per account — the send loop
    // must not be issuing footer lookups.
    expect(footerFindMany).toHaveBeenCalledTimes(1);
  });

  it('gives each account its own answer when they differ', async () => {
    mockHierarchy({ chevy: 'yag', ford: 'yag', yag: null });
    mockOverrides([
      { accountKey: 'yag', config: { align: 'right' } },
      { accountKey: 'ford', config: { align: 'left' } },
    ]);

    const out = await resolveAccountFooters(['chevy', 'ford']);
    expect(out.get('chevy')?.config.align).toBe('right');
    expect(out.get('ford')?.config.align).toBe('left');
  });

  it('dedupes repeated keys and returns an empty map for no input', async () => {
    mockHierarchy({ chevy: null });
    mockOverrides([]);

    expect((await resolveAccountFooters([])).size).toBe(0);
    const out = await resolveAccountFooters(['chevy', 'chevy']);
    expect(out.size).toBe(1);
  });
});
