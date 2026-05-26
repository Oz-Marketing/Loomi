import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import {
  createTrigger,
  getFlow,
  listTriggers,
  type TriggerType,
} from '@/lib/services/loomi-flows';

const VALID_TRIGGER_TYPES: ReadonlySet<TriggerType> = new Set([
  'list',
  'audience',
  'manual',
  'event',
  'form_submission',
]);

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin', 'client');
  if (error) return error;

  const { id } = await context.params;
  const scope =
    session!.user.role === 'client' || session!.user.role === 'admin'
      ? (session!.user.accountKeys ?? [])
      : null;
  const existing = await getFlow(id, scope);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const triggers = await listTriggers(id);
  return NextResponse.json({ triggers });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await context.params;
  const scope =
    session!.user.role === 'client' || session!.user.role === 'admin'
      ? (session!.user.accountKeys ?? [])
      : null;
  const existing = await getFlow(id, scope);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const type = String(body?.type || '') as TriggerType;
  if (!VALID_TRIGGER_TYPES.has(type)) {
    return NextResponse.json(
      { error: `type must be one of: ${[...VALID_TRIGGER_TYPES].join(', ')}` },
      { status: 400 },
    );
  }
  if (type === 'event') {
    return NextResponse.json(
      { error: 'Event triggers are not available in v1 (no event source yet).' },
      { status: 400 },
    );
  }

  const trigger = await createTrigger(id, {
    type,
    config: body?.config ?? {},
    enabled: body?.enabled !== false,
  });
  return NextResponse.json({ trigger }, { status: 201 });
}
