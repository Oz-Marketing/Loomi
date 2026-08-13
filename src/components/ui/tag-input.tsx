'use client';

import { useState, type KeyboardEvent } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

/**
 * Tags as pills.
 *
 * Replaces a comma-separated text input, which asked people to hold the
 * delimiter in their head, gave no feedback that "q3 " and "q3" are the same
 * value, and made removing the third of five tags a text-editing exercise.
 *
 * Colour is DERIVED from the tag text, not assigned. The same tag is therefore
 * the same colour everywhere it appears, which is the only way colour carries
 * information — a random palette would just be decoration, and would flicker as
 * tags were reordered.
 */

/**
 * Six pairs, each legible on both themes. Chosen for hue separation rather than
 * brand fidelity: the point is telling two tags apart at a glance.
 */
const TAG_COLORS = [
  'bg-sky-500/15 text-sky-300 border-sky-500/30',
  'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  'bg-violet-500/15 text-violet-300 border-violet-500/30',
  'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'bg-rose-500/15 text-rose-300 border-rose-500/30',
  'bg-teal-500/15 text-teal-300 border-teal-500/30',
] as const;

/** Stable hash → palette index. Same tag, same colour, always. */
export function tagColorClass(tag: string): string {
  let hash = 0;
  const key = tag.trim().toLowerCase();
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

export function TagInput({
  value,
  onChange,
  placeholder = 'Add a tag and press Enter',
  disabled = false,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');

  function commit(raw: string) {
    // Accept a paste of "lease, q3, launch" too — people will paste from a
    // spreadsheet, and refusing it would be pedantry.
    const parts = raw.split(',').map((t) => t.trim()).filter(Boolean);
    if (parts.length === 0) return;
    const existing = new Set(value.map((t) => t.toLowerCase()));
    const added = parts.filter((t) => {
      if (existing.has(t.toLowerCase())) return false;
      existing.add(t.toLowerCase());
      return true;
    });
    if (added.length > 0) onChange([...value, ...added]);
    setDraft('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
      return;
    }
    // Backspace on an empty field removes the last pill — the behaviour every
    // tag field has, and its absence feels broken.
    if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      e.preventDefault();
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div
      className={`flex min-h-[38px] w-full flex-wrap items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 transition-colors focus-within:border-[var(--primary)] ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tagColorClass(tag)}`}
        >
          <span className="truncate">{tag}</span>
          {!disabled && (
            <button
              type="button"
              onClick={() => onChange(value.filter((t) => t !== tag))}
              aria-label={`Remove ${tag}`}
              className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
            >
              <XMarkIcon className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}

      <input
        type="text"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        // Commit on blur so a typed-but-unconfirmed tag isn't silently lost when
        // someone tabs on or hits Save.
        onBlur={() => commit(draft)}
        placeholder={value.length === 0 ? placeholder : ''}
        className="min-w-[8rem] flex-1 bg-transparent px-1 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
      />
    </div>
  );
}
