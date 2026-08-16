'use client';

import { useCallback, useEffect, useState } from 'react';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { Tooltip } from '@/app/app/tools/_shared/Tooltip';
import PrimaryButton from '@/components/primary-button';
import { toast } from '@/lib/toast';

type ReportRow = {
  key: string;
  label: string;
  enabled: boolean;
  /** No stored row — this is `defaultForClients` showing through. */
  isDefault: boolean;
  defaultForClients: boolean;
};

/**
 * Which reports this sub-account's CLIENT users see.
 *
 * Not a permission screen. `reporting.report.view` already decides whether a
 * role sees reports at all, and Budget / Executive are gated separately and
 * never appear in this list. This trims the client-facing set down to what the
 * dealer actually buys, so a store running Meta ads and nothing else isn't
 * handed an empty Call Tracking report.
 *
 * Staff are unaffected by anything here, which is worth saying on screen —
 * otherwise the natural reading of an unticked box is "nobody can see this".
 */
export function ReportAccessTab({ accountKey }: { accountKey: string }) {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [baseline, setBaseline] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/accounts/${encodeURIComponent(accountKey)}/reports`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load report access');
      const next: ReportRow[] = data.reports ?? [];
      const on = new Set<string>(next.filter((r) => r.enabled).map((r) => r.key));
      setRows(next);
      setEnabled(on);
      setBaseline(JSON.stringify([...on].sort()));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load report access');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [accountKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = JSON.stringify([...enabled].sort()) !== baseline;

  const toggle = (key: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/accounts/${encodeURIComponent(accountKey)}/reports`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: [...enabled] }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to save');
      setBaseline(JSON.stringify([...enabled].sort()));
      // Re-read so the "default" markers reflect the rows now written.
      await load();
      toast.success('Report access updated.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">Loading report access…</p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-[var(--foreground)]">
          Client Report Access
        </h3>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Which reports this sub-account&apos;s client users see. Agency staff
          always see every report their role allows, regardless of these
          settings.
        </p>
      </div>

      <div className="space-y-1.5">
        {rows.map((row) => (
          <label
            key={row.key}
            className="flex items-start gap-2 cursor-pointer py-0.5"
          >
            <input
              type="checkbox"
              checked={enabled.has(row.key)}
              onChange={() => toggle(row.key)}
              className="mt-0.5 rounded border-[var(--border)]"
            />
            <span className="inline-flex items-center gap-1.5 text-xs text-[var(--foreground)]">
              {row.label}
              {row.isDefault && (
                <Tooltip
                  label={`No setting saved for this sub-account yet, so it follows the platform default (${
                    row.defaultForClients ? 'shown' : 'hidden'
                  }). Saving writes an explicit choice.`}
                >
                  <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                    default
                  </span>
                </Tooltip>
              )}
            </span>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <PrimaryButton onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save Report Access'}
        </PrimaryButton>
        {enabled.size === 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-500">
            <InformationCircleIcon className="w-3.5 h-3.5" />
            Client users on this sub-account will see no reports at all.
          </span>
        )}
      </div>
    </div>
  );
}
