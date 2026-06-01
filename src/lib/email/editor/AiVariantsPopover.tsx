'use client';

// Shared "AI suggestions" popover for the email editor.
//
// Used by:
//   - EmailSettings (subject + preview text variant generation)
//   - BlockProperties (heading / text / button block copy generation)
//
// The popover takes a `fetcher` callback so the caller controls which
// API endpoint to hit and what context to pass — this file is pure UI
// orchestration. Variants render as clickable cards; clicking one calls
// `onPick(text)` and closes the popover.
//
// A "Regenerate" affordance lets the user re-roll the variants without
// closing, useful when the first set didn't land. An optional brief
// textarea (`enableBrief`) lets the user steer the regen — kept off by
// default so the popover is one-click-fast in the common case.

import * as React from 'react';
import {
  SparklesIcon,
  ArrowPathIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

export interface AiVariantsPopoverProps {
  /** Renders the popover when true; cleanup happens on false. */
  open: boolean;
  onClose: () => void;
  /** Anchor element — popover positions itself underneath. The caller
   *  controls layout; we just need a measurable rect. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Short heading shown at the top of the popover ("Subject line ideas"). */
  title: string;
  /** Async producer of N variant strings. Receives the latest brief
   *  the user typed (empty string when brief is disabled or untouched). */
  fetcher: (brief: string) => Promise<string[]>;
  /** Called when the user picks a variant. Popover closes afterwards. */
  onPick: (text: string) => void;
  /** When true, render a small brief textarea above the variants so
   *  the user can steer regeneration. Defaults to false. */
  enableBrief?: boolean;
  /** Show the variants as monospace blocks rather than the default
   *  sans-serif. Useful for button labels where the user wants to
   *  preview pixel-fit length. Defaults to false. */
  monospace?: boolean;
}

export function AiVariantsPopover({
  open,
  onClose,
  anchorRef,
  title,
  fetcher,
  onPick,
  enableBrief = false,
  monospace = false,
}: AiVariantsPopoverProps) {
  const [variants, setVariants] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [brief, setBrief] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Track the latest fetcher in a ref — keeps the effect that auto-
  // fires on open from re-running every time the caller's closure
  // identity changes (which happens every render when the fetcher
  // captures component state).
  const fetcherRef = React.useRef(fetcher);
  React.useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const run = React.useCallback(async (briefValue: string) => {
    setLoading(true);
    setError(null);
    try {
      const results = await fetcherRef.current(briefValue);
      setVariants(results);
      if (results.length === 0) {
        setError('No suggestions came back. Try again or refine the brief.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI request failed.');
      setVariants([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-fire the first request when the popover opens.
  React.useEffect(() => {
    if (!open) {
      // Reset on close so the next open starts clean.
      setVariants([]);
      setBrief('');
      setError(null);
      return;
    }
    void run('');
  }, [open, run]);

  // Close on Escape + outside click.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current && containerRef.current.contains(target)) return;
      if (anchorRef.current && anchorRef.current.contains(target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    // Mousedown rather than click so it fires before any inner buttons
    // re-render the page; click would race the new mount on tab focus.
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, onClose, anchorRef]);

  // Position under the anchor on open + resize. Uses inline styles
  // because the popover renders into a portal-less plain div — keeps
  // the impl simple and avoids needing portals/floating-ui.
  const [position, setPosition] = React.useState<{ top: number; left: number; width: number } | null>(null);
  React.useEffect(() => {
    if (!open || !anchorRef.current) {
      setPosition(null);
      return;
    }
    const update = () => {
      if (!anchorRef.current) return;
      const rect = anchorRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + window.scrollY + 6,
        left: rect.left + window.scrollX,
        // Match the anchor's width so the popover lines up cleanly,
        // but clamp to a usable range — narrow anchors (icon buttons)
        // would otherwise produce a tiny unreadable popover.
        width: Math.max(280, Math.min(440, rect.width)),
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchorRef]);

  if (!open || !position) return null;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label={title}
      className="z-50 rounded-xl border border-[var(--border)] bg-[var(--card-strong)] backdrop-blur-2xl shadow-xl"
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        width: position.width,
      }}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border)]">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--foreground)]">
          <SparklesIcon className="w-3.5 h-3.5 text-[var(--primary)]" />
          {title}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void run(brief)}
            disabled={loading}
            title="Regenerate"
            className="inline-flex items-center justify-center w-6 h-6 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-40"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="inline-flex items-center justify-center w-6 h-6 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <XMarkIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {enableBrief && (
        <div className="px-3 py-2 border-b border-[var(--border)]">
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Optional: tone, audience, offer…"
            rows={2}
            className="w-full px-2 py-1.5 text-xs bg-transparent text-[var(--foreground)] border border-[var(--border)] rounded-md outline-none focus:border-[var(--primary)] resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void run(brief);
              }
            }}
          />
          <p className="text-[10px] text-[var(--muted-foreground)] mt-1">
            Press <kbd className="px-1 rounded border border-[var(--border)] font-mono">⌘ Enter</kbd> to regenerate with the brief.
          </p>
        </div>
      )}

      <div className="px-3 py-2 space-y-1.5 max-h-[320px] overflow-y-auto">
        {loading && variants.length === 0 && (
          <div className="py-6 text-center text-[12px] text-[var(--muted-foreground)]">
            Thinking…
          </div>
        )}
        {error && (
          <div className="py-2 px-2 text-[11px] text-red-300 bg-red-500/10 rounded-md">
            {error}
          </div>
        )}
        {variants.map((variant, idx) => (
          <button
            type="button"
            key={`${idx}-${variant.slice(0, 30)}`}
            onClick={() => {
              onPick(variant);
              onClose();
            }}
            className={`block w-full text-left px-2.5 py-2 rounded-md text-[12px] leading-snug border border-transparent hover:border-[var(--primary)]/40 hover:bg-[var(--muted)]/40 transition-colors ${
              monospace ? 'font-mono' : ''
            }`}
          >
            {variant}
          </button>
        ))}
      </div>
    </div>
  );
}
