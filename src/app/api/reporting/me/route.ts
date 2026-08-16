/**
 * GET /api/reporting/me
 *
 * Returns the authenticated user and their reporting scope. Useful as a
 * smoke-test endpoint and as the pattern reference for every future
 * reporting route:
 *
 *   const { ctx, error } = await requireReportingAccess();
 *   if (error) return error;
 *   // ctx.accountKeys → null (unrestricted) | string[] (scope filter)
 */
import { NextResponse } from 'next/server';
import { requireReportingAccess } from '../_lib/guard';

export async function GET() {
  const { ctx, error } = await requireReportingAccess();
  if (error) return error;

  return NextResponse.json({
    user: ctx.user,
    accountKeys: ctx.accountKeys,
    unrestricted: ctx.accountKeys === null,
    // Whether the ad reports will include internal cost for this caller. Here
    // because it's the one place to check the gate without a live Meta/Google
    // connection — and because the front end can use it to hide cost columns
    // rather than render empty ones.
    canViewSpend: ctx.canViewSpend,
  });
}
