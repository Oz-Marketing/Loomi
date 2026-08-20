/**
 * Who is reading, expressed in the only two terms the docs library cares about:
 * are they a client, and which sectors can they enter.
 *
 * Server-only — it goes through `subjectFromSession`, which reads the JWT.
 */
import { accessibleSectors } from '@/lib/permissions/registry';
import { subjectFromSession } from '@/lib/permissions/require';
import { MANAGEMENT_ROLES } from '@/lib/roles';

import type { DocSector } from './types';

export interface DocReader {
  isClient: boolean;
  sectors: DocSector[];
}

type SessionLike = Parameters<typeof subjectFromSession>[0];

/**
 * Anyone in a management role is staff, matching how `/api/changelog` already
 * decides. Not derived from sector roles: a staff user whose roles were never
 * assigned would otherwise resolve to "client with no sectors" and be shown an
 * empty library — the exact failure the visibility rule in `types.ts` is written
 * to avoid.
 */
export function docReaderFromSession(session: SessionLike): DocReader {
  const isClient = !(MANAGEMENT_ROLES as string[]).includes(session.user.role ?? '');
  if (!isClient) return { isClient: false, sectors: [] };

  return {
    isClient: true,
    sectors: accessibleSectors(subjectFromSession(session)) as DocSector[],
  };
}

/**
 * The Prisma `where` that matches what this reader may see.
 *
 * Kept alongside `canReadDoc` in `types.ts` and mirroring it exactly: one is the
 * filter the query applies, the other is the check the UI and the single-article
 * route apply. They must agree, so they are written to be read side by side.
 */
export function docVisibilityWhere(reader: DocReader) {
  if (!reader.isClient) return {};
  return {
    status: 'published',
    audience: 'everyone',
    // `platform` is the shared preamble — how accounts and signing in work — so
    // any client with a sector at all is entitled to it.
    sector: { in: [...reader.sectors, ...(reader.sectors.length > 0 ? ['platform'] : [])] },
  };
}
