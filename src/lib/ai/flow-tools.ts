// Tool surface for the in-builder "Iris" assistant.
//
// Design notes
// ────────────
// The Anthropic tool-use loop runs server-side. The model sees one consistent
// view of the flow graph via an in-memory `WorkingGraph` initialized from the
// client's snapshot. Read tools query that graph; write tools mutate it AND
// record an ordered `FlowAiAction` so the client can replay the same edits
// through its existing `setNodes` / `setEdges` / triggers API path — which is
// what feeds dirty/autosave/history.
//
// We deliberately don't run any of these through the real DB on the server —
// graph mutations only become persistent when the client's autosave fires
// the existing PUT /api/flows/[id]/graph route. Trigger mutations are still
// HTTP calls because triggers live on their own table and there's no
// "in-flight draft" for them; those round-trips happen client-side after the
// loop returns, in the same order the model produced them.

import type Anthropic from '@anthropic-ai/sdk';
import type { BuilderNodeType } from '@/components/flows/builder/types';

// ── Shapes mirrored from the builder ──
// We keep a separate copy here (rather than importing the builder types)
// because this file runs on the server and the builder is a 'use client'
// module — pulling its types is fine, but the *runtime* must not bleed in.

export type AiNodeType = BuilderNodeType;

export interface AiGraphNode {
  id: string;
  type: AiNodeType;
  config: Record<string, unknown>;
  x: number;
  y: number;
}

export interface AiGraphEdge {
  id: string;
  source: string;
  target: string;
  /** Source handle / branch label (e.g. 'a', 'b', 'else' on a condition). */
  branch: string | null;
}

export interface AiTrigger {
  id: string;
  // Keep in sync with TriggerType in src/lib/flows/validation.ts.
  type: 'list' | 'audience' | 'manual' | 'event' | 'form_submission';
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface FlowSnapshot {
  flowId: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  accountKey: string | null;
  nodes: AiGraphNode[];
  edges: AiGraphEdge[];
  triggers: AiTrigger[];
}

// ── Action sequence handed back to the client ──
// One-to-one with the write tools below. The client applies these in order
// via the same handlers a user click would, so undo/redo + dirty/autosave
// hook up for free.

export type FlowAiAction =
  | {
      type: 'add_node';
      node: { id: string; nodeType: AiNodeType; config: Record<string, unknown>; x: number; y: number };
    }
  | { type: 'remove_node'; nodeId: string }
  | { type: 'update_node_config'; nodeId: string; config: Record<string, unknown> }
  | {
      type: 'connect_nodes';
      edge: { id: string; source: string; target: string; branch: string | null };
    }
  | { type: 'disconnect_edge'; edgeId: string }
  | {
      type: 'add_trigger';
      trigger: { tempId: string; triggerType: AiTrigger['type']; config: Record<string, unknown>; enabled: boolean };
    }
  | { type: 'remove_trigger'; triggerId: string }
  | {
      type: 'set_trigger_config';
      triggerId: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
    }
  | { type: 'run_auto_layout' }
  | {
      type: 'apply_generated_graph';
      nodes: AiGraphNode[];
      edges: AiGraphEdge[];
      triggers: Array<{ tempId: string; triggerType: AiTrigger['type']; config: Record<string, unknown>; enabled: boolean }>;
    };

// ── Mutable working graph ──
// The model thinks one tool call at a time; we keep state between calls so
// "add node → connect it → configure it" all reference a coherent graph.

class WorkingGraph {
  constructor(public snapshot: FlowSnapshot) {}

