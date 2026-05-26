// Pure (client-safe) flow validation. Imported by both the publish
// route on the server and FlowBuilder on the client so we have a
// single source of truth for what makes a flow publishable.

export type NodeType =
  | 'trigger'
  | 'email'
  | 'sms'
  | 'add_tag'
  | 'remove_tag'
  | 'update_field'
  | 'add_to_list'
  | 'remove_from_list'
  | 'add_note'
  | 'create_task'
  | 'wait'
  | 'wait_until'
  | 'condition'
  | 'split'
  | 'webhook'
  | 'exit'
  | 'sticky_note';

export type TriggerType =
  | 'list'
  | 'audience'
  | 'manual'
  | 'event'
  // Fires when a Loomi-native Form receives a submission. Stored
  // config: { formId: string }. Enrollment is event-driven by the
  // forms submit pipeline (src/lib/forms/submit.ts) — the trigger
  // poll worker skips this type, so the flow only enrolls when a
  // submission actually arrives.
  | 'form_submission';

// Node types the worker can actually execute today. Keep in sync with
// the switch statement in processEnrollmentTick on the worker side.
export const EXECUTABLE_NODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  'trigger',
  'email',
  'wait',
  'condition',
  'split',
  'exit',
]);

// Annotation-only nodes — visible on the canvas, never executed, no
// edges in or out. The validator skips them for both the
// executable-type check and the outgoing-connection check.
export const ANNOTATION_NODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  'sticky_note',
]);

export type IssueSeverity = 'error' | 'warning';

export interface FlowValidationIssue {
  /** Node this issue is anchored to, or null for graph-level problems
   *  (e.g. "flow must contain a trigger"). Drives the red highlight in
   *  the builder — the client filters issues by nodeId. */
  nodeId: string | null;
  message: string;
  /** Errors block publish; warnings are advisory. Defaults to 'error'
   *  when omitted by older call sites. */
  severity?: IssueSeverity;
  /** Optional one-liner shown under the message in the Error Log
   *  drawer ("How to fix"). Plain text, no markdown. */
  fix?: string;
}

export class FlowValidationError extends Error {
  constructor(public issues: FlowValidationIssue[]) {
    super(issues.map((i) => i.message).join('; '));
    this.name = 'FlowValidationError';
  }
}

