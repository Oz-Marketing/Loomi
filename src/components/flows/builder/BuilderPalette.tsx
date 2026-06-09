'use client';

import { useMemo, useState } from 'react';
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
  ArrowRightCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { BranchIcon } from '@/components/icons/branch';
import { NoteIcon } from '@/components/icons/note';
import {
  NODE_META,
  PALETTE_SECTIONS,
  type BuilderNodeCategory,
  type BuilderNodeType,
} from './types';

type IconCmp = React.ComponentType<{ className?: string }>;

// Same icon table as BuilderNodes — kept duplicated rather than
// exported to avoid a circular import (BuilderNodes already imports
// from `./types`). Small enough to be fine.
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
  push_to_crm: ArrowRightCircleIcon,
  exit: StopCircleIcon,
  sticky_note: NoteIcon,
};

// Trigger is created with the flow and lives on the canvas as the entry
// node. We render it in its own pinned section above the draggable steps
// rather than letting the user drag a second one.
const PINNED_ENTRY_TYPE: BuilderNodeType = 'trigger';

export function BuilderPalette() {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<BuilderNodeCategory, boolean>>(
    {} as Record<BuilderNodeCategory, boolean>,
  );

  const query = search.trim().toLowerCase();

  // Group types into the sections declared in PALETTE_SECTIONS. Filter
  // by search query (matches label OR description) when one is active.
  const sections = useMemo(() => {
    return PALETTE_SECTIONS.map((section) => {
      const types = (Object.keys(NODE_META) as BuilderNodeType[])
        .filter((t) => NODE_META[t].category === section.category)
        // Trigger is pinned at the top; suppress it from the list view.
        .filter((t) => t !== PINNED_ENTRY_TYPE)
        // Exit is no longer added by hand — flows end implicitly at any leaf
        // step (shown as a baked-in "End" cap), so drop it from the palette.
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
    }).filter((s) => s.types.length > 0);
  }, [query]);

  function toggleCollapsed(category: BuilderNodeCategory) {
    setCollapsed((prev) => ({ ...prev, [category]: !prev[category] }));
  }

  function handleDragStart(e: React.DragEvent, nodeType: BuilderNodeType) {
    e.dataTransfer.setData('application/loomi-flow-node', nodeType);
    e.dataTransfer.effectAllowed = 'move';
  }

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--card-strong)] backdrop-blur-2xl backdrop-saturate-150">
      {/* Header — mirrors the GHL Actions panel: title + subtitle row,
          then a search input below. */}
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">Actions</h3>
        <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
          Drag onto the canvas to add a step.
        </p>
      </div>

      <div className="px-3 py-2 border-b border-[var(--border)]">
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted-foreground)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search actions"
            className="w-full pl-7 pr-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
      </div>

      {/* Pinned entry row — non-draggable; clarifies the trigger lives
          on the canvas as the entry point and is managed via the
          Triggers drawer in the top bar, not by adding more of them. */}
      <div className="px-3 pt-3">
        <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-1.5 pl-1">
          Entry
        </div>
        <div
          className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 cursor-not-allowed"
          title="Trigger is created automatically. Configure via the Triggers button in the top bar."
        >
          <span
            className={`w-8 h-8 rounded-md flex items-center justify-center ${NODE_META[PINNED_ENTRY_TYPE].bg}`}
          >
            <BoltIcon className={`w-4 h-4 ${NODE_META[PINNED_ENTRY_TYPE].color}`} />
          </span>
          <span className="flex-1 min-w-0 text-xs font-medium truncate">
            {NODE_META[PINNED_ENTRY_TYPE].label}
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {sections
          // The pinned "Entry" section is rendered above; skip it here.
          .filter((s) => s.category !== 'entry')
          .map((section) => {
            const isCollapsed = !!collapsed[section.category];
            return (
              <div
                key={section.category}
                className="border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--card)]/40"
              >
                <button
                  type="button"
                  onClick={() => toggleCollapsed(section.category)}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-[var(--muted)]/50 transition-colors"
                >
                  <span className="text-xs font-semibold text-[var(--foreground)]">
                    {section.label}
                  </span>
                  {isCollapsed ? (
                    <ChevronRightIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                  ) : (
                    <ChevronDownIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                  )}
                </button>
                {!isCollapsed && (
                  <ul className="px-1.5 pb-1.5 space-y-0.5">
                    {section.types.map((type) => (
                      <PaletteItem
                        key={type}
                        type={type}
                        icon={ICON_MAP[type]}
                        onDragStart={handleDragStart}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}

        {sections.length === 0 && query && (
          <p className="text-[11px] text-[var(--muted-foreground)] text-center py-6">
            No actions match “{search}”.
          </p>
        )}
      </div>
    </aside>
  );
}

function PaletteItem({
  type,
  icon: Icon,
  onDragStart,
}: {
  type: BuilderNodeType;
  icon: IconCmp;
  onDragStart: (e: React.DragEvent, t: BuilderNodeType) => void;
}) {
  const meta = NODE_META[type];
  return (
    <li>
      <button
        type="button"
        draggable
        onDragStart={(e) => onDragStart(e, type)}
        className="group w-full flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-[var(--muted)]/60 transition-colors cursor-grab active:cursor-grabbing"
        title={meta.description}
      >
        <span
          className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${meta.bg}`}
        >
          <Icon className={`w-4 h-4 ${meta.color}`} />
        </span>
        <span className="flex-1 min-w-0 text-left">
          <span className="text-xs font-medium text-[var(--foreground)] block truncate">
            {meta.label}
          </span>
          {!meta.executable && (
            <span className="text-[9px] uppercase tracking-wider text-amber-400">
              Coming soon
            </span>
          )}
        </span>
        <ChevronRightIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
      </button>
    </li>
  );
}
