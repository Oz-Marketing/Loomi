import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/permissions/require';
import { playbooksAllowed } from '@/lib/playbooks/access';
import { isV2Template } from '@/lib/email/types';
import { templateHasOffersMarker } from '@/lib/ad-generator/automation/offer-email-doc';

/**
 * Template choices for authoring a playbook.
 *
 * Deliberately NOT scoped to one sub-account: a playbook is applied to many, so
 * it can only be built from designs every rooftop can reach — shared ad
 * templates and shared email templates. Offering a template owned by a single
 * sub-account would produce a playbook that silently renders nothing everywhere
 * else.
 */
export async function GET() {
  const { error } = await requirePermission('agency.subaccounts.view');
  if (error) return error;
  if (!(await playbooksAllowed())) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const [adRows, emailRows] = await Promise.all([
      prisma.adTemplateDoc
        .findMany({
          where: { status: 'published', isActive: true, accountKey: null },
          select: { id: true, name: true, doc: true },
          orderBy: { updatedAt: 'desc' },
        })
        .catch(() => []),
      prisma.template
        .findMany({
          where: { type: 'design', accountKey: null },
          select: { slug: true, title: true, content: true },
          orderBy: { updatedAt: 'desc' },
          take: 200,
        })
        .catch(() => []),
    ]);

    return NextResponse.json({
      adTemplates: adRows.map((t) => ({
        id: t.id,
        name: t.name,
        sizes: (() => {
          try {
            const d = JSON.parse(t.doc) as { sizes?: { id?: string; label?: string }[] };
            return (d.sizes ?? [])
              .filter((s): s is { id: string; label?: string } => typeof s.id === 'string')
              .map((s) => ({ id: s.id, label: s.label || s.id }));
          } catch {
            return [];
          }
        })(),
      })),
      emailTemplates: emailRows
        .filter((t) => isV2Template(t.content))
        .map((t) => ({
          slug: t.slug,
          title: t.title,
          hasOffersBlock: templateHasOffersMarker(t.content),
        })),
    });
  } catch (err) {
    console.error('[api/playbooks/library/options] GET failed:', err);
    return NextResponse.json({ error: 'Could not load template options' }, { status: 500 });
  }
}
