/**
 * The automation's ad design — /api/ad-generator/automation/template
 *
 * GET  ?accountKey= → the designs this sub-account may use for automated ads,
 *                     plus the one currently chosen.
 * POST { accountKey, templateId } → choose one (empty string clears it).
 *
 * WHY THIS EXISTS SEPARATELY FROM `shadow?action=save_config`. That endpoint
 * rewrites the WHOLE automation config — enabled, output mode, ad caps, watch
 * scope — and is admin-only for good reason. This is the single decision a
 * DEALER makes, so it has to be reachable by a non-admin, which means it must be
 * incapable of touching anything else. It writes exactly one JSON key and never
 * creates an enabled config.
 *
 * Three things are checked before an id is stored, because a client-suppliable
 * template id is otherwise a way to point a rooftop's ads at any design in the
 * system:
 *   1. the template exists, is published and active;
 *   2. this sub-account may actually use it (owner ∪ shared ∪ global);
 *   3. it is marked usable by automation — a design built for a person to fill
 *      has fields the feed cannot supply, and would generate ads with holes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { canAccessAccount, forbidden, getAccountScope, getAuthSession } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import { canAccountUseTemplate, parseSharedKeys } from '@/lib/ad-generator/template-access';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import { usableByAutomation } from '@/lib/ad-generator/offer-kinds';
import { getAncestorAccountKeys } from '@/lib/services/accounts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Signed in, and allowed to act for this sub-account. Deliberately NO role gate. */
async function gate(accountKey: string) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!accountKey) return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  if (!canAccessAccount(getAccountScope(session), accountKey)) return forbidden();
  return null;
}

function parseDoc(raw: string): TemplateDoc | null {
  try {
    const d = JSON.parse(raw);
    return d && typeof d === 'object' && Array.isArray(d.sizes) && d.layouts ? (d as TemplateDoc) : null;
  } catch {
    return null;
  }
}

/** The chosen id from a stored `templateMap`. `all` is the key the resolver reads. */
function chosenFrom(templateMap: string | null): string {
  if (!templateMap) return '';
  try {
    const m = JSON.parse(templateMap) as Record<string, unknown>;
    const v = m?.all;
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}

export async function GET(req: NextRequest) {
  const accountKey = (req.nextUrl.searchParams.get('accountKey') || '').trim();
  const denied = await gate(accountKey);
  if (denied) return denied;

  try {
    const [rows, config] = await Promise.all([
      prisma.adTemplateDoc.findMany({
        where: { status: 'published', isActive: true },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, name: true, doc: true, accountKey: true, sharedAccountKeys: true },
      }),
      prisma.adAutomationConfig.findUnique({
        where: { accountKey },
        select: { templateMap: true, enabled: true },
      }),
    ]);

    // A template authored at the group account is inherited by each rooftop
    // beneath it, so the scope check needs the ancestor chain — without it a
    // dealer in a group sees only globals and its own.
    const ancestorKeys = await getAncestorAccountKeys(accountKey).catch(() => [] as string[]);

    const templates = rows
      .filter((r) =>
        canAccountUseTemplate(
          { accountKey: r.accountKey, sharedAccountKeys: parseSharedKeys(r.sharedAccountKeys) },
          { accountKey, ancestorKeys },
        ),
      )
      .map((r) => ({
        id: r.id,
        name: r.name,
        doc: parseDoc(r.doc),
        owned: r.accountKey === accountKey,
      }));

    return NextResponse.json({
      templateId: chosenFrom(config?.templateMap ?? null),
      enabled: !!config?.enabled,
      templates,
    });
  } catch (err) {
    console.error('[api/adgen/automation/template] GET failed:', err);
    return NextResponse.json({ error: 'Could not load the designs' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: { accountKey?: string; templateId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body' }, { status: 400 });
  }

  const accountKey = (body.accountKey ?? '').trim();
  const denied = await gate(accountKey);
  if (denied) return denied;

  const templateId = (body.templateId ?? '').trim();

  try {
    if (templateId) {
      const row = await prisma.adTemplateDoc.findUnique({
        where: { id: templateId },
        select: { id: true, status: true, isActive: true, doc: true, accountKey: true, sharedAccountKeys: true },
      });
      if (!row || row.status !== 'published' || !row.isActive) {
        return NextResponse.json({ error: 'That design is not available.' }, { status: 400 });
      }
      const ancestorKeys = await getAncestorAccountKeys(accountKey).catch(() => [] as string[]);
      if (
        !canAccountUseTemplate(
          { accountKey: row.accountKey, sharedAccountKeys: parseSharedKeys(row.sharedAccountKeys) },
          { accountKey, ancestorKeys },
        )
      ) {
        return forbidden();
      }
      const doc = parseDoc(row.doc);
      if (!doc || !usableByAutomation(doc)) {
        return NextResponse.json(
          { error: 'That design is for custom ads only, so automation cannot use it.' },
          { status: 400 },
        );
      }
    }

    // Read-modify-write the ONE key, so any other mapping an admin set survives.
    const existing = await prisma.adAutomationConfig.findUnique({
      where: { accountKey },
      select: { templateMap: true },
    });
    let map: Record<string, string> = {};
    if (existing?.templateMap) {
      try {
        const parsed = JSON.parse(existing.templateMap) as Record<string, unknown>;
        map = Object.fromEntries(
          Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'),
        );
      } catch {
        map = {};
      }
    }
    if (templateId) map.all = templateId;
    else delete map.all;

    // `create` deliberately sets nothing but the map — a first save from this
    // endpoint must never be what switches automation on.
    await prisma.adAutomationConfig.upsert({
      where: { accountKey },
      create: { accountKey, templateMap: JSON.stringify(map) },
      update: { templateMap: JSON.stringify(map) },
    });

    return NextResponse.json({ ok: true, templateId });
  } catch (err) {
    console.error('[api/adgen/automation/template] POST failed:', err);
    return NextResponse.json({ error: 'Could not save the design' }, { status: 500 });
  }
}
