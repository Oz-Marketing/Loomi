'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  NoSymbolIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { HelpTip } from '@/components/ui/help-tip';
import type { MediaPreflight, PreflightFinding } from '@/lib/media-preflight';

/**
 * Review and approval for one asset — Phase 5 of docs/asset-management.md.
 *
 * Pre-flight runs live when the panel opens, so a reviewer sees the current
 * position rather than whatever was true at the last attempt. Blocks refuse the
 * approval; warnings are shown, recorded, and approved past — a gate that
 * refuses everything imperfect gets switched off within a month.
 */

function Finding({ f }: { f: PreflightFinding }) {
  const block = f.severity === 'block';
  return (
    <li className="flex items-start gap-2">
      {block ? (
        <NoSymbolIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
      ) : (
        <ExclamationTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
      )}
      <span className="min-w-0 flex-1 text-[11px] leading-snug text-[var(--foreground)]">
        {f.message}
        {/* The field citation is what makes this auditable rather than an opinion. */}
        <span className="ml-1 font-mono text-[10px] text-[var(--muted-foreground)]">
          {f.field}
        </span>
      </span>
    </li>
  );
}

export function ApprovalPanel({
  assetId,
  status,
  approvedByName,
  approvedAt,
  reviewNote,
  readOnly = false,
  onChanged,
}: {
  assetId: string;
  status?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  reviewNote?: string | null;
  readOnly?: boolean;
  /** Called with the updated asset so the list can restate itself. */
  onChanged?: (file: Record<string, unknown>) => void;
}) {
  const [preflight, setPreflight] = useState<MediaPreflight | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(reviewNote ?? '');

  const approved = status === 'approved';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(assetId)}/approval`);
      const data = await res.json();
      if (res.ok) setPreflight(data.preflight);
    } catch {
      /* supplementary — a failure here shouldn't break the modal */
    }
    setLoading(false);
  }, [assetId]);

  useEffect(() => { load(); }, [load]);

  async function act(action: 'approve' | 'revoke') {
    setBusy(true);
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(assetId)}/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: note.trim() || undefined }),
      });
      const data = await res.json();

      if (!res.ok) {
        // 422 carries the findings that stopped it — show them rather than a
        // generic failure, since the reviewer's next move depends on which.
        if (data?.preflight) setPreflight(data.preflight);
        toast.error(data?.error || 'Could not update approval');
      } else {
        if (data.preflight) setPreflight(data.preflight);
        onChanged?.(data.file);
        toast.success(action === 'approve' ? 'Asset approved' : 'Approval revoked');
      }
    } catch {
      toast.error('Could not update approval');
    }
    setBusy(false);
  }

  const blocks = preflight?.findings.filter((f) => f.severity === 'block') ?? [];
  const warns = preflight?.findings.filter((f) => f.severity === 'warn') ?? [];

  return (
    <div className="pt-3 border-t border-[var(--border)]">
      <div className="flex items-center justify-between mb-2">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          Review
          <HelpTip title="Review">
            <p>
              Approving marks an asset cleared for use. Clients only ever see
              approved assets.
            </p>
            <p className="mt-2">
              Checks run automatically. Blocking issues (a lapsed licence) refuse
              the approval; warnings are recorded and can be approved past.
            </p>
          </HelpTip>
        </h4>
        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
            approved
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
          }`}
        >
          {approved && <CheckCircleIcon className="h-3 w-3" />}
          {approved ? 'Approved' : 'Draft'}
        </span>
      </div>

      {approved && approvedByName && (
        <p className="mb-2 text-[11px] text-[var(--muted-foreground)]">
          Approved by {approvedByName}
          {approvedAt ? ` on ${new Date(approvedAt).toLocaleDateString()}` : ''}.
        </p>
      )}

      {loading ? (
        <p className="text-[11px] text-[var(--muted-foreground)]">Running checks…</p>
      ) : (
        <>
          {blocks.length === 0 && warns.length === 0 && (
            <p className="mb-2 flex items-center gap-1.5 text-[11px] text-emerald-400">
              <CheckCircleIcon className="h-3.5 w-3.5" />
              All checks passed.
            </p>
          )}

          {blocks.length > 0 && (
            <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/5 p-2.5">
              <p className="mb-1.5 text-[11px] font-semibold text-red-400">
                {blocks.length} issue{blocks.length > 1 ? 's' : ''} must be fixed before approval
              </p>
              <ul className="space-y-1">
                {blocks.map((f) => <Finding key={f.code} f={f} />)}
              </ul>
            </div>
          )}

          {warns.length > 0 && (
            <div className="mb-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-2.5">
              <p className="mb-1.5 text-[11px] font-semibold text-[var(--muted-foreground)]">
                {warns.length} thing{warns.length > 1 ? 's' : ''} worth recording
              </p>
              <ul className="space-y-1">
                {warns.map((f) => <Finding key={f.code} f={f} />)}
              </ul>
            </div>
          )}
        </>
      )}

      {!readOnly && (
        <>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Review note (optional) — carries back with a revoked asset."
            rows={2}
            className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-xs text-[var(--foreground)]"
          />
          <div className="mt-2 flex items-center gap-2">
            {approved ? (
              <button
                type="button"
                onClick={() => act('revoke')}
                disabled={busy}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:opacity-50"
              >
                {busy ? 'Working…' : 'Revoke approval'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => act('approve')}
                disabled={busy || loading || blocks.length > 0}
                title={blocks.length > 0 ? 'Fix the blocking issues first' : undefined}
                className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Working…' : 'Approve'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
