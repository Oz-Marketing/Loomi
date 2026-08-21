import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import {
  channelLineCounts,
  createChannel,
  listChannels,
  listChannelsForAdmin,
  reorderChannels,
} from '@/lib/services/budget-channels';

/**
 * The budget channel list.
 *
 * GET admits ANY of three permissions, because this endpoint genuinely serves
 * three surfaces: the Projects budget hub and intake form, the Reporting budget
 * view, and Agency Settings. It's a taxonomy — labels the screens render — so
 * guarding it with any one of those would blank out the other two rather than
 * protect anything. The numbers it labels are guarded where they live.
 *
 * `?admin=1` adds the row ids and each channel's budget-line count, which the
 * settings screen needs to address rows and to say what archiving one costs.
 * POST creates, PUT reorders — both elevated.
 */
export async function GET(req: NextRequest) {
  const { error } = await requirePermission([
    'projects.access',
    'reporting.budget.view',
    'agency.markup.view',
  ]);
  if (error) return error;

  if (req.nextUrl.searchParams.get('admin') === '1') {
    const { error: adminError } = await requirePermission('agency.platform.configure');
    if (adminError) return adminError;
    const [channels, lineCounts] = await Promise.all([
      listChannelsForAdmin(),
      channelLineCounts(),
    ]);
    return NextResponse.json({ channels, lineCounts });
  }

  return NextResponse.json({ channels: await listChannels() });
}

export async function POST(req: NextRequest) {
  const { error } = await requirePermission('agency.platform.configure');
  if (error) return error;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  try {
    const channel = await createChannel({
      key: body.key == null ? undefined : String(body.key),
      label: String(body.label ?? ''),
      category: String(body.category ?? ''),
      lineType: body.lineType == null ? undefined : String(body.lineType),
      billingKey: body.billingKey == null ? null : String(body.billingKey),
      pacer: body.pacer == null ? null : String(body.pacer),
      intakeKinds: Array.isArray(body.intakeKinds) ? body.intakeKinds.map(String) : [],
      icon: body.icon == null ? null : String(body.icon),
      externalIds: Array.isArray(body.externalIds) ? body.externalIds.map(Number) : [],
    });
    return NextResponse.json({ channel }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not create that channel.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  const { error } = await requirePermission('agency.platform.configure');
  if (error) return error;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  if (!Array.isArray(body.ids) || body.ids.some((id: unknown) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'ids must be an array of channel ids.' }, { status: 400 });
  }
  try {
    await reorderChannels(body.ids as string[]);
    return NextResponse.json({ channels: await listChannelsForAdmin() });
  } catch {
    return NextResponse.json({ error: 'Could not save that order.' }, { status: 400 });
  }
}
