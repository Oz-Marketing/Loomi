/**
 * The gate every OEM-run route shares, and the scope sanitizer.
 *
 * Lived inline in the shadow route; the on-demand run route needs the same
 * three checks in the same order, and two copies of an auth gate is how they
 * drift. Server-only.
 */
import { NextResponse } from 'next/server';
import { canAccessAccount, forbidden, getAccountScope, getAuthSession } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import type { GenerateScope } from './generate-ads';
import type { SelectableOfferType } from './select-offer';

/**
 * 404 when the Ad Generator is off for this deployment; 401 without a session;
 * 403 without `studio.adgen.generate` or outside the caller's account scope;
 * 400 with no account. Null when the request may proceed.
 */
export async function gateOfferRun(accountKey: string): Promise<NextResponse | null> {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { error } = await requirePermission('studio.adgen.generate');
  if (error) return error;
  if (!accountKey) return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  if (!canAccessAccount(getAccountScope(session), accountKey)) return forbidden();
  return null;
}

/**
 * Per-run narrowing from a client, validated hard: an unrecognised offer type
 * reaching `selectOffer` would reject every incentive without saying why.
 */
export function sanitizeScope(raw: { vehicles?: unknown[]; offerTypes?: unknown[] } | null | undefined): GenerateScope {
  const vehicles = Array.isArray(raw?.vehicles) ? raw!.vehicles! : [];
  const types = Array.isArray(raw?.offerTypes) ? raw!.offerTypes! : [];
  return {
    vehicles: vehicles.filter((v): v is string => typeof v === 'string' && !!v.trim()),
    offerTypes: types.filter(
      (t): t is SelectableOfferType => t === 'lease' || t === 'apr' || t === 'cash',
    ),
  };
}
