'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { LockClosedIcon, XMarkIcon } from '@heroicons/react/24/outline';
import type { HidableField } from '@/lib/ad-generator/field-prefs';

/**
 * Choosing which fields this sub-account's custom-ad form shows.
 *
 * A shared template carries every field any dealer might need. This is how one
 * rooftop trims the form to the handful it actually uses, without a designer
 * forking the template per dealer.
 *
 * Protected fields are LISTED, greyed, with the reason — a list that silently
 * omitted "Monthly payment" would read as a bug, where one that shows it locked
 * and says "required for at least one offer type" answers the question before
 * it's asked.
 */
export function FieldPrefsModal({
  accountKey,
  templateId,
  templateName,
  onClose,
  onSaved,
}: {
  accountKey: string;
  templateId: string;
  templateName: string;
  onClose: () => void;
  /** The saved hidden set, so the form behind can re-render immediately. */
  onSaved: (hidden: string[]) => void;
}) {
  const [fields, setFields] = useState<HidableField[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(
      `/api/ad-generator/field-prefs?accountKey=${encodeURIComponent(accountKey)}&templateId=${encodeURIComponent(templateId)}`,
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { fields?: HidableField[]; hiddenFields?: string[] }) => {
        if (cancelled) return;
        setFields(d.fields ?? []);
        setHidden(d.hiddenFields ?? []);
      })
      .catch(() => {
        if (!cancelled) toast.error('Could not load the form fields.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey, templateId]);

  // Escape closes, matching every other dialog in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (key: string) =>
    setHidden((h) => (h.includes(key) ? h.filter((k) => k !== key) : [...h, key]));

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/ad-generator/field-prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountKey, templateId, hiddenFields: hidden }),
      });
      const d = (await res.json().catch(() => ({}))) as { hiddenFields?: string[]; error?: string };
      if (!res.ok) {
        toast.error(d.error || 'Could not save the form fields.');
        return;
      }
      // Trust the SERVER's list — it drops anything protected, and the user
      // should see that rather than believe a hide stuck when it didn't.
      const saved = d.hiddenFields ?? [];
      setHidden(saved);
      onSaved(saved);
      toast.success('Form fields updated.');
      onClose();
    } catch {
      toast.error('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  }, [accountKey, templateId, hidden, onClose, onSaved]);

  const shownCount = fields.filter((f) => !hidden.includes(f.key)).length;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose form fields"
      onClick={onClose}
    >
      {/* `--card` is 62% opaque, which reads as a glass panel over a busy form.
          A dialog needs to sit ON TOP of the page, not through it — same
          card-strong + blur the launch dialog uses. */}
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] shadow-xl backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Form fields</h2>
            <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
              Which fields this account fills in on {templateName}. Hiding one doesn&apos;t change
              any ad you&apos;ve already made.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="space-y-1.5 p-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-8 animate-pulse rounded-lg bg-[var(--muted)]/50" />
              ))}
            </div>
          ) : fields.length === 0 ? (
            <p className="p-4 text-xs text-[var(--muted-foreground)]">
              This design has no editable fields.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {fields.map((f) => {
                const locked = !!f.lockedReason;
                const shown = locked || !hidden.includes(f.key);
                return (
                  <li key={f.key}>
                    <label
                      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs ${
                        locked ? 'opacity-55' : 'cursor-pointer hover:bg-[var(--muted)]/50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={shown}
                        disabled={locked || saving}
                        onChange={() => toggle(f.key)}
                        className="h-3.5 w-3.5 flex-shrink-0 accent-[var(--primary)]"
                      />
                      <span className="flex-1 text-[var(--foreground)]">{f.label}</span>
                      {locked ? (
                        <span className="flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
                          <LockClosedIcon className="h-3 w-3" />
                          {f.lockedReason}
                        </span>
                      ) : (
                        // Hiding works, but the field returns when the offer type
                        // needs it. Saying so here stops that reading as a bug the
                        // first time someone switches to an APR offer.
                        f.note && (
                          <span className="text-[10px] text-[var(--muted-foreground)]">{f.note}</span>
                        )
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] p-3">
          <span className="text-[11px] text-[var(--muted-foreground)]">
            {loading ? '' : `${shownCount} of ${fields.length} shown`}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={loading || saving}
              className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
