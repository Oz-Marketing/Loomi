import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/api-auth';
import { ELEVATED_ROLES } from '@/lib/auth';
import { normalizeOems } from '@/lib/oems';
import * as accountService from '@/lib/services/accounts';
import { normalizeAccountInputAliases } from '@/lib/account-field-aliases';
import { normalizeAccountOutputPayload } from '@/lib/account-output';
import { getIndustryDefaults } from '@/data/industry-defaults';
import { hasUnrestrictedAccountAccess } from '@/lib/roles';

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
      result[key] = data;
    }
    return NextResponse.json(result);
  } catch {
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
