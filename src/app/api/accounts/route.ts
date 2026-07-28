import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/api-auth';
import { ELEVATED_ROLES } from '@/lib/auth';
import { normalizeOems } from '@/lib/oems';
import * as accountService from '@/lib/services/accounts';
import { normalizeAccountInputAliases } from '@/lib/account-field-aliases';
import { normalizeAccountOutputPayload } from '@/lib/account-output';
import { getIndustryDefaults } from '@/data/industry-defaults';
import { hasUnrestrictedAccountAccess } from '@/lib/roles';

/** Parse an org's logos JSON string into a {light,dark,white,black} map. */
function parseLogos(raw: string | null | undefined): Record<string, string> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, string>) : null;
  } catch {
    return null;
  }
}

type OrgBranding = { colors?: Record<string, string>; fonts?: Record<string, string> };

/** Parse a branding JSON string into { colors, fonts }. Accepts an already-
 *  parsed object (the accounts payload is normalized before we merge). */
function parseBranding(raw: string | null | undefined | OrgBranding): OrgBranding | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as OrgBranding;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as OrgBranding) : null;
  } catch {
    return null;
  }
}

/** Merge a child's branding over the org's, per sub-field (child wins). */
function mergeBranding(org: OrgBranding, own: OrgBranding | undefined): OrgBranding {
  const pick = (a?: Record<string, string>, b?: Record<string, string>) => {
    const out: Record<string, string> = { ...(b ?? {}) };
    for (const [k, v] of Object.entries(a ?? {})) {
      if (!out[k]) out[k] = v; // org fills only the gaps the child left empty
    }
    return out;
  };
  const colors = pick(org.colors, own?.colors);
  const fonts = pick(org.fonts, own?.fonts);
  const result: OrgBranding = {};
  if (Object.keys(colors).length) result.colors = colors;
  if (Object.keys(fonts).length) result.fonts = fonts;
  return result;
}

