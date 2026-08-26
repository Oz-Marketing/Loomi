/**
 * The editable half of a specialist: its brief, its house notes, its depth.
 *
 * The central rule is that a stored row is an OVERRIDE of the code default, never
 * a prerequisite. A specialist with no row runs on the brief compiled into its
 * registry entry, so shipping this changed nothing until someone edited something,
 * and deleting a row is a working "reset to default" rather than a way to leave an
 * agent with no instructions at all.
 *
 * Everything a user may change lives here. Tools, permissions and guardrails stay
 * in the registry — see docs/specialist-agents.md for why that line is where it is.
 */

import { prisma } from '@/lib/prisma';
import type { SpecialistProfile } from '@/lib/ai/specialists/registry';
import { characterByUrl } from '@/lib/ai/specialists/avatar-library';

/** Depths a profile may select. Mirrors what the SDK accepts. */
export const EFFORTS = ['low', 'medium', 'high', 'max'] as const;
export type ProfileEffort = (typeof EFFORTS)[number];

export function isEffort(value: unknown): value is ProfileEffort {
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value);
}

export interface StoredProfile {
  id: string;
  specialistKey: string | null;
  name: string;
  instructions: string;
  notes: string | null;
  effort: ProfileEffort;
  portraitUrl: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

/** A profile as the runtime wants it, plus whether a human has touched it. */
export interface ResolvedProfile extends SpecialistProfile {
  effort: ProfileEffort;
  /** Display name and face, already resolved against the registry defaults. */
  name: string;
  portraitUrl: string | null;
  /** False when this is the registry default with no row behind it. */
  customized: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface ProfileInput {
  name?: string;
  instructions?: string;
  notes?: string | null;
  effort?: ProfileEffort;
  /** A url from the avatar library, or null to fall back to the default face. */
  portraitUrl?: string | null;
}

const MAX_INSTRUCTIONS = 20_000;
const MAX_NOTES = 20_000;
const MAX_NAME = 60;

export class ProfileValidationError extends Error {}

/**
 * Check a submitted profile before it can reach the database.
 *
 * Instructions may not be blanked: an empty brief doesn't reset a specialist, it
 * silently strips its entire character and leaves it answering as a generic
 * assistant that still wears the specialist's face. Resetting is deleting the row.
 */
export function validateProfileInput(input: ProfileInput): void {
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new ProfileValidationError('Name cannot be empty.');
    if (name.length > MAX_NAME) {
      throw new ProfileValidationError(`Name must be ${MAX_NAME} characters or fewer.`);
    }
  }
  if (input.instructions !== undefined) {
    if (!input.instructions.trim()) {
      throw new ProfileValidationError(
        'Instructions cannot be empty — use "Reset to default" to restore the built-in brief.',
      );
    }
    if (input.instructions.length > MAX_INSTRUCTIONS) {
      throw new ProfileValidationError(
        `Instructions must be ${MAX_INSTRUCTIONS.toLocaleString()} characters or fewer.`,
      );
    }
  }
  if (input.notes != null && input.notes.length > MAX_NOTES) {
    throw new ProfileValidationError(
      `Notes must be ${MAX_NOTES.toLocaleString()} characters or fewer.`,
    );
  }
  if (input.effort !== undefined && !isEffort(input.effort)) {
    throw new ProfileValidationError(`Effort must be one of ${EFFORTS.join(', ')}.`);
  }
  // Only faces from the committed library. An arbitrary URL here would be a way
  // to point the product's own chrome at somebody else's server.
  if (input.portraitUrl != null && !characterByUrl(input.portraitUrl)) {
    throw new ProfileValidationError('That avatar is not in the library.');
  }
}

function toStored(row: {
  id: string;
  specialistKey: string | null;
  name: string;
  instructions: string;
  notes: string | null;
  effort: string;
  portraitUrl: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}): StoredProfile {
  return {
    id: row.id,
    specialistKey: row.specialistKey,
    name: row.name,
    instructions: row.instructions,
    notes: row.notes,
    effort: isEffort(row.effort) ? row.effort : 'high',
    portraitUrl: row.portraitUrl,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

/** The stored override for a specialist, or null when it runs on its default. */
export async function getProfile(specialistKey: string): Promise<StoredProfile | null> {
  const row = await prisma.agentProfile.findUnique({ where: { specialistKey } });
  return row ? toStored(row) : null;
}

/**
 * What the runtime should actually use.
 *
 * Falls back FIELD BY FIELD rather than all-or-nothing: a team that writes house
 * notes without touching the brief should get their notes plus the maintained
 * default brief, not their notes plus whatever the brief happened to be the day
 * they first saved.
 */
export async function resolveProfile(
  specialistKey: string,
  fallback: SpecialistProfile,
  fallbackEffort: ProfileEffort,
  defaults: { name: string; portraitUrl?: string | null } = { name: '' },
): Promise<ResolvedProfile> {
  const stored = await getProfile(specialistKey).catch(() => null);
  if (!stored) {
    return {
      instructions: fallback.instructions,
      notes: fallback.notes,
      effort: fallbackEffort,
      name: defaults.name,
      portraitUrl: defaults.portraitUrl ?? null,
      customized: false,
      updatedAt: null,
      updatedBy: null,
    };
  }
  return {
    instructions: stored.instructions || fallback.instructions,
    notes: stored.notes ?? fallback.notes,
    effort: stored.effort,
    name: stored.name || defaults.name,
    portraitUrl: stored.portraitUrl ?? defaults.portraitUrl ?? null,
    customized: true,
    updatedAt: stored.updatedAt,
    updatedBy: stored.updatedBy,
  };
}

/**
 * Create or update the override, recording what it replaced.
 *
 * The revision written is the state BEFORE this change — including, on the very
 * first edit, a synthetic revision holding the code default. Without that, the
 * history of a specialist would begin at its first edit and there would be no
 * record of what it said originally.
 */
export async function saveProfile(args: {
  specialistKey: string;
  input: ProfileInput;
  fallback: SpecialistProfile;
  fallbackEffort: ProfileEffort;
  defaultName: string;
  defaultPortraitUrl?: string | null;
  userId: string | null;
}): Promise<StoredProfile> {
  validateProfileInput(args.input);

  const existing = await prisma.agentProfile.findUnique({
    where: { specialistKey: args.specialistKey },
  });

  const prior = existing
    ? {
        name: existing.name,
        instructions: existing.instructions,
        notes: existing.notes,
        effort: existing.effort,
        portraitUrl: existing.portraitUrl,
        changedBy: existing.updatedBy,
      }
    : {
        name: args.defaultName,
        instructions: args.fallback.instructions,
        notes: args.fallback.notes ?? null,
        effort: args.fallbackEffort,
        portraitUrl: args.defaultPortraitUrl ?? null,
        // Null author: nobody wrote this, it is what shipped.
        changedBy: null,
      };

  const next = {
    name: args.input.name?.trim() ?? prior.name,
    instructions: args.input.instructions ?? prior.instructions,
    notes: args.input.notes === undefined ? prior.notes : args.input.notes || null,
    effort: args.input.effort ?? prior.effort,
    portraitUrl:
      args.input.portraitUrl === undefined ? prior.portraitUrl : args.input.portraitUrl || null,
  };

  const row = existing
    ? await prisma.agentProfile.update({
        where: { id: existing.id },
        data: { ...next, updatedBy: args.userId },
      })
    : await prisma.agentProfile.create({
        data: {
          specialistKey: args.specialistKey,
          ...next,
          ownerScope: 'agency',
          createdBy: args.userId,
          updatedBy: args.userId,
        },
      });

  await prisma.agentProfileRevision.create({
    data: {
      profileId: row.id,
      name: prior.name,
      instructions: prior.instructions,
      notes: prior.notes,
      effort: prior.effort,
      changedBy: prior.changedBy,
    },
  });

  return toStored(row);
}

/** Drop the override so the specialist runs on its code default again. */
export async function resetProfile(specialistKey: string): Promise<boolean> {
  const res = await prisma.agentProfile.deleteMany({ where: { specialistKey } });
  return res.count > 0;
}

export interface RevisionSummary {
  id: string;
  name: string;
  instructions: string;
  notes: string | null;
  effort: string;
  changedBy: string | null;
  changedAt: string;
}

/**
 * Past versions, newest first.
 *
 * Returns an empty list rather than throwing if history can't be read. History is
 * context, not the thing being edited — an unavailable revision table must not
 * take down the editor and leave someone unable to fix a brief that is actively
 * giving bad answers.
 */
export async function listRevisions(
  specialistKey: string,
  limit = 20,
): Promise<RevisionSummary[]> {
  const profile = await prisma.agentProfile
    .findUnique({ where: { specialistKey }, select: { id: true } })
    .catch(() => null);
  if (!profile) return [];
  const rows = await prisma.agentProfileRevision
    .findMany({
      where: { profileId: profile.id },
      orderBy: { changedAt: 'desc' },
      take: limit,
    })
    .catch(() => []);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    instructions: r.instructions,
    notes: r.notes,
    effort: r.effort,
    changedBy: r.changedBy,
    changedAt: r.changedAt.toISOString(),
  }));
}
