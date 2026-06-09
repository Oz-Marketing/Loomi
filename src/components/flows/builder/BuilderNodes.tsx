'use client';

import { memo, useMemo, useRef } from 'react';
import {
  Handle,
  Position,
  useEdges,
  type NodeProps,
} from '@xyflow/react';
import { PlusIcon } from '@heroicons/react/24/outline';
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
  ExclamationTriangleIcon,
  DocumentDuplicateIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useBuilderContext } from './BuilderContext';
import { BranchIcon } from '@/components/icons/branch';
import { NoteIcon } from '@/components/icons/note';
import {
  CONDITION_FALLBACK_ID,
  NODE_META,
  type BuilderNodeData,
  type BuilderNodeStats,
  type BuilderNodeType,
  type ConditionBranch,
  type ConditionConfig,
} from './types';

const ICON_MAP: Record<BuilderNodeType, React.ComponentType<{ className?: string }>> = {
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

// Reusable card shell. Each specific node renders its own labels +
// summary line below the header, but they all share the same outer
// chrome so the canvas reads as a coherent system rather than six
// bespoke widgets.
function NodeShell({
  type,
  nodeId,
  selected,
  summary,
  statsRow,
  widthOverride,
  errors,
  titleOverride,
  children,
}: {
  type: BuilderNodeData['type'];
  /** Used by the hover-revealed clone/delete buttons to call back
   *  into BuilderContext. */
  nodeId: string;
  selected?: boolean;
  summary: string;
  /** Optional per-node analytics chips. Rendered just under the
   *  summary; absent on draft flows that have never run. */
  statsRow?: React.ReactNode;
  /** Override the default 220px width — needed by the condition node
   *  when it has many branches that wouldn't fit otherwise. */
  widthOverride?: number;
  /** Per-node validation messages from the last publish attempt.
   *  When non-empty, the shell paints a red ring + chip and the first
   *  message previews under the summary. Full list shows in the
   *  inspector when the node is selected. */
  errors?: string[];
  /** Optional custom title shown in the header in place of the
   *  NODE_META label. Used by the condition node so the user can
   *  rename "Condition" to the actual branching question. */
  titleOverride?: string;
  children?: React.ReactNode;
}) {
  const meta = NODE_META[type];
  const Icon = ICON_MAP[type];
  const headerTitle = titleOverride?.trim() || meta.label;
  const hasErrors = !!errors && errors.length > 0;
  const { onCloneNode, onDeleteNode, onAddAfterNode, highlightedNodeId, highlightSeverity } =
    useBuilderContext();
  // The Error Log paints this ring when the user clicks an issue — it wins
  // over the passive error/selected states so the clicked node is obvious.
  const isHighlighted = highlightedNodeId === nodeId;
  const plusButtonRef = useRef<HTMLButtonElement | null>(null);

  // The +-button below the node lets the user extend the flow when
  // it's a true leaf (no outgoing edges yet). For already-connected
  // nodes the existing hover-+ on the connector handles inserting
  // between them — showing both would be visually redundant.
  // Exempt types: terminal (exit), annotation (sticky_note), and
  // multi-handle branchers (condition/split) where + on the body is
  // ambiguous (which branch?).
  const ADD_NEXT_EXEMPT = new Set<BuilderNodeData['type']>([
    'exit',
    'sticky_note',
    'condition',
    'split',
  ]);
  const edges = useEdges();
  const hasOutgoing = useMemo(
    () => edges.some((e) => e.source === nodeId),
    [edges, nodeId],
  );
  const showAddNext = !ADD_NEXT_EXEMPT.has(type) && !hasOutgoing;
  // A plain action step with no next is the flow's implicit end — the engine
  // marks the contact completed on reaching any leaf (advanceEnrollment in
  // loomi-flows.ts). Show a baked-in "End" cap there so users no longer add
  // an Exit node by hand. Excludes the trigger (a trigger-only flow has no
  // module to "end") and the exempt branch/annotation/exit types.
  const showEndCap = showAddNext && type !== 'trigger';

  function handleAddAfter() {
    const rect = plusButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    onAddAfterNode(nodeId, rect.left + rect.width / 2, rect.bottom);
  }
  // Trigger is the flow's entry point — cloning/deleting it would
  // strand every contact in the flow. Block both actions for that
  // type. (Other types are free to clone or delete.)
  const canMutate = type !== 'trigger';
  return (
    <div
      className={`group relative rounded-xl border bg-[var(--card-strong)] backdrop-blur-xl backdrop-saturate-150 shadow-sm transition-shadow ${
        isHighlighted && highlightSeverity === 'warning'
          ? 'border-amber-500/80 ring-2 ring-amber-500/50 shadow-md'
          : isHighlighted
            ? 'border-rose-500/80 ring-2 ring-rose-500/50 shadow-md'
            : hasErrors
              ? 'border-rose-500/70 ring-2 ring-rose-500/40 shadow-md'
              : selected
                ? 'border-[var(--primary)] shadow-md ring-2 ring-[var(--primary)]/30'
                : 'border-[var(--border)]'
      }`}
      style={{ width: widthOverride ?? 220 }}
    >
      {hasErrors && (
        <span
          title={errors!.join('\n')}
          className="absolute -top-2 -right-2 z-10 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[9px] font-semibold shadow-md"
        >
          <ExclamationTriangleIcon className="w-3 h-3" />
          {errors!.length}
        </span>
      )}
      {canMutate && (
        <div className="nodrag absolute -top-3 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 rounded-md border border-[var(--border)] bg-[var(--card-strong)] backdrop-blur-md shadow-md px-0.5 py-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCloneNode(nodeId);
            }}
            title="Clone step (paste it elsewhere on the canvas)"
            className="inline-flex items-center justify-center w-6 h-6 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <DocumentDuplicateIcon className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteNode(nodeId);
            }}
            title="Delete step"
            className="inline-flex items-center justify-center w-6 h-6 rounded text-[var(--muted-foreground)] hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
          >
            <TrashIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
        <span className={`w-6 h-6 rounded-md flex items-center justify-center ${meta.bg} flex-shrink-0`}>
          <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
        </span>
        <span
          title={titleOverride ? `${meta.label} — ${headerTitle}` : undefined}
          className="text-xs font-semibold text-[var(--foreground)] truncate"
        >
          {headerTitle}
        </span>
      </div>
      <div className="px-3 py-2 text-[11px] text-[var(--muted-foreground)] min-h-[28px]">
        {summary}
      </div>
      {hasErrors && (
        <div className="px-3 py-1.5 border-t border-rose-500/30 bg-rose-500/10 text-[10px] text-rose-300 leading-snug">
          {errors![0]}
          {errors!.length > 1 && (
            <span className="text-rose-400/80"> · +{errors!.length - 1} more</span>
          )}
        </div>
      )}
      {statsRow}
      {children}
      {/* Bottom affordance for leaf nodes: the "+ add next" button and,
          for plain action steps, a baked-in "End" cap that shows the flow
          terminates here (contact marked completed). Both hang below the
          card; a leaf has nothing beneath it so auto-layout leaves room.
          Hidden for terminal/annotation/branching types (ADD_NEXT_EXEMPT). */}
      {(showAddNext || showEndCap) && (
        <div className="nodrag absolute left-1/2 top-full -translate-x-1/2 mt-2 flex flex-col items-center gap-1.5">
          {showAddNext && (
            <button
              ref={plusButtonRef}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleAddAfter();
              }}
              title="Add step after"
              aria-label="Add step after"
              className="w-5 h-5 rounded-full border border-[var(--border)] bg-[var(--card-strong)] text-[var(--muted-foreground)] hover:text-white hover:bg-[var(--primary)] hover:border-[var(--primary)] flex items-center justify-center shadow-sm transition-colors"
            >
              <PlusIcon className="w-3 h-3" />
            </button>
          )}
          {showEndCap && (
            <>
              <span className="w-px h-2 bg-[var(--border)]" aria-hidden />
              <span
                title="The flow ends here — the contact is marked completed."
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-[var(--border)] bg-zinc-500/15 text-zinc-300 text-[10px] font-semibold uppercase tracking-wider"
              >
                <StopCircleIcon className="w-3 h-3" />
                End
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Stat chip primitives ──

function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'yes' | 'no' | 'warn';
}) {
  const toneClass =
    tone === 'yes'
      ? 'text-emerald-400'
      : tone === 'no'
        ? 'text-rose-400'
        : tone === 'warn'
          ? 'text-amber-400'
          : 'text-[var(--foreground)]';
  return (
    <div className="flex flex-col items-start gap-0.5 min-w-0" title={hint}>
      <span className="text-[9px] uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </span>
      <span className={`text-[11px] font-semibold tabular-nums ${toneClass}`}>{value}</span>
    </div>
  );
}

function StatsRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-1.5 border-t border-[var(--border)] flex items-center gap-3 flex-wrap">
      {children}
    </div>
  );
}

function formatNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function pct(numer: number, denom: number): string {
  if (denom <= 0) return '0%';
  return `${Math.round((numer / denom) * 100)}%`;
}

function emailStatsRow(stats: BuilderNodeStats | undefined): React.ReactNode {
  if (!stats || (stats.sent ?? 0) === 0) return null;
  const sent = stats.sent ?? 0;
  return (
    <StatsRow>
      <Stat label="Sent" value={formatNumber(sent)} />
      <Stat
        label="Open"
        value={pct(stats.opened ?? 0, sent)}
        hint={`${stats.opened ?? 0} of ${sent}`}
      />
      <Stat
        label="Click"
        value={pct(stats.clicked ?? 0, sent)}
        hint={`${stats.clicked ?? 0} of ${sent}`}
      />
      {(stats.failed ?? 0) > 0 && (
        <Stat label="Failed" value={formatNumber(stats.failed!)} tone="warn" />
      )}
    </StatsRow>
  );
}

function branchStatsRow(
  stats: BuilderNodeStats | undefined,
  layout: 'condition' | 'split',
): React.ReactNode {
  const branches = stats?.branches;
  if (!branches || Object.keys(branches).length === 0) return null;
  const total = Object.values(branches).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  if (layout === 'condition') {
    const yes = branches.yes ?? 0;
    const no = branches.no ?? 0;
    return (
      <StatsRow>
        <Stat label="Yes" value={formatNumber(yes)} tone="yes" hint={pct(yes, total)} />
        <Stat label="No" value={formatNumber(no)} tone="no" hint={pct(no, total)} />
      </StatsRow>
    );
  }
  // Split: render each branch in declared order
  return (
    <StatsRow>
      {Object.entries(branches).map(([label, count]) => (
        <Stat
          key={label}
          label={label.toUpperCase()}
          value={formatNumber(count)}
          hint={pct(count, total)}
        />
      ))}
    </StatsRow>
  );
}

