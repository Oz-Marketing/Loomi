/**
 * Which Loomi account a monday request is for.
 *
 * monday's Client field is a label from the rep's intake board ("Young
 * Chrysler Jeep Dodge Ram in Morgan"), not a key, and its labels were typed
 * separately from Loomi's dealer names ("Young Chrysler Dodge Jeep Ram of
 * Morgan"). This SUGGESTS an account; a person confirms it when starting the
 * draft. A wrong suggestion would draft one store's email for another, so it
 * would rather say nothing than guess.
 *
 * Pure.
 */

/** Words that carry no identity: every store is "Young", and "of"/"in" vary at random. */
const STOPWORDS = new Set(['young', 'of', 'in', 'the', 'and', 'at']);

/** "Young Buick GMC (Layton)" → {buick, gmc, layton}; "Harley-Davidson" → {harley, davidson}. */
export function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((t) => t && !STOPWORDS.has(t)),
  );
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

export interface AccountOption {
  key: string;
  dealer: string;
  /** Owns other accounts. A group is never the store an email is for unless the label says so. */
  isGroup?: boolean;
}

export interface AccountSuggestion {
  accountKey: string | null;
  /** Why there's no suggestion, for the person choosing. */
  reason?: string;
}

/**
 * The account one monday Client label names, or null with the reason.
 *
 * One label at a time: a request can name several stores ("Young Powersports
 * Ogden, Young Powersports Euro"), and each is its own client with its own
 * templates, so each is matched on its own.
 *
 * A candidate's name and the label must CONTAIN one another — every word of the
 * shorter appears in the longer — so "Young Audi" finds "Audi Layton" but
 * "Young CDJR of Burley" can never land on Morgan just for sharing four of five
 * words. Among candidates the most shared words wins, and a tie is no answer:
 * "Young Mazda" is three stores, and "Young Harley Davidson" two.
 */
export function suggestAccount(client: string, accounts: AccountOption[]): AccountSuggestion {
  const label = nameTokens(client);
  if (label.size === 0) return { accountKey: null, reason: `"${client}" doesn't name a store.` };

  const scored = accounts
    .map((a) => {
      const name = nameTokens(a.dealer);
      if (name.size === 0 || !(isSubset(label, name) || isSubset(name, label))) return null;
      // "Young Powersports Bountiful/Centerville" contains "Young Powersports", the
      // group — but it names a store. Only "ALL", "Group" or the exact name mean the group.
      const meansGroup = label.has('all') || label.has('group') || (isSubset(label, name) && isSubset(name, label));
      if (a.isGroup && !meansGroup) return null;
      let shared = 0;
      for (const t of label) if (name.has(t)) shared++;
      return { key: a.key, shared };
    })
    .filter((s): s is { key: string; shared: number } => s !== null)
    .sort((x, y) => y.shared - x.shared);

  if (scored.length === 0) {
    return { accountKey: null, reason: `No Loomi account matches "${client}".` };
  }
  if (scored.length > 1 && scored[1].shared === scored[0].shared) {
    return { accountKey: null, reason: `"${client}" could be more than one account.` };
  }
  return { accountKey: scored[0].key };
}
