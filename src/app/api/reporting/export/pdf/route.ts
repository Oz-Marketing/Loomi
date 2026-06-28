/**
 * Report PDF export — POST /api/reporting/export/pdf
 *
 * The client posts a normalized ReportDoc (built from data it already
 * rendered) and gets back a branded PDF. No platform fetching happens here —
 * this route is platform-agnostic, so every reporting tab shares it.
 *
 * Auth: any user who can see the reporting surface. The body carries no
 * account secrets (just display values the caller already saw on screen), so
 * there's nothing further to scope.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireReportingAccess } from '../../_lib/guard';
import { renderReportPdf } from '@/lib/reporting/pdf';
import { isValidReportDoc, reportDocSizeError, sanitizeReportFilename } from '@/lib/reporting/report-doc';

export const dynamic = 'force-dynamic';
// Headless Chromium can take a few seconds to spin up + render.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { error } = await requireReportingAccess();
  if (error) return error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isValidReportDoc(body)) {
    return NextResponse.json({ error: 'Malformed report document' }, { status: 400 });
  }

  const sizeError = reportDocSizeError(body);
  if (sizeError) {
    return NextResponse.json({ error: sizeError }, { status: 413 });
  }

  try {
    const pdf = await renderReportPdf(body);
    const filename = `${sanitizeReportFilename(body.title)}.pdf`;
    return new NextResponse(pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[reporting/export/pdf] failed', err);
    const message = err instanceof Error ? err.message : 'PDF export failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
