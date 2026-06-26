/**
 * Platform-agnostic "report document" — the normalized shape every reporting
 * tab produces for export. The client builds it from data it already fetched,
 * the PDF route renders it to a branded print template, and the XLSX route
 * renders it to a formatted workbook.
 *
 * Cells carry RAW values (numbers stay numbers) with a per-column {@link CellType}.
 * Display formatting is derived from the type via {@link formatCell} (used by the
 * PDF template) and Excel number formats via {@link excelNumFmt} — so numbers
 * land in the spreadsheet as real numbers you can sum and pivot.
 *
 * Convention: sections[0] is the report's PRIMARY table.
 */

export type CellType = 'text' | 'integer' | 'currency' | 'percent';

export interface ReportColumn {
  header: string;
  type: CellType;
  /**
   * How the Excel TOTAL row aggregates this column. Defaults by type
   * (integer/currency → 'sum', percent → 'avg', text → 'none'). Override with
   * 'none' for non-additive numbers like Quality Score or CPM, where a sum or
   * mean would mislead.
   */
  total?: 'sum' | 'avg' | 'none';
}

export interface ReportSection {
  title: string;
  columns: ReportColumn[];
  /** Raw values: numbers for numeric columns, strings for text columns. */
  rows: (string | number)[][];
}

export interface ReportKpi {
  label: string;
  value: string;
  secondary?: string;
}

export interface ReportDoc {
  /** e.g. "Meta Ads — Young Honda". */
  title: string;
  /** e.g. "May 17 – Jun 16, 2026". */
  subtitle?: string;
  /** Small key/value facts rendered under the header (account, range, etc.). */
  meta?: { label: string; value: string }[];
  kpis?: ReportKpi[];
  sections: ReportSection[];
}

/**
 * Format a raw cell value for display (PDF + any text rendering). Mirrors the
 * on-screen formatters in shared.tsx (`usd`, `num`, `pctText`). Percent values
 * are stored in percent units (2.5 → "2.50%").
 */
export function formatCell(value: string | number, type: CellType): string {
  if (typeof value === 'number' && !Number.isFinite(value)) return '—';
  if (typeof value !== 'number') return String(value ?? '');
  switch (type) {
    case 'currency':
      return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
    case 'percent':
      return `${value.toFixed(2)}%`;
    case 'integer':
      return Math.round(value).toLocaleString('en-US');
    default:
      return String(value);
  }
}

/** Excel number format string for a column type, or undefined for plain text. */
export function excelNumFmt(type: CellType): string | undefined {
  switch (type) {
    case 'currency':
      return '$#,##0.00';
    case 'percent':
      // Value is already in percent units, so suffix without dividing.
      return '0.00"%"';
    case 'integer':
      return '#,##0';
    default:
      return undefined;
  }
}

// ── Export-route helpers (shared by the PDF + XLSX routes) ──

/**
 * Structural validation for an inbound {@link ReportDoc} (untrusted request
 * body). Confirms the shape the renderers rely on — a string title and an
 * array of sections, each with title/columns/rows — without trusting the
 * caller. Cell values are tolerated as-is; the renderers coerce them.
 */
export function isValidReportDoc(d: unknown): d is ReportDoc {
  if (!d || typeof d !== 'object') return false;
  const doc = d as Record<string, unknown>;
  if (typeof doc.title !== 'string') return false;
  if (!Array.isArray(doc.sections)) return false;
  return doc.sections.every(
    (s) =>
      s &&
      typeof s === 'object' &&
      typeof (s as ReportSection).title === 'string' &&
      Array.isArray((s as ReportSection).columns) &&
      Array.isArray((s as ReportSection).rows),
  );
}

/** Slugify a report title into a safe download filename stem. */
export function sanitizeReportFilename(value: string): string {
  const safe = value.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return safe || 'report';
}

/**
 * Upper bounds on an export payload. A single authenticated user could
 * otherwise post a doc large enough to exhaust memory while rendering
 * (headless Chromium for PDF, an in-memory workbook for XLSX). Real reports
 * sit far below these, so they only ever trip on a runaway/abusive request.
 */
export const REPORT_DOC_LIMITS = {
  maxSections: 40,
  maxColumns: 64,
  maxRowsTotal: 50_000,
} as const;

/**
 * Returns a human-readable reason if the doc exceeds {@link REPORT_DOC_LIMITS},
 * else null. Routes should treat a non-null result as a 413.
 */
export function reportDocSizeError(doc: ReportDoc): string | null {
  if (doc.sections.length > REPORT_DOC_LIMITS.maxSections) {
    return `Too many sections (${doc.sections.length} > ${REPORT_DOC_LIMITS.maxSections})`;
  }
  let totalRows = 0;
  for (const s of doc.sections) {
    if (s.columns.length > REPORT_DOC_LIMITS.maxColumns) {
      return `Too many columns in "${s.title}" (${s.columns.length} > ${REPORT_DOC_LIMITS.maxColumns})`;
    }
    totalRows += s.rows.length;
  }
  if (totalRows > REPORT_DOC_LIMITS.maxRowsTotal) {
    return `Too many rows (${totalRows} > ${REPORT_DOC_LIMITS.maxRowsTotal})`;
  }
  return null;
}