const handleStyle = {
  width: 10,
  height: 10,
  border: '2px solid var(--background)',
  background: 'var(--primary)',
};

export const TriggerNode = memo(function TriggerNode({
  id,
  data,
  selected,
}: NodeProps) {
  const builderData = data as BuilderNodeData;
  const enrolled = builderData.stats?.enrolled ?? 0;
  const statsRow =
    enrolled > 0 ? (
      <StatsRow>
        <Stat label="Enrolled" value={formatNumber(enrolled)} hint="Lifetime enrollments" />
      </StatsRow>
    ) : null;
  return (
    <NodeShell
      type="trigger"
      nodeId={id}
      selected={!!selected}
      summary="Contacts enter here."
      statsRow={statsRow}
      errors={builderData.errors}
    >
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </NodeShell>
  );
});

export const EmailNode = memo(function EmailNode({
  id,
  data,
  selected,
}: NodeProps) {
  const builderData = data as BuilderNodeData;
  const config = builderData.config ?? {};
  const subject = String(config.subject || '');
  const templateId = config.templateId ? String(config.templateId) : '';
  const summary = subject
    ? `Subject: ${subject}`
    : templateId
      ? `Template: ${templateId.slice(0, 12)}…`
      : 'Pick a template or set inline HTML →';
  return (
    <NodeShell
      type="email"
      nodeId={id}
      selected={!!selected}
      summary={summary}
      statsRow={emailStatsRow(builderData.stats)}
      errors={builderData.errors}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </NodeShell>
  );
});

export const WaitNode = memo(function WaitNode({
  id,
  data,
  selected,
}: NodeProps) {
  const builderData = data as BuilderNodeData;
  const config = builderData.config ?? {};
  const ms = Number(config.ms || 0);
  const summary = ms > 0 ? `Wait ${formatDuration(ms)}` : 'Set a delay →';
  return (
    <NodeShell
      type="wait"
      nodeId={id}
      selected={!!selected}
      summary={summary}
      errors={builderData.errors}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </NodeShell>
  );
});

