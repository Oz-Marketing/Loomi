// Shared types for the flow builder. These mirror the API shapes but
// stay separate so we can evolve the canvas-side shape independently
// (e.g. add transient UI state like `selected`, `validationError`).

import type { FilterOperator } from '@/lib/smart-list-types';

// ── Condition node config ──
// Each condition has N user-named branches plus an implicit "else"
// fallback. Branches evaluate top-to-bottom; the first one whose rules
// match wins, and the contact flows down that branch's edge.

export interface ConditionRule {
  id: string;
  field: string; // a key from FILTERABLE_FIELDS in smart-list-types
  operator: FilterOperator;
  value: string;
  /** Used by the 'between' date operator (and ignored elsewhere). */
  value2?: string;
}

export interface ConditionBranch {
  id: string;
  label: string;
  /** How rules combine within this branch. */
  logic: 'AND' | 'OR';
  rules: ConditionRule[];
}

export interface ConditionConfig {
  // Optional in the type because brand-new nodes start with an empty
  // config blob — the inspector + worker guard at runtime.
  branches?: ConditionBranch[];
  /** Visible label for the implicit fallback edge. Defaults to "else". */
  fallbackLabel?: string;
  /** Optional custom title for the node — the inspector lets the user
   *  rename "Condition" to the actual question they're branching on
   *  (e.g. "Opened the welcome email?"). NodeShell falls back to the
   *  NODE_META label when this is empty. */
  title?: string;
}

/** Stable id used by the implicit fallback edge — every condition has
 *  an implicit "else" branch so a contact always exits somewhere. */
export const CONDITION_FALLBACK_ID = 'else';

export type BuilderNodeType =
  // Entry
  | 'trigger'
  // Messaging
  | 'email'
  | 'sms'
  // Contact ops
  | 'add_tag'
  | 'remove_tag'
  | 'update_field'
  | 'add_to_list'
  | 'remove_from_list'
  | 'add_note'
  // Tasks
  | 'create_task'
  // Logic
  | 'condition'
  | 'split'
  // Wait
  | 'wait'
  | 'wait_until'
  // Integrations
  | 'webhook'
  | 'push_to_crm'
  // Exit
  | 'exit'
  // Annotations (canvas authoring aids; not executed)
  | 'sticky_note';

export type BuilderNodeCategory =
  | 'entry'
  | 'messaging'
  | 'contact'
  | 'tasks'
  | 'logic'
  | 'wait'
  | 'integrations'
  | 'end'
  | 'annotation';

// `[key: string]: unknown` index signature is required so reactflow's
// `Node<T>` constraint (`T extends Record<string, unknown>`) accepts
// this type.
export interface BuilderNodeData {
  type: BuilderNodeType;
  config: Record<string, unknown>;
  /** Live execution stats overlayed by the builder once a flow has
   *  enrollments. Absent on drafts that have never run. */
  stats?: BuilderNodeStats;
  /** Per-node validation errors from the last publish attempt. When
   *  set, the canvas paints the node red and the inspector lists the
   *  messages. Cleared on the next graph edit. */
  errors?: string[];
  [key: string]: unknown;
}

export interface BuilderNodeStats {
  total: number;
  sent?: number;
  opened?: number;
  clicked?: number;
  bounced?: number;
  failed?: number;
  branches?: Record<string, number>;
  enrolled?: number;
  completed?: number;
}

export interface FlowApiTrigger {
  id: string;
  // Keep in sync with TriggerType in src/lib/flows/validation.ts.
  // `form_submission` fires from the forms submit pipeline rather
  // than the trigger poll worker.
  type:
    | 'list'
    | 'audience'
    | 'manual'
    | 'event'
    | 'form_submission'
    | 'date_reminder'
    | 'birthday'
    | 'tag_added';
  config: Record<string, unknown>;
  enabled: boolean;
}

// ── Flow-level settings ──
// Mirrors the FlowSettings interface in services/loomi-flows.ts so the
// client can edit them via the settings cog without dragging the
// whole worker module into the bundle.
export type FlowReEntryPolicy = 'never' | 'after-days' | 'always';
export type FlowDndHandling = 'skip' | 'pause' | 'exit';
export type FlowGoalType = 'tag-added' | 'field-set';

export interface FlowSettings {
  reEntry: { policy: FlowReEntryPolicy; afterDays?: number };
  quietHours: { enabled: boolean; start: string; end: string };
  goal: { enabled: boolean; type: FlowGoalType; value: string };
  maxDuration: { enabled: boolean; days: number };
  dndHandling: FlowDndHandling;
}

export interface FlowApiDetail {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  accountKey: string;
  publishedAt: string;
  archivedAt: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  activeEnrollments: number;
  nodes: Array<{
    id: string;
    type: BuilderNodeType;
    config: Record<string, unknown>;
    x: number;
    y: number;
  }>;
  edges: Array<{
    id: string;
    fromNodeId: string;
    toNodeId: string;
    branch: string | null;
  }>;
  triggers: FlowApiTrigger[];
  settings: FlowSettings;
}

