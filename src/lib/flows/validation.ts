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
  // Fires when a contact's anchor date field (a custom field like
  // last_purchase_date, or the native dateOfBirth/lifecycle columns)
  // reaches anchor + offsetDays. `recurAnnually` matches on month/day
  // (ignoring year) for recurring milestones like anniversaries.
  // Config: { field: string, offsetDays: number, recurAnnually: boolean }
  | 'date_reminder'
  // Fires `daysBefore` days before a contact's birthday (native
  // dateOfBirth), recurring annually. Config: { daysBefore: number }
  | 'birthday'
  // Fires when a contact carries a given tag (the template-friendly
  // stand-in for GHL's "Contact Tag Added" — config carries the tag, so
  // it deploys cleanly without a per-account audience). Re-entry policy
  // + the flow removing the tag at the end govern re-firing.
  // Config: { tag: string }
  | 'tag_added'
  // Fires when a Loomi-native Form receives a submission. Stored
  // config: { formId: string }. Enrollment is event-driven by the
  // forms submit pipeline (src/lib/forms/submit.ts) — the trigger
  // poll worker skips this type, so the flow only enrolls when a
  // submission actually arrives.
  | 'form_submission';

// Every node type the builder can place on the canvas. This is the
// PERSISTENCE whitelist — the graph-save route accepts any of these so
// drafts can hold not-yet-executable steps (add_note, create_task, …)
// and annotations (sticky_note) without losing them on autosave.
// Executability is enforced separately at publish time
// (EXECUTABLE_NODE_TYPES below). Keeping this list here — rather than a
// hand-maintained copy in the API route — is what stops the two from
// drifting apart (a stale route whitelist silently dropped sms/add_tag/
// remove_tag nodes on save, orphaning their edges).
export const KNOWN_NODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
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
  'sticky_note',
]);

// Node types the worker can actually execute today. Keep in sync with
// the switch statement in processEnrollmentTick on the worker side.
export const EXECUTABLE_NODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  'trigger',
  'email',
  'sms',
  'add_tag',
  'remove_tag',
  'wait',
  'wait_until',
  'condition',
  'split',
  'webhook',
  'exit',
]);

