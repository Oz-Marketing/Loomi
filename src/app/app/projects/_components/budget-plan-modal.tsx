'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';
import { ChannelIcon } from '@/components/icons/channel-icon';
import { BUDGET_CHANNELS, channelLabel } from '@/lib/budget/channels';
import { usd0 as usd, type BudgetPlan } from './budget-shared';

/**
 * The account's plan for a year: what the client committed, the recurring
 * retainer, and the markup lines are stamped with.
 *
 * A modal rather than an inline disclosure — this is setup you do once or twice
 * a year, and inline it competed for attention with the grid, which is the
 * thing people actually come here to read.
 */
export function BudgetPlanModal({
  year,
  accountName,
  plan,
  onSave,
  onClose,
}: {
  year: number;
  accountName: string;
  plan: BudgetPlan | null;
  onSave: (body: Record<string, unknown>, generate?: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [declared, setDeclared] = useState('');
  const [retainer, setRetainer] = useState('');
  const [markup, setMarkup] = useState('');
  // Which channel "Lay out the year" puts the retainer on. Surfaced rather than
  // implied — generating twelve channel-less lines silently leaves the grid
  // empty and the money invisible, which reads as the feature being broken.
  const [retainerChannel, setRetainerChannel] = useState('');
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setDeclared(plan?.declaredTotal ? String(plan.declaredTotal) : '');
    setRetainer(plan?.monthlyRetainer ? String(plan.monthlyRetainer) : '');
    setMarkup(plan?.defaultMarkup != null ? String(plan.defaultMarkup) : '');
  }, [plan]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  // A markup under 0.5 means the agency keeps more than half the budget, which
  // is possible but rare — far more often it's a margin (0.23) typed where the
  // spend factor (0.77) belongs.
  const markupNum = markup === '' ? null : Number(markup);
  const markupValid = markupNum != null && Number.isFinite(markupNum) && markupNum > 0;
  const markupSuspicious = markupValid && markupNum < 0.5;
  const previewBase = Number(retainer) > 0 ? Number(retainer) : 10_000;
  const markupPreview = markupValid
    ? `A ${usd(previewBase)} budget would target ${usd(previewBase * markupNum)} in spend${
        markupSuspicious ? ' — did you mean ' + (1 - markupNum).toFixed(2) + '?' : '.'
      }`
    : null;

  const body = () => ({
    declaredTotal: declared === '' ? null : Number(declared),
    monthlyRetainer: retainer === '' ? null : Number(retainer),
    defaultMarkup: markup === '' ? null : Number(markup),
    retainerChannel: retainerChannel || null,
  });

  const run = async (generate: boolean) => {
    setSaving(true);
    await onSave(body(), generate);
    setSaving(false);
    onClose();
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="frost-heavy flex w-full max-w-lg flex-col overflow-hidden rounded-2xl shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Budget plan</h3>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              {accountName} · {year}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-1 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <MoneyField
            label="Planned for the year"
            hint="What the client committed. Leave blank if there's no formal number — the page just won't show a target."
            value={declared}
            onChange={setDeclared}
          />
          <MoneyField
            label="Monthly Managed Marketing Service"
            hint="The recurring monthly amount, used by “Lay out the year” below."
            value={retainer}
            onChange={setRetainer}
          />
          <div>
            <label className="block text-xs font-medium text-[var(--foreground)]">
              Markup override
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              placeholder="Account default"
              value={markup}
              onChange={(e) => setMarkup(e.target.value)}
              className="loomi-input mt-1 w-full !bg-[var(--input)]"
            />
            {/* Worked example, live. "Markup" here is the SPEND factor (0.77
                = a 23% margin), but everyone says "23% margin" out loud — so
                0.23 gets typed when 0.77 was meant, and nothing downstream can
                tell the difference. Showing the resulting spend makes an
                inverted value obvious at the moment it's entered. */}
            <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
              Spend = budget × markup, frozen onto each new line — changing it never rewrites money
              already committed.
              {markupPreview && (
                <>
                  {' '}
                  <span className={markupSuspicious ? 'font-medium text-amber-600' : ''}>
                    {markupPreview}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Lay out the year — a distinct action from saving the numbers, so it
            gets its own block rather than sitting beside Save as a peer. */}
        <div className="border-t border-[var(--border)] bg-[var(--muted)]/30 px-5 py-4">
          <p className="text-xs font-medium text-[var(--foreground)]">Lay out the year</p>
          <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
            {retainer === ''
              ? 'Set a monthly Managed Marketing Service amount above to enable this.'
              : retainerChannel
                ? `Creates a ${channelLabel(retainerChannel)} line of $${Number(retainer).toLocaleString()} for each month that doesn’t already have one — safe to re-run.`
                : `Creates an unassigned pool line of $${Number(retainer).toLocaleString()} for each month. Pick a channel to have them show up in the grid instead.`}
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <div className="w-[170px]">
              <SearchableSelect
                value={retainerChannel}
                onChange={setRetainerChannel}
                searchable={false}
                options={[
                  { value: '', label: 'Unassigned pool' },
                  ...BUDGET_CHANNELS.map((c) => ({
                    value: c.key,
                    label: c.label,
                    icon: <ChannelIcon channel={c.key} className="h-4 w-4" />,
                  })),
                ]}
                className="!bg-[var(--input)] !rounded-lg !px-2.5 !py-1.5 !text-xs"
              />
            </div>
            <button
              type="button"
              disabled={saving || retainer === ''}
              onClick={() => void run(true)}
              className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)] disabled:opacity-50"
            >
              Save &amp; lay out
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-3 py-2 text-sm text-[var(--muted-foreground)] transition hover:text-[var(--foreground)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void run(false)}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save plan'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MoneyField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--foreground)]">{label}</label>
      <div className="relative mt-1">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-[var(--muted-foreground)]">
          $
        </span>
        <input
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          placeholder="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="loomi-input w-full !bg-[var(--input)] !pl-6"
        />
      </div>
      {hint && <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{hint}</p>}
    </div>
  );
}
