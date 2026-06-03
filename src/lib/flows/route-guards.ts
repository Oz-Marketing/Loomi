import { NextResponse } from 'next/server';

/**
 * Block a scoped (client/admin) caller from MUTATING a template flow
 * (accountKey null/empty). Templates are agency-wide assets; only
 * unscoped roles (developer / super_admin, where `scope === null`) may
 * edit them. Reads are unaffected — templates stay world-readable so
 * sub-accounts can browse and deploy them.
 *
 * Returns a 403 NextResponse to short-circuit the handler, or null to
 * proceed. Usage in a route after fetching the flow:
 *
 *   const guard = forbidTemplateMutation(existing.accountKey, scope);
 *   if (guard) return guard;
 */
export function forbidTemplateMutation(
  accountKey: string | null | undefined,
  scope: string[] | null,
): NextResponse | null {
  if (!accountKey && scope !== null) {
    return NextResponse.json(
      {
        error:
          'This is a shared template — only an agency admin can edit it. Deploy it to your account to make changes there.',
      },
      { status: 403 },
    );
  }
  return null;
}
