import { parseCustomValues } from '@/lib/accounts/custom-values';
import { normalizeMergeKey } from '@/lib/sending/account-merge-values';

/**
 * Where a drafted email's buttons go.
 *
 * The copywriter picks each button's PURPOSE from a fixed list; code looks the
 * link up in the account's custom values (Account settings → Custom Values).
 * The model never writes a URL. A purpose with no link on file, or whose link
 * is dead, goes to the dealer's homepage, and the draft says so.
 */

export const CTA_PURPOSES = {
  new_inventory: { label: 'New inventory', keys: ['new_inventory_url', 'inventory_url'] },
  used_inventory: { label: 'Used inventory', keys: ['used_inventory_url'] },
  specials: { label: 'Specials', keys: ['specials_url', 'promotions_url'] },
  service_scheduler: { label: 'Schedule service', keys: ['service_scheduler_url'] },
  service_specials: { label: 'Service specials', keys: ['service_specials_url'] },
  trade_in: { label: 'Value your trade', keys: ['trade_in_url'] },
  finance: { label: 'Apply for financing', keys: ['finance_url'] },
  contact: { label: 'Contact', keys: ['contact_url'] },
  homepage: { label: 'Homepage', keys: [] as string[] },
} as const;
export type CtaPurpose = keyof typeof CTA_PURPOSES;
export const CTA_PURPOSE_KEYS = Object.keys(CTA_PURPOSES) as CtaPurpose[];

export function isCtaPurpose(v: string): v is CtaPurpose {
  return (CTA_PURPOSE_KEYS as string[]).includes(v);
}

function httpUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The account's link for each purpose that has one, from its custom values. */
export function accountLinks(customValues: unknown): Partial<Record<CtaPurpose, { url: string; key: string }>> {
  const values = parseCustomValues(customValues);
  const byNorm = new Map(Object.entries(values).map(([k, d]) => [normalizeMergeKey(k), { key: k, value: d.value }]));
  const out: Partial<Record<CtaPurpose, { url: string; key: string }>> = {};
  for (const purpose of CTA_PURPOSE_KEYS) {
    for (const key of CTA_PURPOSES[purpose].keys) {
      const hit = byNorm.get(normalizeMergeKey(key));
      const url = hit ? httpUrl(hit.value) : null;
      if (hit && url) {
        out[purpose] = { url, key: hit.key };
        break;
      }
    }
  }
  return out;
}

export type LinkCheck = 'ok' | 'dead' | 'homepage' | 'unconfirmed';

/**
 * Did `url` load, and land where it pointed? A link that redirects to the
 * homepage is a page that moved. 401/403/405/429 are bot protection as often as
 * anything, so they're "unconfirmed" — kept, with a note — rather than dead.
 */
export function classifyResponse(requested: string, status: number, finalUrl: string): LinkCheck {
  if (status === 401 || status === 403 || status === 405 || status === 429) return 'unconfirmed';
  if (status >= 400) return 'dead';
  try {
    const from = new URL(requested);
    const to = new URL(finalUrl);
    if (from.pathname.replace(/\/+$/, '') !== '' && to.pathname.replace(/\/+$/, '') === '' && !to.search) return 'homepage';
  } catch {
    // An unparseable final URL tells us nothing more.
  }
  return 'ok';
}

const CHECK_TIMEOUT_MS = 8000;

export async function checkLink(url: string): Promise<LinkCheck> {
  try {
    // GET, not HEAD: dealer platforms answer HEAD with 405 or 404 more often than not.
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LoomiLinkCheck/1.0)', Accept: 'text/html' },
    });
    res.body?.cancel().catch(() => {});
    return classifyResponse(url, res.status, res.url || url);
  } catch {
    return 'unconfirmed';
  }
}

export interface ResolvedCta {
  url: string;
  /** A note for the proofer, when the link isn't the account's own for this purpose. */
  note: string | null;
}

/**
 * The link for each button, in order: the account's link for its purpose when
 * it has one that works, else the homepage. `check` is injected so this stays
 * testable without the network.
 */
export async function resolveCtas(
  ctas: { label: string; purpose: string }[],
  links: Partial<Record<CtaPurpose, { url: string; key: string }>>,
  homepage: string,
  check: (url: string) => Promise<LinkCheck> = checkLink,
): Promise<ResolvedCta[]> {
  const checked = new Map<string, Promise<LinkCheck>>();
  const once = (url: string) => {
    if (!checked.has(url)) checked.set(url, check(url));
    return checked.get(url)!;
  };
  return Promise.all(
    ctas.map(async (cta): Promise<ResolvedCta> => {
      const purpose = isCtaPurpose(cta.purpose) ? cta.purpose : 'homepage';
      if (purpose === 'homepage') return { url: homepage, note: null };
      const tag = `{{custom_values.${CTA_PURPOSES[purpose].keys[0]}}}`;
      const link = links[purpose];
      if (!link) {
        return { url: homepage, note: `"${cta.label}" goes to the homepage: the account has no ${tag} for ${CTA_PURPOSES[purpose].label.toLowerCase()}.` };
      }
      const result = await once(link.url);
      if (result === 'dead' || result === 'homepage') {
        const why = result === 'dead' ? "doesn't load" : 'redirects to the homepage';
        return { url: homepage, note: `"${cta.label}" goes to the homepage: the account's ${link.key} (${link.url}) ${why}.` };
      }
      return {
        url: link.url,
        note: result === 'unconfirmed' ? `"${cta.label}" links to ${link.url}, which Loomi couldn't confirm loads. Check it before sending.` : null,
      };
    }),
  );
}
