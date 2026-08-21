import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import {
  clearAccountFooter,
  resolveAccountFooter,
  saveAccountFooter,
} from '@/lib/sending/account-footer';
import { resolveFooterConfig } from '@/lib/sending/unsubscribe-footer';

interface RouteParams {
  params: Promise<{ key: string }>;
}

/**
 * Per-account email compliance footer styling.
 *
 * The footer's REQUIRED parts — dealer name, postal address, unsubscribe
 * link — are emitted by the renderer and are not in this payload. Only
 * presentation and two copy strings are, so no request here can produce a
 * non-compliant footer. See lib/sending/unsubscribe-footer.ts.
 */

/** Admins scoped to specific accounts can only touch those accounts. */
async function guard(key: string) {
  const { error, session } = await requirePermission('agency.subaccounts.edit');
  if (error) return { error };
  const userKeys = session!.user.accountKeys ?? [];
  if (session!.user.role === 'admin' && userKeys.length > 0 && !userKeys.includes(key)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { error: null };
}

/**
 * GET — the config this account renders with, plus where it came from so the
 * editor can say "inherited from Young Automotive Group" instead of
 * pretending the values are the account's own.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { key } = await params;
  const { error } = await guard(key);
  if (error) return error;

  const resolved = await resolveAccountFooter(key);
  return NextResponse.json({
    config: resolved.config,
    inherited: resolved.inherited,
    sourceAccountKey: resolved.sourceAccountKey,
  });
}

/** PUT — save an override for this account. */
export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { key } = await params;
  const { error } = await guard(key);
  if (error) return error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Expected a config object' }, { status: 400 });
  }

  // resolveFooterConfig discards anything invalid rather than rejecting the
  // request, so a stale client can't wedge the form. Echo back what was
  // actually stored so the UI shows the truth, not what it hoped to send.
  const stored = resolveFooterConfig(body as Record<string, unknown>);
  await saveAccountFooter(key, stored);

  return NextResponse.json({ ok: true, config: stored, inherited: false });
}

/**
 * DELETE — drop the override so this account inherits again.
 *
 * Returns the config that now applies, which on a rooftop under a group is
 * the group's footer, not the built-in default.
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { key } = await params;
  const { error } = await guard(key);
  if (error) return error;

  await clearAccountFooter(key);
  const resolved = await resolveAccountFooter(key);
  return NextResponse.json({
    ok: true,
    config: resolved.config,
    inherited: resolved.inherited,
    sourceAccountKey: resolved.sourceAccountKey,
  });
}