  private idCounter = 0;
  /** Generate a server-side temp id. The client swaps these for cuids on
   *  save just like it already does for the `client-*` ids the canvas
   *  creates on drag-drop. */
  nextNodeId(): string {
    this.idCounter += 1;
    return `ai-node-${Date.now().toString(36)}-${this.idCounter}`;
  }
  nextEdgeId(source: string, target: string): string {
    this.idCounter += 1;
    return `ai-edge-${source}-${target}-${this.idCounter}`;
  }
  nextTriggerTempId(): string {
    this.idCounter += 1;
    return `ai-trigger-${Date.now().toString(36)}-${this.idCounter}`;
  }
}

// ── Tool schemas (sent to Anthropic) ──

const NODE_TYPE_VALUES: AiNodeType[] = [
  'trigger',
  'email',
  'sms',
  'add_tag',
  'remove_tag',
  'update_field',
  'add_to_list',
  'remove_from_list',
  'add_note',
  'create_task',
  'wait',
  'wait_until',
  'condition',
  'split',
  'webhook',
  'exit',
];

export const FLOW_AI_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_flow_snapshot',
    description:
      'Return the current graph (nodes, edges, triggers) so you can reason about what exists before making edits. Always call this before making non-trivial changes if you have not seen the graph yet this turn.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'add_node',
    description:
      'Add a new step to the canvas. Returns the new node id, which you can use in subsequent connect_nodes / update_node_config calls. Position is optional — omit it and the layout will be auto-formatted later.',
    input_schema: {
      type: 'object',
      properties: {
        node_type: { type: 'string', enum: NODE_TYPE_VALUES, description: 'The step type.' },
        config: {
          type: 'object',
          description:
            "The step's configuration blob. Schema depends on node_type — see the system prompt for shapes. Pass {} for an empty starter config.",
        },
        x: { type: 'number', description: 'Optional x coordinate. Default 0.' },
        y: { type: 'number', description: 'Optional y coordinate. Default 0.' },
      },
      required: ['node_type', 'config'],
    },
  },
  {
    name: 'remove_node',
    description:
      'Delete a node by id. Edges touching the node are removed automatically. Refuses to remove the trigger node (every flow needs one).',
    input_schema: {
      type: 'object',
      properties: { node_id: { type: 'string' } },
      required: ['node_id'],
    },
  },
  {
    name: 'update_node_config',
    description:
      "Replace a node's config blob. Pass the FULL new config — partial merges aren't supported. Use this for retitling emails, changing wait durations, adjusting condition rules, etc.",
    input_schema: {
      type: 'object',
      properties: {
        node_id: { type: 'string' },
        config: { type: 'object', description: "The node's new full config object." },
      },
      required: ['node_id', 'config'],
    },
  },
  {
    name: 'connect_nodes',
    description:
      'Wire an edge from one node to another. For condition / split sources, pass `branch` matching one of the branch ids on the source node\'s config (e.g. "a", "b", or "else" for a condition).',
    input_schema: {
      type: 'object',
      properties: {
        source: { type: 'string' },
        target: { type: 'string' },
        branch: {
          type: 'string',
          description: 'Optional branch id when the source is a condition or split.',
        },
      },
      required: ['source', 'target'],
    },
  },
  {
    name: 'disconnect_edge',
    description: 'Remove an edge by id.',
    input_schema: {
      type: 'object',
      properties: { edge_id: { type: 'string' } },
      required: ['edge_id'],
    },
  },
  {
    name: 'add_trigger',
    description:
      'Add a flow-level trigger (list, audience, manual, event, or form_submission). Executable today: list, audience, manual (API enrollment), and form_submission (fires when a Loomi form is submitted). `event` is reserved for future webhook ingestion and is not active yet.',
    input_schema: {
      type: 'object',
      properties: {
        trigger_type: {
          type: 'string',
          enum: ['list', 'audience', 'manual', 'event', 'form_submission'],
        },
        config: {
          type: 'object',
          description:
            'For list: { listId }. For audience: { audienceId }. For form_submission: { formId }. For manual / event: {}.',
        },
        enabled: { type: 'boolean', description: 'Whether the trigger is active. Default false.' },
      },
      required: ['trigger_type', 'config'],
    },
  },
  {
    name: 'remove_trigger',
    description: 'Remove a trigger by id.',
    input_schema: {
      type: 'object',
      properties: { trigger_id: { type: 'string' } },
      required: ['trigger_id'],
    },
  },
  {
    name: 'set_trigger_config',
    description: 'Update a trigger\'s config and/or enabled flag.',
    input_schema: {
      type: 'object',
      properties: {
        trigger_id: { type: 'string' },
        config: { type: 'object' },
        enabled: { type: 'boolean' },
      },
      required: ['trigger_id'],
    },
  },
  {
    name: 'run_auto_layout',
    description: 'Re-run the auto-format pass on the canvas so everything is cleanly spaced.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'apply_generated_graph',
    description:
      'Replace the entire graph with a freshly generated one. Use this when building a flow from scratch in response to a high-level prompt like "build a 5-day post-service follow-up". Keep the existing trigger node only if you also want to replace it. Use referenced ids (any string) for cross-references between nodes/edges; the client will normalize them.',
    input_schema: {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              node_type: { type: 'string', enum: NODE_TYPE_VALUES },
              config: { type: 'object' },
              x: { type: 'number' },
              y: { type: 'number' },
            },
            required: ['id', 'node_type', 'config'],
          },
        },
        edges: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string' },
              target: { type: 'string' },
              branch: { type: 'string' },
            },
            required: ['source', 'target'],
          },
        },
        triggers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              trigger_type: {
                type: 'string',
                enum: ['list', 'audience', 'manual', 'event', 'form_submission'],
              },
              config: { type: 'object' },
              enabled: { type: 'boolean' },
            },
            required: ['trigger_type', 'config'],
          },
        },
      },
      required: ['nodes', 'edges'],
    },
  },
];

