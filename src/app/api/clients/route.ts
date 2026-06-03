import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/api-auth';
import { ELEVATED_ROLES } from '@/lib/auth';
import { hasUnrestrictedAccountAccess } from '@/lib/roles';
import * as accountService from '@/lib/services/accounts';
import { accountToClientEntry, type ClientEntry } from '@/lib/services/clients';
import { getIndustryDefaults } from '@/data/industry-defaults';

// Backed by the canonical `Account` Postgres model. This route used to read
// and write data/rooftops.json on the release filesystem — a duplicate store
// that was silently wiped on every deploy. It is kept as a thin compatibility
// layer so the Clients admin page keeps its existing { [key]: {...} } contract.

/** GET → key-indexed map of the accounts the caller may see. */
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

    const result: Record<string, ClientEntry> = {};
    for (const account of accounts) {
      result[account.key] = accountToClientEntry(account);
    }
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'Could not read clients' }, { status: 500 });
  }
}

/** POST → create a new account. Mirrors POST /api/accounts. */
export async function POST(req: NextRequest) {
  const { error } = await requireRole(...ELEVATED_ROLES);
  if (error) return error;

  try {
    const { key, dealer, category } = await req.json();
    if (!key || !dealer) {
      return NextResponse.json({ error: 'Missing key and dealer' }, { status: 400 });
    }
    const safeKey = String(key).trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeKey) {
      return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
    }
    if (safeKey.startsWith('_')) {
      return NextResponse.json({ error: 'Client key cannot start with "_"' }, { status: 400 });
    }

    const existing = await accountService.getAccount(safeKey);
    if (existing) {
      return NextResponse.json({ error: 'Client key already exists' }, { status: 409 });
    }

    const resolvedCategory = (category && String(category)) || 'General';
    const data: Parameters<typeof accountService.createAccount>[0] = {
      key: safeKey,
      dealer: String(dealer).trim(),
      category: resolvedCategory,
      logos: JSON.stringify({ light: '', dark: '' }),
    };
    const industryDefaults = getIndustryDefaults(resolvedCategory);
    if (industryDefaults) {
      data.customValues = JSON.stringify(industryDefaults);
    }

    const account = await accountService.createAccount(data);
    return NextResponse.json({ key: account.key, ...accountToClientEntry(account) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * PUT → bulk-save dealer/category edits from the Clients page.
 *
 * Body: { [key]: { dealer, category, logos } }. Only dealer and category are
 * persisted here; logos are owned by POST /api/accounts/[key]/logos. Unknown
 * keys are skipped (no implicit creation).
 */
export async function PUT(req: NextRequest) {
  const { error } = await requireRole(...ELEVATED_ROLES);
  if (error) return error;

  try {
    const body = (await req.json()) as Record<string, { dealer?: string; category?: string }>;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Expected an object of clients' }, { status: 400 });
    }

    const keys = Object.keys(body);
    const existing = new Set(
      (await Promise.all(keys.map((k) => accountService.getAccount(k))))
        .filter((a): a is NonNullable<typeof a> => Boolean(a))
        .map((a) => a.key),
    );

    await Promise.all(
      keys
        .filter((k) => existing.has(k))
        .map((k) => {
          const entry = body[k] ?? {};
          const patch: { dealer?: string; category?: string } = {};
          if (typeof entry.dealer === 'string') patch.dealer = entry.dealer.trim();
          if (typeof entry.category === 'string') patch.category = entry.category;
          if (Object.keys(patch).length === 0) return Promise.resolve();
          return accountService.updateAccount(k, patch);
        }),
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** DELETE → remove an account. Mirrors DELETE /api/accounts. */
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
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }
    await accountService.deleteAccount(key);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
