/**
 * Report Excel export — POST /api/reporting/export/xlsx
 *
 * The client posts a normalized ReportDoc (built from data it already
 * rendered) and gets back a formatted .xlsx workbook. Platform-agnostic, so
 * every reporting tab shares it. The body carries only display values the
 * caller already saw on screen — no account secrets — so there's nothing
 * further to scope beyond the reporting-access guard.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireReportingAccess } from '../../_lib/guard';
import { renderReportXlsx } from '@/lib/reporting/xlsx';
import { isValidReportDoc, reportDocSizeError, sanitizeReportFilename } from '@/lib/reporting/report-doc';

export const dynamic = 'force-dynamic';

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
    const xlsx = await renderReportXlsx(body);
    const filename = `${sanitizeReportFilename(body.title)}.xlsx`;
    return new NextResponse(xlsx as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[reporting/export/xlsx] failed', err);
    const message = err instanceof Error ? err.message : 'Excel export failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
