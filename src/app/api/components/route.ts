import { NextResponse } from 'next/server';

/**
 * Legacy Maizzle component-management API. The Maizzle subproject was
 * removed in the v2 / react-email migration; this route is now a stub
 * that returns empty results so existing callers (admin dashboard stats)
 * don't crash.
 *
 * The visual editor's component library now lives in
 * `src/lib/email/components/` (React) and is consumed directly by the
 * v2 renderer — there's no per-template HTML component registry to manage.
 */
export async function GET() {
  return NextResponse.json([]);
}