// ── System prompt ──
// Lives next to the schemas so it can reference the same NODE_TYPE_VALUES
// list — keeps the model's worldview in sync with what we actually accept.

export const FLOW_AI_SYSTEM_PROMPT = `You are Iris, an assistant embedded inside the Loomi Studio drip-flow builder. You help users plan, build, edit, explain, and diagnose marketing automation flows.

## What you can do

You have tools that read the current flow and mutate it directly. The user sees every change happen live on their canvas, and \`Ctrl+Z\` undoes whatever you just did. Be confident and direct — if the user asks for a change, just make it. Don't ask permission for routine edits; do explain what you did in plain language.

When the request is exploratory ("what does this flow do?", "why aren't contacts enrolling?"), don't make edits — read the graph and answer.

When the user describes a flow they want to build from scratch, call \`apply_generated_graph\` with the whole thing in one go rather than building it up step-by-step.

## The data model

**Node types** (15 total). Each has a \`config\` shape:

- \`trigger\` — entry point. Config: \`{}\`. The flow's actual enrollment triggers live in a separate \`triggers\` list (see below), not on this node.
- \`email\` — send an email. Config: \`{ subject: string, templateId?: string, html?: string }\`.
- \`sms\` — send a text. Config: \`{ message: string }\`. **Coming soon — does not execute yet.**
- \`add_tag\` — add a tag. Config: \`{ tag: string }\`.
- \`remove_tag\` — remove a tag. Config: \`{ tag: string }\`.
- \`update_field\` — set a contact field. Config: \`{ field: string, value: string }\`.
- \`add_to_list\` — add to a static list. Config: \`{ listId: string }\`.
- \`remove_from_list\` — remove from a static list. Config: \`{ listId: string }\`.
- \`add_note\` — attach a note. Config: \`{ note: string }\`. **Coming soon.**
- \`create_task\` — create a task. Config: \`{ title: string, dueAt?: string }\`. **Coming soon.**
- \`wait\` — pause for a duration. Config: \`{ ms: number }\` where \`ms\` is milliseconds. Common values: hour = 3600000, day = 86400000.
- \`wait_until\` — pause until a contact-field date. Config: \`{ field: string, offsetDays: number }\`. **Coming soon.**
- \`condition\` — branch on contact predicates. Config: \`{ branches: ConditionBranch[], fallbackLabel?: string }\`. A \`ConditionBranch\` is \`{ id: string, label: string, logic: 'AND'|'OR', rules: ConditionRule[] }\`. A \`ConditionRule\` is \`{ id: string, field: string, operator: FilterOperator, value: string, value2?: string }\`. Branches evaluate top-to-bottom; the first match wins. There's an implicit "else" branch with id \`"else"\`.
- \`split\` — A/B percentage split. Config: \`{ weights: number[], labels: string[] }\`.
- \`webhook\` — POST to a URL. Config: \`{ url: string, method: 'POST', body: string }\`. **Coming soon.**
- \`exit\` — end of flow. Config: \`{}\`.

**Executable today**: trigger, email, wait, condition, split, exit, add_tag, remove_tag, update_field, add_to_list, remove_from_list. The rest render but block publish.

**Edges**: directed, optionally with a \`branch\` matching a condition branch id (or "else") or a split label.

**Triggers** (separate from the trigger node):
- \`list\` — enrolls contacts on a given ContactList. Config: \`{ listId: string }\`.
- \`audience\` — enrolls based on a smart audience. Config: \`{ audienceId: string }\`.
- \`manual\` — API-only. Config: \`{}\`.
- \`form_submission\` — fires when a Loomi form is submitted. Config: \`{ formId: string }\`. The forms submit pipeline enrolls the contact automatically; no polling.
- \`event\` — **not active yet**.

**Filterable fields** for condition rules (key — type):
- Contact: firstName, lastName, fullName, email, phone, city, state, postalCode, source (all text).
- Vehicle: vehicleYear, vehicleMake, vehicleModel, vehicleVin, vehicleMileage (text).
- Lifecycle dates: dateAdded, purchaseDate, lastServiceDate, nextServiceDate, leaseEndDate, warrantyEndDate (date).
- Messaging: hasReceivedMessage, hasReceivedEmail, hasReceivedSms, hasOpenedEmail (boolean); lastMessageDate (date). \`hasOpenedEmail\` is the right field for "branch on whether they opened a prior email" — it flips true once any past send to this contact recorded an \`open\` event from the ESP webhook.
- Meta: tags (tags).

**Operators by field type**:
- text: contains, not_contains, equals, not_equals, is_empty, is_not_empty
- date: before, after, between (uses value + value2), within_days, overdue, is_empty, is_not_empty
- tags: includes_any, includes_all, excludes, is_empty, is_not_empty
- boolean: is_true, is_false

## Style

- Be concise. Don't over-explain; the user can see the canvas.
- After making edits, summarize in one or two sentences what changed.
- If the user's request is ambiguous (e.g. "send an email" — which email? what subject?), pick reasonable defaults and mention them; don't stop to ask unless the ambiguity is load-bearing.
- Never use ALL CAPS or emojis.
- Don't hedge ("I could potentially..."). Just do the thing or say what you found.`;

