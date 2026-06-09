'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronRightIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import {
  BoltIcon,
  EnvelopeIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  CalendarDaysIcon,
  ScaleIcon,
  StopCircleIcon,
  TagIcon,
  MinusCircleIcon,
  PencilSquareIcon,
  ListBulletIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';
import { BranchIcon } from '@/components/icons/branch';
import { NoteIcon } from '@/components/icons/note';
import {
  NODE_META,
  PALETTE_SECTIONS,
  type BuilderNodeType,
} from './types';

// Popover shown when the user clicks the hover-revealed + on an edge.
// Categorized list of step types with search; clicking a type calls
// `onPick` which inserts the step between the edge's source/target.
//
// Renders into a portal so it floats above ReactFlow's canvas chrome
// and isn't clipped by any parent's `overflow-hidden`.

type IconCmp = React.ComponentType<{ className?: string }>;

const ICON_MAP: Record<BuilderNodeType, IconCmp> = {
  trigger: BoltIcon,
  email: EnvelopeIcon,
  sms: ChatBubbleLeftRightIcon,
  add_tag: TagIcon,
  remove_tag: MinusCircleIcon,
  update_field: PencilSquareIcon,
  add_to_list: ListBulletIcon,
  remove_from_list: MinusCircleIcon,
  add_note: DocumentTextIcon,
  create_task: CheckCircleIcon,
  wait: ClockIcon,
  wait_until: CalendarDaysIcon,
  condition: BranchIcon,
  split: ScaleIcon,
  webhook: ArrowTopRightOnSquareIcon,
  exit: StopCircleIcon,
  sticky_note: NoteIcon,
};

interface InsertStepMenuProps {
  /** Viewport coords where the user clicked the + button. */
  clientX: number;
  clientY: number;
  onPick: (type: BuilderNodeType) => void;
  onClose: () => void;
}

export function InsertStepMenu({
  clientX,
  clientY,
  onPick,
  onClose,
}: InsertStepMenuProps) {
  const [search, setSearch] = useState('');
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const query = search.trim().toLowerCase();

  // Same section/category structure as the palette, minus the entry
  // (trigger — can't insert another mid-flow) and exit: the flow now ends
  // implicitly at any leaf step (shown as a baked-in "End" cap), so an
  // explicit Exit node is no longer something users add by hand.
  const sections = useMemo(() => {
    return PALETTE_SECTIONS.filter((s) => s.category !== 'entry').map(
      (section) => {
        const types = (Object.keys(NODE_META) as BuilderNodeType[])
          .filter((t) => NODE_META[t].category === section.category)
          .filter((t) => t !== 'trigger')
          .filter((t) => t !== 'exit')
          .filter((t) => {
            if (!query) return true;
            const meta = NODE_META[t];
            return (
              meta.label.toLowerCase().includes(query) ||
              meta.description.toLowerCase().includes(query)
            );
          });
        return { ...section, types };
      },
    ).filter((s) => s.types.length > 0);
  }, [query]);

  // Auto-focus the search input on mount so the user can type
  // immediately after clicking +.
  useEffect(() => {
    requestAnimationFrame(() => searchRef.current?.focus());
  }, []);

  // Click outside to close. Capture-phase pointerdown beats focus
  // shifts from the inputs inside.
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener('pointerdown', handler);
    return () => window.removeEventListener('pointerdown', handler);
  }, [onClose]);

  // Esc closes too.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Position the popover near the click but clamp to viewport so it
  // doesn't get cut off at edges. 300px wide × ~360px tall budget.
  const POPOVER_W = 288;
  const POPOVER_H = 360;
  const padding = 12;
  const left = Math.min(
    Math.max(padding, clientX - POPOVER_W / 2),
    window.innerWidth - POPOVER_W - padding,
  );
  const top = Math.min(
    Math.max(padding, clientY + 8),
    window.innerHeight - POPOVER_H - padding,
  );

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={popoverRef}
      style={{ position: 'fixed', top, left, width: POPOVER_W, maxHeight: POPOVER_H }}
      className="z-[300] flex flex-col rounded-lg border border-[var(--border)] bg-[var(--card-strong)] backdrop-blur-2xl backdrop-saturate-150 shadow-xl overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-[var(--border)]">
        <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-1.5">
          Insert step
        </div>
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted-foreground)]" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search steps"
            className="w-full pl-7 pr-2 py-1 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        {sections.length === 0 && (
          <p className="text-[11px] text-[var(--muted-foreground)] text-center py-4">
            No steps match “{search}”.
          </p>
        )}
        {sections.map((section) => (
          <SectionCard
            key={section.category}
            label={section.label}
            types={section.types}
            onPick={onPick}
          />
        ))}
      </div>
    </div>,
    document.body,
  );
}

function SectionCard({
  label,
  types,
  onPick,
}: {
  label: string;
  types: BuilderNodeType[];
  onPick: (type: BuilderNodeType) => void;
}) {
  return (
    <div className="rounded-md overflow-hidden">
      <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </div>
      <ul className="space-y-0.5">
        {types.map((type) => {
          const meta = NODE_META[type];
          const Icon = ICON_MAP[type];
          return (
            <li key={type}>
              <button
                type="button"
                onClick={() => onPick(type)}
                disabled={!meta.executable}
                className="group w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-[var(--muted)]/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title={meta.description}
              >
                <span
                  className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${meta.bg}`}
                >
                  <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-[var(--foreground)] block truncate">
                    {meta.label}
                  </span>
                  {!meta.executable && (
                    <span className="text-[9px] uppercase tracking-wider text-amber-400">
                      Coming soon
                    </span>
                  )}
                </span>
                {meta.executable && (
                  <ChevronRightIcon className="w-3 h-3 text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