export const ConditionNode = memo(function ConditionNode({
  id,
  data,
  selected,
}: NodeProps) {
  const builderData = data as BuilderNodeData;
  const config = (builderData.config ?? {}) as ConditionConfig;
  const branches: ConditionBranch[] = Array.isArray(config.branches)
    ? config.branches
    : [];
  const fallbackLabel = (config.fallbackLabel || 'else').trim() || 'else';

  // Each user-defined branch plus the implicit fallback gets its own
  // source handle. Handles are evenly distributed across the bottom edge
  // and labels render in a row underneath so the user can tell which
  // branch each outgoing edge represents at a glance.
  const handles: { id: string; label: string; tone: 'branch' | 'fallback' }[] = [
    ...branches.map((b) => ({
      id: b.id,
      label: b.label || b.id,
      tone: 'branch' as const,
    })),
    { id: CONDITION_FALLBACK_ID, label: fallbackLabel, tone: 'fallback' as const },
  ];

  const totalRules = branches.reduce((acc, b) => acc + b.rules.length, 0);
  const summary = branches.length === 0
    ? 'Add a branch →'
    : totalRules === 0
      ? `${branches.length} branch${branches.length === 1 ? '' : 'es'} — add rules →`
      : `${branches.length} branch${branches.length === 1 ? '' : 'es'} · ${totalRules} rule${totalRules === 1 ? '' : 's'}`;

  const stats = branchStatsRow(builderData.stats, 'condition');

  // Widen the node when there are many branches so the labels don't
  // crowd. 4 branches = default width; each extra adds breathing room.
  const widthOverride = handles.length > 4
    ? Math.min(380, 220 + (handles.length - 4) * 40)
    : 220;

  return (
    <NodeShell
      type="condition"
      nodeId={id}
      selected={!!selected}
      summary={summary}
      statsRow={stats}
      widthOverride={widthOverride}
      errors={builderData.errors}
      titleOverride={config.title}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} />
      {handles.map((h, i) => {
        const left = ((i + 1) / (handles.length + 1)) * 100;
        return (
          <Handle
            key={h.id}
            type="source"
            position={Position.Bottom}
            id={h.id}
            style={{ ...handleStyle, left: `${left}%` }}
          />
        );
      })}
      <div className="px-2 py-1.5 grid border-t border-[var(--border)] gap-1"
           style={{ gridTemplateColumns: `repeat(${handles.length}, minmax(0, 1fr))` }}>
        {handles.map((h) => (
          <span
            key={h.id}
            title={h.label}
            className={`text-[10px] font-medium text-center truncate ${
              h.tone === 'fallback' ? 'text-zinc-400' : 'text-emerald-400'
            }`}
          >
            {h.label}
          </span>
        ))}
      </div>
    </NodeShell>
  );
});

export const SplitNode = memo(function SplitNode({
  id,
  data,
  selected,
}: NodeProps) {
  const builderData = data as BuilderNodeData;
  const config = builderData.config ?? {};
  const weights = Array.isArray(config.weights) ? (config.weights as number[]) : [0.5, 0.5];
  const labels = Array.isArray(config.labels)
    ? (config.labels as string[])
    : weights.map((_, i) => String.fromCharCode(97 + i));
  const summary = weights.map((w, i) => `${labels[i] ?? '?'} ${Math.round(w * 100)}%`).join(' · ');
  const portCount = Math.max(2, weights.length);
  const stats = branchStatsRow(builderData.stats, 'split');
  return (
    <NodeShell
      type="split"
      nodeId={id}
      selected={!!selected}
      summary={summary}
      statsRow={stats}
      errors={builderData.errors}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} />
      {Array.from({ length: portCount }, (_, i) => {
        const left = ((i + 1) / (portCount + 1)) * 100;
        const id = labels[i] ?? String.fromCharCode(97 + i);
        return (
          <Handle
            key={id}
            type="source"
            position={Position.Bottom}
            id={id}
            style={{ ...handleStyle, left: `${left}%` }}
          />
        );
      })}
    </NodeShell>
  );
});

export const ExitNode = memo(function ExitNode({
  id,
  data,
  selected,
}: NodeProps) {
  const builderData = data as BuilderNodeData;
  const completed = builderData.stats?.completed ?? 0;
  const statsRow =
    completed > 0 ? (
      <StatsRow>
        <Stat label="Completed" value={formatNumber(completed)} />
      </StatsRow>
    ) : null;
  return (
    <NodeShell
      type="exit"
      nodeId={id}
      selected={!!selected}
      summary="Marks the contact as completed."
      statsRow={statsRow}
      errors={builderData.errors}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} />
    </NodeShell>
  );
});

