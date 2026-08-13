import type { MediaAsset } from '@prisma/client';
import { assessRights, RIGHTS_STATUS_LABELS, licenseTypeLabel } from '@/lib/media-rights';
import { assetCategoryLabel, assetSourceLabel, parseListColumn } from '@/lib/media-metadata';

/**
 * Rights export — the surviving half of the spreadsheet idea.
 *
 * The round-trip (export, edit, re-import) was rejected: OEM licence terms are
 * uniform per programme, so a per-row editor solves variation this problem
 * doesn't have, and bulk edit does the same job without a parser. What survives
 * is the READ: handing someone a sheet of what's licensed, to whom, through
 * when, and what has already lapsed.
 *
 * That's a rights review, an insurance question, or an OEM asking what you're
 * still running — all of which want a file, not a screen.
 *
 * Deliberately no import counterpart. If per-row values ever genuinely differ
 * (a stock invoice with per-image terms), build it then, against a real shape.
 */

/** Matches the escaping used by the form-submissions export. */
function escapeCsvCell(value: unknown): string {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Columns, in the order a reviewer reads them: what it is, whose it is, what the
 * licence says, and — last, because it's the answer everything else supports —
 * whether it's still usable.
 */
export const RIGHTS_EXPORT_HEADERS = [
  'Filename',
  'Scope',
  'Brand',
  'Asset type',
  'Source',
  'Rights holder',
  'Licence type',
  'Agreement ref',
  'Licence starts',
  'Licence expires',
  'Campaign ends',
  'Usage scope',
  'Territory',
  'Derivatives allowed',
  'Sublicensing allowed',
  'Review status',
  'Rights status',
  'Days remaining',
] as const;

/** ISO date only — a review reads dates, not timestamps. */
function day(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : '';
}

/**
 * Tri-state booleans read as words, not `true`/`false`/blank.
 *
 * Blank and "no" mean very different things for a licence — "we never recorded
 * whether derivatives are allowed" is a gap to chase, "derivatives are not
 * allowed" is a constraint to honour — and a spreadsheet blank hides that.
 */
function triState(v: boolean | null): string {
  if (v === null || v === undefined) return 'Not recorded';
  return v ? 'Yes' : 'No';
}

function scopeOf(a: MediaAsset): string {
  if (a.accountKey) return a.accountKey;
  return a.oem ? `Shared — ${a.oem}` : 'Loomi library (all accounts)';
}

export function rightsExportRow(asset: MediaAsset, now: Date): string {
  const rights = assessRights(asset, now);
  return [
    asset.filename,
    scopeOf(asset),
    asset.oem ?? '',
    assetCategoryLabel(asset.assetCategory) ?? '',
    assetSourceLabel(asset.assetSource) ?? '',
    asset.rightsHolder ?? '',
    licenseTypeLabel(asset.licenseType) ?? '',
    asset.licenseRef ?? '',
    day(asset.licenseStartsAt),
    day(asset.licenseExpiresAt),
    day(asset.expiresAt),
    parseListColumn(asset.usageScope).join('; '),
    parseListColumn(asset.territoryScope).join('; '),
    triState(asset.derivativesPermitted),
    triState(asset.sublicensingPermitted),
    asset.status === 'approved' ? 'Approved' : 'Draft',
    RIGHTS_STATUS_LABELS[rights.status],
    // Negative reads as overdue, which is what a reviewer wants to see.
    rights.daysRemaining ?? '',
  ]
    .map(escapeCsvCell)
    .join(',');
}

export function rightsExportCsv(assets: MediaAsset[], now = new Date()): string {
  const lines = [
    RIGHTS_EXPORT_HEADERS.map(escapeCsvCell).join(','),
    ...assets.map((a) => rightsExportRow(a, now)),
  ];
  // CRLF: Excel is the destination, and it's the line ending Excel expects.
  return lines.join('\r\n');
}

/** `loomi-rights-2026-08-13.csv` */
export function rightsExportFilename(now = new Date()): string {
  return `loomi-rights-${now.toISOString().slice(0, 10)}.csv`;
}
