'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckIcon } from '@heroicons/react/24/outline';
import { AutomationTemplatePicker, type PickerTemplate } from './template-picker';
import { brandingFromAccount } from '@/components/ad-generator/ad-preview-thumb';
import type { AdData } from '@/lib/ad-generator/types';

/**
 * The dealer's view of automated ads: choose the design, and that's the whole
 * page.
 *
 * Monthly manufacturer offers are the agency's problem now — the pipeline reads
 * them from the feed, writes the disclaimer from the manufacturer's own wording
 * and builds the ads. The one thing that is genuinely the dealer's taste is what
 * those ads LOOK like, so that is the only control here. Everything else lives
 * behind the admin inspector.
 *
 * Saves through a narrow endpoint that can write nothing but the design — see
 * `api/ad-generator/automation/template`.
 */
export function ClientTemplateCard({
  accountKey,
  accountData,
}: {
  accountKey: string | null;
  accountData: Parameters<typeof brandingFromAccount>[0];
}) {
  const [templates, setTemplates] = useState<PickerTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [savedId, setSavedId] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!accountKey) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/ad-generator/automation/template?accountKey=${encodeURIComponent(accountKey)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { templateId?: string; enabled?: boolean; templates?: PickerTemplate[] }) => {
        if (cancelled) return;
        setTemplates(d.templates ?? []);
        setTemplateId(d.templateId ?? '');
        setSavedId(d.templateId ?? '');
        setEnabled(!!d.enabled);
      })
      .catch(() => {
        if (!cancelled) toast.error('Could not load your ad designs.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey]);

  const save = useCallback(async () => {
    if (!accountKey) return;
    setSaving(true);
    try {
      const res = await fetch('/api/ad-generator/automation/template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountKey, templateId }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(d.error || 'Could not save the design.');
        return;
      }
      setSavedId(templateId);
      toast.success(templateId ? 'Design saved.' : 'Design cleared.');
    } catch {
      toast.error('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  }, [accountKey, templateId]);

  const branding = brandingFromAccount(accountData) as AdData;
  const dirty = templateId !== savedId;

  if (!accountKey) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        Choose a sub-account in the top bar to set its ad design.
      </p>
    );
  }

  return (
    <section className="glass-card rounded-2xl border border-[var(--border)] p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">Design for automatic ads</h2>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity disabled:opacity-40"
        >
          <CheckIcon className="h-3.5 w-3.5" />
          {saving ? 'Saving…' : dirty ? 'Save design' : 'Saved'}
        </button>
      </div>
      <p className="mb-4 max-w-2xl text-xs text-[var(--muted-foreground)]">
        Your monthly manufacturer offers are built automatically — the vehicle, the payment and the
        legal wording all come straight from the manufacturer. Pick the look you want them to use.
      </p>

      {/* A design chosen for an automation nobody has switched on is a real
          state, and one someone should be told about rather than discover. */}
      {!enabled && !loading && (
        <p className="mb-4 rounded-lg bg-[var(--muted)]/50 px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
          Automatic ads aren&apos;t switched on for this sub-account yet. You can still choose a
          design — your Oz contact turns it on.
        </p>
      )}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[198px] animate-pulse rounded-xl bg-[var(--muted)]/50" />
          ))}
        </div>
      ) : (
        <AutomationTemplatePicker
          templates={templates}
          value={templateId}
          onChange={setTemplateId}
          branding={branding}
          disabled={saving}
        />
      )}
    </section>
  );
}
