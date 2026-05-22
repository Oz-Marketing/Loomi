import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  try {
    const body = await req.json();
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    if (!slug) return NextResponse.json({ error: 'Missing slug' }, { status: 400 });

    const raw = body.category;
    const category =
      raw === null || raw === undefined || raw === ''
        ? null
        : String(raw).trim().toLowerCase().replace(/\s+/g, '-');

    const existing = await prisma.template.findUnique({ where: { slug } });
    if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

    await prisma.template.update({
      where: { slug },
      data: {
        category,
        updatedAt: new Date(),
        updatedByUserId: session!.user.id,
      },
    });

    return NextResponse.json({ success: true, slug, category });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
