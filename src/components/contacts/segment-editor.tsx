'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  BookmarkSquareIcon,
  ChartBarIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  FunnelIcon,
  GlobeAltIcon,
  PlusIcon,
  TrashIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { useFilterableFields } from '@/hooks/use-filterable-fields';
import { operatorHasRequiredValues } from '@/lib/smart-list-engine';
import { toast } from '@/lib/toast';
import type {
  FieldDefinition,
  FieldType,
  FilterCondition,
  FilterDefinition,
  FilterGroup,
  FilterOperator,
} from '@/lib/smart-list-types';
import {
  FIELD_CATEGORIES,
  FILTERABLE_FIELDS,
  NO_VALUE_OPERATORS,
  OPERATOR_LABELS,
  OPERATORS_BY_TYPE,
} from '@/lib/smart-list-types';
import type { Contact } from '@/lib/contacts/types';

let uidCounter = 1;
function uid(): string {
  return `f${Date.now()}-${uidCounter++}`;
}

function emptyCondition(fields: FieldDefinition[]): FilterCondition {
  const first = fields[0] ?? FILTERABLE_FIELDS[0];
  return {
    id: uid(),
    field: first.key,
    operator: OPERATORS_BY_TYPE[first.type][0],
    value: '',
  };
}

function emptyGroup(fields: FieldDefinition[]): FilterGroup {
  return { id: uid(), logic: 'AND', conditions: [emptyCondition(fields)] };
}

function emptyDefinition(fields: FieldDefinition[]): FilterDefinition {
  return { version: 1, logic: 'AND', groups: [emptyGroup(fields)] };
}

function rehydrateIds(def: FilterDefinition): FilterDefinition {
  return {
    ...def,
    groups: def.groups.map((g) => ({
      ...g,
      id: g.id || uid(),
      conditions: g.conditions.map((c) => ({ ...c, id: c.id || uid() })),
    })),
  };
}

// Drop half-finished conditions before saving. Shares
// `operatorHasRequiredValues` with the engine and the API validator so
// all three agree on what "complete" means — this used to let a
// `between` through with no bounds, which the API now rejects outright.
function cleanForSave(def: FilterDefinition): FilterDefinition {
  return {
    ...def,
    groups: def.groups
      .map((g) => ({
        ...g,
        conditions: g.conditions.filter((c) =>
          operatorHasRequiredValues(c.operator, c.value, c.value2),
        ),
      }))
      .filter((g) => g.conditions.length > 0),
  };
}

/** Live-preview state. `count` and `reachable` are EXACT figures from
 *  the server; `contacts` is only a display sample. */
interface SegmentPreviewState {
  status: 'loading' | 'ready' | 'error' | 'empty-filter' | 'org-wide';
  count: number;
  reachable: { email: number; phone: number };
  contacts: Contact[];
  /** Total contacts in the account, for the "% of roster" line. */
  total: number;
  strategy?: 'sql' | 'scan';
  error?: string;
}

/** What an ad-platform push would actually take from this segment. */
interface EligibilityState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  eligible: number;
  excluded: {
    noIdentifier: number;
    suppressed: number;
    optedOut: number;
    duplicate: number;
    noProvenance: number;
  };
  /** Which lead sources the provenance rule dropped, commonest first. */
  excludedSources: Array<{ source: string; count: number }>;
  message?: string;
}

export interface SegmentEditorProps {
  /** Existing segment for edit mode. When undefined, the editor is in create mode. */
  initial?: {
    id?: string;
    name: string;
    description?: string | null;
    accountKey?: string | null;
    color?: string | null;
    filters: string;
  };
  /** When duplicating, render in create mode but seed the form. */
  mode: 'create' | 'edit';
}

