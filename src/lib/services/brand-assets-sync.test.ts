import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The reconcile half of the brand-asset sync, with storage and the database
 * stubbed — it can't run locally otherwise, and create/update/skip/remove are
 * exactly the branches that break silently.
 */

let accountRow: Record<string, unknown>;
let rows: Record<string, unknown>[];
let nextId = 1;

vi.mock('@/lib/s3', () => ({
  // Production maps these via S3_PUBLIC_URL_PREFIX; the shape is what matters.
  s3KeyFromPublicUrl: (url: string) =>
    url.startsWith('https://cdn.test/') ? url.slice('https://cdn.test/'.length) : null,
  downloadFromS3: vi.fn(async () => Buffer.from('LOGOBYTES')),
}));

vi.mock('@/lib/media-thumbnails', () => ({
  generateThumbnail: vi.fn(async () => ({ originalWidth: 512, originalHeight: 256 })),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    account: { findUnique: vi.fn(async () => accountRow) },
    mediaAsset: {
      findMany: vi.fn(async () => rows),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `a${nextId++}`, ...data };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        rows = rows.filter((r) => r.id !== where.id);
        return {};
      }),
    },
  },
}));

beforeEach(() => {
  rows = [];
  nextId = 1;
  accountRow = {
    key: 'youngHondaOgden',
    dealer: 'Young Honda Ogden',
    logos: JSON.stringify({ light: 'https://cdn.test/logos/yho/light-1.png' }),
    customFonts: null,
    customValues: null,
  };
});

describe('syncAccountBrandAssets', () => {
  it('catalogues a logo with classification derived, not typed', () => {
    // The point of the whole exercise: no human fills any of this in.
    return import('./brand-assets').then(async ({ syncAccountBrandAssets }) => {
      const r = await syncAccountBrandAssets('youngHondaOgden');
      expect(r).toEqual({ created: 1, updated: 0, removed: 0 });
      expect(rows[0]).toMatchObject({
        managedBy: 'account-logo',
        managedRef: 'light',
        s3Key: 'logos/yho/light-1.png',
        assetCategory: 'logo',
        category: 'brand',
        assetSource: 'dealer-supplied',
        altText: 'Young Honda Ogden logo, light variant',
        size: 9,
        width: 512,
        height: 256,
      });
      expect(rows[0].contentHash).toBeTruthy();
    });
  });

  it('is a no-op on re-run', async () => {
    const { syncAccountBrandAssets } = await import('./brand-assets');
    await syncAccountBrandAssets('youngHondaOgden');
    // Cheap enough to call on every settings save is the whole design intent.
    expect(await syncAccountBrandAssets('youngHondaOgden')).toEqual({
      created: 0, updated: 0, removed: 0,
    });
    expect(rows).toHaveLength(1);
  });

  it('updates in place when a logo is replaced', async () => {
    const { syncAccountBrandAssets } = await import('./brand-assets');
    await syncAccountBrandAssets('youngHondaOgden');

    // Replacing writes a new uniquely-keyed object (cache busting).
    accountRow.logos = JSON.stringify({ light: 'https://cdn.test/logos/yho/light-2.png' });
    const r = await syncAccountBrandAssets('youngHondaOgden');

    expect(r).toEqual({ created: 0, updated: 1, removed: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0].s3Key).toBe('logos/yho/light-2.png');
  });

  it('removes the row when the logo is removed from the account', async () => {
    const { syncAccountBrandAssets } = await import('./brand-assets');
    await syncAccountBrandAssets('youngHondaOgden');

    accountRow.logos = '{}';
    expect(await syncAccountBrandAssets('youngHondaOgden')).toEqual({
      created: 0, updated: 0, removed: 1,
    });
    expect(rows).toHaveLength(0);
  });

  it('skips externally-hosted logos it does not own', async () => {
    // Some accounts still point at the legacy GoHighLevel CDN. Those bytes
    // aren't ours, so cataloguing them would create a row pointing at nothing.
    accountRow.logos = JSON.stringify({ light: 'https://assets.cdn.filesafe.space/x/y.png' });
    const { syncAccountBrandAssets } = await import('./brand-assets');
    expect(await syncAccountBrandAssets('youngHondaOgden')).toEqual({
      created: 0, updated: 0, removed: 0,
    });
    expect(rows).toHaveLength(0);
  });

  it('catalogues fonts as documents alongside logos', async () => {
    accountRow.customFonts = JSON.stringify([
      { family: 'Honda Sans', weight: '700', style: 'normal', url: 'https://cdn.test/fonts/yho/a.woff2' },
    ]);
    const { syncAccountBrandAssets } = await import('./brand-assets');
    await syncAccountBrandAssets('youngHondaOgden');

    const font = rows.find((r) => r.managedBy === 'account-font');
    expect(font).toMatchObject({ assetCategory: 'document', managedRef: 'Honda Sans|700|normal' });
    expect(rows).toHaveLength(2);
  });

  it('does nothing for a missing account', async () => {
    accountRow = null as never;
    const { syncAccountBrandAssets } = await import('./brand-assets');
    expect(await syncAccountBrandAssets('nope')).toEqual({ created: 0, updated: 0, removed: 0 });
  });
});
