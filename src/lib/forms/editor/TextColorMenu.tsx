'use client';

import * as React from 'react';
import { DEFAULT_SWATCHES } from './PropertyControls';

export const isCssColor = (c: string) => !!c && typeof CSS !== 'undefined' && CSS.supports('color', c);

const isHex6 = (c: string) => /^#[0-9a-f]{6}$/i.test(c);

/**
 * Text color dropdown for RichTextInput's toolbar. A swatch applies in one
 * click; a custom color goes through the hex field (or the native picker,
 * which only fills the field — it fires on every drag step, and each apply
 * would be an undo entry).
 *
 * Swatch and Reset clicks keep focus in the editor (mousedown is
 * cancelled), so the selection stays highlighted while choosing.
 */
export function TextColorMenu({
  initial,
  anchorRef,
  onPick,
  onReset,
  onClose,
}: {
  initial: string;
  /** The toolbar button that toggles this menu — clicks on it aren't "outside". */
  anchorRef: React.RefObject<HTMLElement | null>;
  onPick: (color: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [hex, setHex] = React.useState(initial);
  const ref = React.useRef<HTMLDivElement>(null);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;

  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchorRef.current?.contains(target)) return;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [anchorRef]);

  const commit = () => {
    if (isCssColor(hex.trim())) onPick(hex.trim());
  };
  const keepSelection = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Text color"
      // The app's standard dropdown surface; it drops from the left here.
      className="glass-dropdown absolute left-0 right-0 top-full z-30 mt-1 p-3"
      style={{ transformOrigin: 'top left' }}
    >
      <div className="mb-3 grid grid-cols-8 gap-1.5">
        {DEFAULT_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            onMouseDown={keepSelection}
            onClick={() => onPick(c)}
            className={`aspect-square rounded border transition-transform hover:scale-110 ${
              c.toLowerCase() === initial.toLowerCase() ? 'border-[var(--primary)] ring-1 ring-[var(--primary)]' : 'border-[var(--border)]'
            }`}
            style={{ background: c }}
          />
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={isHex6(hex) ? hex : '#000000'}
          onChange={(e) => setHex(e.target.value)}
          title="Custom color"
          className="h-8 w-8 flex-shrink-0 cursor-pointer rounded-md border border-[var(--border)] bg-transparent p-0.5"
        />
        <input
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          placeholder="#197cc2"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="Hex color"
          className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-transparent px-2 font-mono text-xs text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]"
        />
        <button
          type="button"
          onClick={commit}
          disabled={!isCssColor(hex.trim())}
          className="h-8 rounded-md bg-[var(--primary)] px-2.5 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Apply
        </button>
      </div>
      <button
        type="button"
        onMouseDown={keepSelection}
        onClick={onReset}
        className="mt-2 text-[11px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
      >
        Reset color
      </button>
    </div>
  );
}
