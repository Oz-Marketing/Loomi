// Load the account data behind a blast's account-level merge tags.
//
// The send path used to load eight columns here (name, From address, phone,
// address, website) and nothing else, so every account-backed tag the editor
// preview filled — {{custom_values.service_phone}}, the logo URL, brand
// colors, every account custom value — reached the inbox as literal text.
// This loader selects everything accountMergeValues() reads, and inherits
// logos and branding down the account hierarchy exactly the way /api/accounts
// and the editor do (nearest ancestor fills a gap, the account's own value
// always wins), so a rooftop that leans on its group's brand kit sends the
// group's logo rather than a blank.
//
// Server-only (Prisma). The mapping itself is pure and lives in
// ./account-merge-values.ts so the editor can share it.

import { prisma } from '@/lib/prisma';
import {
  parseJsonObject,
  type AccountMergeSource,
} from '@/lib/sending/account-merge-values';

export {
  accountMergeValues,
  type AccountMergeSource,
} from '@/lib/sending/account-merge-values';

/** Depth cap on the parent walk — a malformed chain must not spin. */
const MAX_ANCESTOR_DEPTH = 10;

/** Every column accountMergeValues() reads, plus the parent link. */
export const BLAST_ACCOUNT_SELECT = {
  key: true,
  dealer: true,
  email: true,
  senderEmail: true,
  phone: true,
  salesPhone: true,
  servicePhone: true,
  partsPhone: true,
  address: true,
  city: true,
  state: true,
  postalCode: true,
  website: true,
  timezone: true,
  logos: true,
  branding: true,
  customValues: true,
  parentAccountKey: true,
} as const;

/** One account, ready for buildBlastMergetagContext(). JSON columns parsed. */
export type LoadedBlastAccount = AccountMergeSource & {
  key: string;
  logos?: Record<string, string>;
  branding?: { colors?: Record<string, string>; fonts?: Record<string, string> };
  customValues?: Record<string, unknown>;
};

type StringMap = Record<string, string>;

function stringMap(value: unknown): StringMap {
  const out: StringMap = {};
  const parsed = parseJsonObject(value);
  if (!parsed) return out;
  for (const [field, raw] of Object.entries(parsed)) {
    if (typeof raw === 'string' && raw.trim()) out[field] = raw.trim();
  }
  return out;
}

/** Fill only the gaps `own` left empty — the child's own value always wins. */
function fillGaps(own: StringMap, inherited: StringMap): StringMap {
  const merged = { ...own };
  for (const [field, value] of Object.entries(inherited)) {
    if (!merged[field]) merged[field] = value;
  }
  return merged;
}

interface AncestorRow {
  key: string;
  logos: string | null;
  branding: string | null;
  parentAccountKey: string | null;
}

/**
 * Load merge data for every account in `accountKeys`, keyed by account key.
 * An account that no longer exists is simply absent from the map — callers
 * already treat a missing entry as "no account data".
 *
 * Ancestors are fetched one LEVEL at a time for the whole batch, so a blast
 * across 18 rooftops under one group costs two or three queries, not 18 walks.
 */
export async function loadBlastAccountData(
  accountKeys: string[],
): Promise<Map<string, LoadedBlastAccount>> {
  const map = new Map<string, LoadedBlastAccount>();
  const keys = [...new Set(accountKeys.filter(Boolean))];
  if (keys.length === 0) return map;

  const rows = await prisma.account.findMany({
    where: { key: { in: keys } },
    select: BLAST_ACCOUNT_SELECT,
  });

  // Every account row seen so far, by key — the requested ones and each
  // ancestor level as it arrives.
  const byKey = new Map<string, AncestorRow>();
  for (const row of rows) {
    byKey.set(row.key, {
      key: row.key,
      logos: row.logos ?? null,
      branding: row.branding ?? null,
      parentAccountKey: row.parentAccountKey ?? null,
    });
  }

  let frontier = rows
    .map((row) => row.parentAccountKey ?? null)
    .filter((key): key is string => Boolean(key) && !byKey.has(key as string));
  for (let depth = 0; frontier.length > 0 && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    const wanted = [...new Set(frontier)];
    const ancestors = await prisma.account.findMany({
      where: { key: { in: wanted } },
      select: { key: true, logos: true, branding: true, parentAccountKey: true },
    });
    for (const ancestor of ancestors) {
      byKey.set(ancestor.key, {
        key: ancestor.key,
        logos: ancestor.logos ?? null,
        branding: ancestor.branding ?? null,
        parentAccountKey: ancestor.parentAccountKey ?? null,
      });
    }
    frontier = ancestors
      .map((ancestor) => ancestor.parentAccountKey ?? null)
      .filter((key): key is string => Boolean(key) && !byKey.has(key as string));
  }

  for (const row of rows) {
    let logos = stringMap(row.logos);
    const ownBranding = parseJsonObject(row.branding) ?? {};
    let colors = stringMap(ownBranding.colors);
    let fonts = stringMap(ownBranding.fonts);

    // Nearest ancestor first; a cycle or a missing parent ends the walk.
    const seen = new Set<string>([row.key]);
    let cursor = row.parentAccountKey ?? null;
    for (let depth = 0; cursor && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const ancestor = byKey.get(cursor);
      if (!ancestor) break;
      logos = fillGaps(logos, stringMap(ancestor.logos));
      const inherited = parseJsonObject(ancestor.branding) ?? {};
      colors = fillGaps(colors, stringMap(inherited.colors));
      fonts = fillGaps(fonts, stringMap(inherited.fonts));
      cursor = ancestor.parentAccountKey;
    }

    const branding: LoadedBlastAccount['branding'] = {};
    if (Object.keys(colors).length) branding.colors = colors;
    if (Object.keys(fonts).length) branding.fonts = fonts;

    map.set(row.key, {
      key: row.key,
      dealer: row.dealer,
      email: row.email,
      senderEmail: row.senderEmail,
      phone: row.phone,
      salesPhone: row.salesPhone,
      servicePhone: row.servicePhone,
      partsPhone: row.partsPhone,
      address: row.address,
      city: row.city,
      state: row.state,
      postalCode: row.postalCode,
      website: row.website,
      timezone: row.timezone,
      logos,
      branding,
      customValues: parseJsonObject(row.customValues) ?? {},
    });
  }

  return map;
}
