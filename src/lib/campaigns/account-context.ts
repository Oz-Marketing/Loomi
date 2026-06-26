/**
 * Server-side account → AI context.
 *
 * The template-editor assistant gets account branding from the client (the
 * browser already has `AccountData`). The campaign builder generates on the
 * server, so it fetches the Account row and maps it to the `AccountContextInput`
 * that `buildAccountContext` expects, then returns the built context string.
 *
 * The resulting string is snapshotted onto `Campaign.contextSnapshot` at plan
 * time so generation stays reproducible if account settings change mid-build.
 */
import { prisma } from '@/lib/prisma';
import { buildAccountContext, type AccountContextInput } from '@/lib/ai-knowledge';

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

type AccountRow = NonNullable<Awaited<ReturnType<typeof prisma.account.findUnique>>>;

/** Map a DB Account row to the AI `AccountContextInput` shape. */
export function accountRowToContextInput(account: AccountRow): AccountContextInput {
  const branding = parseJson<{
    colors?: Record<string, string | undefined>;
    fonts?: Record<string, string | undefined>;
  } | null>(account.branding, null);

  const logos = parseJson<Record<string, string | undefined> | null>(account.logos, null);

  // customValues is Record<key, { name, value }> — flatten to key → value.
  const customValuesRaw = parseJson<Record<string, { name?: string; value?: string }> | null>(
    account.customValues,
    null,
  );
  let customValues: Record<string, string> | null = null;
  if (customValuesRaw && typeof customValuesRaw === 'object') {
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(customValuesRaw)) {
      if (v && typeof v === 'object' && typeof v.value === 'string' && v.value) flat[k] = v.value;
    }
    if (Object.keys(flat).length > 0) customValues = flat;
  }

  return {
    name: account.dealer,
    branding: branding ? { colors: branding.colors, fonts: branding.fonts } : null,
    logos: logos ?? null,
    customValues,
    identity: {
      city: account.city,
      state: account.state,
      phone: account.phone,
      address: account.address,
      postalCode: account.postalCode,
      website: account.website,
    },
    business: {
      category: account.category,
      email: account.email,
      timezone: account.timezone,
      storefrontImage: null,
      salesPhone: account.salesPhone,
      servicePhone: account.servicePhone,
      partsPhone: account.partsPhone,
    },
  };
}

/**
 * Build the AI account-context string for an account key. Returns undefined if
 * the account doesn't exist.
 */
export async function buildAccountContextForKey(accountKey: string): Promise<string | undefined> {
  const account = await prisma.account.findUnique({ where: { key: accountKey } });
  if (!account) return undefined;
  return buildAccountContext(accountRowToContextInput(account));
}
