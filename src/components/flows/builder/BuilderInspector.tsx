'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ExclamationTriangleIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { Node } from '@xyflow/react';
import {
  FIELD_CATEGORIES,
  FILTERABLE_FIELDS,
  NO_VALUE_OPERATORS,
  OPERATOR_LABELS,
  OPERATORS_BY_TYPE,
  type FieldDefinition,
  type FieldType,
  type FilterOperator,
} from '@/lib/smart-list-types';
import { useFilterableFields } from '@/hooks/use-filterable-fields';
import {
  NODE_META,
  type BuilderNodeData,
  type BuilderNodeType,
  type ConditionBranch,
  type ConditionConfig,
  type ConditionRule,
  type FlowApiTrigger,
} from './types';
import { SearchableSelect, type SearchableSelectOption } from './SearchableSelect';
import { TriggerManager } from './TriggerManager';

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

interface BuilderInspectorProps {
  selectedNode: Node<BuilderNodeData> | null;
  /** All nodes — accepted so future predicates can reference siblings
   *  (e.g. "opened email from step X"). Currently unused; kept on the
   *  prop surface so callers don't churn when that lands. */
  nodes: Node<BuilderNodeData>[];
  onChange: (nodeId: string, config: Record<string, unknown>) => void;
  onDelete: (nodeId: string) => void;
  onClose: () => void;
  /** Trigger management — passed through to TriggerManager when the
   *  selected node is the trigger. The inspector hosts the picker
   *  now that the standalone Triggers drawer was removed. */
  flowId: string;
  accountKey: string | null;
  triggers: FlowApiTrigger[];
  onTriggersChanged: (next: FlowApiTrigger[]) => void;
}

export function BuilderInspector({
  selectedNode,
  nodes: _nodes,
  onChange,
  onDelete,
  onClose,
  flowId,
  accountKey,
  triggers,
  onTriggersChanged,
}: BuilderInspectorProps) {
  void _nodes;
  // Empty-state intentionally absent: the parent only mounts this
  // component when a node is selected, so the panel disappears
  // entirely otherwise (matches the template editor's behavior).
  if (!selectedNode) return null;

  const meta = NODE_META[selectedNode.data.type];
  const canDelete = selectedNode.data.type !== 'trigger';

  return (
    <aside className="w-full h-full flex flex-col border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--card-strong)] backdrop-blur-2xl backdrop-saturate-150 shadow-lg min-h-0">
      {/* Header — mirrors the GHL "Actions" panel: title row with a
          close affordance on the right, then a thin divider before
          the form body. */}
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-[var(--foreground)] truncate">
            {meta.label}
          </h3>
          <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5 truncate">
            {meta.description}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          title="Close inspector"
          aria-label="Close inspector"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {selectedNode.data.errors && selectedNode.data.errors.length > 0 && (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-300 mb-1.5">
              <ExclamationTriangleIcon className="w-3.5 h-3.5" />
              {selectedNode.data.errors.length === 1
                ? 'Fix this before publishing'
                : `${selectedNode.data.errors.length} issues to fix before publishing`}
            </div>
            <ul className="list-disc list-inside text-[11px] text-rose-200 leading-relaxed space-y-0.5">
              {selectedNode.data.errors.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          </div>
        )}
        <NodeConfigForm
          key={selectedNode.id}
          type={selectedNode.data.type}
          config={selectedNode.data.config}
          onChange={(config) => onChange(selectedNode.id, config)}
          flowId={flowId}
          accountKey={accountKey}
          triggers={triggers}
          onTriggersChanged={onTriggersChanged}
        />
      </div>

      {canDelete && (
        <div className="px-4 py-3 border-t border-[var(--border)] flex-shrink-0">
          <button
            type="button"
            onClick={() => onDelete(selectedNode.id)}
            className="inline-flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 transition-colors"
          >
            <TrashIcon className="w-3.5 h-3.5" />
            Delete step
          </button>
        </div>
      )}
    </aside>
  );
}

function NodeConfigForm({
  type,
  config,
  onChange,
  flowId,
  accountKey,
  triggers,
  onTriggersChanged,
}: {
  type: BuilderNodeType;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  flowId: string;
  accountKey: string | null;
  triggers: FlowApiTrigger[];
  onTriggersChanged: (next: FlowApiTrigger[]) => void;
}) {
  switch (type) {
    case 'email':
      return <EmailForm config={config} onChange={onChange} />;
    case 'wait':
      return <WaitForm config={config} onChange={onChange} />;
    case 'condition':
      return <ConditionForm config={config} onChange={onChange} accountKey={accountKey} />;
    case 'split':
      return <SplitForm config={config} onChange={onChange} />;
    case 'sms':
      return <SmsForm config={config} onChange={onChange} />;
    case 'add_tag':
    case 'remove_tag':
      return <TagForm config={config} onChange={onChange} />;
    case 'update_field':
      return <UpdateFieldForm config={config} onChange={onChange} accountKey={accountKey} />;
    case 'add_to_list':
    case 'remove_from_list':
      return <ListMembershipForm config={config} onChange={onChange} />;
    case 'add_note':
      return <NoteForm config={config} onChange={onChange} />;
    case 'create_task':
      return <TaskForm config={config} onChange={onChange} />;
    case 'wait_until':
      return <WaitUntilForm config={config} onChange={onChange} />;
    case 'webhook':
      return <WebhookForm config={config} onChange={onChange} />;
    case 'push_to_crm':
      return <PushToCrmForm config={config} onChange={onChange} />;
    case 'trigger':
      return (
        <TriggerManager
          flowId={flowId}
          accountKey={accountKey}
          triggers={triggers}
          onTriggersChanged={onTriggersChanged}
        />
      );
    case 'exit':
      return (
        <p className="text-[11px] text-[var(--muted-foreground)] leading-relaxed">
          Marks the contact as completed when they reach this node. No
          settings — just wire it up as the end of a branch.
        </p>
      );
    // sticky_note is handled inline on the node card (no inspector
    // popout) — see StickyNoteNode + the type guard in FlowBuilder
    // that suppresses the popout when one is selected.
  }
}

// ── Generic text-field driver shared by most new forms ──
// Tracks each named field with local state + commits to the parent on
// every keystroke. Avoids re-implementing the same `useState/useEffect`
// dance in nine near-identical components.
function useFieldState(
  config: Record<string, unknown>,
  keys: string[],
): [Record<string, string>, (key: string, value: string) => void] {
  const initial: Record<string, string> = {};
  for (const k of keys) initial[k] = String(config[k] ?? '');
  const [state, setState] = useState<Record<string, string>>(initial);
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const k of keys) next[k] = String(config[k] ?? '');
    setState(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);
  const set = (key: string, value: string) =>
    setState((prev) => ({ ...prev, [key]: value }));
  return [state, set];
}

