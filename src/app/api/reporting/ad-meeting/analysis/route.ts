/**
 * Ad Meeting analysis — POST /api/reporting/ad-meeting/analysis
 *
 * Takes an assembled `ReportDoc` and returns a written analysis for the front
 * of the deliverable. Port of Oz Dealer Tools' `ad-meeting/analyze`.
 *
 * STAFF ONLY (MANAGEMENT_ROLES). Two reasons: the analysis is drafted and
 * reviewed before a client ever sees it, and each call costs real Opus tokens —
 * neither is something a `client` role should be able to trigger.
 *
 * The client posts the document rather than the server re-fetching every
 * platform, matching how the PDF and XLSX exporters already work: the caller
 * has the data on screen, and analysing exactly what will be exported means the
 * prose can never cite a figure the reader can't find on the page.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import { isValidReportDoc, reportDocSizeError } from '@/lib/reporting/report-doc';
import { AnalysisUnavailable, generateMeetingAnalysis } from '@/lib/reporting/meeting-analysis';

export const dynamic = 'force-dynamic';
// Opus with adaptive thinking on a full marketing review is not a fast call.
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const { error } = await requireRole(...MANAGEMENT_ROLES);
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
  if (sizeError) return NextResponse.json({ error: sizeError }, { status: 413 });

  try {
    const analysis = await generateMeetingAnalysis(body);
    return NextResponse.json({ analysis });
  } catch (err) {
    if (err instanceof AnalysisUnavailable) {
      // 'refused' and 'empty' are outcomes, not faults — the caller exports
      // the document without an analysis rather than treating it as a failure.
      const status = err.code === 'not_configured' ? 503 : err.code === 'error' ? 502 : 409;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error('[reporting/ad-meeting/analysis]', err);
    return NextResponse.json({ error: 'Failed to write the analysis' }, { status: 500 });
  }
}
