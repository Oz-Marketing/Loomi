'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { LinkIcon } from '@heroicons/react/24/outline';
import { Collapse } from '@/components/ui/collapse';
import { ColorInput } from './PropertyControls';

export interface LinkValue {
  /** The words that become the link. */
  text: string;
  /** Already normalized by `normalizeLinkUrl`. */
  url: string;
  /** '' leaves the link in the surrounding text color. */
  color: string;
}

/** Accept a bare domain ("example.com/terms") as https; refuse unsafe schemes. */
export function normalizeLinkUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  if (/^(?:https?:|mailto:|tel:)/i.test(url)) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null; // javascript:, data:, …
  if (url.startsWith('/') || url.startsWith('#')) return url;
  return `https://${url}`;
}

const fieldClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]';
const labelClass =
  'mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]';

/**
 * Add / edit a link in a rich text prop: the words being linked, the URL,
 * and an optional color. Rendered only while open, so the fields mount
 * fresh from `initial` every time.
 */
export function LinkDialog({
  initial,
  editing,
  onApply,
  onRemove,
  onCancel,
}: {
  initial: LinkValue;
  /** The selection is already inside a link: say "Save", offer Remove. */
  editing: boolean;
  onApply: (value: LinkValue) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = React.useState(initial.text);
  const [url, setUrl] = React.useState(initial.url);
  const [color, setColor] = React.useState(initial.color);
  const [urlError, setUrlError] = React.useState(false);
  const titleId = React.useId();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeLinkUrl(url);
    if (!normalized) {
      setUrlError(true);
      return;
    }
    // A link with no words would be invisible — show the address instead.
    onApply({ text: text.trim() ? text : url.trim(), url: normalized, color: color.trim() });
  };

  // Portaled to the body: the properties panel scrolls and sits beside a
  // scaled canvas, and `position: fixed` under a transformed ancestor is
  // positioned against that ancestor rather than the viewport.
  return createPortal(
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40 p-4 animate-overlay-in"
      onPointerDown={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={submit}
        onPointerDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-5 shadow-2xl backdrop-blur-2xl animate-modal-in"
      >
        <h3 id={titleId} className="mb-4 flex items-center gap-1.5 text-sm font-semibold text-[var(--foreground)]">
          <LinkIcon className="h-4 w-4" />
          {editing ? 'Edit link' : 'Add link'}
        </h3>

        <label className={labelClass} htmlFor={`${titleId}-text`}>
          Text to display
        </label>
        <input
          id={`${titleId}-text`}
          name="linkText"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus={!initial.text}
          placeholder="Privacy Policy"
          className={`${fieldClass} mb-4`}
        />

        <label className={labelClass} htmlFor={`${titleId}-url`}>
          URL
        </label>
        <input
          id={`${titleId}-url`}
          name="linkUrl"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setUrlError(false);
          }}
          autoFocus={!!initial.text}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="https://example.com/privacy"
          aria-invalid={urlError}
          className={`${fieldClass} ${urlError ? 'border-red-500' : ''}`}
        />
        <Collapse open={urlError}>
          <p className="pt-1 text-[11px] text-red-500">Enter a web address, or a mailto: or tel: link.</p>
        </Collapse>

        <div className={`${labelClass} mt-4`}>
          <span>Link color</span>
          <span className="text-[10px] normal-case tracking-normal">Optional</span>
        </div>
        <ColorInput value={color} onChange={setColor} />

        <div className="mt-5 flex items-center gap-2">
          {editing && (
            <button
              type="button"
              onClick={onRemove}
              className="rounded-lg px-2 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10"
            >
              Remove link
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
            >
              {editing ? 'Save' : 'Add link'}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
}