// ── Email form ──

function EmailForm({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const [subject, setSubject] = useState(String(config.subject || ''));
  const [templateId, setTemplateId] = useState(String(config.templateId || ''));
  const [html, setHtml] = useState(String(config.html || ''));
  const [templates, setTemplates] = useState<{ id: string; title: string }[]>([]);

  // Reset local state when the user picks a different node so we don't
  // leak the previous node's draft into this one.
  useEffect(() => {
    setSubject(String(config.subject || ''));
    setTemplateId(String(config.templateId || ''));
    setHtml(String(config.html || ''));
  }, [config]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/templates')
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((data) => {
        if (cancelled) return;
        const rows = Array.isArray(data?.templates) ? data.templates : [];
        setTemplates(
          rows.map((t: { id: string; title: string }) => ({ id: t.id, title: t.title })),
        );
      })
      .catch(() => {
        // Templates endpoint optional — fall back to inline HTML mode.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function commit(next: { subject?: string; templateId?: string; html?: string }) {
    onChange({
      ...config,
      subject: next.subject ?? subject,
      templateId: next.templateId ?? templateId,
      html: next.html ?? html,
    });
  }

  return (
    <>
      <Field label="Subject">
        <input
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            commit({ subject: e.target.value });
          }}
          placeholder="e.g. Your service appointment is coming up"
          className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
        />
      </Field>
      <Field label="Template">
        <select
          value={templateId}
          onChange={(e) => {
            setTemplateId(e.target.value);
            commit({ templateId: e.target.value });
          }}
          className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
        >
          <option value="">— Use inline HTML below —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </Field>
      {!templateId && (
        <Field label="Inline HTML">
          <textarea
            value={html}
            onChange={(e) => {
              setHtml(e.target.value);
              commit({ html: e.target.value });
            }}
            rows={6}
            className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs font-mono"
            placeholder="<p>Hi {{firstName}}, …</p>"
          />
        </Field>
      )}
    </>
  );
}

// ── Wait form ──

const WAIT_UNITS = [
  { id: 'minutes', label: 'minutes', ms: 60_000 },
  { id: 'hours', label: 'hours', ms: 3_600_000 },
  { id: 'days', label: 'days', ms: 86_400_000 },
];

function WaitForm({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const initialMs = Number(config.ms || 0);
  // Pick the highest unit that gives a whole number for nicer display.
  const initialUnit =
    initialMs % WAIT_UNITS[2].ms === 0 && initialMs >= WAIT_UNITS[2].ms
      ? 'days'
      : initialMs % WAIT_UNITS[1].ms === 0 && initialMs >= WAIT_UNITS[1].ms
        ? 'hours'
        : 'minutes';
  const initialValue =
    initialMs > 0 ? initialMs / WAIT_UNITS.find((u) => u.id === initialUnit)!.ms : 1;

  const [value, setValue] = useState(initialValue);
  const [unit, setUnit] = useState(initialUnit);

  useEffect(() => {
    setValue(initialValue);
    setUnit(initialUnit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  function commit(nextValue: number, nextUnit: string) {
    const unitMs = WAIT_UNITS.find((u) => u.id === nextUnit)?.ms ?? 60_000;
    onChange({ ...config, ms: Math.max(0, Math.round(nextValue * unitMs)) });
  }

  return (
    <Field label="Wait duration">
      <div className="flex gap-2">
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => {
            const v = Number(e.target.value) || 0;
            setValue(v);
            commit(v, unit);
          }}
          className="w-20 px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
        />
        <select
          value={unit}
          onChange={(e) => {
            setUnit(e.target.value);
            commit(value, e.target.value);
          }}
          className="flex-1 px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
        >
          {WAIT_UNITS.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </div>
    </Field>
  );
}

// ── Condition form: multi-branch custom rules ──
//
// The user authors N named branches; each branch is one or more rules
// (AND/OR-combined) over any field in FILTERABLE_FIELDS. Branches
// evaluate top-to-bottom at runtime; the first whose rules match wins.
// Contacts that match nothing flow down the implicit "else" edge.
//
// Resolved field set for the active flow's scope.
//
// Library / cross-account flows (accountKey=null) keep just the built-
// in fields — there's no single account whose customs to merge in.
// Account-scoped flows pull in that account's declared custom fields
// via useFilterableFields so condition branches can target e.g.
// `last_purchase_date`. A condition that references a stale custom
// key still renders (text input, default operators) so deleting a
// custom field doesn't blow up an existing branch.

function operatorsFor(
  fieldKey: string,
  fieldsByKey: Record<string, FieldDefinition>,
): FilterOperator[] {
  const field = fieldsByKey[fieldKey];
  if (!field) return OPERATORS_BY_TYPE.text;
  return OPERATORS_BY_TYPE[field.type];
}

function makeEmptyRule(fields: FieldDefinition[]): ConditionRule {
  const firstField = fields[0] ?? FILTERABLE_FIELDS[0];
  return {
    id: uid('r'),
    field: firstField.key,
    operator: OPERATORS_BY_TYPE[firstField.type][0],
    value: '',
  };
}

function parseBranches(config: Record<string, unknown>): ConditionBranch[] {
  const branches = (config as ConditionConfig).branches;
  return Array.isArray(branches) ? branches : [];
}

function ConditionForm({
  config,
  onChange,
  accountKey,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  accountKey: string | null;
}) {
  const branches = parseBranches(config);
  const fallbackLabel = String((config as ConditionConfig).fallbackLabel || 'else');
  const title = String((config as ConditionConfig).title || '');

  // Account-aware field set. Library flows (null accountKey) keep
  // built-ins only. The hook handles the null case internally and
  // returns FILTERABLE_FIELDS when there's no account scope.
  const { fields } = useFilterableFields(accountKey);
  const fieldsByKey = useMemo<Record<string, FieldDefinition>>(() => {
    const out: Record<string, FieldDefinition> = {};
    for (const f of fields) out[f.key] = f;
    return out;
  }, [fields]);

  function commit(
    nextBranches: ConditionBranch[],
    nextFallback?: string,
    nextTitle?: string,
  ) {
    const next: ConditionConfig = {
      branches: nextBranches,
      fallbackLabel: (nextFallback ?? fallbackLabel) || 'else',
      title: nextTitle !== undefined ? nextTitle : title,
    };
    onChange({ ...config, ...next });
  }

  function addBranch() {
    // Pick the next available single-letter id (a, b, c, ...). Falls
    // back to a uid suffix once we run out of letters (very rare).
    const used = new Set(branches.map((b) => b.id));
    let id = '';
    for (let i = 0; i < 26; i++) {
      const candidate = String.fromCharCode(97 + i);
      if (!used.has(candidate)) {
        id = candidate;
        break;
      }
    }
    if (!id) id = uid('b');
    const label = `Branch ${id.toUpperCase()}`;
    commit([
      ...branches,
      { id, label, logic: 'AND', rules: [makeEmptyRule(fields)] },
    ]);
  }

  function updateBranch(branchId: string, next: Partial<ConditionBranch>) {
    commit(
      branches.map((b) => (b.id === branchId ? { ...b, ...next } : b)),
    );
  }

  function deleteBranch(branchId: string) {
    commit(branches.filter((b) => b.id !== branchId));
  }

  function addRule(branchId: string) {
    commit(
      branches.map((b) =>
        b.id === branchId ? { ...b, rules: [...b.rules, makeEmptyRule(fields)] } : b,
      ),
    );
  }

  function updateRule(branchId: string, ruleId: string, next: Partial<ConditionRule>) {
    commit(
      branches.map((b) =>
        b.id === branchId
          ? {
              ...b,
              rules: b.rules.map((r) => (r.id === ruleId ? { ...r, ...next } : r)),
            }
          : b,
      ),
    );
  }

  function deleteRule(branchId: string, ruleId: string) {
    commit(
      branches.map((b) =>
        b.id === branchId ? { ...b, rules: b.rules.filter((r) => r.id !== ruleId) } : b,
      ),
    );
  }

  return (
    <>
      {/* Rename the node's header from the default "Condition" to the
          actual question being branched on. Falls back to "Condition"
          on the canvas when empty. */}
      <Field label="Title">
        <input
          value={title}
          onChange={(e) => commit(branches, fallbackLabel, e.target.value)}
          placeholder="e.g. Opened the welcome email?"
          className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
        />
      </Field>

      <p className="text-[10px] text-[var(--muted-foreground)] leading-relaxed">
        Branches evaluate top-to-bottom — the first one whose rules match wins.
        Contacts that match nothing take the <span className="text-zinc-300">{fallbackLabel}</span> edge.
      </p>

      {branches.map((branch, index) => (
        <BranchCard
          key={branch.id}
          branch={branch}
          index={index}
          fields={fields}
          fieldsByKey={fieldsByKey}
          onLabelChange={(label) => updateBranch(branch.id, { label })}
          onLogicChange={(logic) => updateBranch(branch.id, { logic })}
          onAddRule={() => addRule(branch.id)}
          onUpdateRule={(ruleId, next) => updateRule(branch.id, ruleId, next)}
          onDeleteRule={(ruleId) => deleteRule(branch.id, ruleId)}
          onDelete={() => deleteBranch(branch.id)}
        />
      ))}

      <button
        type="button"
        onClick={addBranch}
        className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-md border border-dashed border-[var(--border)] text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] transition-colors"
      >
        <PlusIcon className="w-3.5 h-3.5" />
        Add branch
      </button>

      <Field label="Fallback branch label">
        <input
          value={fallbackLabel}
          onChange={(e) => commit(branches, e.target.value)}
          placeholder="else"
          className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
        />
      </Field>
    </>
  );
}

function BranchCard({
  branch,
  index,
  fields,
  fieldsByKey,
  onLabelChange,
  onLogicChange,
  onAddRule,
  onUpdateRule,
  onDeleteRule,
  onDelete,
}: {
  branch: ConditionBranch;
  index: number;
  fields: FieldDefinition[];
  fieldsByKey: Record<string, FieldDefinition>;
  onLabelChange: (label: string) => void;
  onLogicChange: (logic: 'AND' | 'OR') => void;
  onAddRule: () => void;
  onUpdateRule: (ruleId: string, next: Partial<ConditionRule>) => void;
  onDeleteRule: (ruleId: string) => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--card)]/40 overflow-hidden">
      <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-[var(--border)]">
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] flex-shrink-0">
          {index + 1}.
        </span>
        <input
          value={branch.label}
          onChange={(e) => onLabelChange(e.target.value)}
          placeholder={`Branch ${branch.id.toUpperCase()}`}
          className="flex-1 min-w-0 px-2 py-1 rounded-md bg-[var(--input)] border border-[var(--border)] text-xs font-medium"
        />
        <button
          type="button"
          onClick={onDelete}
          title="Delete branch"
          className="inline-flex items-center justify-center w-6 h-6 rounded-md text-rose-400 hover:bg-rose-500/10 transition-colors flex-shrink-0"
        >
          <TrashIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-2.5 space-y-2">
        {branch.rules.length > 1 && (
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-[var(--muted-foreground)]">Match</span>
            <button
              type="button"
              onClick={() => onLogicChange(branch.logic === 'AND' ? 'OR' : 'AND')}
              className="px-1.5 py-0.5 rounded border border-[var(--border)] bg-[var(--input)] text-[var(--foreground)] font-mono"
            >
              {branch.logic === 'AND' ? 'ALL' : 'ANY'}
            </button>
            <span className="text-[var(--muted-foreground)]">of these rules:</span>
          </div>
        )}

        {branch.rules.map((rule) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            fields={fields}
            fieldsByKey={fieldsByKey}
            onChange={(next) => onUpdateRule(rule.id, next)}
            onDelete={() => onDeleteRule(rule.id)}
          />
        ))}

        <button
          type="button"
          onClick={onAddRule}
          className="inline-flex items-center gap-1 text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        >
          <PlusIcon className="w-3 h-3" />
          Add rule
        </button>
      </div>
    </div>
  );
}

