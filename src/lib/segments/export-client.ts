'use client';

// Browser side of the segment CSV export, shared by the segments index,
// the segment builder, and the filtered Contacts view so all three
// produce the same file and report the same errors.
//
// The rows come from the server (POST /api/segments/export), which is
// where `contacts.pii.export` is checked and the export recorded. The
// browser only triggers the download.

import { toast } from '@/lib/toast';
import type { FilterDefinition } from '@/lib/smart-list-types';

export function downloadCsvBlob(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Pull the server's filename out of Content-Disposition, if it sent one. */
function filenameFromResponse(res: Response, fallback: string): string {
  const header = res.headers.get('Content-Disposition') || '';
  const match = /filename="([^"]+)"/.exec(header);
  return match?.[1] || fallback;
}

export interface SegmentExportRequest {
  /** Accounts to resolve the segment against — a single rooftop, or every
   *  rooftop in a group roll-up. */
  accountKeys: string[];
  /** A saved segment… */
  segmentId?: string | null;
  /** …or an unsaved definition from the builder. One of the two. */
  definition?: FilterDefinition | null;
  /** Used only for the fallback filename and the toast. */
  label?: string;
}

/**
 * Export a segment to CSV. Returns true on success; failures are
 * reported by toast, so callers only need the flag for their own
 * busy state.
 */
export async function exportSegmentCsv(req: SegmentExportRequest): Promise<boolean> {
  if (req.accountKeys.length === 0) {
    toast.error('Pick an account before exporting — a segment is sized per account.');
    return false;
  }
  try {
    const res = await fetch('/api/segments/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountKeys: req.accountKeys,
        ...(req.segmentId ? { segmentId: req.segmentId } : {}),
        ...(req.definition ? { definition: req.definition } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(
        res.status === 403
          ? "You don't have permission to export contacts."
          : typeof detail?.error === 'string'
            ? detail.error
            : 'Export failed',
      );
    }
    const csv = await res.text();
    const stamp = new Date().toISOString().slice(0, 10);
    const fallback = `${(req.label || 'segment')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'segment'}-${stamp}.csv`;
    downloadCsvBlob(filenameFromResponse(res, fallback), csv);
    // Row count comes from the file itself — the header line is not a
    // contact, so a one-row file is one contact, not two.
    const rows = Math.max(0, csv.split('\n').length - 1);
    toast.success(`Exported ${rows.toLocaleString()} contact${rows === 1 ? '' : 's'}.`);
    return true;
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Export failed');
    return false;
  }
}
