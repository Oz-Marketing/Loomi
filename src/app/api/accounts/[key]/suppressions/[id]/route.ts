import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { prisma } from '@/lib/prisma';
import {
  clearSendGridSuppression,
  resolveSendGridConfig,
} from '@/lib/sending/sendgrid';

interface RouteParams {
  params: Promise<{ key: string; id: string }>;
}


/**
 * DELETE /api/accounts/[key]/suppressions/[id]
 *
 * Remove a single suppression row. Useful for re-enabling sends after a
 * customer says "you should mail me, I never unsubscribed" — operations
 * trust call. We don't tombstone or audit-trail the removal here; if
 * that becomes a need, add a separate SuppressionEvent table.
 *
 * Also clears the address from SendGrid's own suppression list. Deleting
 * only our row used to leave SendGrid still dropping every message, so the
 * operator saw "sent" in the report while the customer got nothing. The
 * SendGrid call is best-effort: if it fails we still remove the local row
 * (the operator asked for that) and report `sendgridCleared: false` so the
 * UI can say the upstream list still needs a manual pass.
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { error, session } = await requirePermission('agency.subaccounts.edit');
  if (error) return error;

  const { key, id } = await params;
  const userKeys = session!.user.accountKeys ?? [];
  if (session!.user.role === 'admin' && userKeys.length > 0 && !userKeys.includes(key)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Read before delete: clearing the SendGrid side needs the email and
  // reason, and after deleteMany they're gone.
  const row = await prisma.emailSuppression.findFirst({
    where: { id, accountKey: key },
    select: { email: true, reason: true },
  });
  if (!row) {
    return NextResponse.json({ error: 'Suppression not found' }, { status: 404 });
  }

  // Scoped delete: the (accountKey, id) pair guards against an admin
  // assigned to one sub-account from blowing away rows in another by
  // guessing IDs.
  const result = await prisma.emailSuppression.deleteMany({
    where: { id, accountKey: key },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: 'Suppression not found' }, { status: 404 });
  }

  let sendgridCleared = false;
  let sendgridError: string | null = null;
  try {
    const config = await resolveSendGridConfig(key);
    if (!config) {
      // No key on this account: nothing upstream could have suppressed it.
      sendgridCleared = true;
    } else {
      const outcome = await clearSendGridSuppression({
        apiKey: config.apiKey,
        email: row.email,
        reason: row.reason,
      });
      sendgridCleared = outcome.errors.length === 0;
      if (!sendgridCleared) sendgridError = outcome.errors.join('; ');
    }
  } catch (err) {
    sendgridError = err instanceof Error ? err.message : 'Unknown error';
  }

  if (sendgridError) {
    console.error(
      `[suppressions] removed local row for ${row.email} (${key}) but SendGrid clear failed:`,
      sendgridError,
    );
  }

  return NextResponse.json({ ok: true, sendgridCleared, sendgridError });
}
