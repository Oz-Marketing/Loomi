import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { prisma } from '@/lib/prisma';

// GET /api/contacts/:id/events?accountKey=
//
// The contact's service/purchase history — one row per repair order or deal
// (see ContactEvent). Powers the timeline and the multi-vehicle "garage" on
// the contact page. Newest first.

type RouteContext = { params: Promise<{ contactId: string }> };

const MAX_EVENTS = 500;

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { session, error } = await requirePermission('studio.contacts.view');
  if (error) return error;

  const { contactId } = await params;
  const accountKey = req.nextUrl.searchParams.get('accountKey')?.trim() ?? '';
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }

  if (session!.user.role === 'admin') {
    const assigned = session!.user.accountKeys ?? [];
    if (assigned.length > 0 && !assigned.includes(accountKey)) {
      return NextResponse.json({ error: 'Forbidden for this account' }, { status: 403 });
    }
  }

  const events = await prisma.contactEvent.findMany({
    where: { contactId, accountKey },
    orderBy: [{ eventDate: 'desc' }, { createdAt: 'desc' }],
    take: MAX_EVENTS,
    select: {
      id: true,
      type: true,
      eventDate: true,
      amount: true,
      vehicleYear: true,
      vehicleMake: true,
      vehicleModel: true,
      vehicleVin: true,
      vehicleMileage: true,
      sourceCrm: true,
      reference: true,
      details: true,
    },
  });

  return NextResponse.json({ events, meta: { total: events.length } });
}
