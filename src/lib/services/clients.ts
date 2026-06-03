/**
 * "Clients" projection over the canonical `Account` model.
 *
 * The Clients admin page (/clients) used to read and write a standalone
 * data/rooftops.json file — a parallel store that was lost on every deploy
 * and duplicated the real Account table (the schema even comments
 * "Accounts (formerly rooftops.json)"). These helpers project an Account row
 * down to just the fields that page needs, so it never sees sensitive Account
 * columns (encrypted SendGrid/Twilio keys, sending identity, etc.).
 */

export interface ClientLogos {
  light: string;
  dark: string;
  white?: string;
  black?: string;
}

export interface ClientEntry {
  dealer: string;
  category: string | null;
  logos: ClientLogos;
}

/** Parse an `Account.logos` JSON string into the {light,dark,...} shape. */
export function parseLogos(raw: string | null | undefined): ClientLogos {
  if (!raw) return { light: '', dark: '' };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { light: '', dark: '', ...(parsed as Record<string, string>) };
    }
  } catch {
    // fall through to default
  }
  return { light: '', dark: '' };
}

/** Project a full Account row down to the client-list shape. */
export function accountToClientEntry(account: {
  dealer: string;
  category: string | null;
  logos: string | null;
}): ClientEntry {
  return {
    dealer: account.dealer,
    category: account.category ?? null,
    logos: parseLogos(account.logos),
  };
}
