import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { hasPermission, subjectFromSession } from '@/lib/permissions/require';
import { SPECIALISTS } from '@/lib/ai/specialists/registry';
import { agentIdentity } from '@/lib/ai/specialists/identity';
import { accentForPortrait } from '@/lib/ai/specialists/avatar-library';
import { getProfile } from '@/lib/ai/agent-profile-store';

/**
 * The roster.
 *
 * Every specialist is listed, with `manageable` saying whether THIS user may edit
 * it. Listing an agent someone can't edit is deliberate: the roster is a map of
 * what exists, and hiding rows would make the product look emptier than it is to
 * everyone outside the one team that owns each agent.
 */
export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;

  const subject = subjectFromSession(session!);

  const agents = await Promise.all(
    Object.values(SPECIALISTS).map(async (spec) => {
      const identity = agentIdentity(spec.key);
      const stored = await getProfile(spec.key).catch(() => null);
      return {
        key: spec.key,
        name: stored?.name || identity.name,
        role: identity.role,
        portraitUrl: stored?.portraitUrl ?? identity.portraitUrl ?? null,
        accent: accentForPortrait(stored?.portraitUrl, identity.accent),
        toolCount: spec.tools.length,
        customized: Boolean(stored),
        updatedAt: stored?.updatedAt ?? null,
        manageable: hasPermission(session!, subject, spec.managePermission),
      };
    }),
  );

  return NextResponse.json({ agents });
}
