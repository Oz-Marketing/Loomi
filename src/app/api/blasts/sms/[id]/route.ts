import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import {
  deleteSmsBlast,
  getSmsBlast,
  updateSmsBlastDraft,
} from '@/lib/services/sms-blasts';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** GET /api/blasts/sms/[id] — fetch a single SMS campaign (incl. drafts). */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin', 'client');
  if (error) return error;

  const { id } = await params;
  const campaign = await getSmsBlast(id);
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  if (session!.user.role === 'client') {
    const allowed = new Set(session!.user.accountKeys ?? []);
    const visible = campaign.accountKeys.some((key) => allowed.has(key));
    if (!visible) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }
  }

  return NextResponse.json({ campaign });
}

/** PATCH /api/blasts/sms/[id] — merge-update a draft. */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await params;
  const existing = await getSmsBlast(id);
  if (!existing) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  const userRole = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];
  if (userRole === 'admin' && userAccountKeys.length > 0) {
    const allowed = new Set(userAccountKeys);
    const inScope =
      existing.accountKeys.length === 0 ||
      existing.accountKeys.some((key) => allowed.has(key));
    if (!inScope) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const body = await req.json().catch(() => ({}));
  const patch: Parameters<typeof updateSmsBlastDraft>[1] = {};

  if (typeof body?.name === 'string') patch.name = body.name;
  if (typeof body?.message === 'string') patch.message = body.message;
  if (typeof body?.sourceAudienceId === 'string' || body?.sourceAudienceId === null) {
    patch.sourceAudienceId = body.sourceAudienceId || null;
  }
  if (typeof body?.sourceFilter === 'string' || body?.sourceFilter === null) {
    patch.sourceFilter = body.sourceFilter || null;
  }
  if (typeof body?.sourceListId === 'string' || body?.sourceListId === null) {
    patch.sourceListId = body.sourceListId || null;
  }
  if (typeof body?.sourceContactIds === 'string' || body?.sourceContactIds === null) {
    patch.sourceContactIds = body.sourceContactIds || null;
  }
  if (typeof body?.metadata === 'string' || body?.metadata === null) {
    patch.metadata = body.metadata || null;
  }
  if (Array.isArray(body?.accountKeys)) {
    patch.accountKeys = (body.accountKeys as unknown[]).filter(
      (k): k is string => typeof k === 'string' && k.length > 0,
    );
    if (userRole === 'admin' && userAccountKeys.length > 0) {
      const allowed = new Set(userAccountKeys);
      const disallowed = patch.accountKeys.find((k) => !allowed.has(k));
      if (disallowed) {
        return NextResponse.json({ error: 'Forbidden account selection' }, { status: 403 });
      }
    }
  }

  try {
    const updated = await updateSmsBlastDraft(id, patch);
    return NextResponse.json({ campaign: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update campaign';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/blasts/sms/[id] — hard-delete a Loomi SMS campaign. */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await params;
  const existing = await getSmsBlast(id);
  if (!existing) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  const userRole = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];
  if (userRole === 'admin' && userAccountKeys.length > 0) {
    const allowed = new Set(userAccountKeys);
    const inScope =
      existing.accountKeys.length === 0 ||
      existing.accountKeys.some((key) => allowed.has(key));
    if (!inScope) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  try {
    await deleteSmsBlast(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete campaign';
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
