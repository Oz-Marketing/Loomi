import { prisma } from '@/lib/prisma';

/**
 * App-level singleton key/value store (the `AppSetting` table).
 *
 * Replaces small "file-as-database" stores that used to be written to the
 * release filesystem at runtime and were silently wiped on every deploy
 * (each release is rebuilt from `git archive`). Keep keys namespaced and
 * stable — they are the primary key.
 */

/** Key for the AI knowledge-base markdown (formerly loomi-knowledge.md). */
export const KNOWLEDGE_SETTING_KEY = 'loomi-knowledge';

/** Read a setting's value, or `null` if it has never been set. */
export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

/** Create or overwrite a setting's value. */
export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

/**
 * Seed a setting only if it does not already exist. Returns true if it wrote
 * the value, false if a row was already present. Used by the one-time
 * backfill so re-running a deploy never clobbers edits made through the UI.
 */
export async function seedSettingIfAbsent(key: string, value: string): Promise<boolean> {
  const existing = await prisma.appSetting.findUnique({ where: { key }, select: { key: true } });
  if (existing) return false;
  await prisma.appSetting.create({ data: { key, value } });
  return true;
}
