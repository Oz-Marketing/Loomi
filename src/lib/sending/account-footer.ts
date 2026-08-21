// Resolve the per-account email compliance footer, with inheritance.
//
// A row in AccountEmailFooter is an OVERRIDE, not a value — absence is
// meaningful. Resolution walks up Account.parentAccountKey and takes the
// first row it finds, so a footer saved on a group account (Young Automotive
// Group) applies to all 18 rooftops beneath it until a rooftop saves its own.
// Removing a rooftop's row re-inherits from the group rather than snapping
// back to the built-in default.
//
// The rendering half lives in ./unsubscribe-footer, which is deliberately
// free of Prisma so it stays unit-testable and usable from the editor
// preview. This module is the only place that reads the database.

import { prisma } from '@/lib/prisma';
import {
  resolveFooterConfig,
  type UnsubscribeFooterConfig,
} from '@/lib/sending/unsubscribe-footer';

/**
 * Defensive cap on the parent walk. The schema allows a cycle
 * (A.parent = B, B.parent = A) and one bad row must not hang a send.
 */
const MAX_DEPTH = 10;

export interface ResolvedFooter {
  /** Validated config, ready to render. Never null — falls back to defaults. */
  config: UnsubscribeFooterConfig;
  /**
   * Which account the config came from, or null when nothing in the chain
   * had a row and these are the built-in defaults.
   */
  sourceAccountKey: string | null;
  /** True when the config came from an ancestor rather than this account. */
  inherited: boolean;
}

type FooterRow = { accountKey: string; config: unknown };

function resolveFrom(
  accountKey: string,
  chain: string[],
  rowsByKey: Map<string, FooterRow>,
): ResolvedFooter {
  for (const key of chain) {
    const row = rowsByKey.get(key);
    if (row) {
      return {
        config: resolveFooterConfig(
          row.config as Partial<UnsubscribeFooterConfig> | null,
        ),
        sourceAccountKey: key,
        inherited: key !== accountKey,
      };
    }
  }
  return {
    config: resolveFooterConfig(null),
    sourceAccountKey: null,
    inherited: false,
  };
}

/**
 * The account itself followed by its ancestors, nearest first.
 *
 * Walks one row at a time rather than a recursive CTE: chains are two or
 * three deep in practice (group → rooftop), so the query count is trivial
 * and the code stays readable.
 */
async function ancestorChain(accountKey: string): Promise<string[]> {
  const chain: string[] = [accountKey];
  const seen = new Set([accountKey]);
  let current = accountKey;

  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const row = await prisma.account.findUnique({
      where: { key: current },
      select: { parentAccountKey: true },
    });
    const parent = row?.parentAccountKey;
    // Stop on no parent, or on a cycle — a self-referencing or looped row
    // would otherwise spin until the depth cap for every send.
    if (!parent || seen.has(parent)) break;
    chain.push(parent);
    seen.add(parent);
    current = parent;
  }

  return chain;
}

/** Resolve one account's footer, following the parent chain. */
export async function resolveAccountFooter(
  accountKey: string,
): Promise<ResolvedFooter> {
  const chain = await ancestorChain(accountKey);
  const rows = await prisma.accountEmailFooter.findMany({
    where: { accountKey: { in: chain } },
    select: { accountKey: true, config: true },
  });
  return resolveFrom(
    accountKey,
    chain,
    new Map(rows.map((r) => [r.accountKey, r])),
  );
}

/**
 * Resolve several accounts at once, for a blast that spans rooftops.
 *
 * Collects every chain first, then fetches all overrides in one query —
 * the per-recipient send loop must not be issuing footer lookups.
 */
export async function resolveAccountFooters(
  accountKeys: string[],
): Promise<Map<string, ResolvedFooter>> {
  const unique = [...new Set(accountKeys.filter(Boolean))];
  const out = new Map<string, ResolvedFooter>();
  if (unique.length === 0) return out;

  const chains = new Map<string, string[]>();
  for (const key of unique) {
    chains.set(key, await ancestorChain(key));
  }

  const allKeys = [...new Set([...chains.values()].flat())];
  const rows = await prisma.accountEmailFooter.findMany({
    where: { accountKey: { in: allKeys } },
    select: { accountKey: true, config: true },
  });
  const rowsByKey = new Map(rows.map((r) => [r.accountKey, r]));

  for (const key of unique) {
    out.set(key, resolveFrom(key, chains.get(key) ?? [key], rowsByKey));
  }
  return out;
}

/** Save (or replace) this account's override. */
export async function saveAccountFooter(
  accountKey: string,
  config: Partial<UnsubscribeFooterConfig>,
): Promise<void> {
  // Store the validated shape, not the raw payload: a rejected value should
  // be rejected once, at write time, rather than every time we render.
  // Spread into a plain object so it satisfies Prisma's InputJsonValue,
  // which wants an index signature our named interface doesn't carry.
  const validated = { ...resolveFooterConfig(config) };
  await prisma.accountEmailFooter.upsert({
    where: { accountKey },
    create: { accountKey, config: validated },
    update: { config: validated },
  });
}

/**
 * Drop this account's override so it inherits again.
 *
 * Deliberately not "reset to default": on a rooftop under a group, the
 * expected outcome of clearing a customization is the group's footer, not
 * Loomi's built-in one.
 */
export async function clearAccountFooter(accountKey: string): Promise<void> {
  await prisma.accountEmailFooter.deleteMany({ where: { accountKey } });
}