// ── Tool executor ──
// Each branch mutates the working graph (so subsequent tool calls in the same
// loop see a consistent view) and records the action for the client. The
// returned string is the tool_result content the model sees next turn.

export interface ToolExecutionResult {
  /** Returned to the model as the tool_result content. */
  resultText: string;
  /** True when the tool reported an error; the model sees `is_error: true`. */
  isError: boolean;
  /** Appended to the action list if the call modified state. */
  action?: FlowAiAction;
}

export function executeFlowTool(
  graph: WorkingGraph,
  toolName: string,
  input: Record<string, unknown>,
): ToolExecutionResult {
  try {
    switch (toolName) {
      case 'get_flow_snapshot':
        return { resultText: snapshotForModel(graph.snapshot), isError: false };

      case 'add_node':
        return addNode(graph, input);
      case 'remove_node':
        return removeNode(graph, input);
      case 'update_node_config':
        return updateNodeConfig(graph, input);
      case 'connect_nodes':
        return connectNodes(graph, input);
      case 'disconnect_edge':
        return disconnectEdge(graph, input);

      case 'add_trigger':
        return addTrigger(graph, input);
      case 'remove_trigger':
        return removeTrigger(graph, input);
      case 'set_trigger_config':
        return setTriggerConfig(graph, input);

      case 'run_auto_layout':
        return { resultText: 'Auto-layout queued.', isError: false, action: { type: 'run_auto_layout' } };

      case 'apply_generated_graph':
        return applyGeneratedGraph(graph, input);

      default:
        return { resultText: `Unknown tool: ${toolName}`, isError: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Tool execution failed';
    return { resultText: message, isError: true };
  }
}

// ── Per-tool handlers ──

function snapshotForModel(snapshot: FlowSnapshot): string {
  // Trim coordinates from the model's view — they're noise it would happily
  // try to "correct".
  return JSON.stringify(
    {
      status: snapshot.status,
      nodes: snapshot.nodes.map((n) => ({ id: n.id, type: n.type, config: n.config })),
      edges: snapshot.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, branch: e.branch })),
      triggers: snapshot.triggers,
    },
    null,
    2,
  );
}

