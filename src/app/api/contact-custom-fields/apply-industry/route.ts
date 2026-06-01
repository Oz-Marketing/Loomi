// Bulk-apply blueprints by industry tag.
//
// POST /api/contact-custom-fields/apply-industry
//   Body: { industryTag: "Automotive" }
//
// Deploys every blueprint tagged with `industryTag` to every
// sub-account whose Account.category matches `industryTag`. Skips
// deployments that already exist. Returns a per-pair summary.
//
// Admin+ only. Designed for one-click "seed all Automotive
// sub-accounts with the standard automotive field set" UX in the
// admin Blueprints tab.

import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { applyIndustryBlueprintsToMatchingAccounts } from '@/lib/services/contact-custom-fields';

export async function POST(req: NextRequest) {
  // Portfolio-wide sweep: gated to elevated roles only because the
  // service doesn't filter against the caller's account scope. Admins
  // with limited scope should use per-blueprint deploy instead.
  const { error } = await requireRole('developer', 'super_admin');
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const industryTag = typeof body.industryTag === 'string' ? body.industryTag.trim() : '';
  if (!industryTag) {
    return NextResponse.json(
      { error: 'industryTag is required' },
      { status: 400 },
    );
  }

  const result = await applyIndustryBlueprintsToMatchingAccounts(industryTag);
  return NextResponse.json(result);
}