function RuleRow({
  rule,
  fields,
  fieldsByKey,
  onChange,
  onDelete,
}: {
  rule: ConditionRule;
  fields: FieldDefinition[];
  fieldsByKey: Record<string, FieldDefinition>;
  onChange: (next: Partial<ConditionRule>) => void;
  onDelete: () => void;
}) {
  const field = fieldsByKey[rule.field];
  const fieldType: FieldType = field?.type ?? 'text';
  const operators = operatorsFor(rule.field, fieldsByKey);
  const needsValue = !NO_VALUE_OPERATORS.includes(rule.operator);
  const needsValue2 = rule.operator === 'between' || rule.operator === 'num_between';

  // Build the field options list once per render — grouping by
  // category so the dropdown shows Contact / Vehicle / Lifecycle /
  // Messaging / Meta / Custom in the same shape as the segments UI.
  // Empty categories drop out so the "Custom" group only appears when
  // the active flow's account has declared fields.
  const fieldOptions: SearchableSelectOption[] = FIELD_CATEGORIES.flatMap((cat) => {
    const inCategory = fields.filter((f) => f.category === cat.key);
    if (inCategory.length === 0) return [];
    return inCategory.map((f) => ({
      value: f.key,
      label: f.label,
      group: cat.label,
    }));
  });
  const operatorOptions: SearchableSelectOption[] = operators.map((op) => ({
    value: op,
    label: OPERATOR_LABELS[op],
  }));

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--input)] p-2 space-y-1.5">
      <div className="flex items-center gap-1">
        <div className="flex-1 min-w-0">
          <SearchableSelect
            value={rule.field}
            options={fieldOptions}
            placeholder="Pick a field…"
            searchable
            onChange={(nextField) => {
              const nextOps = operatorsFor(nextField, fieldsByKey);
              // Reset operator if the current one isn't valid for the
              // new field type — picking 'is_true' on a text field
              // would be immediately invalid, so we snap to the first
              // valid op.
              const nextOperator = nextOps.includes(rule.operator)
                ? rule.operator
                : nextOps[0];
              onChange({ field: nextField, operator: nextOperator, value: '', value2: '' });
            }}
          />
        </div>
        <button
          type="button"
          onClick={onDelete}
          title="Remove rule"
          className="inline-flex items-center justify-center w-5 h-5 rounded text-[var(--muted-foreground)] hover:text-rose-400 hover:bg-rose-500/10 transition-colors flex-shrink-0"
        >
          <XMarkIcon className="w-3 h-3" />
        </button>
      </div>

      <SearchableSelect
        value={rule.operator}
        options={operatorOptions}
        placeholder="Operator"
        onChange={(op) => onChange({ operator: op as FilterOperator })}
      />

      {needsValue && (
        <div className="flex items-center gap-1">
          <ValueInput
            fieldType={fieldType}
            operator={rule.operator}
            value={rule.value}
            onChange={(value) => onChange({ value })}
          />
          {needsValue2 && (
            <>
              <span className="text-[10px] text-[var(--muted-foreground)]">and</span>
              <ValueInput
                fieldType={fieldType}
                operator={rule.operator}
                value={rule.value2 || ''}
                onChange={(value2) => onChange({ value2 })}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ValueInput({
  fieldType,
  operator,
  value,
  onChange,
}: {
  fieldType: FieldType;
  operator: FilterOperator;
  value: string;
  onChange: (v: string) => void;
}) {
  // `within_days` overrides the date type to a numeric input — the user
  // is typing a day count, not a date.
  if (operator === 'within_days') {
    return (
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="days"
        className="flex-1 min-w-0 px-1.5 py-1 rounded border border-[var(--border)] bg-[var(--card)] text-[10px]"
      />
    );
  }
  if (fieldType === 'date') {
    return (
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-0 px-1.5 py-1 rounded border border-[var(--border)] bg-[var(--card)] text-[10px]"
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={fieldType === 'tags' ? 'tag1, tag2' : 'value'}
      className="flex-1 min-w-0 px-1.5 py-1 rounded border border-[var(--border)] bg-[var(--card)] text-[10px]"
    />
  );
}

// ── Split form ──

function SplitForm({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const initialWeights = Array.isArray(config.weights)
    ? (config.weights as unknown[]).map((w) => Number(w) || 0)
    : [0.5, 0.5];
  const initialLabels = Array.isArray(config.labels)
    ? (config.labels as unknown[]).map((l) => String(l))
    : initialWeights.map((_, i) => String.fromCharCode(97 + i));

  const [weights, setWeights] = useState<number[]>(initialWeights);
  const [labels] = useState<string[]>(initialLabels);

  useEffect(() => {
    const w = Array.isArray(config.weights)
      ? (config.weights as unknown[]).map((x) => Number(x) || 0)
      : [0.5, 0.5];
    setWeights(w);
  }, [config]);

  function commit(nextWeights: number[]) {
    onChange({
      ...config,
      weights: nextWeights,
      labels: labels.slice(0, nextWeights.length),
    });
  }

  function setBranchPct(i: number, pct: number) {
    const next = [...weights];
    next[i] = Math.max(0, Math.min(1, pct / 100));
    // Normalize so the total stays 1. If only 2 branches, the other gets
    // the remainder. For 3+ branches we scale the others proportionally.
    const total = next.reduce((a, b) => a + b, 0);
    if (total > 0) {
      const scale = 1 / total;
      const normalized = next.map((w) => Math.round(w * scale * 100) / 100);
      // Force exact sum to 1 by absorbing rounding into the last bucket.
      const sum = normalized.slice(0, -1).reduce((a, b) => a + b, 0);
      normalized[normalized.length - 1] = Math.round((1 - sum) * 100) / 100;
      setWeights(normalized);
      commit(normalized);
    } else {
      setWeights(next);
      commit(next);
    }
  }

  return (
    <>
      {weights.map((w, i) => (
        <Field key={i} label={`Branch ${labels[i] ?? String.fromCharCode(97 + i)}`}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              value={Math.round(w * 100)}
              onChange={(e) => setBranchPct(i, Number(e.target.value) || 0)}
              className="w-20 px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
            />
            <span className="text-xs text-[var(--muted-foreground)]">%</span>
          </div>
        </Field>
      ))}
      <p className="text-[10px] text-[var(--muted-foreground)]">
        Branches must sum to 100%. Adjust one and the rest rescale.
      </p>
    </>
  );
}

// ── SMS form ──

function SmsForm({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const [state, setField] = useFieldState(config, ['message']);
  function commit(next: Partial<typeof state>) {
    onChange({ ...config, ...state, ...next });
  }
  return (
    <>
      <Field label="Message">
        <textarea
          value={state.message}
          onChange={(e) => {
            setField('message', e.target.value);
            commit({ message: e.target.value });
          }}
          rows={4}
          maxLength={1600}
          placeholder="Hi {{firstName}}, …"
          className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
        />
      </Field>
      <p className="text-[10px] text-[var(--muted-foreground)] leading-relaxed">
        Mergetags: <code>{'{{firstName}}'}</code>, <code>{'{{lastName}}'}</code>,
        <code>{'{{fullName}}'}</code>, <code>{'{{email}}'}</code>,
        <code>{'{{phone}}'}</code>. Twilio caps the body at 1,600 chars.
      </p>
    </>
  );
}

// ── Add/remove tag form ──

function TagForm({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const [state, setField] = useFieldState(config, ['tag']);
  return (
    <Field label="Tag">
      <input
        value={state.tag}
        onChange={(e) => {
          setField('tag', e.target.value);
          onChange({ ...config, tag: e.target.value });
        }}
        placeholder="e.g. lease-ending"
        className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
      />
    </Field>
  );
}

// ── Update field form ──
//
// Two-section picker:
//   - Canonical fields = direct columns on the Contact model that the
//     worker can overwrite safely.
//   - Custom fields = the active account's declared ContactCustomField
//     rows. Each carries a type so the value input adapts (date picker
//     for dates, dropdown for selects, etc.).
//
// Library flows (no account scope) only show canonical fields because
// custom fields are per-sub-account by definition.

const CANONICAL_UPDATABLE_FIELDS = [
  'firstName',
  'lastName',
  'fullName',
  'email',
  'phone',
  'city',
  'state',
  'postalCode',
  'source',
  'vehicleYear',
  'vehicleMake',
  'vehicleModel',
];

function UpdateFieldForm({
  config,
  onChange,
  accountKey,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  accountKey: string | null;
}) {
  const [state, setField] = useFieldState(config, ['field', 'value']);
  function commit(next: Partial<typeof state>) {
    onChange({ ...config, ...state, ...next });
  }

  // Pull this account's custom fields so they show up as first-class
  // pickable targets. Library / cross-account flows pass accountKey=null,
  // which makes the hook return built-ins-only — meaning the Custom
  // optgroup just won't render.
  const { customFields } = useFilterableFields(accountKey);

  // Look up the selected field's type so we can render the right value
  // input. Canonical fields default to text; custom fields use the
  // declared type from the blueprint/instance.
  const selectedCustom = useMemo(
    () => customFields.find((cf) => `custom:${cf.key}` === state.field),
    [customFields, state.field],
  );
  const selectedType = selectedCustom?.type ?? 'text';
  const selectedOptions = selectedCustom?.options ?? null;

  // Plain checkbox for booleans persists the literal string "true" /
  // "false" so the value column stays stringy (matches how mergetags +
  // canonical-field updates look on the wire).
  const booleanChecked = state.value === 'true';

  return (
    <>
      <Field label="Field">
        <select
          value={state.field}
          onChange={(e) => {
            setField('field', e.target.value);
            // Reset value when switching fields — the previous value
            // almost certainly doesn't fit the new field's shape (date
            // → text, select → number, etc.).
            commit({ field: e.target.value, value: '' });
          }}
          className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
        >
          <option value="">— Select a field —</option>
          <optgroup label="Contact fields">
            {CANONICAL_UPDATABLE_FIELDS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </optgroup>
          {customFields.length > 0 && (
            <optgroup label="Custom fields">
              {customFields.map((cf) => (
                <option key={cf.key} value={`custom:${cf.key}`}>
                  {cf.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </Field>
      <Field label="New value">
        {selectedType === 'select' && selectedOptions && selectedOptions.length > 0 ? (
          <select
            value={state.value}
            onChange={(e) => {
              setField('value', e.target.value);
              commit({ value: e.target.value });
            }}
            className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
          >
            <option value="">— Select —</option>
            {selectedOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : selectedType === 'multiselect' && selectedOptions && selectedOptions.length > 0 ? (
          <input
            value={state.value}
            onChange={(e) => {
              setField('value', e.target.value);
              commit({ value: e.target.value });
            }}
            placeholder="comma-separated values"
            className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
          />
        ) : selectedType === 'boolean' ? (
          <label className="inline-flex items-center gap-2 h-7 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={booleanChecked}
              onChange={(e) => {
                const next = e.target.checked ? 'true' : 'false';
                setField('value', next);
                commit({ value: next });
              }}
              className="rounded border-[var(--border)]"
            />
            {booleanChecked ? 'Yes' : 'No'}
          </label>
        ) : (
          <input
            type={selectedType === 'date' ? 'date' : selectedType === 'number' ? 'number' : 'text'}
            value={state.value}
            onChange={(e) => {
              setField('value', e.target.value);
              commit({ value: e.target.value });
            }}
            placeholder={
              selectedType === 'number'
                ? 'e.g. 12500'
                : selectedType === 'date'
                  ? ''
                  : 'e.g. {{firstName}} or a literal'
            }
            className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
          />
        )}
      </Field>
      {selectedCustom?.description && (
        <p className="text-[10px] text-[var(--muted-foreground)] -mt-2">
          {selectedCustom.description}
        </p>
      )}
    </>
  );
}

// ── List membership form (add / remove) ──

function ListMembershipForm({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const [state, setField] = useFieldState(config, ['listId']);
  const [lists, setLists] = useState<{ id: string; name: string; memberCount: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/contacts/lists')
      .then((r) => (r.ok ? r.json() : { lists: [] }))
      .then((data) => {
        if (cancelled) return;
        const rows = Array.isArray(data?.lists) ? data.lists : [];
        setLists(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Field label="List">
      <select
        value={state.listId}
        onChange={(e) => {
          setField('listId', e.target.value);
          onChange({ ...config, listId: e.target.value });
        }}
        className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
      >
        <option value="">— Select a list —</option>
        {lists.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name} ({l.memberCount})
          </option>
        ))}
      </select>
    </Field>
  );
}

// ── Add note form ──

function NoteForm({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const [state, setField] = useFieldState(config, ['note']);
  return (
    <>
      <ComingSoonNote>
        Note attachment is not executable yet — Contact has no Note
        relation in the schema. Coming in a follow-up.
      </ComingSoonNote>
      <Field label="Note">
        <textarea
          value={state.note}
          onChange={(e) => {
            setField('note', e.target.value);
            onChange({ ...config, note: e.target.value });
          }}
          rows={4}
          placeholder="Internal note for this contact…"
          className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
        />
      </Field>
    </>
  );
}

// ── Create task form ──

function TaskForm({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const [state, setField] = useFieldState(config, ['title', 'dueAt']);
  function commit(next: Partial<typeof state>) {
    onChange({ ...config, ...state, ...next });
  }
  return (
    <>
      <ComingSoonNote>
        Tasks aren&apos;t executable yet — no Task model exists in the
        schema. Coming in a follow-up.
      </ComingSoonNote>
      <Field label="Title">
        <input
          value={state.title}
          onChange={(e) => {
            setField('title', e.target.value);
            commit({ title: e.target.value });
          }}
          placeholder="Follow up with {{firstName}}"
          className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
        />
      </Field>
      <Field label="Due (optional)">
        <input
          type="datetime-local"
          value={state.dueAt}
          onChange={(e) => {
            setField('dueAt', e.target.value);
            commit({ dueAt: e.target.value });
          }}
          className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
        />
      </Field>
    </>
  );
}

// ── Wait-until form ──
//
// Pauses the enrollment until a date-typed field on the contact is
// reached. Examples on a dealer Contact: nextServiceDate, leaseEndDate,
// warrantyEndDate, purchaseDate.

const DATE_FIELDS = [
  'nextServiceDate',
  'lastServiceDate',
  'leaseEndDate',
  'warrantyEndDate',
  'purchaseDate',
  'dateAdded',
];

function WaitUntilForm({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const [state, setField] = useFieldState(config, ['field', 'offsetDays']);
  function commit(next: Partial<typeof state>) {
    onChange({
      ...config,
      ...state,
      ...next,
      offsetDays: Number(next.offsetDays ?? state.offsetDays) || 0,
    });
  }
  return (
    <>
      <Field label="Date field">
        <select
          value={state.field}
          onChange={(e) => {
            setField('field', e.target.value);
            commit({ field: e.target.value });
          }}
          className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
        >
          <option value="">— Pick a date —</option>
          {DATE_FIELDS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Offset (days, ± allowed)">
        <input
          type="number"
          value={state.offsetDays}
          onChange={(e) => {
            setField('offsetDays', e.target.value);
            commit({ offsetDays: e.target.value });
          }}
          placeholder="0"
          className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
        />
      </Field>
      <p className="text-[10px] text-[var(--muted-foreground)]">
        Use a negative offset to fire <em>before</em> the date — e.g. −7 to
        send a lease-ending nudge a week early.
      </p>
    </>
  );
}

// ── Webhook form ──

function WebhookForm({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const [state, setField] = useFieldState(config, ['url', 'method', 'body']);
  function commit(next: Partial<typeof state>) {
    onChange({ ...config, ...state, ...next });
  }
  return (
    <>
      <Field label="URL">
        <input
          value={state.url}
          onChange={(e) => {
            setField('url', e.target.value);
            commit({ url: e.target.value });
          }}
          placeholder="https://example.com/hook"
          className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
        />
      </Field>
      <Field label="Method">
        <select
          value={state.method || 'POST'}
          onChange={(e) => {
            setField('method', e.target.value);
            commit({ method: e.target.value });
          }}
          className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
        >
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="GET">GET</option>
          <option value="DELETE">DELETE</option>
        </select>
      </Field>
      <Field label="Body (JSON)">
        <textarea
          value={state.body}
          onChange={(e) => {
            setField('body', e.target.value);
            commit({ body: e.target.value });
          }}
          rows={4}
          placeholder='{"contactId": "{{contactId}}"}'
          className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs font-mono"
        />
      </Field>
      <p className="text-[10px] text-[var(--muted-foreground)] leading-relaxed">
        Mergetags inside the body: <code>{'{{contactId}}'}</code>,
        <code>{'{{firstName}}'}</code>, <code>{'{{lastName}}'}</code>,
        <code>{'{{email}}'}</code>, <code>{'{{phone}}'}</code>,
        <code>{'{{accountKey}}'}</code>, <code>{'{{flowId}}'}</code>,
        <code>{'{{enrollmentId}}'}</code>. Request times out after 10s; one
        retry is attempted on 5xx / timeout. Non-2xx after retry marks
        the step failed but does not exit the enrollment.
      </p>
    </>
  );
}

function PushToCrmForm({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const [state, setField] = useFieldState(config, ['provider']);
  const provider = state.provider || 'hubspot';
  function commit(next: Partial<typeof state>) {
    onChange({ ...config, ...state, ...next });
  }
  return (
    <>
      <Field label="CRM">
        <select
          value={provider}
          onChange={(e) => {
            setField('provider', e.target.value);
            commit({ provider: e.target.value });
          }}
          className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
        >
          <option value="hubspot">HubSpot</option>
        </select>
      </Field>
      <p className="text-[10px] text-[var(--muted-foreground)] leading-relaxed">
        Hands the contact off to this account&apos;s connected HubSpot
        integration as a qualified lead — an idempotent upsert by email, so a
        contact that passes through more than once just refreshes the same
        record. Connect HubSpot under the account&apos;s Integrations (the
        HubSpot card). If no HubSpot CRM is connected, the step is skipped and
        the contact continues through the flow.
      </p>
    </>
  );
}

// ── Shared "execution pending" callout for non-executable steps ──

function ComingSoonNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-2 rounded-md border border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-300 leading-relaxed">
      {children}
    </div>
  );
}

// ── Shared field shell ──

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
