'use client';

/**
 * Default Markup settings tab — the agency-wide markup (gross→spend factor)
 * applied to any account without its own override (Account.markup). Backed by
 * AppSetting "app-default-markup" (see services/markup.ts). Elevated roles only
 * (super_admin / developer) — gated in settings/page.tsx and again by the
 * /api/default-markup PUT route.
 *
 * Stored as a factor (e.g. 0.77 = a 23% agency margin), matching the
 * per-account "Pacer Markup Rate" field on the sub-account settings page.
 */
import { useEffect, useState } from 'react';
import PrimaryButton from '@/components/primary-button';
import { toast } from '@/lib/toast';

export function DefaultMarkupTab() {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/default-markup')
      .then((r) => r.json())
      .then((d) => {
        // 0 = unconfigured; show blank so the admin sets a real value.
        const m =
          typeof d.markup === 'number' && d.markup > 0 ? String(d.markup) : '';
        setValue(m);
        setSaved(m);
      })
      .catch(() => toast.error('Failed to load default markup'))
      .finally(() => setLoading(false));
  }, []);

  const parsed = Number(value);
  const valid = Number.isFinite(parsed) && parsed > 0;
  const hasChanges = value.trim() !== saved.trim();
  const canSave = hasChanges && valid && !saving;
  const marginPct = valid ? Math.round((1 - parsed) * 1000) / 10 : null;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await fetch('/api/default-markup', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markup: parsed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Failed to save default markup');
        return;
      }
      const m = typeof data.markup === 'number' ? String(data.markup) : value;
      setValue(m);
      setSaved(m);
      toast.success('Default markup saved.');
    } catch {
      toast.error('Failed to save default markup');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-[var(--muted-foreground)]">
          Loading default markup…
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <section className="glass-section-card rounded-xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">
              Default Markup
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
              The agency-wide gross→spend factor that turns a client&apos;s gross
              budget into the amount that should hit the ad platform
              (<strong>actual spend = client budget × markup</strong>). It applies
              to every account that doesn&apos;t set its own{' '}
              <strong>Pacer Markup Rate</strong> in its sub-account settings.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {hasChanges && (
              <span className="text-xs font-medium text-amber-500">Unsaved</span>
            )}
            <PrimaryButton onClick={save} disabled={!canSave}>
              {saving ? 'Saving…' : 'Save'}
            </PrimaryButton>
          </div>
        </div>

        <div className="mt-5">
          <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
            Markup factor
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '' || /^\d*\.?\d*$/.test(v)) setValue(v);
            }}
            placeholder="0.77"
            className="w-[160px] rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
          />
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
            {valid
              ? `${parsed} = ${marginPct}% agency margin. Example: $500 client budget × ${parsed} = $${(500 * parsed).toFixed(2)} spend target.`
              : 'Enter a factor between 0 and 1 (e.g. 0.77 for a 23% margin). Until set, unoverridden accounts compute a $0 target.'}
          </p>
        </div>
      </section>
    </div>
  );
}