// Generic linear action node. Used for every new type that doesn't
// need special handles (sms, add_tag, remove_tag, update_field,
// add_to_list, remove_from_list, add_note, create_task, webhook,
// wait_until). Each derives its summary line from its own config.
function makeActionNode(
  type: BuilderNodeType,
  buildSummary: (config: Record<string, unknown>) => string,
) {
  return memo(function ActionNode({ id, data, selected }: NodeProps) {
    const builderData = data as BuilderNodeData;
    const config = builderData.config ?? {};
    const summary = buildSummary(config);
    return (
      <NodeShell
        type={type}
        nodeId={id}
        selected={!!selected}
        summary={summary}
        errors={builderData.errors}
      >
        <Handle type="target" position={Position.Top} style={handleStyle} />
        <Handle type="source" position={Position.Bottom} style={handleStyle} />
      </NodeShell>
    );
  });
}

const SmsNode = makeActionNode('sms', (c) => {
  const message = String(c.message || '');
  return message ? `“${truncate(message, 32)}”` : 'Set message body →';
});

const AddTagNode = makeActionNode('add_tag', (c) => {
  const tag = String(c.tag || '');
  return tag ? `+ tag: ${tag}` : 'Pick a tag to add →';
});

const RemoveTagNode = makeActionNode('remove_tag', (c) => {
  const tag = String(c.tag || '');
  return tag ? `− tag: ${tag}` : 'Pick a tag to remove →';
});

const UpdateFieldNode = makeActionNode('update_field', (c) => {
  const field = String(c.field || '');
  const value = String(c.value || '');
  if (!field) return 'Pick a field to update →';
  return `${field} = ${value || '(empty)'}`;
});

const AddToListNode = makeActionNode('add_to_list', (c) => {
  const listId = String(c.listId || '');
  return listId ? `+ list: ${truncate(listId, 16)}` : 'Pick a list →';
});

const RemoveFromListNode = makeActionNode('remove_from_list', (c) => {
  const listId = String(c.listId || '');
  return listId ? `− list: ${truncate(listId, 16)}` : 'Pick a list →';
});

const AddNoteNode = makeActionNode('add_note', (c) => {
  const note = String(c.note || '');
  return note ? `“${truncate(note, 32)}”` : 'Compose a note →';
});

const CreateTaskNode = makeActionNode('create_task', (c) => {
  const title = String(c.title || '');
  return title ? title : 'Set task title →';
});

const WebhookNode = makeActionNode('webhook', (c) => {
  const url = String(c.url || '');
  return url ? `POST ${truncate(url, 28)}` : 'Set webhook URL →';
});

const WaitUntilNode = makeActionNode('wait_until', (c) => {
  const field = String(c.field || '');
  return field ? `Until ${field}` : 'Pick a date field →';
});

function truncate(value: string, n: number): string {
  return value.length > n ? `${value.slice(0, n - 1)}…` : value;
}

import {
  AiPromptNode,
  TriggerPlaceholderNode,
  EndPlaceholderNode,
} from './EmptyStateNodes';
import { StickyNoteNode } from './StickyNoteNode';

export const NODE_TYPES = {
  trigger: TriggerNode,
  email: EmailNode,
  sms: SmsNode,
  add_tag: AddTagNode,
  remove_tag: RemoveTagNode,
  update_field: UpdateFieldNode,
  add_to_list: AddToListNode,
  remove_from_list: RemoveFromListNode,
  add_note: AddNoteNode,
  create_task: CreateTaskNode,
  wait: WaitNode,
  wait_until: WaitUntilNode,
  condition: ConditionNode,
  split: SplitNode,
  webhook: WebhookNode,
  exit: ExitNode,
  // Annotation — persisted node, no edges, never executed.
  sticky_note: StickyNoteNode,
  // Phantom empty-state node types — only rendered while showEmptyHero
  // is true; never persisted to the DB.
  ai_prompt: AiPromptNode,
  trigger_placeholder: TriggerPlaceholderNode,
  end_placeholder: EndPlaceholderNode,
} as const;

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}