export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;

  try {
    const userRole = session!.user.role;
    const userAccountKeys = session!.user.accountKeys ?? [];
    const accounts = hasUnrestrictedAccountAccess(userRole, userAccountKeys)
      ? await accountService.getAccounts()
      : userAccountKeys.length > 0
        ? await accountService.getAccounts(userAccountKeys)
        : [];

    // Org brand-kit inheritance: a sub-account inherits its organization's
    // logos + branding (colors/fonts) per-field — its own value wins, the org
    // fills any gap. We expose the resolved set as `logos`/`branding` (so every
    // display consumer inherits for free) and the account's raw values as
    // `ownLogos`/`ownBranding` (so edit forms don't persist inherited values).
    // Inheritance follows the ACCOUNT HIERARCHY (parentAccountKey), not the
    // retired Organization layer: a rooftop inherits from its group account,
    // which may itself inherit from a parent. We walk the whole chain rather
    // than one level, so a three-tier setup fills gaps from the nearest
    // ancestor that defines a value.
    const byKey = new Map(accounts.map((a) => [a.key, a]));
    const ancestorsOf = (startKey: string): typeof accounts => {
      const chain: typeof accounts = [];
      const seen = new Set<string>([startKey]);
      let cursor = byKey.get(startKey)?.parentAccountKey ?? null;
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor); // guards a malformed parent cycle
        const next = byKey.get(cursor);
        if (!next) break; // parent not visible to this user
        chain.push(next);
        cursor = next.parentAccountKey ?? null;
      }
      return chain;
    };

    // Return as key-indexed account map: { [accountKey]: accountData }
    const result: Record<string, Record<string, unknown>> = {};
    for (const account of accounts) {
      const { key, ...rest } = account;
      const data: Record<string, unknown> = { ...rest };
      delete data.createdAt;
      delete data.updatedAt;
      // Never ship the encrypted GoHighLevel token; expose only its presence.
      data.ghlConfigured = Boolean(data.ghlApiKey);
      delete data.ghlApiKey;
      normalizeAccountOutputPayload(data);
      // After normalize, data.logos / data.branding are the account's own parsed
      // objects. Keep the raw own values, then resolve against the parent org.
      data.ownLogos = data.logos ?? null;
      data.ownBranding = data.branding ?? null;

      // Nearest ancestor wins over more distant ones; the account's own value
      // always wins over all of them.
      for (const ancestor of ancestorsOf(key)) {
        const inheritedLogos = parseLogos(ancestor.logos);
        if (inheritedLogos) {
          const own = (data.logos as Record<string, string> | undefined) ?? {};
          data.logos = {
            light: own.light || inheritedLogos.light || '',
            dark: own.dark || inheritedLogos.dark || '',
            ...((own.white || inheritedLogos.white) ? { white: own.white || inheritedLogos.white } : {}),
            ...((own.black || inheritedLogos.black) ? { black: own.black || inheritedLogos.black } : {}),
          };
        }
        const inheritedBranding = parseBranding(ancestor.branding);
        if (inheritedBranding) {
          data.branding = mergeBranding(inheritedBranding, data.branding as OrgBranding | undefined);
        }
      }
      result[key] = data;
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error('[api/accounts] GET failed:', err);
    return NextResponse.json({ error: 'Could not read accounts' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { error } = await requireRole(...ELEVATED_ROLES);
  if (error) return error;
  try {
    const payload = await req.json() as Record<string, unknown>;
    normalizeAccountInputAliases(payload);
    const {
      key,
      dealer,
      category,
      oem,
      oems,
      email,
      phone,
      salesPhone,
      servicePhone,
      partsPhone,
      address,
      city,
      state,
      postalCode,
      website,
      timezone,
      accountRepId,
    } = payload as {
      key?: string;
      dealer?: string;
      category?: string;
      oem?: string;
      oems?: unknown;
      email?: string;
      phone?: string;
      salesPhone?: string;
      servicePhone?: string;
      partsPhone?: string;
      address?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      website?: string;
      timezone?: string;
      accountRepId?: string;
    };
    if (!key || !dealer) {
      return NextResponse.json({ error: 'Missing key and dealer' }, { status: 400 });
    }
    const safeKey = key.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeKey) {
      return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
    }
    if (safeKey.startsWith('_')) {
      return NextResponse.json({ error: 'Account key cannot start with "_"' }, { status: 400 });
    }

    const existing = await accountService.getAccount(safeKey);
    if (existing) {
      return NextResponse.json({ error: 'Account key already exists' }, { status: 409 });
    }

    const normalizedOems = normalizeOems(oems, oem);

    const accountData: Parameters<typeof accountService.createAccount>[0] = {
      key: safeKey,
      dealer: dealer.trim(),
      category: category || 'General',
      logos: JSON.stringify({ light: '', dark: '' }),
    };

    if (normalizedOems.length > 0) {
      accountData.oems = JSON.stringify(normalizedOems);
      accountData.oem = normalizedOems[0];
    }

    if (email) accountData.email = email;
    if (phone) accountData.phone = phone;
    if (salesPhone) accountData.salesPhone = salesPhone;
    if (servicePhone) accountData.servicePhone = servicePhone;
    if (partsPhone) accountData.partsPhone = partsPhone;
    if (address) accountData.address = address;
    if (city) accountData.city = city;
    if (state) accountData.state = state;
    if (postalCode) accountData.postalCode = postalCode;
    if (website) accountData.website = website;
    if (timezone) accountData.timezone = timezone;
    if (accountRepId) accountData.accountRepId = accountRepId;

    // Auto-populate custom values from industry template when category matches
    if (!accountData.customValues && accountData.category) {
      const industryDefaults = getIndustryDefaults(accountData.category);
      if (industryDefaults) {
        accountData.customValues = JSON.stringify(industryDefaults);
      }
    }

    const account = await accountService.createAccount(accountData);
    return NextResponse.json({ key: account.key, dealer: account.dealer });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireRole(...ELEVATED_ROLES);
  if (error) return error;
  try {
    const key = req.nextUrl.searchParams.get('key');
    if (!key) {
      return NextResponse.json({ error: 'Missing key' }, { status: 400 });
    }

    const existing = await accountService.getAccount(key);
    if (!existing) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    await accountService.deleteAccount(key);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
