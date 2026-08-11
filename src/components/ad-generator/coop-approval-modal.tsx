'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { XMarkIcon, CheckBadgeIcon } from '@heroicons/react/24/outline';
import type { ApprovalRow, ApprovalStatus } from '@/lib/ad-generator/coop-approval';
import { approvalLabel } from '@/lib/ad-generator/coop-approval';

/**
 * Record that a manufacturer's co-op programme approved this template.
 *
 * This is the sign-off that lets ads generated from the template launch with no
 * per-ad reviewer, so the dialog asks for the evidence — which programme, which
 * guideline edition, and the case number or email that granted it. A reimbursement
 * dispute months later is exactly when somebody has to produce that, and "it was
 * approved, I remember" is not an answer.
 *
 * The approval is tied to the template's CURRENT design. Editing the template
 * afterwards doesn't silently keep it: the design hash moves and the approval
 * reads as out of date until someone re-confirms.
 */
export function CoopApprovalModal({
  templateId,
  templateName,
  /** The template's own make, when it declares one — prefills the field. */
  defaultMake,
  onClose,
  onSaved,
}: {
  templateId: string;
  templateName: string;
  defaultMake?: string | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [make, setMake] = useState(defaultMake?.trim() ?? '');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<ApprovalRow[] | null>(null);
  const [status, setStatus] = useState<ApprovalStatus | null>(null);

  // Load the history, and the standing for the prefilled make.
  useEffect(() => {
    let cancelled = false;
    const qs = make.trim() ? `?make=${encodeURIComponent(make.trim())}` : '';
    fetch(`/api/ad-generator/templates-doc/${templateId}/coop-approval${qs}`)
      .then((r) => (r.ok ? r.json() : { approvals: [], status: null }))
      .then((d: { approvals?: ApprovalRow[]; status?: ApprovalStatus | null }) => {
        if (cancelled) return;
        setRows(d.approvals ?? []);
        setStatus(d.status ?? null);
        // A template that declares no make of its own prefills from whatever is
        // already approved. Without this, opening the dialog on an approved
        // shared plate lists the approval while showing no standing and disabling
        // both buttons — it looks broken, and the fix is for the user to retype a
        // make the page already knows.
        if (!make.trim()) {
          const existing = (d.approvals ?? []).find((r) => !r.revokedAt)?.make;
          if (existing) setMake(existing);
        }
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
    // Re-reads when the make changes, since the standing is per make.
  }, [templateId, make]);

  const save = async () => {
    if (!make.trim()) {
      toast.error('Which manufacturer approved it?');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/ad-generator/templates-doc/${templateId}/coop-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ make: make.trim(), reference, note }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      toast.success(`Recorded — ads from this template can now run unattended for ${make.trim()}`);
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(`Couldn't record it: ${err instanceof Error ? err.message : 'unknown error'}`);
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!make.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/ad-generator/templates-doc/${templateId}/coop-approval?make=${encodeURIComponent(make.trim())}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      toast.success('Approval withdrawn — ads from this template will be held as drafts');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(`Couldn't withdraw it: ${err instanceof Error ? err.message : 'unknown error'}`);
      setBusy(false);
    }
  };

  const live = (rows ?? []).filter((r) => !r.revokedAt);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={() => !busy && onClose()}>
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] shadow-xl backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b border-[var(--border)] p-5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-[var(--foreground)]">
              <CheckBadgeIcon className="h-4 w-4 text-emerald-500" />
              Co-op approval
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              Record that a manufacturer approved &ldquo;{templateName}&rdquo;. Ads generated from it
              then run unattended instead of waiting as drafts.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            title="Close"
            aria-label="Close"
            className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {status && status.state !== 'none' && (
            <div
              className={`rounded-xl border p-3 text-xs ${
                status.state === 'current'
                  ? 'border-emerald-500/40 bg-emerald-500/10'
                  : 'border-amber-500/40 bg-amber-500/10'
              }`}
            >
              <div className="font-semibold text-[var(--foreground)]">{approvalLabel(status.state)}</div>
              <div className="mt-0.5 text-[var(--muted-foreground)]">{status.reason}</div>
            </div>
          )}

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[var(--foreground)]">Manufacturer</span>
            <input
              value={make}
              onChange={(e) => setMake(e.target.value)}
              placeholder="Chevrolet"
              disabled={busy}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            />
            <span className="mt-1 block text-[11px] text-[var(--muted-foreground)]">
              Approvals are per manufacturer — a shared plate can be approved by several,
              independently.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[var(--foreground)]">
              Reference <span className="font-normal text-[var(--muted-foreground)]">(optional)</span>
            </span>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Co-op case number, or who sent the approval"
              disabled={busy}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[var(--foreground)]">
              Note <span className="font-normal text-[var(--muted-foreground)]">(optional)</span>
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Anything the programme conditioned the approval on"
              disabled={busy}
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            />
          </label>

          {live.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                On file
              </div>
              <ul className="space-y-1">
                {live.map((r) => (
                  <li key={r.id} className="rounded-lg border border-[var(--border)] p-2 text-[11px]">
                    <span className="font-semibold text-[var(--foreground)]">{r.make}</span>
                    {r.packVersion ? ` · ${r.packVersion}` : ''}
                    {r.reference ? ` · ${r.reference}` : ''}
                    <div className="text-[var(--muted-foreground)]">
                      {r.approvedByName ?? 'Unknown'} · {new Date(r.approvedAt).toLocaleDateString()}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] p-4">
          {/* Withdrawing is the destructive one — ads fall back to drafts — so it
              sits away from the confirm and never becomes the default action. */}
          <button
            onClick={revoke}
            disabled={busy || !make.trim() || !live.some((r) => r.make.toLowerCase() === make.trim().toLowerCase())}
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-40"
          >
            Withdraw
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy || !make.trim()}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Record approval'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
