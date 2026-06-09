'use client';

/**
 * Industries settings tab — manage the app-wide account "Industry" option
 * list (AppSetting "app-industries"; see services/industries.ts). Elevated
 * roles only (super_admin / developer) — gated in settings/page.tsx and again
 * by the /api/industries PUT route.
 *
 * Edits a local copy and saves the whole list in one PUT (add / rename /
 * reorder / delete). On save it revalidates the shared SWR key so every open
 * account dropdown (useIndustries) picks up the change.
 */
import { useEffect, useMemo, useState } from 'react';
import { mutate } from 'swr';
import {
  PlusIcon,
  TrashIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import PrimaryButton from '@/components/primary-button';
import { toast } from '@/lib/toast';

// Industries that carry built-in behavior keyed off their exact string —
// flagged in the UI so they aren't renamed/removed without realizing it.
const BEHAVIOR_INDUSTRIES = new Set(['automotive', 'powersports']);

export function IndustriesTab() {
  const [list, setList] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    fetch('/api/industries')
      .then((r) => r.json())
      .then((d) => {
        const arr = Array.isArray(d.industries) ? (d.industries as string[]) : [];
        setList(arr);
        setSaved(arr);
      })
      .catch(() => toast.error('Failed to load industries'))
      .finally(() => setLoading(false));
  }, []);

  const hasChanges = useMemo(
    () => JSON.stringify(list) !== JSON.stringify(saved),
    [list, saved],
  );

  // Validation: non-empty, no blank rows, no case-insensitive duplicates.
  const { hasBlank, hasDupes } = useMemo(() => {
    const seen = new Set<string>();
    let blank = false;
    let dupes = false;
    for (const item of list) {
      const t = item.trim();
      if (!t) {
        blank = true;
        continue;
      }
      const k = t.toLowerCase();
      if (seen.has(k)) dupes = true;
      seen.add(k);
    }
    return { hasBlank: blank, hasDupes: dupes };
  }, [list]);

  const canSave = hasChanges && list.length > 0 && !hasBlank && !hasDupes && !saving;

  const updateAt = (i: number, value: string) =>
    setList((prev) => prev.map((x, idx) => (idx === i ? value : x)));
  const removeAt = (i: number) => setList((prev) => prev.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) =>
    setList((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (list.some((x) => x.trim().toLowerCase() === v.toLowerCase())) {
      toast.error('That industry already exists.');
      return;
    }
    setList((prev) => [...prev, v]);
    setDraft('');
  };

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await fetch('/api/industries', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industries: list }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Failed to save industries');
        return;
      }
      const arr = Array.isArray(data.industries) ? (data.industries as string[]) : list;
      setList(arr);
      setSaved(arr);
      // Refresh every mounted account dropdown (useIndustries).
      void mutate('/api/industries');
      toast.success('Industries saved.');
    } catch {
      toast.error('Failed to save industries');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-[var(--muted-foreground)]">Loading industries…</p>
      </div>
    );
  }

  const iconBtn =
    'flex-shrink-0 rounded-lg border border-[var(--border)] p-2 text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-30';

  return (
    <div className="max-w-2xl">
      <section className="glass-section-card rounded-xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Industries</h3>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
              These are the options in every account&apos;s <strong>Industry</strong> dropdown.
              Add, rename, reorder, or remove them. Changes apply across the app on save.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {hasChanges && <span className="text-xs font-medium text-amber-500">Unsaved</span>}
            <PrimaryButton onClick={save} disabled={!canSave}>
              {saving ? 'Saving…' : 'Save'}
            </PrimaryButton>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          {list.map((item, i) => {
            const isBehavior = BEHAVIOR_INDUSTRIES.has(item.trim().toLowerCase());
            return (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={item}
                  onChange={(e) => updateAt(i, e.target.value)}
                  className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
                />
                {isBehavior && (
                  <span
                    className="whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--muted)]/40 px-2 py-1 text-[10px] font-medium text-[var(--muted-foreground)]"
                    title="This industry has built-in behavior (OEM brands, lifecycle seeding, field templates) keyed off its name. Renaming it disables those features for new accounts."
                  >
                    built-in
                  </span>
                )}
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className={iconBtn} aria-label="Move up">
                  <ChevronUpIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === list.length - 1}
                  className={iconBtn}
                  aria-label="Move down"
                >
                  <ChevronDownIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="flex-shrink-0 rounded-lg border border-[var(--border)] p-2 text-[var(--muted-foreground)] transition-colors hover:border-rose-500/40 hover:text-rose-400"
                  aria-label="Remove"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            );
          })}

          {list.length === 0 && (
            <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">
              No industries — add at least one below.
            </p>
          )}
        </div>

        {/* Add row */}
        <div className="mt-3 flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder="Add an industry (e.g. Marketing Agency)"
            className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
          />
          <button
            type="button"
            onClick={add}
            disabled={!draft.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium hover:border-[var(--primary)] hover:bg-[var(--accent)] disabled:opacity-40"
          >
            <PlusIcon className="h-4 w-4" />
            Add
          </button>
        </div>

        {hasDupes && (
          <p className="mt-3 text-xs text-rose-400">Remove duplicate industries before saving.</p>
        )}
        {hasBlank && (
          <p className="mt-3 text-xs text-rose-400">Industries can&apos;t be blank — fill or remove empty rows.</p>
        )}
      </section>
    </div>
  );
}
