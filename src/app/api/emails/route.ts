import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import * as accountEmailService from '@/lib/services/account-emails';
import type { EmailStatusFilter } from '@/lib/services/account-emails';
import { hasUnrestrictedAccountAccess } from '@/lib/roles';

const ALLOWED_EMAIL_STATUS_FILTERS = new Set<EmailStatusFilter>([
  'all',
  'draft',
  'published',
  'archived',
]);
function parseEmailStatusFilter(value: string | null): EmailStatusFilter | undefined {
  if (!value) return undefined;
  return ALLOWED_EMAIL_STATUS_FILTERS.has(value as EmailStatusFilter)
    ? (value as EmailStatusFilter)
    : undefined;
}

export async function GET(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const accountKey = req.nextUrl.searchParams.get('accountKey');
  // ?status=all|draft|published|archived is the preferred filter.
  // Legacy ?includeArchived=1 still works for any caller that hasn't
  // migrated. Default (neither set) hides archived rows.
  const statusFilter = parseEmailStatusFilter(req.nextUrl.searchParams.get('status'));
  const includeArchived =
    req.nextUrl.searchParams.get('includeArchived') === '1' ||
    req.nextUrl.searchParams.get('includeArchived') === 'true';
  const userRole = session!.user.role;
  const userAccountKeys = session!.user.accountKeys ?? [];
  const unrestricted = hasUnrestrictedAccountAccess(userRole, userAccountKeys);
  const listOptions = { statusFilter, includeArchived };

  if (accountKey) {
    if (!unrestricted && !userAccountKeys.includes(accountKey)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const emails = await accountEmailService.getAccountEmails(accountKey, listOptions);
    return NextResponse.json(emails);
  }

  const emails = unrestricted
    ? await accountEmailService.getAllEmails(listOptions)
    : userAccountKeys.length > 0
      ? await accountEmailService.getEmailsForAccounts(userAccountKeys, listOptions)
      : [];
  return NextResponse.json(emails);
}

export async function POST(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const { name, templateId, accountKey } = await req.json();
    const targetAccountKey = String(accountKey || '').trim();

    if (!name || !targetAccountKey) {
      return NextResponse.json({ error: 'Missing name and accountKey' }, { status: 400 });
    }

    if (!templateId) {
      return NextResponse.json({ error: 'Missing templateId' }, { status: 400 });
    }

    const email = await accountEmailService.createAccountEmail({
      accountKey: targetAccountKey,
      templateId,
      name,
    });

    return NextResponse.json(email);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    const email = await accountEmailService.updateAccountEmail(id, updates);
    return NextResponse.json(email);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    await accountEmailService.deleteAccountEmail(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