// Date fields on Contact that the wait_until node may anchor against.
// Mirrors the picker in BuilderInspector's WaitUntilForm — the
// validator + worker both look this list up rather than hard-coding it
// in three places.
export const WAIT_UNTIL_DATE_FIELDS: readonly string[] = [
  'nextServiceDate',
  'lastServiceDate',
  'leaseEndDate',
  'warrantyEndDate',
  'purchaseDate',
  'dateAdded',
];

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
      const MAX_WAIT_MS = 365 * 24 * 60 * 60 * 1000; // 1 year
      if (!Number.isFinite(ms) || ms <= 0) {
        push(
          node.id,
          'Wait duration must be greater than 0.',
          'Open the step and set a non-zero wait duration (e.g. 1 hour, 2 days).',
        );
      } else if (ms > MAX_WAIT_MS) {
        push(
          node.id,
          'Wait duration is longer than 1 year.',
          'Shorten the wait — a value this large would strand the contact (and can overflow the schedule).',
        );
      }
    }
    if (node.type === 'wait_until') {
      const field = String(node.config.field || '').trim();
      if (!field) {
        push(
          node.id,
          'Pick a date field to wait until.',
          'Open the step and choose a date field on the contact (e.g. nextServiceDate).',
        );
      } else if (!WAIT_UNTIL_DATE_FIELDS.includes(field)) {
        push(
          node.id,
          `Unknown date field "${field}".`,
          `Open the step and pick one of: ${WAIT_UNTIL_DATE_FIELDS.join(', ')}.`,
        );
      }
      const offsetDays = Number(node.config.offsetDays);
      if (
        node.config.offsetDays !== undefined &&
        node.config.offsetDays !== '' &&
        !Number.isFinite(offsetDays)
      ) {
        push(
          node.id,
          'Offset must be a whole number of days.',
          'Open the step and enter a number — negative to fire before the date, positive to fire after.',
        );
      }
    }
    if (node.type === 'add_tag' || node.type === 'remove_tag') {
      const tag = String(node.config.tag || '').trim();
      if (!tag) {
        push(
          node.id,
          'Set a tag name.',
          `Open the step and type the tag to ${node.type === 'add_tag' ? 'add to' : 'remove from'} the contact.`,
        );
      }
    }
    if (node.type === 'sms') {
      const message = String(node.config.message || '').trim();
      if (!message) {
        push(
          node.id,
          'Set an SMS message body.',
          'Open the step and type the text to send. Mergetags like {{firstName}} are supported.',
        );
      } else if (message.length > 1600) {
        push(
          node.id,
          'SMS message exceeds Twilio\'s 1600-character limit.',
          'Trim the message body — most carriers cap at 160 chars per segment and Twilio chains up to 10 segments.',
        );
      }
    }
    if (node.type === 'webhook') {
      const url = String(node.config.url || '').trim();
      if (!url) {
        push(
          node.id,
          'Webhook URL is required.',
          'Open the step and paste the URL the worker should POST to.',
        );
      } else if (!/^https?:\/\//i.test(url)) {
        push(
          node.id,
          'Webhook URL must start with http:// or https://.',
          'Fix the URL in the step inspector — only http and https are allowed.',
        );
      } else if (/^http:\/\//i.test(url)) {
        push(
          node.id,
          'Webhook URL is not HTTPS — contact data would be sent unencrypted.',
          'Use an https:// endpoint. Mergetags like {{email}} in the URL travel in plaintext over http.',
          'warning',
        );
      }
      const method = String(node.config.method || 'POST').toUpperCase();
      if (!['POST', 'PUT', 'PATCH', 'GET', 'DELETE'].includes(method)) {
        push(
          node.id,
          `Unsupported HTTP method "${method}".`,
          'Open the step and pick POST, PUT, PATCH, GET, or DELETE.',
        );
      }
      // Body is only sent for write methods; reject obvious JSON
      // syntax errors up front so the worker doesn't fail silently.
      const body = node.config.body;
      if (typeof body === 'string' && body.trim() && method !== 'GET' && method !== 'DELETE') {
        try {
          JSON.parse(body);
        } catch {
          push(
            node.id,
            'Webhook body must be valid JSON.',
            'Open the step and fix the JSON syntax, or clear the body if no payload is needed.',
          );
        }
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

// ─────────────────────────────────────────────────────
// Publish-time checks that need data the graph alone doesn't carry —
// the flow's enrollment triggers and the account's declared fields.
// Kept pure (no DB) so the service layer feeds them and they're
// unit-testable; publishFlow runs them alongside validateFlowGraph.
// ─────────────────────────────────────────────────────

export interface TriggerForValidation {
  type: TriggerType;
  enabled: boolean;
  config: Record<string, unknown>;
}

/** A flow can pass graph validation yet enroll nobody — no enabled
 *  trigger, or an enabled trigger missing its required config (an empty
 *  tag, no list/audience/form, no date field). Returns blocking issues
 *  so publish fails loudly instead of going live inert. */
export function validateTriggersForPublish(
  triggers: TriggerForValidation[],
): FlowValidationIssue[] {
  const issues: FlowValidationIssue[] = [];
  const enabled = triggers.filter((t) => t.enabled);
  if (enabled.length === 0) {
    issues.push({
      nodeId: null,
      message: 'Flow has no enabled trigger — it would never enroll anyone.',
      severity: 'error',
      fix: 'Open the Trigger step, add a trigger, configure it, and toggle it on before publishing.',
    });
    return issues;
  }
  const hasText = (config: Record<string, unknown>, key: string): boolean =>
    typeof config[key] === 'string' && (config[key] as string).trim() !== '';
  for (const t of enabled) {
    const cfg = t.config ?? {};
    const bad = (what: string) =>
      issues.push({
        nodeId: null,
        message: `The "${t.type}" trigger is enabled but ${what}.`,
        severity: 'error',
        fix: 'Open the Trigger step and finish configuring it, or disable it.',
      });
    switch (t.type) {
      case 'list':
        if (!hasText(cfg, 'listId')) bad('no list is selected');
        break;
      case 'audience':
        if (!hasText(cfg, 'audienceId')) bad('no audience is selected');
        break;
      case 'form_submission':
        if (!hasText(cfg, 'formId')) bad('no form is selected');
        break;
      case 'tag_added':
        if (!hasText(cfg, 'tag')) bad('no tag is set');
        break;
      case 'date_reminder':
        if (!hasText(cfg, 'field')) bad('no date field is set');
        break;
      // manual (API-driven), birthday (daysBefore defaults to 0), and
      // event (rejected at creation in v1) need no extra config.
      case 'manual':
      case 'birthday':
      case 'event':
        break;
    }
  }
  return issues;
}

/** Field keys referenced by condition-node rules. Used at publish to
 *  confirm every referenced field actually exists for the account —
 *  otherwise the rule reads undefined and silently routes everyone down
 *  the else branch. */
export function collectConditionFieldKeys(
  nodes: { type: NodeType; config: Record<string, unknown> }[],
): string[] {
  const keys = new Set<string>();
  for (const node of nodes) {
    if (node.type !== 'condition') continue;
    const branches = Array.isArray((node.config as { branches?: unknown }).branches)
      ? ((node.config as { branches: unknown[] }).branches as Array<{ rules?: unknown }>)
      : [];
    for (const branch of branches) {
      const rules = Array.isArray(branch?.rules) ? (branch.rules as Array<{ field?: unknown }>) : [];
      for (const rule of rules) {
        if (typeof rule?.field === 'string' && rule.field.trim()) keys.add(rule.field.trim());
      }
    }
  }
  return [...keys];
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