function getString(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === 'string' ? v : undefined;
}

function getConfig(input: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = input[key];
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}

function addNode(graph: WorkingGraph, input: Record<string, unknown>): ToolExecutionResult {
  const nodeType = getString(input, 'node_type');
  if (!nodeType || !(NODE_TYPE_VALUES as string[]).includes(nodeType)) {
    return { resultText: `Invalid node_type: ${nodeType}`, isError: true };
  }
  if (nodeType === 'trigger') {
    return {
      resultText:
        "The trigger node is created with the flow — use add_trigger to set up list/audience enrollment instead.",
      isError: true,
    };
  }
  const config = getConfig(input, 'config');
  const x = typeof input.x === 'number' ? input.x : 0;
  const y = typeof input.y === 'number' ? input.y : 0;
  const id = graph.nextNodeId();
  graph.snapshot.nodes.push({ id, type: nodeType as AiNodeType, config, x, y });
  return {
    resultText: `Added ${nodeType} node with id "${id}".`,
    isError: false,
    action: { type: 'add_node', node: { id, nodeType: nodeType as AiNodeType, config, x, y } },
  };
}

function removeNode(graph: WorkingGraph, input: Record<string, unknown>): ToolExecutionResult {
  const nodeId = getString(input, 'node_id');
  if (!nodeId) return { resultText: 'node_id is required.', isError: true };
  const node = graph.snapshot.nodes.find((n) => n.id === nodeId);
  if (!node) return { resultText: `No node with id "${nodeId}".`, isError: true };
  if (node.type === 'trigger') {
    return { resultText: 'The trigger node cannot be removed.', isError: true };
  }
  graph.snapshot.nodes = graph.snapshot.nodes.filter((n) => n.id !== nodeId);
  graph.snapshot.edges = graph.snapshot.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
  return {
    resultText: `Removed node "${nodeId}" and any edges touching it.`,
    isError: false,
    action: { type: 'remove_node', nodeId },
  };
}

function updateNodeConfig(graph: WorkingGraph, input: Record<string, unknown>): ToolExecutionResult {
  const nodeId = getString(input, 'node_id');
  if (!nodeId) return { resultText: 'node_id is required.', isError: true };
  const node = graph.snapshot.nodes.find((n) => n.id === nodeId);
  if (!node) return { resultText: `No node with id "${nodeId}".`, isError: true };
  const config = getConfig(input, 'config');
  node.config = config;
  return {
    resultText: `Updated config for "${nodeId}".`,
    isError: false,
    action: { type: 'update_node_config', nodeId, config },
  };
}

