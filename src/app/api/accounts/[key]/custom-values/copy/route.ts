import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/permissions/require';
import { copyCustomValues, parseCustomValues } from '@/lib/accounts/custom-values';
import * as accountService from '@/lib/services/accounts';

/**
 * POST /api/accounts/[key]/custom-values/copy — copy a group's custom values
 * to accounts beneath it.
 *
 * Body: { keys: string[], targets: string[], overwrite?: boolean, withValues?: boolean }
 *
 * Copies the group's SAVED values: an unsaved edit on the page isn't what
 * lands on twenty stores. Every target must sit beneath the group, and each
 * one is read and written in its own transaction, so a value someone saved on
 * a store a moment ago isn't lost to a stale read.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { error, session } = await requirePermission('agency.subaccounts.edit');
  if (error) return error;
  const { key } = await params;

  const body = (await req.json().catch(() => null)) as {
    keys?: unknown;
    targets?: unknown;
    overwrite?: unknown;
    withValues?: unknown;
  } | null;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);
  const keys = strings(body?.keys);
  const targets = [...new Set(strings(body?.targets))].filter((t) => t !== key);
  if (keys.length === 0 || targets.length === 0) {
    return NextResponse.json({ error: 'Choose at least one value and one account.' }, { status: 400 });
  }

  // Same rule as editing an account: an admin may only touch assigned accounts.
  const user = session!.user;
  if (user.role === 'admin' && ![key, ...targets].every((k) => user.accountKeys.includes(k))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const source = await prisma.account.findUnique({ where: { key }, select: { customValues: true } });
  if (!source) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  const sourceValues = parseCustomValues(source.customValues);

  for (const target of targets) {
    const ancestors = await accountService.getAncestorAccountKeys(target);
    if (!ancestors.includes(key)) {
      return NextResponse.json({ error: `"${target}" isn't one of this group's accounts.` }, { status: 400 });
    }
  }

  const opts = { overwrite: body?.overwrite === true, withValues: body?.withValues !== false };
  const results: { key: string; added: number; replaced: number; kept: number }[] = [];
  for (const target of targets) {
    const result = await prisma.$transaction(async (tx) => {
      const row = await tx.account.findUnique({ where: { key: target }, select: { customValues: true } });
      if (!row) return null;
      const copied = copyCustomValues(parseCustomValues(row.customValues), sourceValues, keys, opts);
      if (copied.added.length || copied.replaced.length) {
        await tx.account.update({ where: { key: target }, data: { customValues: JSON.stringify(copied.next) } });
      }
      return copied;
    });
    if (result) {
      results.push({ key: target, added: result.added.length, replaced: result.replaced.length, kept: result.kept.length });
    }
  }
  return NextResponse.json({ results });
}
