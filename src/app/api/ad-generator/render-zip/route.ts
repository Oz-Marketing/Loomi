/**
 * Ad Generator batch render — POST /api/ad-generator/render-zip
 *
 * Body: { templateId, sizeIds?, accountKey?, data, doc?, name? }. Renders the
 * template at every requested size (default: all of the template's sizes) in
 * one headless-Chromium session and returns a single ZIP — browsers block the
 * multi-download the old per-size loop triggered. PNGs are STORE'd (they don't
 * recompress), so the zip step is effectively free.
 */
import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { getAuthSession } from '@/lib/api-auth';
import { resolveTemplate } from '@/lib/ad-generator/resolve-template';
import { adTemplateFromDoc } from '@/lib/ad-generator/doc-template';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import { renderAdBatch } from '@/lib/ad-generator/render';
import { embedAccountFontCss } from '@/lib/ad-generator/render-fonts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Safe cross-platform filename chunk (also used inside the archive). */
function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'ad'
  );
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { templateId?: string; sizeIds?: string[]; accountKey?: string; data?: Record<string, string>; doc?: TemplateDoc; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Prefer the ad's own snapshot doc when supplied (each ad is an independent
  // copy); otherwise resolve the template id live (code templates / older ads).
  const snapshot = body.doc;
  const template =
    snapshot && Array.isArray(snapshot.sizes) && Array.isArray(snapshot.elements) && snapshot.layouts
      ? adTemplateFromDoc(body.templateId || 'snapshot', snapshot)
      : await resolveTemplate(body.templateId ?? '');
  if (!template) return NextResponse.json({ error: 'Unknown template' }, { status: 400 });

  const sizes = body.sizeIds?.length ? template.sizes.filter((s) => body.sizeIds!.includes(s.id)) : template.sizes;
  if (sizes.length === 0) return NextResponse.json({ error: 'Unknown size' }, { status: 400 });

  // Re-build the font @font-face with base64-embedded files (preview sends URL-based).
  const data = await embedAccountFontCss(body.accountKey, { ...(body.data ?? {}) });
  const merged = { ...template.defaults, ...data };

  try {
    const pngs = await renderAdBatch(sizes.map((size) => ({ html: template.render(merged, size), width: size.width, height: size.height })));
    const base = slug(body.name || template.id);
    const zip = new JSZip();
    sizes.forEach((size, i) => zip.file(`${base}-${slug(size.label || size.id)}-${size.width}x${size.height}.png`, pngs[i]));
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${base}-all-sizes.zip"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ad-generator/render-zip] failed', err);
    return NextResponse.json({ error: 'Render failed' }, { status: 500 });
  }
}