export function validateFlowGraph(graph: {
  nodes: { id: string; type: NodeType; config: Record<string, unknown> }[];
  edges: { fromNodeId: string; toNodeId: string; branch: string | null }[];
}): { ok: boolean; issues: FlowValidationIssue[] } {
  const issues: FlowValidationIssue[] = [];
  const push = (
    nodeId: string | null,
    message: string,
    fix?: string,
    severity: IssueSeverity = 'error',
  ) => issues.push({ nodeId, message, severity, fix });

  const edgesByFrom = new Map<string, typeof graph.edges>();
  for (const edge of graph.edges) {
    const arr = edgesByFrom.get(edge.fromNodeId) ?? [];
    arr.push(edge);
    edgesByFrom.set(edge.fromNodeId, arr);
  }

  const hasTrigger = graph.nodes.some((n) => n.type === 'trigger');
  if (!hasTrigger) {
    push(
      null,
      'Flow must contain a trigger entry node.',
      'Drag a Trigger step from the palette onto the canvas — this is where contacts enter the flow.',
    );
  }

  // Reject palette-only step types that don't have a working worker
  // implementation yet (SMS, webhooks, notes, tasks, etc.). Annotation
  // nodes (sticky notes) are exempt — they're authoring aids, never
  // executed, and we want them to ride along through publish.
  for (const node of graph.nodes) {
    if (ANNOTATION_NODE_TYPES.has(node.type)) continue;
    if (!EXECUTABLE_NODE_TYPES.has(node.type)) {
      push(
        node.id,
        `"${node.type}" step can't be published yet — execution support is on the roadmap.`,
        `Remove this step or swap it for a supported type (email, wait, condition, split, exit).`,
      );
    }
  }

  for (const node of graph.nodes) {
    if (node.type === 'exit') continue;
    // Annotation nodes deliberately have no outgoing edges (they're
    // standalone). Skip the orphan check for them.
    if (ANNOTATION_NODE_TYPES.has(node.type)) continue;
    const outgoing = edgesByFrom.get(node.id) ?? [];
    if (outgoing.length === 0) {
      push(
        node.id,
        `This step has no outgoing connection.`,
        `Connect this step to the next one, or end the flow with an Exit step.`,
      );
      continue;
    }
    if (node.type === 'condition') {
      const cfg = node.config as { branches?: Array<{ id: string; label?: string; rules?: unknown[] }> };
      const branches = Array.isArray(cfg.branches) ? cfg.branches : [];
      if (branches.length === 0) {
        push(
          node.id,
          'Needs at least one branch.',
          'Open the step and add a branch with at least one rule.',
        );
      }
      const edgeBranches = new Set(outgoing.map((e) => e.branch));
      for (const b of branches) {
        if (!b.id) {
          push(node.id, 'A branch is missing its id.', 'Re-open the step and re-add the branch.');
          continue;
        }
        const branchName = b.label || b.id;
        if (!Array.isArray(b.rules) || b.rules.length === 0) {
          push(
            node.id,
            `Branch "${branchName}" needs at least one rule.`,
            `Open the step and add a condition rule to the "${branchName}" branch.`,
          );
        }
        if (!edgeBranches.has(b.id)) {
          push(
            node.id,
            `Branch "${branchName}" has no outgoing connection.`,
            `Drag from the "${branchName}" output handle to the next step.`,
          );
        }
      }
      if (!edgeBranches.has('else')) {
        push(
          node.id,
          'Missing an "else" connection for unmatched contacts.',
          'Drag from the "else" output handle to a fallback step (or an Exit).',
        );
      }
    }
    if (node.type === 'split') {
      const weights = Array.isArray(node.config.weights) ? node.config.weights : [];
      const sum = weights.reduce((a: number, w) => a + (Number(w) || 0), 0);
      if (Math.abs(sum - 1) > 0.01) {
        push(
          node.id,
          `Split weights must sum to 100% (got ${Math.round(sum * 100)}%).`,
          'Open the step and adjust the branch percentages until they total 100%.',
        );
      }
    }
    if (node.type === 'email') {
      if (!node.config.templateId && !node.config.html) {
        push(
          node.id,
          'Pick a template or set inline HTML.',
          'Open the step and either select an Email template or paste inline HTML in the inspector.',
        );
      }
    }
    if (node.type === 'wait') {
      const ms = Number(node.config.ms || 0);
      if (!Number.isFinite(ms) || ms <= 0) {
        push(
          node.id,
          'Wait duration must be greater than 0.',
          'Open the step and set a non-zero wait duration (e.g. 1 hour, 2 days).',
        );
      }
    }
  }

  // Warnings — non-blocking, advisory only.
  const triggerCount = graph.nodes.filter((n) => n.type === 'trigger').length;
  if (triggerCount > 1) {
    push(
      null,
      `Flow has ${triggerCount} trigger nodes — only the first is used as the entry point.`,
      'Remove the extra trigger nodes, or split this into separate flows.',
      'warning',
    );
  }

  const hasExit = graph.nodes.some((n) => n.type === 'exit');
  if (graph.nodes.length > 0 && hasTrigger && !hasExit) {
    push(
      null,
      'Flow has no Exit step — contacts will leave the flow only after completing every step.',
      'Add an Exit step at any termination point so contacts can be marked complete sooner.',
      'warning',
    );
  }

  // ok = no errors. Warnings don't block publish.
  const ok = !issues.some((i) => (i.severity ?? 'error') === 'error');
  return { ok, issues };
}

// Helper to count by severity, useful for badges + section headers.
export function countBySeverity(issues: FlowValidationIssue[]): {
  errors: number;
  warnings: number;
} {
  let errors = 0;
  let warnings = 0;
  for (const issue of issues) {
    if ((issue.severity ?? 'error') === 'warning') warnings++;
    else errors++;
  }
  return { errors, warnings };
}
