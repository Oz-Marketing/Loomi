import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';

/**
 * Public links — shareable asset URLs that need no Loomi login.
 *
 * See the schema comment for why the token is STORED rather than signed: these
 * are meant to last and to be revocable, and revocation needs a row to delete.
 *
 * Server-only.
 */

/**
 * 16 random bytes, base64url — 22 characters, ~128 bits.
 *
 * Unguessable is the whole security model here, so this uses `randomBytes` and
 * not `Math.random` or a cuid. A cuid embeds a timestamp and a counter, which
 * makes neighbouring ids partially predictable; that's fine for a row id and
 * wrong for a bearer token.
 */
export function generatePublicToken(): string {
  return randomBytes(16).toString('base64url');
}

export type PublicLinkState = 'active' | 'revoked' | 'expired';

export function publicLinkState(
  link: { revokedAt: Date | null; expiresAt: Date | null },
  now = new Date(),
): PublicLinkState {
  if (link.revokedAt) return 'revoked';
  if (link.expiresAt && link.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'active';
}

/** The public path for a token. Short, because these get pasted into emails. */
export function publicLinkPath(token: string): string {
  return `/m/${token}`;
}

export interface SerializedPublicLink {
  token: string;
  path: string;
  label: string | null;
  state: PublicLinkState;
  expiresAt: string | null;
  revokedAt: string | null;
  accessCount: number;
  lastAccessedAt: string | null;
  createdByName: string | null;
  createdAt: string;
}

export function serializePublicLink(
  link: {
    id: string;
    label: string | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    accessCount: number;
    lastAccessedAt: Date | null;
    createdByName: string | null;
    createdAt: Date;
  },
  now = new Date(),
): SerializedPublicLink {
  return {
    token: link.id,
    path: publicLinkPath(link.id),
    label: link.label,
    state: publicLinkState(link, now),
    expiresAt: link.expiresAt?.toISOString() ?? null,
    revokedAt: link.revokedAt?.toISOString() ?? null,
    accessCount: link.accessCount,
    lastAccessedAt: link.lastAccessedAt?.toISOString() ?? null,
    createdByName: link.createdByName,
    createdAt: link.createdAt.toISOString(),
  };
}

export async function listPublicLinks(assetId: string): Promise<SerializedPublicLink[]> {
  const rows = await prisma.mediaPublicLink
    .findMany({ where: { assetId }, orderBy: { createdAt: 'desc' } })
    .catch(() => []);
  return rows.map((r) => serializePublicLink(r));
}

export async function createPublicLink(input: {
  assetId: string;
  label?: string | null;
  expiresAt?: Date | null;
  userId?: string | null;
  userName?: string | null;
}): Promise<SerializedPublicLink> {
  const created = await prisma.mediaPublicLink.create({
    data: {
      id: generatePublicToken(),
      assetId: input.assetId,
      label: input.label?.trim() || null,
      expiresAt: input.expiresAt ?? null,
      createdBy: input.userId ?? null,
      createdByName: input.userName ?? null,
    },
  });
  return serializePublicLink(created);
}

/**
 * Revoke rather than delete.
 *
 * "Who shared this, and when did we pull it?" is the question a revoked link
 * exists to answer, and a deleted row answers nothing. Idempotent: revoking
 * twice keeps the first timestamp, which is the one that's true.
 */
export async function revokePublicLink(token: string): Promise<boolean> {
  const link = await prisma.mediaPublicLink.findUnique({ where: { id: token } });
  if (!link) return false;
  if (link.revokedAt) return true;
  await prisma.mediaPublicLink.update({
    where: { id: token },
    data: { revokedAt: new Date() },
  });
  return true;
}

/**
 * Resolve a token to its asset, or null when the link can't be served.
 *
 * Deliberately returns null for revoked, expired, missing AND archived — the
 * public side must not distinguish them. Telling an anonymous caller "this link
 * was revoked" rather than "not found" confirms the token was once real, which
 * is free information for anyone probing.
 */
export async function resolvePublicLink(token: string, now = new Date()) {
  const link = await prisma.mediaPublicLink
    .findUnique({ where: { id: token }, include: { asset: true } })
    .catch(() => null);

  if (!link) return null;
  if (publicLinkState(link, now) !== 'active') return null;
  // An archived asset is out of circulation; a live link to it would quietly
  // undo that.
  if (link.asset.archivedAt) return null;

  return link;
}

/**
 * Record a hit. Fire-and-forget — a counter is not worth delaying the file for,
 * and a failed increment must never turn a working link into an error.
 */
export function recordPublicLinkAccess(token: string): void {
  prisma.mediaPublicLink
    .update({
      where: { id: token },
      data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() },
    })
    .catch(() => {});
}
