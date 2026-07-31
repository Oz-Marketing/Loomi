'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { ShadowReport } from './types';

/**
 * One sub-account's automation state — the report, the editable settings, and
 * the actions.
 *
 * Lifted out of ShadowPanel because the on/off switch lives in the page header
 * while the settings form lives in a tab, and `save_config` is a FULL REPLACE:
 * every field the request omits is reset to its default. A toggle that posted
 * only `{enabled}` would silently wipe the makes, template and size selection.
 * Both surfaces therefore have to read from the same saved snapshot.
 */

/** The editable config, held as one object so "has anything changed" is one compare. */
export interface ScopeForm {
  makes: string;
  focus: string;
  exclude: string;
  zip: string;
  windowMode: string;
  templateId: string;
  sizeIds: string[];
  maxAds: string;
  minStock: string;
  mode: string;
}

export const BLANK_FORM: ScopeForm = {
  makes: '',
  focus: '',
  exclude: '',
  zip: '',
  windowMode: 'next_month',
  templateId: '',
  sizeIds: [],
  maxAds: '10',
  minStock: '0',
  mode: 'draft',
};

function formFromReport(rep: ShadowReport): ScopeForm {
  return {
    makes: rep.scope?.makes?.join(', ') ?? '',
    focus: rep.scope?.focusModels?.join(', ') ?? '',
    exclude: rep.scope?.excludeModels?.join(', ') ?? '',
    zip: rep.scope?.zip ?? '',
    windowMode: rep.runWindow?.mode ?? 'next_month',
    templateId: rep.scope?.templateMap?.all ?? '',
    sizeIds: rep.scope?.sizeIds ?? [],
    maxAds: String(rep.scope?.maxAdsPerRun ?? 10),
    minStock: String(rep.scope?.minStock ?? 0),
    mode: rep.scope?.mode ?? 'draft',
  };
}

const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/** `ScopeForm` → the shape `save_config` expects. */
export function toPayload(f: ScopeForm) {
  return {
    makes: csv(f.makes),
    focusModels: csv(f.focus),
    excludeModels: csv(f.exclude),
    zip: f.zip.trim(),
    runWindowMode: f.windowMode,
    templateMap: f.templateId ? { all: f.templateId } : {},
    sizeIds: f.sizeIds,
    maxAdsPerRun: Number(f.maxAds) || 10,
    minStock: Number(f.minStock) || 0,
    mode: f.mode,
  };
}

/** Order-insensitive on sizeIds, so re-picking the same sizes isn't "dirty". */
const formKey = (f: ScopeForm) => JSON.stringify({ ...f, sizeIds: [...f.sizeIds].sort() });

export interface Automation {
  report: ShadowReport | null;
  loading: boolean;
  /** Label of the action in flight, or null. */
  busy: string | null;
  /** What's on screen. */
  form: ScopeForm;
  /** What the server last confirmed. */
  saved: ScopeForm;
  dirty: boolean;
  set: <K extends keyof ScopeForm>(key: K, value: ScopeForm[K]) => void;
  reset: () => void;
  reload: () => Promise<void>;
  act: (action: string, extra?: Record<string, unknown>, label?: string) => Promise<void>;
  /** Flip watching on/off without disturbing the saved settings. */
  toggleEnabled: () => Promise<void>;
  /** Persist the edited form. */
  save: () => Promise<void>;
}

export function useAutomation(accountKey: string | null): Automation {
  const [report, setReport] = useState<ShadowReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<ScopeForm>(BLANK_FORM);
  const [saved, setSaved] = useState<ScopeForm>(BLANK_FORM);

  const reload = useCallback(async () => {
    if (!accountKey) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/ad-generator/automation/shadow?accountKey=${encodeURIComponent(accountKey)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const rep = json as ShadowReport;
      setReport(rep);
      const next = formFromReport(rep);
      setForm(next);
      setSaved(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load the automation report');
    } finally {
      setLoading(false);
    }
  }, [accountKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const act = useCallback(
    async (action: string, extra: Record<string, unknown> = {}, label = action) => {
      if (!accountKey) return;
      setBusy(label);
      try {
        const res = await fetch('/api/ad-generator/automation/shadow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountKey, action, ...extra }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (action === 'sync_feeds') {
          const bad = (json.feeds ?? []).filter((f: { status: string }) => f.status !== 'ok');
          toast[bad.length ? 'warning' : 'success'](
            bad.length
              ? `${bad.length} of ${json.feeds.length} feed(s) had problems`
              : `Synced ${json.feeds.length} feed(s)`,
          );
        } else if (action === 'poll_offers') {
          toast.success(`Polled ${json.scopes} vehicle(s): ${json.offersNew} new, ${json.offersEnded} ended`);
        } else if (action === 'generate') {
          const skipped = (json.skipped ?? []).length;
          toast[json.created || json.refreshed ? 'success' : 'warning'](
            json.created || json.refreshed
              ? `${json.created} new draft(s), ${json.refreshed} refreshed${skipped ? `, ${skipped} skipped` : ''}`
              : `No ads generated — ${skipped} vehicle(s) skipped.`,
          );
        } else {
          toast.success('Saved');
        }
        await reload();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Action failed');
      } finally {
        setBusy(null);
      }
    },
    [accountKey, reload],
  );

  const toggleEnabled = useCallback(
    // Posts the SAVED scope, not the edited one — flipping the switch must not
    // commit a half-typed settings edit sitting in another tab.
    () => act('save_config', { enabled: !report?.enabled, ...toPayload(saved) }, 'toggle'),
    [act, report?.enabled, saved],
  );

  const save = useCallback(
    () => act('save_config', { enabled: report?.enabled ?? false, ...toPayload(form) }, 'save'),
    [act, report?.enabled, form],
  );

  return {
    report,
    loading,
    busy,
    form,
    saved,
    dirty: formKey(form) !== formKey(saved),
    set: (key, value) => setForm((f) => ({ ...f, [key]: value })),
    reset: () => setForm(saved),
    reload,
    act,
    toggleEnabled,
    save,
  };
}
