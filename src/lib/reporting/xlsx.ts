/**
 * Server-side report → Excel workbook. Renders a {@link ReportDoc} to a
 * branded, formatted .xlsx: a Summary sheet (header, meta, KPIs) plus one
 * sheet per table. Numbers land as real numbers with $/% formats, so the
 * output is analyzable (sum, sort, pivot) — not just text that looks like a
 * table.
 *
 * Each data sheet gets: indigo header band, frozen header, banded rows + thin
 * borders, AutoFilter dropdowns, a bold TOTAL row (live SUM/AVERAGE formulas),
 * and a color-scale on percent columns. Sheet tabs are tinted Loomi indigo.
 */
import ExcelJS from 'exceljs';
import { type ReportDoc, type ReportColumn, excelNumFmt } from './report-doc';

const INDIGO = 'FF6366F1';
const BAND = 'FFF6F6F9'; // very light gray for zebra striping
const BORDER = 'FFE4E4E7';
const TOTAL_FILL = 'FFEDEDF2';
const MUTED = 'FF71717A';

const THIN = { style: 'thin' as const, color: { argb: BORDER } };
const ALL_BORDERS = { top: THIN, bottom: THIN, left: THIN, right: THIN };

/** 1-based column index → spreadsheet letter (1→A, 27→AA). */
function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Excel sheet names are ≤31 chars and can't contain * ? : / \ [ ]. */
function sheetName(title: string, used: Set<string>): string {
  const base = title.replace(/[*?:/\\[\]]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` ${n++}`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(name.toLowerCase());
  return name;
}

/**
 * Coerce a raw value into something ExcelJS can serialize to valid XML.
 * Non-finite numbers (NaN / ±Infinity) and null/undefined would otherwise emit
 * malformed cells, which Excel reports as a corrupt file with missing data.
 */
function cellValue(v: unknown): string | number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return String(v);
}

function alignFor(type: ReportColumn['type']): 'left' | 'right' {
  return type === 'text' ? 'left' : 'right';
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.height = 20;
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INDIGO } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    // Left-align headers so the AutoFilter dropdown (right edge) never covers
    // the label; data cells keep their numeric right-alignment below.
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = ALL_BORDERS;
  });
}

/** Write a typed table to a sheet with the full styling treatment. */
function writeTableSheet(ws: ExcelJS.Worksheet, columns: ReportColumn[], rawRows: (string | number)[][]): void {
  ws.properties.tabColor = { argb: INDIGO };

  const headerRow = ws.addRow(columns.map((c) => c.header));
  styleHeaderRow(headerRow);
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  rawRows.forEach((r, idx) => {
    const row = ws.addRow(r.map(cellValue));
    const banded = idx % 2 === 1; // every other data row
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const fmt = excelNumFmt(c.type);
      if (fmt) cell.numFmt = fmt;
      cell.alignment = { horizontal: alignFor(c.type) };
      cell.border = ALL_BORDERS;
      if (banded) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
    });
  });

  const lastDataRow = 1 + rawRows.length;

  // ── Totals row: SUM for counts/money, AVERAGE for rates ──
  if (rawRows.length > 0) {
    const totals: (string | { formula: string; result: number })[] = columns.map((c, i) => {
      const mode = c.total ?? (c.type === 'percent' ? 'avg' : c.type === 'text' ? 'none' : 'sum');
      if (mode === 'none') return i === 0 ? 'TOTAL' : '';
      const L = colLetter(i + 1);
      const nums = rawRows
        .map((r) => r[i])
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      if (mode === 'avg') {
        const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
        return { formula: `AVERAGE(${L}2:${L}${lastDataRow})`, result: avg };
      }
      const sum = nums.reduce((a, b) => a + b, 0);
      return { formula: `SUM(${L}2:${L}${lastDataRow})`, result: sum };
    });
    const totalRow = ws.addRow(totals);
    totalRow.eachCell((cell, col) => {
      const c = columns[col - 1];
      cell.font = { bold: true };
      cell.alignment = { horizontal: alignFor(c?.type ?? 'text') };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } };
      cell.border = { ...ALL_BORDERS, top: { style: 'medium', color: { argb: INDIGO } } };
      const fmt = c ? excelNumFmt(c.type) : undefined;
      if (fmt) cell.numFmt = fmt;
    });
  }

  // ── AutoFilter over header + data (not the totals row) ──
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: lastDataRow, column: columns.length } };

  // ── Color scale on percent columns (data rows only) ──
  if (rawRows.length > 0) {
    columns.forEach((c, i) => {
      if (c.type !== 'percent') return;
      const L = colLetter(i + 1);
      ws.addConditionalFormatting({
        ref: `${L}2:${L}${lastDataRow}`,
        rules: [
          {
            type: 'colorScale',
            priority: 1,
            cfvo: [{ type: 'min' }, { type: 'percentile', value: 50 }, { type: 'max' }],
            color: [{ argb: 'FFF8696B' }, { argb: 'FFFFEB84' }, { argb: 'FF63BE7B' }],
          },
        ],
      });
    });
  }

  // ── Auto-fit column widths ──
  // Header needs ~3 extra chars of room for the AutoFilter dropdown button so
  // it doesn't sit on top of the label.
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    let max = c.header.length + 3;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? '').length;
      if (len > max) max = len;
    });
    col.width = Math.min(64, Math.max(12, max + 2));
  });
}

export async function renderReportXlsx(doc: ReportDoc): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Loomi Studio';
  wb.calcProperties.fullCalcOnLoad = true; // recompute TOTAL formulas on open
  const generatedAt = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const used = new Set<string>();

  // ── Summary sheet ──
  const summary = wb.addWorksheet(sheetName('Summary', used));
  summary.properties.tabColor = { argb: INDIGO };
  summary.mergeCells('A1:C1');
  const titleCell = summary.getCell('A1');
  titleCell.value = doc.title;
  titleCell.font = { bold: true, size: 16, color: { argb: INDIGO } };
  if (doc.subtitle) {
    summary.mergeCells('A2:C2');
    const sub = summary.getCell('A2');
    sub.value = doc.subtitle;
    sub.font = { color: { argb: MUTED }, size: 11 };
  }
  summary.addRow([]);
  for (const m of doc.meta ?? []) {
    const row = summary.addRow([m.label, m.value]);
    row.getCell(1).font = { bold: true, color: { argb: MUTED } };
  }
  if (doc.kpis?.length) {
    summary.addRow([]);
    const kpiHeader = summary.addRow(['Metric', 'Value', 'Detail']);
    styleHeaderRow(kpiHeader);
    doc.kpis.forEach((k, idx) => {
      const row = summary.addRow([k.label, k.value, k.secondary ?? '']);
      row.eachCell((cell) => {
        cell.border = ALL_BORDERS;
        if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
      });
      row.getCell(2).font = { bold: true };
    });
  }
  summary.addRow([]);
  summary.addRow([`Generated ${generatedAt}`]).font = { color: { argb: 'FFA1A1AA' }, size: 9 };
  summary.getColumn(1).width = 24;
  summary.getColumn(2).width = 30;
  summary.getColumn(3).width = 30;

  // ── One sheet per section ──
  for (const section of doc.sections) {
    const ws = wb.addWorksheet(sheetName(section.title, used));
    writeTableSheet(ws, section.columns, section.rows);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
