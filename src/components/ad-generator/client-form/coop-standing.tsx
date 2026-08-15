'use client';

import { useEffect, useState } from 'react';
import { Tooltip } from '@/app/app/tools/_shared/Tooltip';
import type { ApprovalState } from '@/lib/ad-generator/coop-approval';

/**
 * Co-op standing for the template this ad is built from.
 *
 * The manufacturer approves a PLATE, not fifty ads, so this is a property of the
 * TEMPLATE and the make — never of the offer in front of you. It's shown here
 * because this is where someone is about to export, and "the design moved since
 * the OEM saw it" is worth knowing before the ad ships, not after the co-op claim
 * comes back rejected weeks later.
 *
 * Read-only. Granting an approval is a privileged act with its own admin flow;
 * this only reports what the record says.
 */

const PRESENTATION: Record<ApprovalState, { label: string; tone: 'ok' | 'warn' | 'bad' | 'none' }> = {
  current: { label: 'Co-op approved', tone: 'ok' },
  stale_design: { label: 'Approval needs re-confirming', tone: 'warn' },
  stale_pack: { label: 'Approval needs re-confirming', tone: 'warn' },
  revoked: { label: 'Approval withdrawn', tone: 'bad' },
  none: { label: 'No co-op approval on file', tone: 'none' },
};

const TONE_CLASS: Record<'ok' | 'warn' | 'bad' | 'none', string> = {
  ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warn: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  bad: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  none: 'border-[var(--border)] bg-[var(--muted)]/40 text-[var(--muted-foreground)]',
};

export function CoopStanding({ templateId, make }: { templateId: string; make: string }) {
  const [state, setState] = useState<ApprovalState | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!templateId || !make.trim()) {
      setState(null);
      return;
    }
    let cancelled = false;
    fetch(
      `/api/ad-generator/templates-doc/${encodeURIComponent(templateId)}/coop-approval?make=${encodeURIComponent(make)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { status?: { state: ApprovalState; reason: string } | null } | null) => {
        if (cancelled) return;
        setState(d?.status?.state ?? null);
        setReason(d?.status?.reason ?? '');
      })
      // A code-defined template has no approval record and the lookup 404s. That
      // is "nothing to report", not an error worth putting in front of anyone.
      .catch(() => {
        if (!cancelled) setState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [templateId, make]);

  if (!state) return null;
  const { label, tone } = PRESENTATION[state];

  return (
    <Tooltip label={reason || label}>
      <span
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium ${TONE_CLASS[tone]}`}
      >
        <span aria-hidden="true" className="text-[13px] leading-none">
          {tone === 'ok' ? '✓' : tone === 'none' ? '·' : '!'}
        </span>
        {label}
      </span>
    </Tooltip>
  );
}
