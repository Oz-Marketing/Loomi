/**
 * Collector for Content-Security-Policy violation reports.
 *
 * The policy ships as `Content-Security-Policy-Report-Only` (see next.config),
 * so nothing is blocked — the browser just tells us what WOULD have been. This
 * endpoint turns that into a short, readable log we can act on, and is the whole
 * reason the report-only pass exists: enforcing a policy written from reading
 * the code, rather than from what the app actually loads, is how you take a
 * product down on a Friday.
 *
 * ── Why this is unauthenticated ──
 *
 * The browser posts the report itself, on its own, with no credentials and no
 * way to attach any. Gating it would mean collecting nothing. It is therefore
 * on the proxy's public passthrough list, and treated accordingly: nothing here
 * touches the database, nothing is echoed back, and the payload is read for a
 * handful of known string fields and otherwise ignored.
 *
 * ── Why it dedupes ──
 *
 * A violation fires per page load, per offending element. The app has three
 * known inline scripts, so an undeduped collector would write several lines per
 * visit forever and the signal — an origin nobody expected — would be buried
 * inside a minute. One line per distinct (directive, blocked origin) per
 * process is enough to build the allowlist from.
 */

import { NextRequest, NextResponse } from 'next/server';

/**
 * Distinct violations already logged by THIS process. In-memory on purpose: a
 * deploy or restart clears it, which is what you want — it re-reports whatever
 * is still happening against the new build rather than staying quiet about it.
 */
const seen = new Set<string>();
/** Hard ceiling, so a hostile or broken client cannot grow the set unbounded. */
const MAX_DISTINCT = 500;

interface CspReportBody {
  'csp-report'?: Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Origin only — the path of a blocked URL is noise and can carry query data. */
function originOf(uri: string): string {
  if (!uri) return '(inline)';
  if (!uri.startsWith('http')) return uri; // 'inline', 'eval', 'data', …
  try {
    return new URL(uri).origin;
  } catch {
    return '(unparseable)';
  }
}

export async function POST(req: NextRequest) {
  // Browsers send `application/csp-report` or `application/reports+json`, never
  // a plain JSON content-type, so parse defensively rather than negotiating.
  const body = (await req.json().catch(() => null)) as CspReportBody | null;
  const report = body?.['csp-report'];
  if (!report) {
    // Malformed or not a report. 204 regardless: there is no client here to
    // benefit from an error, and answering 400 invites retries.
    return new NextResponse(null, { status: 204 });
  }

  const directive = str(report['effective-directive']) || str(report['violated-directive']) || 'unknown';
  const blocked = originOf(str(report['blocked-uri']));
  const documentOrigin = originOf(str(report['document-uri']));

  const key = `${directive}|${blocked}|${documentOrigin}`;
  if (!seen.has(key) && seen.size < MAX_DISTINCT) {
    seen.add(key);
    // One line, greppable, no payload echo.
    console.warn(`[csp] would block ${directive} <- ${blocked} on ${documentOrigin}`);
  }

  // 204: the browser does not read the response, and returning a body just
  // spends bandwidth on every violation.
  return new NextResponse(null, { status: 204 });
}