function connectNodes(graph: WorkingGraph, input: Record<string, unknown>): ToolExecutionResult {
  const source = getString(input, 'source');
  const target = getString(input, 'target');
  const branch = getString(input, 'branch') ?? null;
  if (!source || !target) return { resultText: 'source and target are required.', isError: true };
  if (!graph.snapshot.nodes.some((n) => n.id === source)) {
    return { resultText: `No source node "${source}".`, isError: true };
  }
  if (!graph.snapshot.nodes.some((n) => n.id === target)) {
    return { resultText: `No target node "${target}".`, isError: true };
  }
  const id = graph.nextEdgeId(source, target);
  graph.snapshot.edges.push({ id, source, target, branch });
  return {
    resultText: `Connected ${source} → ${target}${branch ? ` (branch "${branch}")` : ''}.`,
    isError: false,
    action: { type: 'connect_nodes', edge: { id, source, target, branch } },
  };
}

function disconnectEdge(graph: WorkingGraph, input: Record<string, unknown>): ToolExecutionResult {
  const edgeId = getString(input, 'edge_id');
  if (!edgeId) return { resultText: 'edge_id is required.', isError: true };
  const before = graph.snapshot.edges.length;
  graph.snapshot.edges = graph.snapshot.edges.filter((e) => e.id !== edgeId);
  if (graph.snapshot.edges.length === before) {
    return { resultText: `No edge with id "${edgeId}".`, isError: true };
  }
  return { resultText: `Removed edge "${edgeId}".`, isError: false, action: { type: 'disconnect_edge', edgeId } };
}

function addTrigger(graph: WorkingGraph, input: Record<string, unknown>): ToolExecutionResult {
  const triggerType = getString(input, 'trigger_type');
  if (
    triggerType !== 'list' &&
    triggerType !== 'audience' &&
    triggerType !== 'manual' &&
    triggerType !== 'event' &&
    triggerType !== 'form_submission'
  ) {
    return { resultText: `Invalid trigger_type: ${triggerType}`, isError: true };
  }
  const config = getConfig(input, 'config');
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : false;
  const tempId = graph.nextTriggerTempId();
  graph.snapshot.triggers.push({ id: tempId, type: triggerType, config, enabled });
  return {
    resultText: `Added ${triggerType} trigger (temp id "${tempId}", enabled=${enabled}).`,
    isError: false,
    action: { type: 'add_trigger', trigger: { tempId, triggerType, config, enabled } },
  };
}

function removeTrigger(graph: WorkingGraph, input: Record<string, unknown>): ToolExecutionResult {
  const triggerId = getString(input, 'trigger_id');
  if (!triggerId) return { resultText: 'trigger_id is required.', isError: true };
  const before = graph.snapshot.triggers.length;
  graph.snapshot.triggers = graph.snapshot.triggers.filter((t) => t.id !== triggerId);
  if (graph.snapshot.triggers.length === before) {
    return { resultText: `No trigger with id "${triggerId}".`, isError: true };
  }
  return {
    resultText: `Removed trigger "${triggerId}".`,
    isError: false,
    action: { type: 'remove_trigger', triggerId },
  };
}

function setTriggerConfig(graph: WorkingGraph, input: Record<string, unknown>): ToolExecutionResult {
  const triggerId = getString(input, 'trigger_id');
  if (!triggerId) return { resultText: 'trigger_id is required.', isError: true };
  const trigger = graph.snapshot.triggers.find((t) => t.id === triggerId);
  if (!trigger) return { resultText: `No trigger with id "${triggerId}".`, isError: true };
  const action: FlowAiAction = { type: 'set_trigger_config', triggerId };
  if (input.config && typeof input.config === 'object' && !Array.isArray(input.config)) {
    trigger.config = input.config as Record<string, unknown>;
    action.config = trigger.config;
  }
  if (typeof input.enabled === 'boolean') {
    trigger.enabled = input.enabled;
    action.enabled = input.enabled;
  }
  return { resultText: `Updated trigger "${triggerId}".`, isError: false, action };
}

