/**
 * Ad size library — server-side reads and one-time seeding.
 *
 * The `AdSizePreset` table is the only size list the app has, so a fresh
 * environment has to be given the starter sizes rather than falling back to a
 * code catalog at render time (that fallback is exactly what produced the old
 * "app defaults vs custom" split, and the bug where a picker showed one and not
 * the other).
 *
 * Seeding runs lazily on first read and is guarded two ways: an AppSetting
 * marker records the starter-set version already applied, and each seeded row
 * carries a unique `builtinKey`. Either alone would be enough to stop
 * duplicates; together they also mean deleting a starter is permanent — the
 * marker keeps the seeder from running again, so a size someone removed on
 * purpose does not reappear on the next page load.
 */
import { prisma } from '@/lib/prisma';
import { getSetting, setSetting } from '@/lib/services/app-settings';
import { AD_SIZE_STARTERS, parseTags, type LibrarySize } from './ad-size-library';

/** AppSetting key holding the highest starter-set version seeded here. */
export const SIZE_SEED_KEY = 'ad-size-library-seeded';

/**
 * Bump when starters are ADDED. Existing rows are never touched — a bump only
 * lets `skipDuplicates` insert the new keys.
 */
export const SIZE_SEED_VERSION = 1;

type Row = {
  id: string;
  name: string;
  width: number;
  height: number;
  tags: string | null;
  createdByName: string | null;
  createdByEmail: string | null;
  createdByImage: string | null;
  createdAt: Date;
};

export function toLibrarySize(row: Row): LibrarySize {
  return {
    id: row.id,
    name: row.name,
    width: row.width,
    height: row.height,
    tags: parseTags(row.tags),
    createdByName: row.createdByName,
    createdByEmail: row.createdByEmail,
    createdByImage: row.createdByImage,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Insert any starter sizes this environment has never been offered. Safe to
 * call on every read: it short-circuits on the marker after the first run, and
 * never throws — a library that can't be seeded (unmigrated table) should still
 * list whatever rows exist.
 */
export async function ensureSizeLibrarySeeded(): Promise<void> {
  try {
    const marker = await getSetting(SIZE_SEED_KEY);
    const seeded = marker ? Number(marker) : 0;
    if (Number.isFinite(seeded) && seeded >= SIZE_SEED_VERSION) return;

    await prisma.adSizePreset.createMany({
      data: AD_SIZE_STARTERS.map((s) => ({
        builtinKey: s.key,
        name: s.name,
        width: s.width,
        height: s.height,
        tags: JSON.stringify(s.tags),
        createdByName: 'Loomi',
      })),
      skipDuplicates: true,
    });
    await setSetting(SIZE_SEED_KEY, String(SIZE_SEED_VERSION));
  } catch (err) {
    console.warn('[ad-size-library] seeding skipped:', err);
  }
}

/** The whole library, newest custom sizes first, seeded if it never has been. */
export async function listSizeLibrary(): Promise<LibrarySize[]> {
  await ensureSizeLibrarySeeded();
  const rows = await prisma.adSizePreset.findMany({ orderBy: [{ createdAt: 'desc' }] });
  return rows.map(toLibrarySize);
}

/**
 * One size by name, for callers that reference sizes by label rather than id
 * (media renditions). Falls back to a starter so a rendition request still
 * resolves in an environment whose table isn't migrated yet.
 */
export async function findSizeByName(name: string): Promise<LibrarySize | undefined> {
  try {
    const row = await prisma.adSizePreset.findFirst({ where: { name }, orderBy: { createdAt: 'asc' } });
    if (row) return toLibrarySize(row);
  } catch (err) {
    console.warn('[ad-size-library] name lookup failed, using starters:', err);
  }
  const starter = AD_SIZE_STARTERS.find((s) => s.name === name);
  return starter ? { id: starter.key, name: starter.name, width: starter.width, height: starter.height, tags: starter.tags } : undefined;
}
