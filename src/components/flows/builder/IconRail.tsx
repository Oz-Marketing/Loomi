'use client';

import {
  ChartBarSquareIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { NoteIcon } from '@/components/icons/note';

// ── Feature identifiers for the left rail ──
//
// Each rail item maps to one of these. Most open a shared left drawer
// (FeatureDrawer); a couple are different kinds of action:
//   - `sticky_notes` is a drag source (drop a sticky note onto the
//     canvas) and does not open a drawer
//   - `stats` is a toggle — when on, the canvas overlays per-node stat
//     chips on email / sms nodes
// The non-drawer kinds still appear in the rail; their `onSelect`
// callback in FlowBuilder dispatches them separately.

export type RailFeature =
  | 'iris'
  | 'notes'
  | 'sticky_notes'
  | 'stats'
  | 'error_log'
  | 'version_history';

interface RailItem {
  feature: RailFeature;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** True for items that are draggable rather than click-to-open
   *  (currently just sticky notes). */
  draggable?: boolean;
  /** Toggle-style items (e.g. stats overlay) — selected state shows a
   *  fill rather than acting as a drawer-active state. */
  toggle?: boolean;
}

// Iris lives in its own fully-rounded button ABOVE the rail
// container — separate visual treatment because it's the marquee
// AI entry point. See IrisRailButton below.
const RAIL_ITEMS: RailItem[] = [
  { feature: 'notes', label: 'Notes', Icon: ChatBubbleLeftRightIcon },
  // The sticky-note rail item is a drag source — users grab it and
  // drop onto the canvas to create a sticky note. No drawer.
  { feature: 'sticky_notes', label: 'Sticky Notes', Icon: NoteIcon, draggable: true },
  { feature: 'stats', label: 'Stats View', Icon: ChartBarSquareIcon, toggle: true },
  { feature: 'error_log', label: 'Error Log', Icon: ExclamationTriangleIcon },
  { feature: 'version_history', label: 'Version History', Icon: ClockIcon },
];

interface IconRailProps {
  /** Active drawer feature, or null. Toggle features (`stats`) live in
   *  `toggleStates` instead so they can be on independently of any
   *  drawer. */
  activeDrawer: RailFeature | null;
  toggleStates: Partial<Record<RailFeature, boolean>>;
  onSelect: (feature: RailFeature) => void;
  /** Drag start for `sticky_notes`. The rail just sets the right
   *  dataTransfer payload; FlowBuilder's existing `onDrop` reads it
   *  and creates the sticky-note node. */
  onStickyNoteDragStart: (e: React.DragEvent) => void;
  /** Optional unread-style count badges per feature. Currently used by
   *  `error_log` to surface the number of active validation errors. */
  badges?: Partial<Record<RailFeature, number>>;
}

export function IconRail({
  activeDrawer,
  toggleStates,
  onSelect,
  onStickyNoteDragStart,
  badges,
}: IconRailProps) {
  const irisActive = !!toggleStates.iris;
  return (
    <div className="flex flex-col items-center gap-3">
      {/* Iris — fully-rounded standalone button above the rail. The
          animated rainbow shimmer is the bg; the sparkle icon is
          black so it pops on the colourful surface. */}
      <IrisRailButton active={irisActive} onClick={() => onSelect('iris')} />

      {/* Frosted-glass rail wrapping the remaining tools. */}
      <aside
        className="w-14 flex-shrink-0 flex flex-col items-center gap-1 py-2 rounded-xl border border-[var(--border)] bg-[var(--card-strong)] backdrop-blur-2xl backdrop-saturate-150 shadow-md"
        aria-label="Flow builder tools"
      >
      {RAIL_ITEMS.map((item) => {
        const isActive = item.toggle
          ? !!toggleStates[item.feature]
          : activeDrawer === item.feature;

        const handleDragStart = item.draggable
          ? (e: React.DragEvent) => onStickyNoteDragStart(e)
          : undefined;

        // Toggle-style items (stats) tint to primary when on; drawer
        // items don't get an active state here because opening a
        // drawer hides the rail anyway.
        const colorClass = isActive
          ? 'text-[var(--primary)]'
          : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]';

        return (
          // `group` lets us style the tooltip span based on the button's
          // hover state. No native `title` attribute — that would queue
          // the browser's slow yellow tooltip on top of ours after
          // ~700ms.
          <button
            key={item.feature}
            type="button"
            draggable={item.draggable}
            onDragStart={handleDragStart}
            onClick={() => onSelect(item.feature)}
            aria-label={item.label}
            aria-pressed={item.toggle ? isActive : undefined}
            className={`group relative w-11 h-11 rounded-md flex items-center justify-center transition-colors ${colorClass} ${
              isActive ? 'bg-[var(--muted)]' : 'hover:bg-[var(--muted)]'
            } ${item.draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
          >
            <item.Icon className="w-6 h-6" />
            {(() => {
              const count = badges?.[item.feature] ?? 0;
              if (count <= 0) return null;
              return (
                <span
                  aria-label={`${count} ${item.label} ${count === 1 ? 'item' : 'items'}`}
                  className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center tabular-nums shadow-sm"
                >
                  {count > 9 ? '9+' : count}
                </span>
              );
            })()}
            {/* Custom tooltip — anchors to the right of the icon, fades
                in on hover with a slight delay (so brushing past the
                rail doesn't flash tooltips). pointer-events-none so
                the tooltip itself never intercepts clicks. */}
            <span
              role="tooltip"
              className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 z-50 whitespace-nowrap px-2.5 py-1 rounded-md text-xs font-medium text-[var(--foreground)] bg-[var(--card-strong)] border border-[var(--border)] backdrop-blur-xl backdrop-saturate-150 shadow-md opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 delay-150"
            >
              {item.label}
              {item.draggable && (
                <span className="ml-1.5 text-[var(--muted-foreground)] text-[10px]">
                  drag onto canvas
                </span>
              )}
            </span>
          </button>
        );
      })}
      </aside>
    </div>
  );
}

// ── Iris button (extracted) ──
//
// Fully-rounded standalone button that lives above the rail container.
// Visually distinct from the rest of the rail items so the AI entry
// point is the obvious focal point. The animated `iris-rainbow-gradient`
// is the bg; the sparkle icon is black so it pops on the chromatic
// surface.

function IrisRailButton({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Iris"
      aria-pressed={active}
      className={`group relative w-12 h-12 rounded-full iris-rainbow-gradient flex items-center justify-center shadow-md transition-transform hover:scale-105 active:scale-95 ${
        active ? 'ring-2 ring-[var(--primary)]/40 ring-offset-2 ring-offset-[var(--card)]' : ''
      }`}
    >
      <SparklesIcon className="w-6 h-6 text-zinc-900" />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 z-50 whitespace-nowrap px-2.5 py-1 rounded-md text-xs font-medium text-[var(--foreground)] bg-[var(--card-strong)] border border-[var(--border)] backdrop-blur-xl backdrop-saturate-150 shadow-md opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 delay-150"
      >
        Iris
      </span>
    </button>
  );
}