function applyGeneratedGraph(graph: WorkingGraph, input: Record<string, unknown>): ToolExecutionResult {
  const rawNodes = Array.isArray(input.nodes) ? (input.nodes as Array<Record<string, unknown>>) : [];
  const rawEdges = Array.isArray(input.edges) ? (input.edges as Array<Record<string, unknown>>) : [];
  const rawTriggers = Array.isArray(input.triggers) ? (input.triggers as Array<Record<string, unknown>>) : [];

  // Normalize node ids — the model passes arbitrary strings; we mint stable
  // ai-node-* ids and remap edges to match.
  const idMap = new Map<string, string>();
  const nodes: AiGraphNode[] = [];
  for (const raw of rawNodes) {
    const oldId = typeof raw.id === 'string' ? raw.id : '';
    const nodeType = typeof raw.node_type === 'string' ? raw.node_type : '';
    if (!oldId || !(NODE_TYPE_VALUES as string[]).includes(nodeType)) continue;
    const newId = graph.nextNodeId();
    idMap.set(oldId, newId);
    nodes.push({
      id: newId,
      type: nodeType as AiNodeType,
      config: raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config)
        ? (raw.config as Record<string, unknown>)
        : {},
      x: typeof raw.x === 'number' ? raw.x : 0,
      y: typeof raw.y === 'number' ? raw.y : 0,
    });
  }

  const edges: AiGraphEdge[] = [];
  for (const raw of rawEdges) {
    const source = typeof raw.source === 'string' ? idMap.get(raw.source) : undefined;
    const target = typeof raw.target === 'string' ? idMap.get(raw.target) : undefined;
    if (!source || !target) continue;
    const branch = typeof raw.branch === 'string' ? raw.branch : null;
    edges.push({ id: graph.nextEdgeId(source, target), source, target, branch });
  }

  const triggers: Array<{ tempId: string; triggerType: AiTrigger['type']; config: Record<string, unknown>; enabled: boolean }> = [];
  for (const raw of rawTriggers) {
    const triggerType = typeof raw.trigger_type === 'string' ? raw.trigger_type : '';
    if (
      triggerType !== 'list' &&
      triggerType !== 'audience' &&
      triggerType !== 'manual' &&
      triggerType !== 'event' &&
      triggerType !== 'form_submission'
    ) {
      continue;
    }
    triggers.push({
      tempId: graph.nextTriggerTempId(),
      triggerType,
      config:
        raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config)
          ? (raw.config as Record<string, unknown>)
          : {},
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : false,
    });
  }

  graph.snapshot.nodes = nodes;
  graph.snapshot.edges = edges;
  // Triggers replace, not append — apply_generated_graph is a full reset.
  graph.snapshot.triggers = triggers.map((t) => ({
    id: t.tempId,
    type: t.triggerType,
    config: t.config,
    enabled: t.enabled,
  }));

  return {
    resultText: `Replaced graph with ${nodes.length} node(s), ${edges.length} edge(s), ${triggers.length} trigger(s).`,
    isError: false,
    action: {
      type: 'apply_generated_graph',
      nodes,
      edges,
      triggers,
    },
  };
}

// ── Entrypoint helpers ──

export function createWorkingGraph(snapshot: FlowSnapshot): WorkingGraph {
  // Deep-copy so the working state can't leak back into the request payload
  // (and so we don't mutate the caller's object).
  return new WorkingGraph({
    flowId: snapshot.flowId,
    status: snapshot.status,
    accountKey: snapshot.accountKey,
    nodes: snapshot.nodes.map((n) => ({ ...n, config: { ...n.config } })),
    edges: snapshot.edges.map((e) => ({ ...e })),
    triggers: snapshot.triggers.map((t) => ({ ...t, config: { ...t.config } })),
  });
}

export type { WorkingGraph };
