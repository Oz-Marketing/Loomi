'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { usePacerReadOnly } from './pacer-read-only';

// useLayoutEffect warns during SSR; the popover only ever mounts after a click,
// so falling back to useEffect on the server just silences the dev warning.
const useIsoLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Inline editor for one cell of the plan table. The cell's normal content is
 * the trigger; clicking it drops a small popover directly below with the
 * control(s) for that field. Escape or a click outside closes it.
 *
 * The popover renders through a portal on document.body for two reasons: the
 * table scrolls inside an `overflow-x-auto` wrapper that would clip it, and the
 * rows are HTML5-draggable — inputs nested inside a draggable element are
 * awkward to focus and impossible to text-select in some browsers. Only the
 * trigger stays inside the row.
 *
 * On a frozen month (read-only) the trigger degrades to plain, inert content.
 */
export function CellEditor({
  label,
  display,
  width = 240,
  align = 'left',
  disabled,
  onClose,
  children,
}: {
  /** Small caps header inside the popover. */
  label?: string;
  /** What the cell shows when closed. */
  display: ReactNode;
  /** Popover width in px. */
  width?: number;
  /** Which edge of the trigger the popover lines up with. */
  align?: 'left' | 'right';
  disabled?: boolean;
  /**
   * Fired when the popover closes. Free-text editors (name, allocation) keep a
   * local draft and commit here, so a Google row doesn't PUT on every keystroke.
   */
  onClose?: () => void;
  /** Editor content. `close()` commits + dismisses the popover. */
  children: (close: () => void) => ReactNode;
}) {
  const readOnly = usePacerReadOnly();
  const locked = disabled || readOnly;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setPos(null); // force a fresh measure next time it opens
    onClose?.();
  }, [onClose]);

  // Measures the popover itself before deciding whether it fits below the
  // trigger — a status list can be 400px tall, so guessing the height here
  // would let a long popover hang off the bottom of the viewport.
  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    const popover = popoverRef.current;
    if (!el || !popover) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const height = popover.offsetHeight;
    let left = align === 'right' ? rect.right - width : rect.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - margin) {
      // Prefer above; if it doesn't fit there either, clamp into view.
      top = rect.top - height - 4;
      if (top < margin) top = Math.max(margin, window.innerHeight - height - margin);
    }
    setPos({ top, left });
  }, [align, width]);

  useIsoLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const onScroll = () => updatePosition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      // Date pickers and status dropdowns opened from inside the popover
      // portal their own layer next to it — a click there isn't "outside".
      if (
        t instanceof Element &&
        t.closest('[data-datepicker-popover], [role="listbox"]')
      ) {
        return;
      }
      close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  if (locked) {
    return <div className="min-w-0">{display}</div>;
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        // The row is draggable; a native drag starting on this button would
        // swallow the click, so opt the trigger out of dragging entirely.
        draggable
        onDragStart={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (open) close();
          else setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        // Fills the cell (plus the 12px of cell padding the negative margins
        // reclaim) so the whole cell is the click target, while the content
        // stays visually aligned with the un-editable columns.
        className={`block w-[calc(100%+0.75rem)] -mx-1.5 -my-1 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[var(--muted)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/50 ${
          open ? 'bg-[var(--muted)] ring-1 ring-[var(--primary)]/50' : ''
        }`}
      >
        {display}
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label={label}
              onMouseDown={(e) => e.stopPropagation()}
              className="fixed z-[200] rounded-xl border border-[var(--border)] bg-[var(--background)] p-2.5 shadow-2xl"
              style={{
                top: pos?.top ?? 0,
                left: pos?.left ?? 0,
                width,
                // Hidden for the first paint — the layout effect measures the
                // real height, then pins it.
                visibility: pos ? 'visible' : 'hidden',
              }}
            >
              {label && (
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  {label}
                </div>
              )}
              {children(close)}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
