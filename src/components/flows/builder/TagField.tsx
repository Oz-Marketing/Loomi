'use client';

import * as React from 'react';
import { useFilterableFields } from '@/hooks/use-filterable-fields';
import {
  MERGETAG_SPLIT_PATTERN,
  buildTagLabelMap,
  tokenKey,
} from '@/lib/flows/merge-tag-catalog';
import { MergeTagPicker } from './MergeTagPicker';

/**
 * Labeled text field for the flow inspector with an inline "Custom Tags"
 * picker. Inserts `{{token}}` at the caret and surfaces a clear visual of the
 * variables a field references.
 *
 * Two visual modes:
 *  - prose (`code` false): a highlight overlay tints each `{{token}}` inline.
 *    The chips are the SAME WIDTH as the raw token text (no padding) so the
 *    native caret stays perfectly aligned — fat/relabelled pills would drift.
 *  - code (`code` true): plain monospace field (no overlay) for HTML/JSON.
 *
 * Both modes render a labelled "tags in use" pill row beneath the field, which
 * is where the friendly labels (esp. for snake_case custom fields) show up.
 *
 * The value is always a plain string; nothing here changes how `applyMergetags`
 * substitutes tokens at send time.
 */
const FIELD_BASE = 'w-full px-2 py-1.5 rounded-md border text-xs';

interface TagFieldProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  accountKey: string | null;
  /** Render a textarea instead of a single-line input. */
  multiline?: boolean;
  /** Code field (HTML/JSON): monospace, no inline highlight overlay. */
  code?: boolean;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
}

export function TagField({
  label,
  value,
  onChange,
  accountKey,
  multiline = false,
  code = false,
  rows = 4,
  maxLength,
  placeholder,
}: TagFieldProps) {
  const fieldRef = React.useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const backdropRef = React.useRef<HTMLDivElement | null>(null);

  const { customFields } = useFilterableFields(accountKey);
  const pickerFields = React.useMemo(
    () => customFields.map((cf) => ({ key: cf.key, label: cf.label })),
    [customFields],
  );
  const labelMap = React.useMemo(
    () => buildTagLabelMap(pickerFields),
    [pickerFields],
  );

  const insertToken = React.useCallback(
    (token: string) => {
      const el = fieldRef.current;
      const start = el?.selectionStart ?? value.length;
      const end = el?.selectionEnd ?? value.length;
      const next = value.slice(0, start) + token + value.slice(end);
      onChange(next);
      const caret = start + token.length;
      requestAnimationFrame(() => {
        const node = fieldRef.current;
        if (!node) return;
        node.focus();
        try {
          node.setSelectionRange(caret, caret);
        } catch {
          /* number/date inputs don't support selection — ignore */
        }
      });
    },
    [value, onChange],
  );

  const syncScroll = React.useCallback(() => {
    const f = fieldRef.current;
    const b = backdropRef.current;
    if (f && b) {
      b.scrollTop = f.scrollTop;
      b.scrollLeft = f.scrollLeft;
    }
  }, []);

  const useOverlay = !code;
  const wrapCls = multiline ? 'whitespace-pre-wrap break-words' : 'whitespace-pre';
  const fieldExtra = code
    ? 'border-[var(--border)] bg-[var(--input)] font-mono'
    : useOverlay
      ? // transparent text so the backdrop pills show through; keep the caret
        // and placeholder visible (text-transparent would hide both).
        'relative border-transparent bg-transparent text-transparent caret-[var(--foreground)] placeholder:text-[var(--muted-foreground)]'
      : 'border-[var(--border)] bg-[var(--input)]';

  // Callback ref accepts the input|textarea union, so it assigns cleanly to
  // either element (a shared RefObject<A&B> would not type-check on both).
  const setRef = (el: HTMLInputElement | HTMLTextAreaElement | null) => {
    fieldRef.current = el;
  };
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => onChange(e.target.value);
  const fieldClass = `${FIELD_BASE} ${fieldExtra} focus:outline-none focus:border-[var(--primary)] ${
    multiline ? 'resize-none' : ''
  }`;

  const field = multiline ? (
    <textarea
      ref={setRef}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      rows={rows}
      onScroll={useOverlay ? syncScroll : undefined}
      onChange={handleChange}
      className={fieldClass}
    />
  ) : (
    <input
      ref={setRef}
      type="text"
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      onScroll={useOverlay ? syncScroll : undefined}
      onChange={handleChange}
      className={fieldClass}
    />
  );

  return (
    <div className="block">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          {label}
        </span>
        <MergeTagPicker customFields={pickerFields} onInsert={insertToken} />
      </div>

      {useOverlay ? (
        <div className="relative">
          <div
            ref={backdropRef}
            aria-hidden
            className={`${FIELD_BASE} border-[var(--border)] bg-[var(--input)] text-[var(--foreground)] absolute inset-0 overflow-hidden pointer-events-none ${wrapCls}`}
          >
            {renderOverlay(value)}
          </div>
          {field}
        </div>
      ) : (
        field
      )}

      <TagsInUseRow value={value} labelMap={labelMap} />
    </div>
  );
}

/** Inline highlight nodes for the overlay — chips are the raw token text at
 *  text width (no padding) so the caret in the field behind stays aligned. */
function renderOverlay(value: string): React.ReactNode {
  if (!value) return null;
  return value.split(MERGETAG_SPLIT_PATTERN).map((seg, i) => {
    if (!seg) return null;
    if (tokenKey(seg)) {
      return (
        <span key={i} className="rounded-[2px] bg-[var(--primary)]/25 text-[var(--primary)]">
          {seg}
        </span>
      );
    }
    return <span key={i}>{seg}</span>;
  });
}

/** Labelled pill row beneath the field — one pill per unique token in the
 *  value. Known keys show the friendly label; unknown keys (typos / tags the
 *  renderer won't resolve) show the raw token in a warning style. */
function TagsInUseRow({
  value,
  labelMap,
}: {
  value: string;
  labelMap: Record<string, string>;
}) {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const seg of value.split(MERGETAG_SPLIT_PATTERN)) {
    const k = tokenKey(seg);
    if (k && !seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  if (keys.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {keys.map((k) => {
        const known = k in labelMap;
        return (
          <span
            key={k}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
              known
                ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                : 'bg-amber-500/10 text-amber-400'
            }`}
            title={known ? `{{${k}}}` : 'Unknown tag — won’t be replaced at send time'}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                known ? 'bg-[var(--primary)]' : 'bg-amber-400'
              }`}
            />
            {known ? labelMap[k] : `{{${k}}}`}
          </span>
        );
      })}
    </div>
  );
}