export function SegmentEditor({ initial, mode }: SegmentEditorProps) {
  const router = useRouter();
  const { isAccount, accountKey, accountData, userRole } = useAccount();
  const subHref = useSubaccountHref();
  const segmentsHref = subHref('/contacts/segments');

  // A segment with no accountKey is org-wide: visible in every account,
  // and writable only by developers/super_admins (the API enforces this
  // on create, edit, and delete alike). Surface that here rather than
  // letting someone build a filter and collect a 403 on save.
  const isPrivileged = userRole === 'developer' || userRole === 'super_admin';
  const isOrgWideScope = !initial?.accountKey && !(isAccount && accountKey);
  const canSave = isPrivileged || !isOrgWideScope;

  // Sub-account custom fields are only meaningful inside a single
  // account. Admin / org-wide mode keeps just the built-ins (custom
  // field keys mean different things in different sub-accounts, so
  // mixing them in a portfolio segment is misleading).
  const { fields } = useFilterableFields(isAccount ? accountKey : null);

  // ── Form state ─────────────────────────────────────────────
  const initialDef = useMemo<FilterDefinition>(() => {
    if (!initial?.filters) return emptyDefinition(fields);
    try {
      const parsed = JSON.parse(initial.filters) as FilterDefinition;
      if (parsed.version !== 1 || !Array.isArray(parsed.groups)) return emptyDefinition(fields);
      return rehydrateIds(parsed);
    } catch {
      return emptyDefinition(fields);
    }
    // `fields` only matters for the *empty* seed; once a filter is
    // hydrated from JSON we keep the user's existing conditions. So
    // exhaustive-deps is intentionally omitted here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.filters]);

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [definition, setDefinition] = useState<FilterDefinition>(initialDef);
  const [saving, setSaving] = useState(false);

  // ── Live preview ───────────────────────────────────────────
  //
  // Resolved by the server, not in this tab. The browser used to fetch
  // every contact (capped at 5,000) and filter them here, which meant
  // the headline number on this screen was the size of a sample on any
  // account bigger than that — with nothing saying so.
  const cleaned = useMemo(() => cleanForSave(definition), [definition]);
  const [preview, setPreview] = useState<SegmentPreviewState>({
    status: 'loading',
    count: 0,
    reachable: { email: 0, phone: 0 },
    contacts: [],
    total: 0,
  });

  const [eligibility, setEligibility] = useState<EligibilityState>({
    status: 'idle',
    eligible: 0,
    excluded: { noIdentifier: 0, suppressed: 0, optedOut: 0, duplicate: 0, noProvenance: 0 },
    excludedSources: [],
  });

  // Serialised so the effect re-runs on a real change to the filter, not
  // on every re-render (cleanForSave returns a fresh object each time).
  const cleanedKey = useMemo(() => JSON.stringify(cleaned), [cleaned]);

  useEffect(() => {
    // Org-wide scope has no single account to resolve against — a
    // segment is a filter, and its size differs per sub-account. Rather
    // than showing a cross-account sample dressed up as a count, say so.
    if (!isAccount || !accountKey) {
      setPreview({
        status: 'org-wide',
        count: 0,
        reachable: { email: 0, phone: 0 },
        contacts: [],
        total: 0,
      });
      return;
    }
    if (cleaned.groups.length === 0) {
      setPreview({
        status: 'empty-filter',
        count: 0,
        reachable: { email: 0, phone: 0 },
        contacts: [],
        total: 0,
      });
      return;
    }

    let cancelled = false;
    setPreview((prev) => ({ ...prev, status: 'loading' }));

    // Debounced: the builder fires on every keystroke in a value input,
    // and each resolve is a real query against the whole contact table.
    const timer = setTimeout(() => {
      fetch('/api/segments/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountKey,
          definition: cleaned,
          sampleSize: 12,
          // So the segment can't reference itself while being edited.
          segmentId: initial?.id,
        }),
      })
        .then(async (r) => {
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
          return data;
        })
        .then((data) => {
          if (cancelled) return;
          setPreview({
            status: 'ready',
            count: Number(data.count) || 0,
            reachable: {
              email: Number(data.reachable?.email) || 0,
              phone: Number(data.reachable?.phone) || 0,
            },
            contacts: Array.isArray(data.contacts) ? data.contacts : [],
            total: Number(data.accountTotal) || 0,
            strategy: data.strategy,
          });
        })
        .catch((err) => {
          if (cancelled) return;
          setPreview({
            status: 'error',
            count: 0,
            reachable: { email: 0, phone: 0 },
            contacts: [],
            total: 0,
            error: err instanceof Error ? err.message : 'Preview failed',
          });
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `cleanedKey` stands in for `cleaned` — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanedKey, isAccount, accountKey]);

  // How much of this segment could actually be pushed to an ad platform.
  // A separate request from the preview so a slow eligibility pass never
  // blanks the segment count beside it.
  useEffect(() => {
    if (!isAccount || !accountKey || cleaned.groups.length === 0) {
      setEligibility((prev) => ({ ...prev, status: 'idle' }));
      return;
    }
    let cancelled = false;
    setEligibility((prev) => ({ ...prev, status: 'loading' }));

    const timer = setTimeout(() => {
      fetch('/api/segments/eligibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountKey, definition: cleaned }),
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (cancelled) return;
          if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
          setEligibility({
            status: 'ready',
            eligible: Number(data.breakdown?.eligible) || 0,
            excluded: {
              noIdentifier: Number(data.breakdown?.excluded?.noIdentifier) || 0,
              suppressed: Number(data.breakdown?.excluded?.suppressed) || 0,
              optedOut: Number(data.breakdown?.excluded?.optedOut) || 0,
              duplicate: Number(data.breakdown?.excluded?.duplicate) || 0,
              noProvenance: Number(data.breakdown?.excluded?.noProvenance) || 0,
            },
            excludedSources: Array.isArray(data.breakdown?.excludedSources)
              ? data.breakdown.excludedSources
              : [],
          });
        })
        .catch(() => {
          if (!cancelled) setEligibility((prev) => ({ ...prev, status: 'error' }));
        });
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanedKey, isAccount, accountKey]);

  // ── Mutations ──────────────────────────────────────────────
  const updateDef = useCallback(
    (mutator: (prev: FilterDefinition) => FilterDefinition) => {
      setDefinition(mutator);
    },
    [],
  );

  function updateCondition(groupId: string, condId: string, patch: Partial<FilterCondition>) {
    updateDef((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id !== groupId
          ? g
          : {
              ...g,
              conditions: g.conditions.map((c) => (c.id !== condId ? c : { ...c, ...patch })),
            },
      ),
    }));
  }

  function handleFieldChange(groupId: string, condId: string, fieldKey: string) {
    const field = fields.find((f) => f.key === fieldKey);
    const fieldType: FieldType = field?.type ?? 'text';
    const operator = OPERATORS_BY_TYPE[fieldType][0];
    updateCondition(groupId, condId, { field: fieldKey, operator, value: '', value2: undefined });
  }

  function addCondition(groupId: string) {
    updateDef((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id !== groupId ? g : { ...g, conditions: [...g.conditions, emptyCondition(fields)] },
      ),
    }));
  }

  function removeCondition(groupId: string, condId: string) {
    updateDef((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id !== groupId ? g : { ...g, conditions: g.conditions.filter((c) => c.id !== condId) },
      ),
    }));
  }

  function toggleGroupLogic(groupId: string) {
    updateDef((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id !== groupId ? g : { ...g, logic: g.logic === 'AND' ? 'OR' : 'AND' },
      ),
    }));
  }

  function addGroup() {
    updateDef((prev) => ({ ...prev, groups: [...prev.groups, emptyGroup(fields)] }));
  }

  function removeGroup(groupId: string) {
    updateDef((prev) => ({ ...prev, groups: prev.groups.filter((g) => g.id !== groupId) }));
  }

  function toggleTopLogic() {
    updateDef((prev) => ({ ...prev, logic: prev.logic === 'AND' ? 'OR' : 'AND' }));
  }

  // ── Save ───────────────────────────────────────────────────
  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Give the segment a name.');
      return;
    }
    if (cleaned.groups.length === 0) {
      toast.error('Add at least one condition with a value.');
      return;
    }
    if (!canSave) {
      toast.error('Org-wide segments can only be saved by a developer or super admin.');
      return;
    }

    setSaving(true);
    try {
      const filters = JSON.stringify(cleaned);
      const trimmedDesc = description.trim();
      const body: Record<string, unknown> = {
        name: trimmedName,
        filters,
        description: trimmedDesc || null,
      };

      if (mode === 'edit' && initial?.id) {
        const res = await fetch(`/api/audiences/${encodeURIComponent(initial.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(typeof data.error === 'string' ? data.error : 'Failed to save segment');
        }
        toast.success(`Segment "${trimmedName}" updated.`);
      } else {
        body.accountKey = isAccount && accountKey ? accountKey : undefined;
        const res = await fetch('/api/audiences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(typeof data.error === 'string' ? data.error : 'Failed to save segment');
        }
        toast.success(`Segment "${trimmedName}" created.`);
      }
      router.push(segmentsHref);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save segment');
    } finally {
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────
  const scopeLabel = initial?.accountKey
    ? accountData?.dealer ?? initial.accountKey
    : isAccount && accountKey
      ? accountData?.dealer ?? accountKey
      : 'Org-wide';

  const totalConditions = definition.groups.reduce((acc, g) => acc + g.conditions.length, 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="pb-4 border-b border-[var(--border)]/70">
        <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] mb-3">
          <Link
            href={segmentsHref}
            className="flex items-center gap-1 hover:text-[var(--foreground)] transition-colors"
          >
            <ArrowLeftIcon className="w-3.5 h-3.5" />
            Segments
          </Link>
          <span>/</span>
          <span className="text-[var(--foreground)]">
            {mode === 'edit' ? 'Edit' : 'New segment'}
          </span>
        </div>
        <div className="flex items-start gap-3 flex-wrap">
          <FunnelIcon className="w-7 h-7 text-[var(--primary)] mt-1.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Segment name…"
              className="w-full text-2xl font-bold bg-transparent border-0 focus:outline-none placeholder:text-[var(--muted-foreground)]/50 px-0"
            />
            <input
              type="text"
              value={description ?? ''}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              className="w-full text-sm text-[var(--muted-foreground)] bg-transparent border-0 focus:outline-none placeholder:text-[var(--muted-foreground)]/40 mt-1 px-0"
            />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--border)] text-[var(--muted-foreground)]"
              title={
                initial?.accountKey || (isAccount && accountKey)
                  ? 'Visible only to this account'
                  : 'Visible to all accounts'
              }
            >
              {initial?.accountKey || (isAccount && accountKey) ? (
                <UsersIcon className="w-3 h-3" />
              ) : (
                <GlobeAltIcon className="w-3 h-3" />
              )}
              {scopeLabel}
            </span>
            <Link
              href={segmentsHref}
              className="px-3 h-9 inline-flex items-center text-sm rounded-lg border border-[var(--border)] hover:bg-[var(--sidebar-muted)] transition-colors"
            >
              Cancel
            </Link>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !name.trim() || cleaned.groups.length === 0 || !canSave}
              title={
                canSave
                  ? undefined
                  : 'Org-wide segments can only be saved by a developer or super admin. Switch to an account to build one there.'
              }
              className="px-4 h-9 inline-flex items-center gap-1.5 text-sm rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <BookmarkSquareIcon className="w-4 h-4" />
              {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create segment'}
            </button>
          </div>
        </div>
      </div>

      {/* Two-pane body */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] gap-4">
        {/* Builder pane */}
        <div className="space-y-4">
          {definition.groups.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--muted-foreground)]">Match</span>
              <LogicPill
                value={definition.logic === 'AND' ? 'ALL' : 'ANY'}
                onToggle={toggleTopLogic}
                tone="primary"
              />
              <span className="text-xs text-[var(--muted-foreground)]">of the following groups</span>
            </div>
          )}

          {definition.groups.map((group, idx) => (
            <GroupCard
              key={group.id}
              group={group}
              index={idx}
              fields={fields}
              removable={definition.groups.length > 1}
              onToggleLogic={() => toggleGroupLogic(group.id)}
              onFieldChange={(cid, fk) => handleFieldChange(group.id, cid, fk)}
              onOperatorChange={(cid, op) =>
                updateCondition(group.id, cid, { operator: op, value: '', value2: undefined })
              }
              onValueChange={(cid, v) => updateCondition(group.id, cid, { value: v })}
              onValue2Change={(cid, v) => updateCondition(group.id, cid, { value2: v })}
              onAddCondition={() => addCondition(group.id)}
              onRemoveCondition={(cid) => removeCondition(group.id, cid)}
              onRemoveGroup={() => removeGroup(group.id)}
            />
          ))}

          <button
            type="button"
            onClick={addGroup}
            className="flex items-center gap-1.5 px-3 h-9 text-xs rounded-lg border border-dashed border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)] transition-colors"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            Add group
          </button>

          {totalConditions === 0 && (
            <p className="text-xs text-[var(--muted-foreground)] flex items-center gap-1.5">
              <ExclamationTriangleIcon className="w-3.5 h-3.5" />
              Add at least one condition to define this segment.
            </p>
          )}
        </div>

        {/* Preview pane */}
        <aside className="lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] flex flex-col">
          <PreviewPanel preview={preview} eligibility={eligibility} />
        </aside>
      </div>
    </div>
  );
}

// ── Group card ──

interface GroupCardProps {
  group: FilterGroup;
  index: number;
  fields: FieldDefinition[];
  removable: boolean;
  onToggleLogic: () => void;
  onFieldChange: (condId: string, fieldKey: string) => void;
  onOperatorChange: (condId: string, op: FilterOperator) => void;
  onValueChange: (condId: string, value: string) => void;
  onValue2Change: (condId: string, value: string) => void;
  onAddCondition: () => void;
  onRemoveCondition: (condId: string) => void;
  onRemoveGroup: () => void;
}

function GroupCard({
  group,
  index,
  fields,
  removable,
  onToggleLogic,
  onFieldChange,
  onOperatorChange,
  onValueChange,
  onValue2Change,
  onAddCondition,
  onRemoveCondition,
  onRemoveGroup,
}: GroupCardProps) {
  return (
    <div className="glass-card rounded-xl border border-[var(--border)]/70 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Group {index + 1}
          </span>
          {group.conditions.length > 1 && (
            <>
              <span className="text-[11px] text-[var(--muted-foreground)]">Match</span>
              <LogicPill
                value={group.logic === 'AND' ? 'ALL' : 'ANY'}
                onToggle={onToggleLogic}
                tone="muted"
              />
              <span className="text-[11px] text-[var(--muted-foreground)]">conditions</span>
            </>
          )}
        </div>
        {removable && (
          <button
            type="button"
            onClick={onRemoveGroup}
            title="Remove group"
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <TrashIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="space-y-2">
        {group.conditions.map((condition, condIdx) => (
          <div key={condition.id} className="space-y-2">
            {condIdx > 0 && (
              <div className="flex items-center gap-2 pl-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]/70">
                  {group.logic === 'AND' ? 'and' : 'or'}
                </span>
              </div>
            )}
            <ConditionRow
              condition={condition}
              fields={fields}
              onFieldChange={(fk) => onFieldChange(condition.id, fk)}
              onOperatorChange={(op) => onOperatorChange(condition.id, op)}
              onValueChange={(v) => onValueChange(condition.id, v)}
              onValue2Change={(v) => onValue2Change(condition.id, v)}
              onRemove={
                group.conditions.length > 1 ? () => onRemoveCondition(condition.id) : undefined
              }
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onAddCondition}
        className="flex items-center gap-1.5 text-xs text-[var(--primary)] hover:text-[var(--primary)]/80 transition-colors"
      >
        <PlusIcon className="w-3.5 h-3.5" />
        Add condition
      </button>
    </div>
  );
}

// ── Condition row (inline horizontal) ──

interface ConditionRowProps {
  condition: FilterCondition;
  fields: FieldDefinition[];
  onFieldChange: (fieldKey: string) => void;
  onOperatorChange: (op: FilterOperator) => void;
  onValueChange: (value: string) => void;
  onValue2Change: (value: string) => void;
  onRemove?: () => void;
}

function ConditionRow({
  condition,
  fields,
  onFieldChange,
  onOperatorChange,
  onValueChange,
  onValue2Change,
  onRemove,
}: ConditionRowProps) {
  const field = fields.find((f) => f.key === condition.field);
  const fieldType: FieldType = field?.type ?? 'text';
  const operators = OPERATORS_BY_TYPE[fieldType];
  const needsValue = !NO_VALUE_OPERATORS.includes(condition.operator);
  const needsValue2 =
    condition.operator === 'between' || condition.operator === 'num_between';
  const missingValue = needsValue && !condition.value.trim();

  // Select fields with declared options + a single-target operator
  // render as a real dropdown; multi-target ops (is_one_of) keep the
  // comma-list input. Number fields get type="number".
  const hasOptions = field?.options && field.options.length > 0;
  const isSingleSelectInput =
    fieldType === 'select' &&
    condition.operator !== 'is_one_of' &&
    condition.operator !== 'is_not_one_of' &&
    hasOptions;
  // numeric_text fields (mileage, vehicle year) carry both operator
  // families, so the input follows the OPERATOR rather than the type:
  // a spinner for "over 60,000", a plain box for "contains 201".
  // Multiselect fields WITH declared options (list membership) get a
  // checkbox picker rather than the comma-separated text box — the
  // stored values are opaque ids, so typing them isn't a real option.
  const isOptionMultiSelect = fieldType === 'multiselect' && hasOptions;
  const isNumberInput =
    fieldType === 'number' ||
    (fieldType === 'numeric_text' && condition.operator.startsWith('num_'));
  const isDateInput = fieldType === 'date' && condition.operator !== 'within_days';

  const inputType = isNumberInput ? 'number' : isDateInput ? 'date' : 'text';
  const placeholder =
    condition.operator === 'within_days'
      ? 'days (e.g. 30)'
      : isNumberInput
        ? 'number'
        : fieldType === 'tags' || fieldType === 'multiselect'
          ? 'tag1, tag2'
          : fieldType === 'select'
            ? 'value1, value2'
            : 'value';

  const fieldGroups = useMemo(
    () =>
      FIELD_CATEGORIES.map((cat) => ({
        label: cat.label,
        options: fields
          .filter((f) => f.category === cat.key)
          .map((f) => ({ value: f.key, label: f.label })),
      })).filter((g) => g.options.length > 0),
    [fields],
  );

  const operatorOptions = useMemo(
    () => operators.map((op) => ({ value: op, label: OPERATOR_LABELS[op] })),
    [operators],
  );

  return (
    <div className="flex items-stretch gap-2 flex-wrap sm:flex-nowrap">
      <LoomiSelect
        value={condition.field}
        onChange={onFieldChange}
        groups={fieldGroups}
        className="sm:w-[32%] min-w-[150px]"
      />
      <LoomiSelect
        value={condition.operator}
        onChange={(v) => onOperatorChange(v as FilterOperator)}
        options={operatorOptions}
        className="sm:w-[22%] min-w-[130px]"
      />
      {needsValue ? (
        <div className="flex items-stretch gap-2 flex-1 min-w-[150px]">
          {isOptionMultiSelect ? (
            <OptionMultiSelect
              options={field?.options ?? []}
              value={condition.value}
              onChange={onValueChange}
              invalid={missingValue}
            />
          ) : isSingleSelectInput ? (
            <select
              value={condition.value}
              onChange={(e) => onValueChange(e.target.value)}
              className={`flex-1 px-3 h-9 text-sm rounded-lg border bg-transparent focus:outline-none transition-colors ${
                missingValue
                  ? 'border-amber-500/50 focus:border-amber-500'
                  : 'border-[var(--border)] focus:border-[var(--primary)]'
              }`}
            >
              <option value="">Select…</option>
              {field?.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={inputType}
              value={condition.value}
              onChange={(e) => onValueChange(e.target.value)}
              placeholder={placeholder}
              className={`flex-1 px-3 h-9 text-sm rounded-lg border bg-transparent focus:outline-none transition-colors ${
                missingValue
                  ? 'border-amber-500/50 focus:border-amber-500'
                  : 'border-[var(--border)] focus:border-[var(--primary)]'
              }`}
            />
          )}
          {needsValue2 && (
            <>
              <span className="self-center text-[11px] text-[var(--muted-foreground)]">and</span>
              <input
                type={isNumberInput ? 'number' : 'date'}
                value={condition.value2 ?? ''}
                onChange={(e) => onValue2Change(e.target.value)}
                className="flex-1 px-3 h-9 text-sm rounded-lg border border-[var(--border)] bg-transparent focus:outline-none focus:border-[var(--primary)] transition-colors"
              />
            </>
          )}
        </div>
      ) : (
        <div className="flex-1 min-w-[150px] flex items-center px-3 h-9 text-xs text-[var(--muted-foreground)] italic">
          no value needed
        </div>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title="Remove condition"
          className="px-2 h-9 rounded-lg text-[var(--muted-foreground)] hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
        >
          <TrashIcon className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function excludedTotal(e: EligibilityState): number {
  // Every bucket the gate can drop a contact into. Miss one and the
  // headline silently under-reports: the segment count and the syncable
  // count disagree with nothing explaining the gap.
  return (
    e.excluded.optedOut +
    e.excluded.suppressed +
    e.excluded.noIdentifier +
    e.excluded.duplicate +
    e.excluded.noProvenance
  );
}

// ── Option multi-select ──
//
// Renders declared options as toggles over a comma-separated value, so
// the stored shape stays identical to what a user would have typed by
// hand. Used for list membership, where the values are cuids.

interface OptionMultiSelectProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}

function OptionMultiSelect({ options, value, onChange, invalid }: OptionMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => new Set(value.split(',').map((v) => v.trim()).filter(Boolean)),
    [value],
  );

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  function toggle(optionValue: string) {
    const next = new Set(selected);
    if (next.has(optionValue)) next.delete(optionValue);
    else next.add(optionValue);
    // Preserve the declared option order so the saved value is stable
    // regardless of the order things were clicked.
    onChange(options.filter((o) => next.has(o.value)).map((o) => o.value).join(','));
  }

  const label =
    selected.size === 0
      ? 'Select…'
      : options
          .filter((o) => selected.has(o.value))
          .map((o) => o.label)
          .join(', ') || `${selected.size} selected`;

  return (
    <div ref={ref} className="relative flex-1 min-w-[150px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full px-3 h-9 text-sm text-left rounded-lg border bg-transparent truncate transition-colors ${
          invalid
            ? 'border-amber-500/50'
            : 'border-[var(--border)] hover:border-[var(--primary)]'
        }`}
      >
        {label}
      </button>
      {open && (
        <div className="absolute z-[9999] mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--background)] shadow-lg">
          {options.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
              No lists in this account yet
            </p>
          ) : (
            options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => toggle(option.value)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-[var(--sidebar-muted)] transition-colors"
              >
                <span
                  className={`w-3.5 h-3.5 rounded border flex-shrink-0 ${
                    selected.has(option.value)
                      ? 'bg-[var(--primary)] border-[var(--primary)]'
                      : 'border-[var(--border)]'
                  }`}
                />
                <span className="truncate">{option.label}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── LoomiSelect (custom dropdown matching the Loomi design language) ──

interface LoomiSelectOption {
  value: string;
  label: string;
}

interface LoomiSelectGroup {
  label: string;
  options: LoomiSelectOption[];
}

interface LoomiSelectProps {
  value: string;
  onChange: (value: string) => void;
  options?: LoomiSelectOption[];
  groups?: LoomiSelectGroup[];
  className?: string;
  placeholder?: string;
}

function LoomiSelect({
  value,
  onChange,
  options,
  groups,
  className = '',
  placeholder = 'Select…',
}: LoomiSelectProps) {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const allOptions = useMemo(() => {
    if (options) return options;
    if (groups) return groups.flatMap((g) => g.options);
    return [];
  }, [options, groups]);

  const selected = allOptions.find((o) => o.value === value);

  function openDropdown() {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        zIndex: 9999,
      });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function handleScroll(e: Event) {
      // Ignore scrolls originating inside the dropdown's own option list —
      // only an outside/page scroll should dismiss it.
      if (ref.current && ref.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  function pick(next: string) {
    onChange(next);
    setOpen(false);
  }

  const dropdown = open
    ? createPortal(
        <div
          ref={ref}
          role="listbox"
          style={dropdownStyle}
          className="max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--background)] shadow-xl py-1"
        >
          {groups
            ? groups.map((group) => (
                <div key={group.label}>
                  <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    {group.label}
                  </p>
                  {group.options.map((option) => (
                    <LoomiSelectOptionRow
                      key={option.value}
                      option={option}
                      isSelected={option.value === value}
                      onSelect={() => pick(option.value)}
                    />
                  ))}
                </div>
              ))
            : options?.map((option) => (
                <LoomiSelectOptionRow
                  key={option.value}
                  option={option}
                  isSelected={option.value === value}
                  onSelect={() => pick(option.value)}
                />
              ))}
        </div>,
        document.body,
      )
    : null;

  return (
    <div className={className}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 pl-3 pr-2 h-9 text-sm rounded-lg border bg-transparent focus:outline-none transition-colors ${
          open
            ? 'border-[var(--primary)]'
            : 'border-[var(--border)] hover:border-[var(--primary)]/60'
        }`}
      >
        <span className={`truncate text-left ${selected ? '' : 'text-[var(--muted-foreground)]'}`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDownIcon
          className={`w-3.5 h-3.5 text-[var(--muted-foreground)] flex-shrink-0 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {dropdown}
    </div>
  );
}

function LoomiSelectOptionRow({
  option,
  isSelected,
  onSelect,
}: {
  option: LoomiSelectOption;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={onSelect}
      className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
        isSelected
          ? 'bg-[var(--primary)]/10 text-[var(--primary)] font-medium'
          : 'hover:bg-[var(--sidebar-muted)]'
      }`}
    >
      {option.label}
    </button>
  );
}

// ── Logic pill (toggle between AND/OR or ALL/ANY) ──

interface LogicPillProps {
  value: string;
  onToggle: () => void;
  tone: 'primary' | 'muted';
}

function LogicPill({ value, onToggle, tone }: LogicPillProps) {
  const styles =
    tone === 'primary'
      ? 'bg-[var(--primary)]/10 text-[var(--primary)] border-[var(--primary)]/30 hover:bg-[var(--primary)]/15'
      : 'border-[var(--border)] hover:border-[var(--primary)]';
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`px-2 py-0.5 text-[10px] font-bold tracking-wider rounded border transition-colors ${styles}`}
    >
      {value}
    </button>
  );
}

// ── Preview pane ──

interface PreviewPanelProps {
  preview: SegmentPreviewState;
  eligibility: EligibilityState;
}

function PreviewPanel({ preview, eligibility }: PreviewPanelProps) {
  const { status, count: matchCount, reachable, contacts, total } = preview;
  const loading = status === 'loading';
  const percent = total > 0 ? Math.round((matchCount / total) * 100) : 0;
  // Exact figures from the server — NOT derived from `contacts`, which is
  // only the handful of rows rendered below.
  const withEmail = reachable.email;
  const withPhone = reachable.phone;
  const sample = contacts;

  return (
    <div className="glass-card rounded-xl border border-[var(--border)]/70 overflow-hidden flex flex-col flex-1 min-h-0">
      <div className="px-4 py-3 border-b border-[var(--border)]/70 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ChartBarIcon className="w-4 h-4 text-[var(--primary)]" />
          <span className="text-sm font-semibold">Live preview</span>
        </div>
        {loading && (
          <ArrowPathIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)] animate-spin" />
        )}
      </div>

      <div className="px-4 py-4 border-b border-[var(--border)]/70">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold tabular-nums">
            {status === 'ready' ? matchCount.toLocaleString() : '—'}
          </span>
          <span className="text-sm text-[var(--muted-foreground)]">
            contact{matchCount === 1 ? '' : 's'} match
          </span>
        </div>
        <p className="text-[11px] text-[var(--muted-foreground)] mt-1">
          {status === 'loading' && 'Resolving…'}
          {status === 'empty-filter' && 'Add a condition to see who matches'}
          {status === 'org-wide' &&
            'Switch to an account to preview — segment size differs per account'}
          {status === 'error' && (
            <span className="text-amber-500">{preview.error}</span>
          )}
          {status === 'ready' && `${percent}% of ${total.toLocaleString()} total`}
        </p>
      </div>

      {/* Ad-platform eligibility. Shown next to the segment size because
          the gap between the two is the number that surprises people —
          a 40,000-member segment can be a 12,000-member audience once
          opt-outs, suppressions and missing identifiers come out. */}
      {eligibility.status !== 'idle' && (
        <div className="px-4 py-3 border-b border-[var(--border)]/70">
          {eligibility.status === 'ready' ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-semibold tabular-nums">
                  {eligibility.eligible.toLocaleString()}
                </span>
                <span className="text-[11px] text-[var(--muted-foreground)]">
                  syncable to ad platforms
                </span>
              </div>
              {excludedTotal(eligibility) > 0 && (
                <p className="text-[11px] text-[var(--muted-foreground)] mt-1">
                  {excludedTotal(eligibility).toLocaleString()} excluded:{' '}
                  {[
                    eligibility.excluded.optedOut && `${eligibility.excluded.optedOut} opted out`,
                    eligibility.excluded.suppressed && `${eligibility.excluded.suppressed} suppressed`,
                    eligibility.excluded.noIdentifier && `${eligibility.excluded.noIdentifier} no email or phone`,
                    eligibility.excluded.duplicate && `${eligibility.excluded.duplicate} duplicate`,
                    eligibility.excluded.noProvenance &&
                      `${eligibility.excluded.noProvenance} no purchase, service or form history`,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </p>
              )}
              {/* Naming the sources turns "some contacts were dropped"
                  into something actionable — these are the lead vendors
                  to go and check the paperwork on. */}
              {eligibility.excludedSources.length > 0 && (
                <p className="text-[11px] text-[var(--muted-foreground)]/80 mt-1">
                  Excluded sources:{' '}
                  {eligibility.excludedSources
                    .slice(0, 3)
                    .map((s) => `${s.source} (${s.count.toLocaleString()})`)
                    .join(', ')}
                  {eligibility.excludedSources.length > 3 ? ', …' : ''}
                </p>
              )}
            </>
          ) : eligibility.status === 'loading' ? (
            <p className="text-[11px] text-[var(--muted-foreground)]">
              Checking ad-platform eligibility…
            </p>
          ) : null}
        </div>
      )}

      {!loading && matchCount > 0 && (
        <div className="px-4 py-3 border-b border-[var(--border)]/70 grid grid-cols-2 gap-2">
          <PreviewStat
            icon={<EnvelopeIcon className="w-3 h-3" />}
            label="with email"
            value={withEmail}
          />
          <PreviewStat
            icon={<CheckCircleIcon className="w-3 h-3" />}
            label="with phone"
            value={withPhone}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="px-4 py-8 text-center text-xs text-[var(--muted-foreground)]">
            Loading…
          </div>
        ) : matchCount === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-[var(--muted-foreground)]">
            <FunnelIcon className="w-7 h-7 mx-auto mb-2 opacity-40" />
            No contacts match these filters yet.
          </div>
        ) : (
          <div className="py-1">
            {sample.map((c) => (
              <div
                key={c.id}
                className="px-4 py-2 border-b border-[var(--border)]/30 last:border-0 hover:bg-[var(--sidebar-muted)]/40 transition-colors"
              >
                <p className="text-xs font-medium truncate">
                  {c.fullName?.trim() || c.firstName || c.lastName || 'Unnamed contact'}
                </p>
                <p className="text-[10px] text-[var(--muted-foreground)] truncate">
                  {c.email || c.phone || '—'}
                </p>
              </div>
            ))}
            {matchCount > sample.length && (
              <p className="px-4 py-2 text-[10px] text-[var(--muted-foreground)] text-center">
                + {(matchCount - sample.length).toLocaleString()} more
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--sidebar-muted)]/40">
      <span className="text-[var(--muted-foreground)]">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-semibold tabular-nums">{value.toLocaleString()}</p>
        <p className="text-[10px] text-[var(--muted-foreground)] truncate">{label}</p>
      </div>
    </div>
  );
}
