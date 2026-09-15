// Mergetag substitution for the "Download PNG" paths.
//
// WHY THIS EXISTS
// ───────────────
// The editor and /preview compile a template and then swap
// {{location.name}}, {{custom_values.sales_phone}}, {{contact.first_name}}
// … for real values, so what the user is looking at reads like a finished
// email. The two download routes (a campaign's PNG, a library template's
// PNG) skipped that step entirely — they screenshotted the stored HTML — so
// every mergetag came out of Chromium as literal `{{…}}` text. The download
// is the artifact people forward to a client, which is the worst place for
// the raw token to survive.
//
// The substitution deliberately reuses the two modules that already own this
// problem rather than adding a third spelling of the namespace:
//   • buildPreviewVariableMap() decides WHAT a token resolves to (same map
//     the on-screen preview uses, so the PNG and the preview agree).
//   • applyBlastMergetags() decides HOW it is substituted (same engine the
//     sender uses: tolerant of inner whitespace, HTML-escapes the value, and
//     leaves an UNKNOWN token intact so a typo stays visible instead of
//     silently vanishing from the download).

import { prisma } from '@/lib/prisma';
import {
  buildPreviewVariableMap,
  type PreviewAccountData,
  type PreviewContact,
} from '@/lib/preview-variables';
import {
  applyBlastMergetags,
  type BlastMergetagContext,
} from '@/lib/sending/blast-mergetags';

/** Depth cap on the parent walk — a malformed chain must not spin. */
const MAX_ANCESTOR_DEPTH = 10;

const PREVIEW_ACCOUNT_SELECT = {
  dealer: true,
  email: true,
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

function parseJsonObject<T>(raw: string | null): T | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function str(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

type Logos = { light?: string; dark?: string; white?: string; black?: string };
type Branding = NonNullable<PreviewAccountData['branding']>;

/** Fill only the gaps `own` left empty — the child's own value always wins. */
function inheritGaps<T extends Record<string, string | undefined>>(
  own: T | undefined,
  inherited: T | null,
): T | undefined {
  if (!inherited) return own;
  const merged = { ...(own ?? {}) } as T;
  for (const [field, value] of Object.entries(inherited)) {
    if (typeof value === 'string' && value && !merged[field]) {
      (merged as Record<string, string>)[field] = value;
    }
  }
  return merged;
}

function inheritBranding(own: Branding | undefined, inherited: Branding | null): Branding | undefined {
  if (!inherited) return own;
  const colors = inheritGaps(own?.colors, inherited.colors ?? null);
  const fonts = inheritGaps(own?.fonts, inherited.fonts ?? null);
  const merged: Branding = {};
  if (colors && Object.keys(colors).length) merged.colors = colors;
  if (fonts && Object.keys(fonts).length) merged.fonts = fonts;
  return Object.keys(merged).length ? merged : undefined;
}

/**
 * Load one account in the shape buildPreviewVariableMap() wants.
 *
 * Logos and branding walk the parent chain the same way /api/accounts does
 * (nearest ancestor wins, the account's own value beats all of them), so a
 * rooftop that leans on its group's brand kit downloads with the group's
 * logo and colors rather than blanks. Everything else — address, phones,
 * custom values — is the account's own and is never inherited.
 */
export async function loadPreviewAccountData(
  accountKey: string,
): Promise<PreviewAccountData | null> {
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: PREVIEW_ACCOUNT_SELECT,
  });
  if (!account) return null;

  let logos = parseJsonObject<Logos>(account.logos) ?? undefined;
  let branding = parseJsonObject<Branding>(account.branding) ?? undefined;

  const seen = new Set<string>([accountKey]);
  let parentKey = account.parentAccountKey;
  for (let depth = 0; parentKey && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    if (seen.has(parentKey)) break;
    seen.add(parentKey);
    const ancestor = await prisma.account.findUnique({
      where: { key: parentKey },
      select: { logos: true, branding: true, parentAccountKey: true },
    });
    if (!ancestor) break;
    logos = inheritGaps(logos, parseJsonObject<Logos>(ancestor.logos));
    branding = inheritBranding(branding, parseJsonObject<Branding>(ancestor.branding));
    parentKey = ancestor.parentAccountKey;
  }

  return {
    dealer: str(account.dealer),
    email: str(account.email),
    phone: str(account.phone),
    salesPhone: str(account.salesPhone),
    servicePhone: str(account.servicePhone),
    partsPhone: str(account.partsPhone),
    address: str(account.address),
    city: str(account.city),
    state: str(account.state),
    postalCode: str(account.postalCode),
    website: str(account.website),
    timezone: str(account.timezone),
    logos,
    branding,
    customValues:
      parseJsonObject<Record<string, { name: string; value: string }>>(
        account.customValues,
      ) ?? undefined,
  };
}

/**
 * Turn the brace-keyed preview map into the bare-keyed context
 * applyBlastMergetags() expects: `{{location.name}}` → `location.name`.
 */
export function toMergetagContext(
  previewValues: Record<string, string>,
): BlastMergetagContext {
  const ctx: BlastMergetagContext = {};
  for (const [token, value] of Object.entries(previewValues)) {
    const key = token.replace(/^\{+\s*|\s*\}+$/g, '').trim();
    if (key) ctx[key] = value;
  }
  return ctx;
}

/**
 * Substitute every mergetag in `html` with this account's REAL data.
 *
 * Sample fallbacks are deliberately off. The editor fills a gap with a
 * plausible stand-in so the layout can be judged, but a PNG leaves the
 * building — nobody downstream can tell an invented "(801) 555-0100" from
 * the dealership's actual number. A recognized token with nothing behind it
 * therefore renders as nothing, which is also what a recipient whose own
 * field is blank gets at send time. That extends to contact tokens: a
 * download is addressed to no one, so `Hi {{contact.first_name}},` comes out
 * as `Hi ,` rather than naming a person who does not exist.
 */
export function resolvePreviewTokens(
  html: string,
  accountData?: PreviewAccountData | null,
  contact?: PreviewContact | null,
): string {
  if (!html) return '';
  const ctx = toMergetagContext(
    buildPreviewVariableMap(accountData, contact, { sampleFallbacks: false }),
  );
  return applyBlastMergetags(html, ctx, { escape: true });
}
