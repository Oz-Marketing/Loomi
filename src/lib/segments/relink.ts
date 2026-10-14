// Re-linking per-account segment copies to the group original they were
// fanned out from.
//
// "Also create in…" records each copy's original in
// `Audience.sourceAudienceId` (see ./copies.ts). Copies made before that
// link was written have it null, so the original's editor finds no copies
// and never offers the after-save push — editing the group's segment then
// silently changes the group alone.
//
// Pure, like copies.ts and fan-out.ts: deciding which rows count as copies
// is where a mistake would link the wrong segments, so it is unit-tested
// here and the script only queries and writes.

import { copyMatchesSource, type PushableSegment } from './copies';

export interface RelinkSegment extends PushableSegment {
  id: string;
  accountKey: string | null;
  sourceAudienceId: string | null;
}

export type RelinkSkipReason =
  | 'org-wide'
  | 'outside-group'
  | 'linked-elsewhere'
  | 'already-linked';

export interface PlanRelinkInput {
  source: RelinkSegment;
  /** Segments carrying the source's name, wherever they live. */
  candidates: RelinkSegment[];
  /** Accounts beneath the source's account — descendants only, not itself. */
  descendantKeys: string[];
}

export interface PlanRelinkResult {
  /** Copies to point at the source. */
  link: RelinkSegment[];
  /** Of `link`, those whose definition already matches the source. The
   *  rest will show as "Out of date" once linked; linking never rewrites
   *  them — only a push does. */
  matching: RelinkSegment[];
  skipped: Array<{ segment: RelinkSegment; reason: RelinkSkipReason }>;
}

export function planRelink({ source, candidates, descendantKeys }: PlanRelinkInput): PlanRelinkResult {
  const below = new Set(descendantKeys);
  const link: RelinkSegment[] = [];
  const matching: RelinkSegment[] = [];
  const skipped: PlanRelinkResult['skipped'] = [];

  for (const seg of candidates) {
    // Matching by name only, so the source itself and anything not named
    // the same are not candidates at all.
    if (seg.id === source.id || seg.name !== source.name) continue;

    let reason: RelinkSkipReason | null = null;
    if (seg.sourceAudienceId === source.id) reason = 'already-linked';
    else if (seg.sourceAudienceId !== null) reason = 'linked-elsewhere';
    else if (seg.accountKey === null) reason = 'org-wide';
    // A segment travels DOWN the hierarchy (visibility.ts), so a same-named
    // segment in a sibling group or above is someone else's, not a copy.
    else if (!below.has(seg.accountKey)) reason = 'outside-group';

    if (reason) {
      skipped.push({ segment: seg, reason });
      continue;
    }
    link.push(seg);
    if (copyMatchesSource(source, seg)) matching.push(seg);
  }

  return { link, matching, skipped };
}