// Node-type metadata used by the palette and node renderers. Keeps
// labels + colors in one place so we can tweak the look without
// hunting through individual node components.
//
// `executable` flags whether the worker can actually run this step
// today. Non-executable types still render on the canvas (so users
// can sketch flows) but the publish-time validator rejects them
// with a helpful message — implementations come in follow-up PRs.
export interface NodeMetaEntry {
  label: string;
  description: string;
  category: BuilderNodeCategory;
  color: string;
  bg: string;
  executable: boolean;
}

// Colors are assigned per *category* so every step inside a group
// (e.g. all Contact ops) reads as visually related. Adding a new step
// to an existing category? Just match the category here — no new
// color decision needed.
const CATEGORY_COLOR: Record<BuilderNodeCategory, { color: string; bg: string }> = {
  entry: { color: 'text-purple-300', bg: 'bg-purple-500/15' },
  messaging: { color: 'text-green-300', bg: 'bg-green-500/15' },
  contact: { color: 'text-blue-300', bg: 'bg-blue-500/15' },
  tasks: { color: 'text-fuchsia-300', bg: 'bg-fuchsia-500/15' },
  logic: { color: 'text-amber-300', bg: 'bg-amber-500/15' },
  wait: { color: 'text-sky-300', bg: 'bg-sky-500/15' },
  integrations: { color: 'text-violet-300', bg: 'bg-violet-500/15' },
  end: { color: 'text-zinc-300', bg: 'bg-zinc-500/15' },
  // Annotations get a warm amber tint so sticky notes read as paper
  // even on the dark canvas.
  annotation: { color: 'text-amber-300', bg: 'bg-amber-500/15' },
};

function meta(
  category: BuilderNodeCategory,
  label: string,
  description: string,
  executable = true,
): NodeMetaEntry {
  return { label, description, category, executable, ...CATEGORY_COLOR[category] };
}

export const NODE_META: Record<BuilderNodeType, NodeMetaEntry> = {
  // ── Entry ──
  trigger: meta('entry', 'Trigger', 'Flow entry point — enrolled contacts start here.'),

  // ── Messaging ──
  email: meta('messaging', 'Send Email', 'Send an email from a template.'),
  sms: meta('messaging', 'Send SMS', 'Send a text via Twilio.'),

  // ── Contact ops ──
  add_tag: meta('contact', 'Add Tag', 'Add a tag to the contact.'),
  remove_tag: meta('contact', 'Remove Tag', 'Remove a tag from the contact.'),
  update_field: meta('contact', 'Update Field', 'Set a value on a contact field. Execution coming soon.', false),
  add_to_list: meta('contact', 'Add to List', 'Add the contact to a static list. Execution coming soon.', false),
  remove_from_list: meta('contact', 'Remove from List', 'Remove the contact from a static list. Execution coming soon.', false),
  add_note: meta('contact', 'Add Note', 'Attach a note to the contact. Execution coming soon.', false),

  // ── Tasks ──
  create_task: meta('tasks', 'Create Task', 'Create an internal task. Execution coming soon.', false),

  // ── Logic ──
  condition: meta('logic', 'Condition', 'Branch on whether a predicate is true (yes/no).'),
  split: meta('logic', 'A/B Split', 'Randomly route by weighted percentages.'),

  // ── Wait ──
  wait: meta('wait', 'Wait', 'Pause the contact for a delay before the next step.'),
  wait_until: meta('wait', 'Wait Until Date', 'Pause until a contact field date is reached.'),

  // ── Integrations ──
  webhook: meta('integrations', 'Webhook', 'Call an external URL with mergetag-templated body.'),
  push_to_crm: meta(
    'integrations',
    'Push to CRM',
    'Send the contact to a connected CRM (HubSpot) as a qualified lead.',
  ),

  // ── End ──
  exit: meta('end', 'Exit', 'End of the flow — contact is marked completed.'),

  // ── Annotation ──
  // Sticky notes are visible on the canvas but never executed.
  // `executable: false` only matters for items shown in the step
  // picker — sticky notes are added via drag-from-rail, not the
  // picker, so this flag is informational.
  sticky_note: meta('annotation', 'Sticky Note', 'Annotation on the canvas — never executes.', false),
};

// Display order + labels for the palette's collapsible sections.
// Order here drives section order in the UI; types in each section
// are filtered from NODE_META by matching `category`.
export const PALETTE_SECTIONS: Array<{
  category: BuilderNodeCategory;
  label: string;
}> = [
  { category: 'entry', label: 'Entry' },
  { category: 'messaging', label: 'Messaging' },
  { category: 'contact', label: 'Contact' },
  { category: 'tasks', label: 'Tasks' },
  { category: 'logic', label: 'Logic' },
  { category: 'wait', label: 'Wait' },
  { category: 'integrations', label: 'Integrations' },
  { category: 'end', label: 'End' },
];
