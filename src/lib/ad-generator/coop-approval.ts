/**
 * Co-op pre-approval of a template — the pure half.
 *
 * The manufacturer approves a PLATE, not fifty ads. Once it has, every ad
 * generated from that plate inherits the approval, which is what lets the
 * pipeline launch unattended without a per-ad reviewer: the thing a human signed
 * off is the template, and an ad is that template with the month's numbers in it.
 *
 * An approval is therefore only as good as its scope, and it has exactly two ways
 * to go out of date:
 *
 *   - the DESIGN moved. Someone edited the template after approval, so what the
 *     OEM saw is not what would ship. This is why approval carries a design hash
 *     rather than a template id.
 *   - the RULES moved. Co-op guidelines get reissued; an approval granted against
 *     the 2026-Q2 edition doesn't speak for 2026-Q3.
 *
 * Neither makes the ad *wrong* — it makes the approval unable to vouch for it. So
 * both degrade to "needs re-confirming", never to "silently still approved".
 */

/** Approval as it stands right now. */
export type ApprovalState =
  /** No approval has ever been recorded for this make. */
  | 'none'
  /** Approved, design unchanged, rules unchanged. Launchable unattended. */
  | 'current'
  /** Approved, but the template has been edited since. */
  | 'stale_design'
  /** Approved, but the make has reissued its guidelines since. */
  | 'stale_pack'
  /** The most recent approval was withdrawn. */
  | 'revoked';

/** The columns this module reasons about. */
export interface ApprovalRow {
  id: string;
  /** Only needed when rows for several templates are grouped; the resolver
   *  itself is always called with one template's rows. */
  templateId?: string;
  make: string;
  docHash: string;
  packVersion: string | null;
  reference?: string | null;
  approvedByName?: string | null;
  approvedAt: Date | string;
  revokedAt?: Date | string | null;
  revokedByName?: string | null;
}

export interface ApprovalStatus {
  state: ApprovalState;
  /** The row the state was derived from, when there is one. */
  approval: ApprovalRow | null;
  /** One sentence, written for a reviewer rather than a log. */
  reason: string;
}

/** True only when the approval can vouch for what would ship right now. */
export function approvalIsCurrent(status: ApprovalStatus): boolean {
  return status.state === 'current';
}

function time(v: Date | string): number {
  return v instanceof Date ? v.getTime() : new Date(v).getTime();
}

function sameMake(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Resolve the approval standing for one template + make.
 *
 * @param rows              Every approval row for the template (any make).
 * @param docHash           The template's CURRENT design hash.
 * @param make              The make being advertised — an ad's make, not the
 *                          template's, since a shared plate carries none.
 * @param activePackVersion The make's current guideline edition, when one is on
 *                          file. Omit and pack staleness isn't evaluated: with no
 *                          pack to compare against, calling an approval stale
 *                          would be an assertion about rules nobody has.
 */
export function resolveTemplateApproval(
  rows: ApprovalRow[],
  params: { docHash: string; make: string; activePackVersion?: string | null },
): ApprovalStatus {
  const { docHash, make, activePackVersion } = params;
  const mine = rows
    .filter((r) => sameMake(r.make, make))
    // Newest first — re-approval after a redesign appends, so the latest row is
    // the one that speaks.
    .sort((a, b) => time(b.approvedAt) - time(a.approvedAt));

  if (mine.length === 0) {
    return {
      state: 'none',
      approval: null,
      reason: `No ${make} co-op approval is on file for this template.`,
    };
  }

  const live = mine.filter((r) => !r.revokedAt);
  if (live.length === 0) {
    const latest = mine[0];
    return {
      state: 'revoked',
      approval: latest,
      reason: `The ${make} co-op approval for this template was withdrawn${
        latest.revokedByName ? ` by ${latest.revokedByName}` : ''
      }.`,
    };
  }

  const approval = live[0];

  if (approval.docHash !== docHash) {
    return {
      state: 'stale_design',
      approval,
      reason: `This template has been edited since ${make} approved it, so the approval no longer covers the current design. Re-confirm it before these ads run unattended.`,
    };
  }

  if (activePackVersion && approval.packVersion && approval.packVersion !== activePackVersion) {
    return {
      state: 'stale_pack',
      approval,
      reason: `Approved against ${make}'s ${approval.packVersion} guidelines, but ${activePackVersion} is now in force. Re-confirm against the new edition.`,
    };
  }

  return {
    state: 'current',
    approval,
    reason: `Approved for ${make} co-op${approval.approvedByName ? ` by ${approval.approvedByName}` : ''}${
      approval.reference ? ` (${approval.reference})` : ''
    }.`,
  };
}

/** Short label for a badge. */
export function approvalLabel(state: ApprovalState): string {
  switch (state) {
    case 'current':
      return 'Co-op approved';
    case 'stale_design':
      return 'Approval out of date';
    case 'stale_pack':
      return 'Guidelines reissued';
    case 'revoked':
      return 'Approval withdrawn';
    default:
      return 'Not approved';
  }
}
