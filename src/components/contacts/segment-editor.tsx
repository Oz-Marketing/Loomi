'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { evaluateFilter } from '@/lib/smart-list-engine';
import { toast } from '@/lib/toast';
import type {
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

function emptyCondition(): FilterCondition {
  return {
    id: uid(),
    field: FILTERABLE_FIELDS[0].key,
    operator: 'contains',
    value: '',
  };
}

function emptyGroup(): FilterGroup {
  return { id: uid(), logic: 'AND', conditions: [emptyCondition()] };
}

function emptyDefinition(): FilterDefinition {
  return { version: 1, logic: 'AND', groups: [emptyGroup()] };
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

function cleanForSave(def: FilterDefinition): FilterDefinition {
  return {
    ...def,
    groups: def.groups
      .map((g) => ({
        ...g,
        conditions: g.conditions.filter((c) => {
          const needsValue = !NO_VALUE_OPERATORS.includes(c.operator);
          return !needsValue || c.value.trim() !== '' || c.operator === 'between';
        }),
      }))
      .filter((g) => g.conditions.length > 0),
  };
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
  const { isAccount, accountKey, accountData } = useAccount();
  const subHref = useSubaccountHref();
  const segmentsHref = subHref('/contacts/segments');

  // ── Form state ─────────────────────────────────────────────
  const initialDef = useMemo<FilterDefinition>(() => {
    if (!initial?.filters) return emptyDefinition();
    try {
      const parsed = JSON.parse(initial.filters) as FilterDefinition;
      if (parsed.version !== 1 || !Array.isArray(parsed.groups)) return emptyDefinition();
      return rehydrateIds(parsed);
    } catch {
      return emptyDefinition();
    }
  }, [initial?.filters]);

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [definition, setDefinition] = useState<FilterDefinition>(initialDef);
  const [saving, setSaving] = useState(false);

  // ── Contacts for live preview ──────────────────────────────
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [previewMeta, setPreviewMeta] = useState<{
    total: number;
    sampled: boolean;
    accounts?: number;
  }>({ total: 0, sampled: false });

  useEffect(() => {
    let cancelled = false;
    setContactsLoading(true);

    const url =
      isAccount && accountKey
        ? `/api/contacts?accountKey=${encodeURIComponent(accountKey)}&all=true&includeMessaging=true`
        : '/api/contacts/aggregate?includeMessaging=true&limitPerAccount=250';

    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (cancelled) return;
        const list: Contact[] = Array.isArray(data?.contacts) ? data.contacts : [];
        setContacts(list);
        if (isAccount) {
          setPreviewMeta({ total: data?.meta?.total ?? list.length, sampled: false });
        } else {
          setPreviewMeta({
            total: data?.meta?.totalContacts ?? list.length,
            sampled: true,
            accounts: data?.meta?.accountsFetched ?? 0,
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setContacts([]);
        setPreviewMeta({ total: 0, sampled: false });
      })
      .finally(() => {
        if (!cancelled) setContactsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAccount, accountKey]);

  // ── Live filter evaluation ─────────────────────────────────
  const cleaned = useMemo(() => cleanForSave(definition), [definition]);
  const matches = useMemo(() => {
    if (cleaned.groups.length === 0) return contacts;
    return evaluateFilter(contacts, cleaned);
  }, [cleaned, contacts]);

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
    const field = FILTERABLE_FIELDS.find((f) => f.key === fieldKey);
    const fieldType: FieldType = field?.type ?? 'text';
    const operator = OPERATORS_BY_TYPE[fieldType][0];
    updateCondition(groupId, condId, { field: fieldKey, operator, value: '', value2: undefined });
  }

  function addCondition(groupId: string) {
    updateDef((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id !== groupId ? g : { ...g, conditions: [...g.conditions, emptyCondition()] },
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
    updateDef((prev) => ({ ...prev, groups: [...prev.groups, emptyGroup()] }));
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
              disabled={saving || !name.trim() || cleaned.groups.length === 0}
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
          <PreviewPanel
            matches={matches}
            total={previewMeta.total}
            sampled={previewMeta.sampled}
            sampledAccounts={previewMeta.accounts}
            loading={contactsLoading}
            isEmptyFilter={cleaned.groups.length === 0}
          />
        </aside>
      </div>
    </div>
  );
}

// ── Group card ──

interface GroupCardProps {
  group: FilterGroup;
  index: number;
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
  onFieldChange: (fieldKey: string) => void;
  onOperatorChange: (op: FilterOperator) => void;
  onValueChange: (value: string) => void;
  onValue2Change: (value: string) => void;
  onRemove?: () => void;
}

function ConditionRow({
  condition,
  onFieldChange,
  onOperatorChange,
  onValueChange,
  onValue2Change,
  onRemove,
}: ConditionRowProps) {
  const field = FILTERABLE_FIELDS.find((f) => f.key === condition.field);
  const fieldType: FieldType = field?.type ?? 'text';
  const operators = OPERATORS_BY_TYPE[fieldType];
  const needsValue = !NO_VALUE_OPERATORS.includes(condition.operator);
  const needsValue2 = condition.operator === 'between';
  const missingValue = needsValue && !condition.value.trim();

  const inputType =
    fieldType === 'date' && condition.operator !== 'within_days' ? 'date' : 'text';
  const placeholder =
    condition.operator === 'within_days'
      ? 'days (e.g. 30)'
      : fieldType === 'tags'
        ? 'tag1, tag2'
        : 'value';

  const fieldGroups = useMemo(
    () =>
      FIELD_CATEGORIES.map((cat) => ({
        label: cat.label,
        options: FILTERABLE_FIELDS.filter((f) => f.category === cat.key).map((f) => ({
          value: f.key,
          label: f.label,
        })),
      })),
    [],
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
          {needsValue2 && (
            <>
              <span className="self-center text-[11px] text-[var(--muted-foreground)]">and</span>
              <input
                type="date"
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
  const ref = useRef<HTMLDivElement>(null);

  const allOptions = useMemo(() => {
    if (options) return options;
    if (groups) return groups.flatMap((g) => g.options);
    return [];
  }, [options, groups]);

  const selected = allOptions.find((o) => o.value === value);

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
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  function pick(next: string) {
    onChange(next);
    setOpen(false);
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
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

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 z-50 max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--background)] shadow-xl py-1"
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
        </div>
      )}
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
  matches: Contact[];
  total: number;
  sampled: boolean;
  sampledAccounts?: number;
  loading: boolean;
  isEmptyFilter: boolean;
}

function PreviewPanel({
  matches,
  total,
  sampled,
  sampledAccounts,
  loading,
  isEmptyFilter,
}: PreviewPanelProps) {
  const matchCount = matches.length;
  const percent = total > 0 ? Math.round((matchCount / total) * 100) : 0;
  const withEmail = matches.filter((c) => c.email && c.email.trim()).length;
  const withPhone = matches.filter((c) => c.phone && c.phone.trim()).length;
  const sample = matches.slice(0, 12);

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
            {loading ? '—' : matchCount.toLocaleString()}
          </span>
          <span className="text-sm text-[var(--muted-foreground)]">
            contact{matchCount === 1 ? '' : 's'} match
          </span>
        </div>
        <p className="text-[11px] text-[var(--muted-foreground)] mt-1">
          {loading
            ? 'Loading contacts…'
            : isEmptyFilter
              ? 'No conditions — all contacts shown'
              : `${percent}% of ${total.toLocaleString()} total`}
          {sampled && !loading && sampledAccounts ? (
            <> · sampled across {sampledAccounts} account{sampledAccounts === 1 ? '' : 's'}</>
          ) : null}
        </p>
      </div>

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
