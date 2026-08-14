'use client';

// Records the per-sub-account consent basis that gates audience sync.
//
// This is a compliance statement about how a dealer collected its CRM
// data, not a feature toggle — which is why it can't be inherited from
// the agency, defaulted, or set as a side effect of some other save.
// Each rooftop is affirmed on its own, by someone who can answer for it.
//
// Without it, `resolveEligibleForSync` throws and nothing can be exported
// to an ad platform. The segment builder surfaces the same blocker on its
// preview panel; this is where it gets resolved.

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';

interface ConsentState {
  recorded: boolean;
  basis: string | null;
  at: string | null;
  by: string | null;
  byName: string | null;
}

export interface AudienceConsentCardProps {
  accountKey: string;
  dealerName?: string | null;
  /** Only developers may record this — see the note above. Non-developers
   *  still see the STATE, since it explains why a sync is blocked. */
  canEdit: boolean;
}

const BASIS_LABEL: Record<string, string> = {
  first_party_disclosure:
    'First-party data, collected with disclosure permitting third-party advertising use',
};

export function AudienceConsentCard({
  accountKey,
  dealerName,
  canEdit,
}: AudienceConsentCardProps) {
  const [state, setState] = useState<ConsentState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/accounts/${encodeURIComponent(accountKey)}/audience-consent`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setState(data.consent ?? null);
    } catch {
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [accountKey]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(basis: string | null) {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/accounts/${encodeURIComponent(accountKey)}/audience-consent`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            basis === null ? { basis: null } : { basis, attest: true },
          ),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to save');
      }
      toast.success(
        basis === null
          ? 'Consent basis withdrawn — audience sync is blocked for this account.'
          : 'Consent basis recorded.',
      );
      setConfirming(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const recorded = !!state?.recorded;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="flex items-start gap-3">
        <ShieldCheckIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--primary)]" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-[var(--foreground)]">
              Audience sync consent
            </h3>
            {!loading && (
              <span
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                  recorded
                    ? 'border-emerald-500/40 text-emerald-500'
                    : 'border-amber-500/40 text-amber-500'
                }`}
              >
                {recorded ? (
                  <CheckCircleIcon className="h-3 w-3" />
                ) : (
                  <ExclamationTriangleIcon className="h-3 w-3" />
                )}
                {recorded ? 'Recorded' : 'Not recorded'}
              </span>
            )}
          </div>

          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Required before any segment from{' '}
            {dealerName ? <strong>{dealerName}</strong> : 'this account'} can be
            synced to Google Ads or another ad platform. It states how this
            dealer&rsquo;s contact data was collected — so it has to be affirmed
            per rooftop, not once for the agency.
          </p>

          {loading ? (
            <p className="mt-4 text-xs text-[var(--muted-foreground)]">Loading…</p>
          ) : recorded ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-lg border border-[var(--border)]/70 bg-[var(--background)] p-3">
                <p className="text-sm text-[var(--foreground)]">
                  {BASIS_LABEL[state!.basis ?? ''] ?? state!.basis}
                </p>
                <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                  Attested by {state!.byName ?? state!.by ?? 'unknown'}
                  {state!.at
                    ? ` on ${new Date(state!.at).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}`
                    : ''}
                </p>
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => submit(null)}
                  disabled={saving}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:border-red-500/50 hover:text-red-400 disabled:opacity-50"
                >
                  {saving ? 'Withdrawing…' : 'Withdraw consent'}
                </button>
              )}
            </div>
          ) : canEdit ? (
            <div className="mt-4">
              {confirming ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  {/* Spelled out rather than hidden behind a checkbox label:
                      whoever clicks this is making the statement. */}
                  <p className="text-sm text-[var(--foreground)]">
                    By recording this, you confirm that{' '}
                    {dealerName ?? 'this account'} collected its contact data
                    directly from its own customers, with disclosure permitting
                    that data to be used for advertising on third-party
                    platforms.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => submit('first_party_disclosure')}
                      disabled={saving}
                      className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--primary)]/90 disabled:opacity-50"
                    >
                      {saving ? 'Recording…' : 'I confirm — record it'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      disabled={saving}
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs transition-colors hover:bg-[var(--sidebar-muted)] disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--primary)]/90"
                >
                  Record consent basis
                </button>
              )}
            </div>
          ) : (
            <p className="mt-4 text-xs text-[var(--muted-foreground)]">
              Only a developer can record this. Audience sync stays blocked for
              this account until they do.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
