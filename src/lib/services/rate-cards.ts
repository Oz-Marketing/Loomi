import { prisma } from '@/lib/prisma';
import { BILLING_CATEGORIES } from '@/lib/budget/channels';

/**
 * Rate cards — the agency's billing categories and what it keeps on each.
 *
 * This is the DB-backed replacement for the `BILLING_CATEGORIES` constant plus
 * its `app-markup-billing-<key>` AppSetting rows. The constant stays, but ONLY
 * as the seed for a fresh install: every agency prices differently and names
 * its categories differently, so a list that needs a deploy to change isn't
 * agnostic. `BILLING_CATEGORIES` is now "what Oz Marketing started with", not
 * "what a rate card can be".
 *
 * Two invariants the rest of the system leans on:
 *
 *   - `key` is immutable. Budget lines and channels reference categories by
 *     key as plain strings, so renaming one would silently detach history.
 *     `label` is the renameable name; the key is chosen once at creation.
 *   - Archive, never delete. An archived card resolves NO rate, so its
 *     channels fall back to the account rate and then the agency default —
 *     precisely the behaviour that existed before rate cards. Deleting the row
 *     would instead leave lines pointing at nothing.
 *
 * Rates are stored as the gross→spend FACTOR (0.77 = a 23% margin) because
 * that's what a line's `markupSnapshot` holds. The UI edits margin percent;
 * the conversion lives at the edge, not in here.
 */

export type RateCard = {
  id: string;
  key: string;
  label: string;
  /** Gross→spend factor, e.g. 0.77. */
  markup: number;
  sortOrder: number;
  archived: boolean;
};

/** Only 0 < markup <= 1 is a rate. A 0 would zero every line on the card. */
export function isValidRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1;
}

/**
 * Normalize a user-supplied key: lowercase, underscores, no leading/trailing
 * separators. Applied at creation only — an existing key is never rewritten.
 */
export function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toRateCard(row: {
  id: string;
  key: string;
  label: string;
  markup: number;
  sortOrder: number;
  archivedAt: Date | null;
}): RateCard {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    markup: row.markup,
    sortOrder: row.sortOrder,
    archived: row.archivedAt != null,
  };
}

/**
 * Every rate card, archived ones last.
 *
 * Falls back to the code seed when the table is EMPTY — the state between this
 * shipping and the seed script running, and the state of a fresh dev database.
 * An empty rate-card list would otherwise silently drop every channel back to
 * the agency default, i.e. quietly undo rate cards. A table with rows in it is
 * authoritative even if a seed category is missing from it: that means someone
 * archived or removed it on purpose.
 */
export async function listRateCards(opts?: { includeArchived?: boolean }): Promise<RateCard[]> {
  const rows = await prisma.billingCategory.findMany({
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  });

  if (rows.length === 0) {
    return BILLING_CATEGORIES.map((c, i) => ({
      id: `seed:${c.key}`,
      key: c.key,
      label: c.label,
      markup: c.defaultMarkup,
      sortOrder: i,
      archived: false,
    }));
  }

  const cards = rows.map(toRateCard);
  return opts?.includeArchived ? cards : cards.filter((c) => !c.archived);
}

/**
 * Active rates keyed by category — the shape `resolveMarkup` consumes.
 * Archived cards are absent rather than zero, so a lookup misses and the caller
 * falls through its own precedence chain.
 */
export async function activeRates(): Promise<Record<string, number>> {
  const cards = await listRateCards();
  return Object.fromEntries(
    cards.filter((c) => isValidRate(c.markup)).map((c) => [c.key, c.markup]),
  );
}

export async function createRateCard(input: {
  key?: string;
  label: string;
  markup: number;
}): Promise<RateCard> {
  const label = input.label.trim();
  if (!label) throw new Error('A rate card needs a name.');
  if (!isValidRate(input.markup)) {
    throw new Error('A markup must be between 0 and 1 (e.g. 0.77 for a 23% margin).');
  }

  const key = normalizeKey(input.key?.trim() || label);
  if (!key) throw new Error('That name has no letters or numbers to make a key from.');

  const clash = await prisma.billingCategory.findUnique({ where: { key } });
  if (clash) {
    throw new Error(`A rate card with the key "${key}" already exists (${clash.label}).`);
  }

  // New cards land at the end. Archived rows count, so reviving one can't
  // collide with a freshly created card's position.
  const last = await prisma.billingCategory.findFirst({
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  const row = await prisma.billingCategory.create({
    data: { key, label, markup: input.markup, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
  return toRateCard(row);
}

/**
 * Update a card's label, rate, or archived state. `key` is deliberately not
 * updatable — see the invariants at the top of this file.
 */
export async function updateRateCard(
  id: string,
  patch: { label?: string; markup?: number; archived?: boolean },
): Promise<RateCard> {
  const existing = await prisma.billingCategory.findUnique({ where: { id } });
  if (!existing) throw new Error('That rate card no longer exists.');

  const data: {
    label?: string;
    markup?: number;
    archivedAt?: Date | null;
  } = {};

  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (!label) throw new Error('A rate card needs a name.');
    data.label = label;
  }

  if (patch.markup !== undefined) {
    if (!isValidRate(patch.markup)) {
      throw new Error('A markup must be between 0 and 1 (e.g. 0.77 for a 23% margin).');
    }
    data.markup = patch.markup;
  }

  if (patch.archived !== undefined) {
    data.archivedAt = patch.archived ? (existing.archivedAt ?? new Date()) : null;
  }

  const row = await prisma.billingCategory.update({ where: { id }, data });
  return toRateCard(row);
}

/** Persist a new order. Ids not in the list keep their current position. */
export async function reorderRateCards(ids: string[]): Promise<void> {
  await prisma.$transaction(
    ids.map((id, i) =>
      prisma.billingCategory.update({ where: { id }, data: { sortOrder: i } }),
    ),
  );
}

/**
 * Set one card's rate by CATEGORY KEY rather than id.
 *
 * Kept because that's the contract the old AppSetting-backed writer had, and
 * the settings tab still thinks in keys. Creates nothing: a key with no row is
 * an error, not an implicit new card, so a typo can't quietly invent a
 * category that channels will never point at.
 */
export async function setRateByKey(key: string, markup: number): Promise<number> {
  if (!isValidRate(markup)) {
    throw new Error('A markup must be between 0 and 1 (e.g. 0.77 for a 23% margin).');
  }
  const row = await prisma.billingCategory.findUnique({ where: { key } });
  if (!row) throw new Error(`"${key}" is not a rate card.`);
  await prisma.billingCategory.update({ where: { id: row.id }, data: { markup } });
  return markup;
}
