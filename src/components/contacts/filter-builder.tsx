'use client';

import { useState, useEffect } from 'react';
import {
  XMarkIcon,
  PlusIcon,
  TrashIcon,
  FunnelIcon,
  BookmarkIcon,
} from '@heroicons/react/24/outline';
import type {
  FilterDefinition,
  FilterGroup,
  FilterCondition,
  FieldDefinition,
  FieldType,
  FilterOperator,
} from '@/lib/smart-list-types';
import {
  FILTERABLE_FIELDS,
  FIELD_CATEGORIES,
  OPERATORS_BY_TYPE,
  OPERATOR_LABELS,
  NO_VALUE_OPERATORS,
} from '@/lib/smart-list-types';

interface FilterBuilderProps {
  initialDefinition?: FilterDefinition;
  /** Merged field set (built-ins + custom fields for the active
   *  account). Defaults to the static built-ins so callers without
   *  account context still work. */
  fields?: FieldDefinition[];
  onApply: (definition: FilterDefinition) => void;
  onSave: (name: string, definition: FilterDefinition) => void;
  onClose: () => void;
}

let nextId = 1;
function uid() {
  return `f${Date.now()}-${nextId++}`;
}

function createEmptyCondition(fields: FieldDefinition[]): FilterCondition {
  const first = fields[0] ?? FILTERABLE_FIELDS[0];
  const firstOperator = OPERATORS_BY_TYPE[first.type][0];
  return {
    id: uid(),
    field: first.key,
    operator: firstOperator,
    value: '',
  };
}

function createEmptyGroup(fields: FieldDefinition[]): FilterGroup {
  return {
    id: uid(),
    logic: 'AND',
    conditions: [createEmptyCondition(fields)],
  };
}

function createEmptyDefinition(fields: FieldDefinition[]): FilterDefinition {
  return {
    version: 1,
    logic: 'AND',
    groups: [createEmptyGroup(fields)],
  };
}

