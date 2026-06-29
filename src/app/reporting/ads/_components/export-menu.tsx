'use client';

/**
 * Export control shared by every reporting tab. Takes a normalized ReportDoc
 * the tab already built from its data, and offers:
 *   - Excel → POSTs the doc to /api/reporting/export/xlsx for a formatted,
 *             multi-sheet workbook (numbers as real numbers).
 *   - PDF   → POSTs the doc to /api/reporting/export/pdf for a branded render.
 *   - CSV   → primary table only (CSV is single-table), generated client-side
 *             from raw values so it stays numeric in Google Sheets / Excel.
 */

import { useState, useRef, useEffect } from 'react';
import Papa from 'papaparse';
import {
  ArrowDownTrayIcon,
  DocumentArrowDownIcon,
  TableCellsIcon,
  DocumentTextIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import type { ReportDoc } from '@/lib/reporting/report-doc';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report';
}

export function ExportMenu({ doc, filenameBase }: { doc: ReportDoc; filenameBase: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const base = slug(filenameBase);

  const exportCsv = () => {
    const section = doc.sections[0];
    if (!section) return;
    // Raw values (NaN/null → blank) so the data stays numeric on import.
    const rows = section.rows.map((r) =>
      r.map((v) => (typeof v === 'number' ? (Number.isFinite(v) ? v : '') : (v ?? ''))),
    );
    const csv = Papa.unparse({ fields: section.columns.map((c) => c.header), data: rows });
    triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `${base}.csv`);
    setOpen(false);
  };

  const exportAs = async (format: 'xlsx' | 'pdf') => {
    setBusy(format);
    setErr(null);
    try {
      const res = await fetch(`/api/reporting/export/${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `Export failed (${res.status})`);
      }
      triggerDownload(await res.blob(), `${base}.${format}`);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  };

  const item =
    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--foreground)] hover:bg-[var(--muted)]/50 disabled:opacity-50';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--foreground)] transition-colors hover:border-[var(--primary)]/40 hover:bg-[var(--muted)]/40"
      >
        <ArrowDownTrayIcon className="h-4 w-4" />
        Export
        <ChevronDownIcon className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--background)] py-1 shadow-lg">
          <button type="button" onClick={() => exportAs('xlsx')} disabled={busy !== null} className={item}>
            <TableCellsIcon className="h-4 w-4 text-[var(--muted-foreground)]" />
            {busy === 'xlsx' ? 'Building Excel…' : 'Excel (.xlsx)'}
          </button>
          <button type="button" onClick={() => exportAs('pdf')} disabled={busy !== null} className={item}>
            <DocumentArrowDownIcon className="h-4 w-4 text-[var(--muted-foreground)]" />
            {busy === 'pdf' ? 'Generating PDF…' : 'PDF (full report)'}
          </button>
          <button type="button" onClick={exportCsv} disabled={busy !== null} className={item}>
            <DocumentTextIcon className="h-4 w-4 text-[var(--muted-foreground)]" />
            CSV (primary table)
          </button>
          {err && <p className="px-3 py-1.5 text-xs text-red-500">{err}</p>}
        </div>
      )}
    </div>
  );
}
