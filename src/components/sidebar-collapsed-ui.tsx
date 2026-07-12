'use client';

/**
 * Collapsed-sidebar UI primitives.
 *
 * - `SidebarTooltip` — pure-CSS label that appears to the right on hover.
 *   Used for every nav item in collapsed mode so users can identify what
 *   each icon means.
 *
 * - `SidebarPopout` — click-triggered flyout that anchors to a trigger
 *   element and renders its children to the right via a portal (so it
 *   escapes the sidebar's overflow). Used by nav groups to surface their
 *   sub-pages when the sidebar is collapsed.
 */
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type SVGProps,
} from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Tooltip that appears to the right of its trigger on hover.
 *
 * Rendered via portal to `document.body` so it escapes ancestor
 * `overflow: hidden` / `overflow: auto` clipping — important because
 * the sidebar `<nav>` has `overflow-y-auto`, and per CSS spec any
 * non-visible overflow on one axis forces the other axis to clip too.
 * A purely-CSS tooltip positioned inside the nav would get cut off.
 *
 * Positioning uses the trigger's `getBoundingClientRect()` on hover.
 * `fixed` positioning so it doesn't shift when the viewport scrolls
 * (sidebar is `position: fixed` anyway — the trigger doesn't move).
 */
export function SidebarTooltip({
  label,
  hint,
  children,
}: {
  label: string;
  /** Optional keyboard shortcut shown as a small key badge after the label. */
  hint?: string;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hovered || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPos({
      top: rect.top + rect.height / 2,
      left: rect.right + 12,
    });
  }, [hovered]);

  return (
    <>
      <div
        ref={ref}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {children}
      </div>
      {hovered &&
        typeof document !== 'undefined' &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-[200] flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--foreground)] text-[var(--background)] text-xs font-medium whitespace-nowrap shadow-md"
            style={{ top: pos.top, left: pos.left, transform: 'translateY(-50%)' }}
          >
            {label}
            {hint && (
              <kbd className="rounded border border-[var(--background)]/30 bg-[var(--background)]/15 px-1 py-px font-mono text-[10px] leading-none">
                {hint}
              </kbd>
            )}
          </span>,
          document.body,
        )}
    </>
  );
}

/**
 * Click-triggered flyout. Renders the icon button as trigger; children
 * appear in a glass-styled popover to the right when open. Closes on:
 *   - outside click
 *   - Escape
 *   - route change (so navigating to a child page dismisses it)
 */
export function SidebarPopout({
  label,
  icon: Icon,
  active = false,
  children,
}: {
  label: string;
  icon: IconComponent;
  active?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoutRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Position to the right of the trigger when opening
  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.top, left: rect.right + 12 });
    }
  }, [open]);

  // Close on outside click + Escape
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        !triggerRef.current?.contains(e.target as Node) &&
        !popoutRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Close on route change (any link inside the popout that navigates will fire this)
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <SidebarTooltip label={label}>
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((v) => !v)}
          className={`flex items-center justify-center px-2 py-2.5 w-full rounded-xl text-sm font-medium transition-all duration-200 ${
            active || open
              ? 'text-[var(--sidebar-foreground)] bg-[var(--sidebar-muted)]'
              : 'text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)]'
          }`}
        >
          <Icon className="w-5 h-5" />
        </button>
      </SidebarTooltip>

      {open && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoutRef}
            role="menu"
            className="fixed z-[200] glass-dropdown rounded-xl p-1.5 min-w-[200px] animate-fade-in-up shadow-lg"
            style={{ top: pos.top, left: pos.left }}
          >
            <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              {label}
            </div>
            <div className="space-y-0.5">{children}</div>
          </div>,
          document.body,
        )}
    </>
  );
}
