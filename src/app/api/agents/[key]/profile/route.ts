import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { getSpecialist } from '@/lib/ai/specialists/registry';
import { agentIdentity } from '@/lib/ai/specialists/identity';
import { AVATAR_LIBRARY, accentForPortrait } from '@/lib/ai/specialists/avatar-library';
import {
  resolveProfile,
  saveProfile,
  resetProfile,
  listRevisions,
  ProfileValidationError,
  isEffort,
} from '@/lib/ai/agent-profile-store';

/**
 * One specialist's editable profile.
 *
 * Gated on the specialist's OWN `managePermission`, not on a blanket settings
 * permission: the team that owns the realm owns the agent. Reading the profile is
 * gated the same way as writing it, because a brief is the house's operating
 * guidance and there is no reason for everyone who can chat to read it.
 */

export async function GET(_req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const specialist = getSpecialist(key);
  if (!specialist) return NextResponse.json({ error: 'No such specialist' }, { status: 404 });

  const { error } = await requirePermission(specialist.managePermission);
  if (error) return error;

  const identity = agentIdentity(specialist.key);
  const profile = await resolveProfile(
    specialist.key,
    specialist.defaultProfile,
    specialist.effort,
    { name: identity.name, portraitUrl: identity.portraitUrl },
  );
  return NextResponse.json({
    profile: {
      key: specialist.key,
      name: profile.name,
      role: identity.role,
      portraitUrl: profile.portraitUrl,
      accent: accentForPortrait(profile.portraitUrl, identity.accent),
      instructions: profile.instructions,
      notes: profile.notes ?? '',
      effort: profile.effort,
      customized: profile.customized,
      updatedAt: profile.updatedAt,
      updatedBy: profile.updatedBy,
    },
    // Shown beside the editor so it is obvious what is NOT editable here.
    capabilities: specialist.tools.map((t) => ({ name: t.name, description: t.description })),
    // The faces a manager may choose from. Shared across specialists so the
    // roster stays one illustration style rather than a dozen.
    library: AVATAR_LIBRARY,
    revisions: await listRevisions(specialist.key),
  });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const specialist = getSpecialist(key);
  if (!specialist) return NextResponse.json({ error: 'No such specialist' }, { status: 404 });

  const { session, error } = await requirePermission(specialist.managePermission);
  if (error) return error;

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    instructions?: string;
    notes?: string | null;
    effort?: string;
    portraitUrl?: string | null;
  };
  if (body.effort !== undefined && !isEffort(body.effort)) {
    return NextResponse.json({ error: 'Unknown effort level.' }, { status: 400 });
  }

  try {
    const saved = await saveProfile({
      specialistKey: specialist.key,
      input: {
        name: body.name,
        instructions: body.instructions,
        notes: body.notes,
        effort: body.effort,
        portraitUrl: body.portraitUrl,
      },
      fallback: specialist.defaultProfile,
      fallbackEffort: specialist.effort,
      defaultName: agentIdentity(specialist.key).name,
      defaultPortraitUrl: agentIdentity(specialist.key).portraitUrl,
      userId: session!.user.id,
    });
    return NextResponse.json({ profile: saved });
  } catch (err) {
    // A rejected edit is the user's mistake to fix, not a server fault.
    if (err instanceof ProfileValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

/** Reset to the built-in brief by dropping the override entirely. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const specialist = getSpecialist(key);
  if (!specialist) return NextResponse.json({ error: 'No such specialist' }, { status: 404 });

  const { error } = await requirePermission(specialist.managePermission);
  if (error) return error;

  await resetProfile(specialist.key);
  return NextResponse.json({ success: true });
}
