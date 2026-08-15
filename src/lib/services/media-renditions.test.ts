import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';

/**
 * Rendition generation, with storage and the database stubbed.
 *
 * The resize is the part worth testing and the part that can't be checked by
 * reading it: whether a 1600×1200 master really comes out as a 1080×1920 story
 * crop is a question about sharp's `fit` semantics, not about our control flow.
 * S3 is mocked so this runs anywhere — no bucket, no credentials.
 */

const uploaded: { key: string; body: Buffer; contentType: string }[] = [];

vi.mock('@/lib/s3', () => ({
  downloadFromS3: vi.fn(async () => masterBuffer),
  uploadToS3: vi.fn(async (key: string, body: Buffer, contentType: string) => {
    uploaded.push({ key, body, contentType });
  }),
  deleteFromS3: vi.fn(async () => {}),
  s3PublicUrl: (key: string) => `https://example.test/${key}`,
}));

const renditionRows = new Map<string, Record<string, unknown>>();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mediaAsset: {
      findUnique: vi.fn(async () => ({
        id: 'asset-1',
        accountKey: 'youngHondaOgden',
        s3Key: 'media/youngHondaOgden/asset-1/master.jpg',
        mimeType: 'image/jpeg',
      })),
    },
    mediaRendition: {
      findUnique: vi.fn(async ({ where }: { where: { assetId_name: { name: string } } }) =>
        renditionRows.get(where.assetId_name.name) ?? null),
      upsert: vi.fn(async ({ where, create, update }: {
        where: { assetId_name: { name: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const key = where.assetId_name.name;
        const existing = renditionRows.get(key);
        const row = existing ? { ...existing, ...update } : create;
        renditionRows.set(key, row);
        return row;
      }),
    },
  },
}));

/** A wide master — 1600×1200, 4:3. */
let masterBuffer: Buffer;

beforeEach(async () => {
  uploaded.length = 0;
  renditionRows.clear();
  masterBuffer = await sharp({
    create: { width: 1600, height: 1200, channels: 3, background: { r: 10, g: 90, b: 200 } },
  })
    .jpeg()
    .toBuffer();
});

describe('canGenerateRenditions', () => {
  it('accepts raster images and refuses everything else', async () => {
    const { canGenerateRenditions } = await import('./media-renditions');
    expect(canGenerateRenditions('image/jpeg')).toBe(true);
    expect(canGenerateRenditions('image/png')).toBe(true);
    // The Audi GWD packages — generating eight unusable JPEGs from a zip would
    // be worse than refusing.
    expect(canGenerateRenditions('application/zip')).toBe(false);
    expect(canGenerateRenditions('application/pdf')).toBe(false);
    expect(canGenerateRenditions('video/mp4')).toBe(false);
    // Rasterizing a logo is rarely what anyone wants.
    expect(canGenerateRenditions('image/svg+xml')).toBe(false);
  });
});

describe('generateRenditions', () => {
  it('produces exactly the catalog dimensions, including a portrait crop from a landscape master', async () => {
    const { generateRenditions } = await import('./media-renditions');

    const result = await generateRenditions('asset-1', [
      { name: 'Instagram Square' },
      { name: 'Instagram Story / Reels' },
      { name: 'Leaderboard' },
    ]);

    expect(result.failed).toEqual([]);
    expect(result.created.map((r) => r.name).sort()).toEqual([
      'Instagram Square',
      'Instagram Story / Reels',
      'Leaderboard',
    ]);

    // Verify the actual pixels, not just the recorded numbers.
    const dims = await Promise.all(
      uploaded.map(async (u) => {
        const m = await sharp(u.body).metadata();
        return `${m.width}x${m.height}`;
      }),
    );
    expect(dims.sort()).toEqual(['1080x1080', '1080x1920', '728x90']);
    expect(uploaded.every((u) => u.contentType === 'image/jpeg')).toBe(true);
  });

  it('letterboxes when fit is contain, filling to the same frame', async () => {
    const { generateRenditions } = await import('./media-renditions');
    await generateRenditions('asset-1', [{ name: 'Instagram Square', fit: 'contain' }]);
    const meta = await sharp(uploaded[0].body).metadata();
    // Same frame either way — `contain` pads rather than shrinking the canvas.
    expect(`${meta.width}x${meta.height}`).toBe('1080x1080');
  });

  it('records how the master was fitted', async () => {
    const { generateRenditions } = await import('./media-renditions');
    const r = await generateRenditions('asset-1', [{ name: 'Facebook Feed', fit: 'contain' }]);
    expect(r.created[0].fit).toBe('contain');
  });

  it('reports an unknown size instead of failing the whole batch', async () => {
    const { generateRenditions } = await import('./media-renditions');
    const result = await generateRenditions('asset-1', [
      { name: 'Instagram Square' },
      { name: 'Nonexistent Size' },
    ]);
    // The good one still lands — a partial set beats none.
    expect(result.created.map((r) => r.name)).toEqual(['Instagram Square']);
    expect(result.failed).toEqual([{ name: 'Nonexistent Size', error: 'Unknown size' }]);
  });

  it('replaces rather than accumulates when a size is regenerated', async () => {
    const { generateRenditions } = await import('./media-renditions');
    await generateRenditions('asset-1', [{ name: 'Instagram Square' }]);
    const firstKey = uploaded[0].key;

    await generateRenditions('asset-1', [{ name: 'Instagram Square' }]);

    // One row, and the same key reused — otherwise every regeneration would
    // orphan its predecessor in the bucket.
    expect(renditionRows.size).toBe(1);
    expect(uploaded[1].key).toBe(firstKey);
  });

  it('upscales a small master rather than refusing', async () => {
    // A 400×300 master asked for a billboard: soft, but blocking it would break
    // the common case of a master that's merely a little short on one axis.
    masterBuffer = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();

    const { generateRenditions } = await import('./media-renditions');
    await generateRenditions('asset-1', [{ name: 'Billboard' }]);
    const meta = await sharp(uploaded[0].body).metadata();
    expect(`${meta.width}x${meta.height}`).toBe('970x250');
  });
});
