import { assessRights, type RightsInput } from '@/lib/media-rights';
import { parseListColumn } from '@/lib/media-metadata';

/**
 * Asset compliance pre-flight — Phase 5 of docs/asset-management.md (§3).
 *
 * Runs when someone tries to approve an asset. Every check is DETERMINISTIC and
 * cites the field it read: a compliance gate that can't be audited won't be
 * trusted and will get switched off, which is the same reasoning that governs
 * the Ad Generator's co-op rule packs.
 *
 * Nothing here inspects pixels. "Is the logo the right size" is a question for
 * the design-time template checks, and guessing at it from an image would
 * produce exactly the confident-but-wrong finding that discredits the whole gate.
 *
 * Two severities, and the distinction is the whole design:
 *
 *  • BLOCK — approving would assert something false. An asset whose licence has
 *    lapsed cannot be "cleared for use", regardless of who clicks the button.
 *  • WARN — the asset is usable but under-described. A reviewer may approve
 *    anyway; the warning is recorded on the approval so the gap is visible later.
 *
 * Pure: no Prisma, no clock of its own.
 */

export type PreflightSeverity = 'block' | 'warn';

export interface PreflightFinding {
  severity: PreflightSeverity;
  /** Stable id, so a finding can be referenced without matching on prose. */
  code: string;
  message: string;
  /** Which field produced it — the citation that makes this auditable. */
  field: string;
}

export interface MediaPreflight {
  findings: PreflightFinding[];
  /** True when nothing blocks. Warnings do not prevent approval. */
  canApprove: boolean;
  /** ISO timestamp, stamped by the caller so this stays pure. */
  checkedAt: string;
}

/** The asset shape pre-flight reads. */
export interface PreflightInput extends RightsInput {
  mimeType: string;
  altText?: string | null;
  assetCategory?: string | null;
  assetSource?: string | null;
  rightsHolder?: string | null;
  oem?: string | null;
  accountKey?: string | null;
  derivativesPermitted?: boolean | null;
  usageScope?: string | null;
  /** How many renditions exist — for the derivatives check. */
  renditionCount?: number;
}

function isImage(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('image/');
}

/**
 * Sources whose assets belong to someone else, so a missing rights holder is a
 * real gap rather than a formality. An Oz-created asset needs no third party
 * named; a licensed one does.
 */
const THIRD_PARTY_SOURCES = new Set(['oem-supplied', 'stock', 'dealer-supplied']);

export function runPreflight(asset: PreflightInput, now: Date): MediaPreflight {
  const findings: PreflightFinding[] = [];

  // ── Rights ──

  const rights = assessRights(asset, now);

  if (rights.status === 'expired' || rights.status === 'lapsed') {
    findings.push({
      severity: 'block',
      code: 'rights_expired',
      field: rights.reason === 'effective' ? 'expiresAt' : 'licenseExpiresAt',
      message:
        rights.reason === 'effective'
          ? 'The campaign or offer this asset supports has ended.'
          : 'The licence for this asset has expired.',
    });
  } else if (rights.status === 'expiring_soon') {
    // Not a block: approving something with three weeks left is legitimate, and
    // refusing would make the last month of every licence unusable.
    findings.push({
      severity: 'warn',
      code: 'rights_expiring',
      field: 'licenseExpiresAt',
      message: `Expires in ${rights.daysRemaining} day${rights.daysRemaining === 1 ? '' : 's'} — plan a replacement.`,
    });
  } else if (rights.status === 'unknown' && THIRD_PARTY_SOURCES.has(asset.assetSource ?? '')) {
    // Third-party material with no licence window recorded. A warning rather
    // than a block, because most of a migrating library is in this state and
    // blocking would make approval impossible before a full rights audit.
    findings.push({
      severity: 'warn',
      code: 'rights_unrecorded',
      field: 'licenseExpiresAt',
      message: 'No licence window recorded for third-party material.',
    });
  }

  if (THIRD_PARTY_SOURCES.has(asset.assetSource ?? '') && !asset.rightsHolder?.trim()) {
    findings.push({
      severity: 'warn',
      code: 'rights_holder_missing',
      field: 'rightsHolder',
      message: 'No rights holder recorded for third-party material.',
    });
  }

  // Derivatives already exist for an asset whose licence forbids them. This IS a
  // block: the renditions are the breach, and approving the master would bless
  // it. The fix is to delete them or correct the licence, not to wave it through.
  if (asset.derivativesPermitted === false && (asset.renditionCount ?? 0) > 0) {
    findings.push({
      severity: 'block',
      code: 'derivatives_forbidden',
      field: 'derivativesPermitted',
      message: `Licence forbids derivative works, but ${asset.renditionCount} generated size(s) exist.`,
    });
  }

  // ── Classification ──

  if (!asset.assetCategory) {
    findings.push({
      severity: 'warn',
      code: 'category_missing',
      field: 'assetCategory',
      message: 'No asset type set — this asset will be hard to find.',
    });
  }

  if (!asset.assetSource) {
    findings.push({
      severity: 'warn',
      code: 'source_missing',
      field: 'assetSource',
      message: 'No source recorded — where this came from is unknown.',
    });
  }

  // An OEM-scoped asset (shared, no owning account) with no brand is
  // unreachable: the resolution rule matches on `oem`, so nobody will ever see
  // it. That makes it a block — approving it would publish it to no one.
  if (asset.accountKey == null && !asset.oem && asset.assetSource === 'oem-supplied') {
    findings.push({
      severity: 'block',
      code: 'oem_scope_missing',
      field: 'oem',
      message: 'OEM-supplied shared asset has no brand set, so no account can see it.',
    });
  }

  // ── Accessibility ──

  if (isImage(asset.mimeType) && !asset.altText?.trim()) {
    findings.push({
      severity: 'warn',
      code: 'alt_text_missing',
      field: 'altText',
      message: 'No alt text — required for accessible email and landing pages.',
    });
  }

  // ── Usage ──

  // Absent and empty both mean "not recorded". Keying off `undefined` would make
  // the check depend on how the caller happened to build the object rather than
  // on the data — a gate that silently skips itself is worse than no gate.
  if (
    THIRD_PARTY_SOURCES.has(asset.assetSource ?? '')
    && parseListColumn(asset.usageScope).length === 0
  ) {
    findings.push({
      severity: 'warn',
      code: 'usage_scope_missing',
      field: 'usageScope',
      message: 'No usage scope recorded — which channels this is licensed for is unknown.',
    });
  }

  return {
    findings,
    canApprove: !findings.some((f) => f.severity === 'block'),
    checkedAt: now.toISOString(),
  };
}

/** Parse a stored preflight blob. Never throws. */
export function parsePreflight(raw?: string | null): MediaPreflight | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.findings)) return null;
    return parsed as MediaPreflight;
  } catch {
    return null;
  }
}

export function countBySeverity(p: MediaPreflight): { blocks: number; warns: number } {
  return {
    blocks: p.findings.filter((f) => f.severity === 'block').length,
    warns: p.findings.filter((f) => f.severity === 'warn').length,
  };
}
