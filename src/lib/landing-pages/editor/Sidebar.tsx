'use client';

import * as React from 'react';
import {
  ArrowLeftIcon,
  Cog6ToothIcon,
  ListBulletIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline';
import { useLandingPageEditor } from './EditorContext';
import { BlockPalette } from './BlockPalette';
import { BlockProperties } from './PropertyPanel';
import { PageSettingsPanel } from './PageSettingsPanel';
import { OutlinePanel } from './OutlinePanel';
import { BLOCK_SCHEMA_BY_TYPE } from '../schemas';
import type { Block } from '../types';

type SidebarTab = 'content' | 'outline' | 'settings';

/**
 * Left sidebar — single panel housing the block palette, page
 * settings, and per-block properties. Mirrors the forms / template
 * editor pattern (page-level controls live with the tools on the
 * left, not in a right rail).
 *
 * Lifecycle:
 *  - Nothing selected → tabbed view (Content / Settings).
 *  - Block selected   → BlockProperties takes over the panel, with
 *    a "← Back" header that deselects.
 */
export function Sidebar() {
  const { template, selectedId, selectBlock } = useLandingPageEditor();
  const [tab, setTab] = React.useState<SidebarTab>('content');

  const selectedBlock = selectedId ? findBlockDeep(template.blocks, selectedId) : null;

  return (
    <aside className="flex flex-col h-full w-full min-h-0 bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
      {selectedBlock ? (
        <SelectedBlockHeader
          block={selectedBlock}
          onBack={() => selectBlock(null)}
        />
      ) : (
        <SidebarTabs tab={tab} onTabChange={setTab} />
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {selectedBlock ? (
          <BlockProperties />
        ) : tab === 'content' ? (
          <BlockPalette />
        ) : tab === 'outline' ? (
          <OutlinePanel />
        ) : (
          <PageSettingsPanel />
        )}
      </div>
    </aside>
  );
}

function SelectedBlockHeader({
  block,
  onBack,
}: {
  block: Block;
  onBack: () => void;
}) {
  const schema = BLOCK_SCHEMA_BY_TYPE[block.type];
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border)]">
      <button
        type="button"
        onClick={onBack}
        title="Back to blocks + settings"
        aria-label="Deselect"
        className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
      >
        <ArrowLeftIcon className="w-4 h-4" />
      </button>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
          Block
        </div>
        <div className="text-sm font-semibold truncate">
          {schema?.label ?? block.type}
        </div>
      </div>
    </div>
  );
}

function SidebarTabs({
  tab,
  onTabChange,
}: {
  tab: SidebarTab;
  onTabChange: (next: SidebarTab) => void;
}) {
  // Segmented pill control — matches the Meta-Ads planner's
  // Initial Setup / Mid-flight Reallocation toggle, which the user
  // wants standardized across editors. Filled primary for active,
  // transparent for the rest.
  return (
    <div className="px-3 pt-3 pb-2">
      <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 gap-0.5">
        <PillTab
          active={tab === 'content'}
          onClick={() => onTabChange('content')}
          icon={<Squares2X2Icon className="w-3.5 h-3.5" />}
          label="Content"
        />
        <PillTab
          active={tab === 'outline'}
          onClick={() => onTabChange('outline')}
          icon={<ListBulletIcon className="w-3.5 h-3.5" />}
          label="Outline"
        />
        <PillTab
          active={tab === 'settings'}
          onClick={() => onTabChange('settings')}
          icon={<Cog6ToothIcon className="w-3.5 h-3.5" />}
          label="Settings"
        />
      </div>
    </div>
  );
}

function PillTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium rounded transition-colors ${
        active
          ? 'bg-[var(--primary)] text-white'
          : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function findBlockDeep(blocks: Block[], id: string): Block | undefined {
  for (const b of blocks) {
    if (b.id === id) return b;
    if (b.children) {
      const inner = findBlockDeep(b.children, id);
      if (inner) return inner;
    }
  }
  return undefined;
}