export function FilterBuilder({
  initialDefinition,
  fields = FILTERABLE_FIELDS,
  onApply,
  onSave,
  onClose,
}: FilterBuilderProps) {
  const [definition, setDefinition] = useState<FilterDefinition>(
    initialDefinition ?? createEmptyDefinition(fields),
  );
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [mounted, setMounted] = useState(false);

  // Animate in on mount
  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  // Close on Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // ── Mutations ──

  function updateGroup(groupId: string, updates: Partial<FilterGroup>) {
    setDefinition((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id === groupId ? { ...g, ...updates } : g,
      ),
    }));
  }

  function updateCondition(
    groupId: string,
    conditionId: string,
    updates: Partial<FilterCondition>,
  ) {
    setDefinition((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              conditions: g.conditions.map((c) =>
                c.id === conditionId ? { ...c, ...updates } : c,
              ),
            }
          : g,
      ),
    }));
  }

  function addCondition(groupId: string) {
    setDefinition((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id === groupId
          ? { ...g, conditions: [...g.conditions, createEmptyCondition(fields)] }
          : g,
      ),
    }));
  }

  function removeCondition(groupId: string, conditionId: string) {
    setDefinition((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id === groupId
          ? { ...g, conditions: g.conditions.filter((c) => c.id !== conditionId) }
          : g,
      ),
    }));
  }

  function addGroup() {
    setDefinition((prev) => ({
      ...prev,
      groups: [...prev.groups, createEmptyGroup(fields)],
    }));
  }

  function removeGroup(groupId: string) {
    setDefinition((prev) => ({
      ...prev,
      groups: prev.groups.filter((g) => g.id !== groupId),
    }));
  }

  function toggleLogic() {
    setDefinition((prev) => ({
      ...prev,
      logic: prev.logic === 'AND' ? 'OR' : 'AND',
    }));
  }

  function handleFieldChange(
    groupId: string,
    conditionId: string,
    fieldKey: string,
  ) {
    const field = fields.find((f) => f.key === fieldKey);
    const fieldType: FieldType = field?.type ?? 'text';
    const operators = OPERATORS_BY_TYPE[fieldType];
    updateCondition(groupId, conditionId, {
      field: fieldKey,
      operator: operators[0],
      value: '',
      value2: undefined,
    });
  }

  function handleApply() {
    const cleaned: FilterDefinition = {
      ...definition,
      groups: definition.groups.filter((g) => g.conditions.length > 0),
    };
    if (cleaned.groups.length === 0) return;
    onApply(cleaned);
  }

  function handleSave() {
    if (!saveName.trim()) return;
    const cleaned: FilterDefinition = {
      ...definition,
      groups: definition.groups.filter((g) => g.conditions.length > 0),
    };
    if (cleaned.groups.length === 0) return;
    onSave(saveName.trim(), cleaned);
    setShowSave(false);
    setSaveName('');
  }

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${
          mounted ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Sidebar panel — mirrors left nav sidebar style */}
      <aside
        className={`glass-panel fixed right-3 top-3 bottom-3 w-80 rounded-2xl flex flex-col overflow-hidden transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          mounted ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="p-5 pb-4 border-b border-[var(--sidebar-border)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FunnelIcon className="w-5 h-5 text-[var(--primary)]" />
              <h3 className="text-sm font-bold tracking-tight">Custom Filter</h3>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)] transition-colors"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>

          {/* Top-level logic */}
          {definition.groups.length > 1 && (
            <div className="flex items-center gap-2 mt-3">
              <span className="text-xs text-[var(--sidebar-muted-foreground)]">Match</span>
              <button
                onClick={toggleLogic}
                className="px-2 py-1 text-xs font-medium rounded-md border border-[var(--sidebar-border)] hover:border-[var(--primary)] transition-colors"
              >
                {definition.logic === 'AND' ? 'ALL' : 'ANY'}
              </button>
              <span className="text-xs text-[var(--sidebar-muted-foreground)]">groups</span>
            </div>
          )}
        </div>

        {/* Scrollable groups area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {definition.groups.map((group, groupIndex) => (
            <div key={group.id} className="border border-[var(--sidebar-border)] rounded-xl p-3">
              {/* Group header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-[var(--sidebar-muted-foreground)] uppercase tracking-wider">
                    Group {groupIndex + 1}
                  </span>
                  {group.conditions.length > 1 && (
                    <button
                      onClick={() =>
                        updateGroup(group.id, {
                          logic: group.logic === 'AND' ? 'OR' : 'AND',
                        })
                      }
                      className="px-2 py-0.5 text-[10px] font-medium rounded border border-[var(--sidebar-border)] hover:border-[var(--primary)] transition-colors"
                    >
                      {group.logic}
                    </button>
                  )}
                </div>
                {definition.groups.length > 1 && (
                  <button
                    onClick={() => removeGroup(group.id)}
                    className="p-1 rounded text-[var(--sidebar-muted-foreground)] hover:text-red-400 transition-colors"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Conditions — stacked vertically for sidebar width */}
              <div className="space-y-2">
                {group.conditions.map((condition) => (
                  <ConditionRow
                    key={condition.id}
                    condition={condition}
                    fields={fields}
                    onFieldChange={(fieldKey) =>
                      handleFieldChange(group.id, condition.id, fieldKey)
                    }
                    onOperatorChange={(op) =>
                      updateCondition(group.id, condition.id, { operator: op })
                    }
                    onValueChange={(val) =>
                      updateCondition(group.id, condition.id, { value: val })
                    }
                    onValue2Change={(val) =>
                      updateCondition(group.id, condition.id, { value2: val })
                    }
                    onRemove={
                      group.conditions.length > 1
                        ? () => removeCondition(group.id, condition.id)
                        : undefined
                    }
                  />
                ))}
              </div>

              {/* Add condition */}
              <button
                onClick={() => addCondition(group.id)}
                className="mt-2 flex items-center gap-1 text-[10px] text-[var(--primary)] hover:text-[var(--primary)]/80 transition-colors"
              >
                <PlusIcon className="w-3 h-3" />
                Add condition
              </button>
            </div>
          ))}

          {/* Add group */}
          <button
            onClick={addGroup}
            className="flex items-center gap-1 text-xs text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] transition-colors"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            Add group
          </button>
        </div>

        {/* Footer actions — pinned to bottom */}
        <div className="p-4 border-t border-[var(--sidebar-border)]">
          <div className="flex flex-col gap-2">
            <button
              onClick={handleApply}
              className="w-full px-4 py-2.5 text-xs font-medium rounded-xl bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 transition-colors"
            >
              Apply Filter
            </button>

            {!showSave ? (
              <button
                onClick={() => setShowSave(true)}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs rounded-xl text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)] transition-colors"
              >
                <BookmarkIcon className="w-3.5 h-3.5" />
                Save as Audience
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="Audience name..."
                  className="flex-1 px-3 py-2 text-xs rounded-lg border border-[var(--sidebar-border)] bg-transparent focus:outline-none focus:border-[var(--primary)]"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave();
                    if (e.key === 'Escape') setShowSave(false);
                  }}
                />
                <button
                  onClick={handleSave}
                  disabled={!saveName.trim()}
                  className="px-3 py-2 text-xs font-medium rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => setShowSave(false)}
                  className="p-2 text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] transition-colors"
                >
                  <XMarkIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

// ── Condition Row (stacked layout for sidebar width) ──

function ConditionRow({
  condition,
  fields,
  onFieldChange,
  onOperatorChange,
  onValueChange,
  onValue2Change,
  onRemove,
}: {
  condition: FilterCondition;
  fields: FieldDefinition[];
  onFieldChange: (fieldKey: string) => void;
  onOperatorChange: (op: FilterOperator) => void;
  onValueChange: (value: string) => void;
  onValue2Change: (value: string) => void;
  onRemove?: () => void;
}) {
  const field = fields.find((f) => f.key === condition.field);
  const fieldType: FieldType = field?.type ?? 'text';
  const operators = OPERATORS_BY_TYPE[fieldType];
  const needsValue = !NO_VALUE_OPERATORS.includes(condition.operator);
  const needsValue2 =
    condition.operator === 'between' || condition.operator === 'num_between';

  // Single-select with declared options gets a real <select>; the
  // multi-style ops (is_one_of, is_not_one_of) keep the comma list
  // input for now since the sidebar is too narrow for a chip picker.
  const hasOptions = field?.options && field.options.length > 0;
  const isSingleSelectInput =
    fieldType === 'select' &&
    condition.operator !== 'is_one_of' &&
    condition.operator !== 'is_not_one_of' &&
    hasOptions;

  const isNumberInput =
    fieldType === 'number' &&
    condition.operator !== 'is_empty' &&
    condition.operator !== 'is_not_empty';

  const isDateInput =
    fieldType === 'date' &&
    condition.operator !== 'within_days' &&
    condition.operator !== 'is_empty' &&
    condition.operator !== 'is_not_empty';

  return (
    <div className="border border-[var(--sidebar-border)] rounded-lg p-2 space-y-1.5">
      {/* Row 1: Field + Remove */}
      <div className="flex items-center gap-1.5">
        <select
          value={condition.field}
          onChange={(e) => onFieldChange(e.target.value)}
          className="flex-1 px-2 py-1.5 text-xs rounded-lg border border-[var(--sidebar-border)] bg-transparent focus:outline-none focus:border-[var(--primary)]"
        >
          {FIELD_CATEGORIES.map((cat) => {
            const inCategory = fields.filter((f) => f.category === cat.key);
            if (inCategory.length === 0) return null;
            return (
              <optgroup key={cat.key} label={cat.label}>
                {inCategory.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
        {onRemove && (
          <button
            onClick={onRemove}
            className="p-1 rounded text-[var(--sidebar-muted-foreground)] hover:text-red-400 transition-colors flex-shrink-0"
          >
            <TrashIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Row 2: Operator */}
      <select
        value={condition.operator}
        onChange={(e) => onOperatorChange(e.target.value as FilterOperator)}
        className="w-full px-2 py-1.5 text-xs rounded-lg border border-[var(--sidebar-border)] bg-transparent focus:outline-none focus:border-[var(--primary)]"
      >
        {operators.map((op) => (
          <option key={op} value={op}>
            {OPERATOR_LABELS[op]}
          </option>
        ))}
      </select>

      {/* Row 3: Value input(s) */}
      {needsValue && (
        isSingleSelectInput ? (
          <select
            value={condition.value}
            onChange={(e) => onValueChange(e.target.value)}
            className="w-full px-2 py-1.5 text-xs rounded-lg border border-[var(--sidebar-border)] bg-transparent focus:outline-none focus:border-[var(--primary)]"
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
            type={isNumberInput ? 'number' : isDateInput ? 'date' : 'text'}
            value={condition.value}
            onChange={(e) => onValueChange(e.target.value)}
            placeholder={placeholderFor(fieldType, condition.operator)}
            className="w-full px-2 py-1.5 text-xs rounded-lg border border-[var(--sidebar-border)] bg-transparent focus:outline-none focus:border-[var(--primary)]"
          />
        )
      )}
      {needsValue2 && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--sidebar-muted-foreground)]">and</span>
          <input
            type={fieldType === 'number' ? 'number' : 'date'}
            value={condition.value2 || ''}
            onChange={(e) => onValue2Change(e.target.value)}
            className="flex-1 px-2 py-1.5 text-xs rounded-lg border border-[var(--sidebar-border)] bg-transparent focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
      )}
    </div>
  );
}

function placeholderFor(type: FieldType, operator: string): string {
  if (operator === 'within_days') return 'days';
  if (type === 'tags' || type === 'multiselect') return 'tag1, tag2, ...';
  if (type === 'select') return 'value1, value2, ...';
  if (type === 'number') return 'number';
  return 'value';
}
