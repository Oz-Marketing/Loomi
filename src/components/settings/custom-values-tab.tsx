'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardDocumentIcon, DocumentDuplicateIcon, PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Checkbox } from '@/components/ui/checkbox';
import { HelpTip } from '@/components/ui/help-tip';
import { toast } from '@/lib/toast';
import {
  HIDDEN_CUSTOM_VALUE_KEYS,
  customValueKey,
  customValueProblems,
  type CustomValueMap,
} from '@/lib/accounts/custom-values';

/**
 * An account's custom values: the `{{custom_values.*}}` merge tags it fills in
 * for itself — links, review URLs, anything a template should say per store.
 * Not contact fields (those are Custom Fields, one per contact).
 *
 * Edited here and saved with the page's Save button, like the rest of the
 * account. A group can copy its values down to its accounts; the copy writes
 * immediately and takes the group's SAVED values.
 */

export interface CustomValuesTabProps {
  values: CustomValueMap;
  savedValues: CustomValueMap;
  onChange: (next: CustomValueMap) => void;
  /** The accounts beneath this one, when it's a group. */
  childAccounts: { key: string; dealer: string }[];
  accountKey: string;
}

const inputClass =
  'w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:border-[var(--primary)]';

export function CustomValuesTab({ values, savedValues, onChange, childAccounts, accountKey }: CustomValuesTabProps) {
  const [newName, setNewName] = useState('');
  const [copyOpen, setCopyOpen] = useState(false);
  const visible = Object.entries(values).filter(([k]) => !HIDDEN_CUSTOM_VALUE_KEYS.has(k));
  const problems = useMemo(() => customValueProblems(values), [values]);
  const unsaved = JSON.stringify(values) !== JSON.stringify(savedValues);
  const newKey = customValueKey(newName);
  const newProblem = !newName.trim()
    ? null
    : !newKey
      ? 'Use letters or numbers in the name.'
      : Object.keys(values).some((k) => customValueKey(k) === newKey)
        ? `There's already a {{custom_values.${newKey}}}.`
        : null;

  function add() {
    if (!newKey || newProblem) return;
    onChange({ ...values, [newKey]: { name: newName.trim(), value: '' } });
    setNewName('');
  }

  function update(key: string, patch: Partial<{ name: string; value: string }>) {
    onChange({ ...values, [key]: { ...values[key], ...patch } });
  }

  function remove(key: string) {
    const next = { ...values };
    delete next[key];
    onChange(next);
  }

  async function copyTag(key: string) {
    try {
      await navigator.clipboard.writeText(`{{custom_values.${key}}}`);
      toast.success('Merge tag copied');
    } catch {
      toast.error("Couldn't copy to the clipboard");
    }
  }

  return (
    <div className="glass-section-card rounded-xl p-6 animate-fade-in-up">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Custom Values</h3>
          <HelpTip title="Custom values">
            <p>
              Values this account fills in for itself — links, review URLs, anything a template should say per
              store. Each one is a merge tag: <code>{'{{custom_values.specials_url}}'}</code> in a template shows
              this account&rsquo;s value.
            </p>
            <p>
              The tag is set when you add the value and doesn&rsquo;t change if you rename it, so templates keep
              working. These aren&rsquo;t contact fields; those are Custom Fields.
            </p>
          </HelpTip>
        </div>
        {childAccounts.length > 0 && (
          <button
            type="button"
            onClick={() => setCopyOpen(true)}
            disabled={unsaved || visible.length === 0}
            title={unsaved ? 'Save your changes first — the copy uses saved values.' : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <DocumentDuplicateIcon className="h-4 w-4" />
            Copy to accounts
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="mb-4 text-sm text-[var(--muted-foreground)]">No custom values yet.</p>
      ) : (
        <div className="mb-4 space-y-2">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] gap-2 px-1 text-xs font-medium text-[var(--muted-foreground)]">
            <span>Name</span>
            <span>Value</span>
            <span className="w-[13.5rem]">Merge tag</span>
          </div>
          {visible.map(([key, def]) => (
            <div key={key} className="animate-fade-in-up">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] items-center gap-2">
                <input
                  className={inputClass}
                  value={def.name}
                  onChange={(e) => update(key, { name: e.target.value })}
                  aria-label="Name"
                />
                <input
                  className={inputClass}
                  value={def.value}
                  onChange={(e) => update(key, { value: e.target.value })}
                  placeholder="Value for this account"
                  aria-label={`Value for ${def.name || key}`}
                />
                <div className="flex w-[13.5rem] items-center gap-1">
                  <button
                    type="button"
                    onClick={() => copyTag(key)}
                    title="Copy merge tag"
                    className="inline-flex min-w-0 flex-1 items-center gap-1 rounded-md bg-[var(--muted)] px-2 py-1.5 text-left font-mono text-[11px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                  >
                    <ClipboardDocumentIcon className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">{key}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(key)}
                    aria-label={`Remove ${def.name || key}`}
                    className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/10 hover:text-red-400"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {problems[key] && <p className="mt-1 px-1 text-xs text-red-400">{problems[key]}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-start gap-2">
        <div className="flex-1">
          <input
            className={inputClass}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder="New value name, e.g. Specials URL"
            aria-label="New value name"
          />
          {newName.trim() && (
            <p className={`mt-1 px-1 text-xs ${newProblem ? 'text-red-400' : 'text-[var(--muted-foreground)]'}`}>
              {newProblem ?? `Tag: {{custom_values.${newKey}}}`}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={add}
          disabled={!newKey || !!newProblem}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" />
          Add
        </button>
      </div>

      {copyOpen && (
        <CopyDialog
          accountKey={accountKey}
          values={savedValues}
          childAccounts={childAccounts}
          onClose={() => setCopyOpen(false)}
        />
      )}
    </div>
  );
}

function CopyDialog({
  accountKey,
  values,
  childAccounts,
  onClose,
}: {
  accountKey: string;
  values: CustomValueMap;
  childAccounts: { key: string; dealer: string }[];
  onClose: () => void;
}) {
  const entries = Object.entries(values).filter(([k]) => !HIDDEN_CUSTOM_VALUE_KEYS.has(k));
  const [keys, setKeys] = useState<Set<string>>(() => new Set(entries.map(([k]) => k)));
  const [targets, setTargets] = useState<Set<string>>(() => new Set(childAccounts.map((a) => a.key)));
  const [withValues, setWithValues] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, k: string) => {
    const next = new Set(set);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setter(next);
  };

  async function run() {
    setBusy(true);
    try {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountKey)}/custom-values/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: [...keys], targets: [...targets], withValues, overwrite }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        results?: { added: number; replaced: number }[];
      };
      if (!res.ok) {
        toast.error(data.error || "Couldn't copy the values");
        return;
      }
      const changed = (data.results ?? []).filter((r) => r.added || r.replaced).length;
      toast.success(
        changed
          ? `Copied to ${changed} account${changed === 1 ? '' : 's'}`
          : 'Every account already had these values',
      );
      onClose();
    } catch {
      toast.error("Couldn't copy the values");
    } finally {
      setBusy(false);
    }
  }

  const Opt = ({ on, title, desc, onPick }: { on: boolean; title: string; desc: string; onPick: () => void }) => (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--muted)] ${on ? 'bg-[var(--muted)]' : ''}`}
    >
      <span className={`mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ${on ? 'bg-[var(--primary)]' : 'border border-[var(--muted-foreground)]/50'}`} />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-[var(--foreground)]">{title}</span>
        <span className="block text-[10px] leading-snug text-[var(--muted-foreground)]">{desc}</span>
      </span>
    </button>
  );

  if (typeof document === 'undefined') return null;
  // z-[260]: this opens from inside the Agency Settings modal (z-[200]).
  return createPortal(
    <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="glass-modal animate-modal-in flex max-h-[85vh] w-[520px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-base font-semibold">Copy custom values to accounts</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)]">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto px-5 py-4">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--muted-foreground)]">Values</span>
              <Checkbox
                size="sm"
                checked={keys.size === entries.length}
                indeterminate={keys.size > 0 && keys.size < entries.length}
                onChange={() => setKeys(keys.size === entries.length ? new Set() : new Set(entries.map(([k]) => k)))}
                label={<span className="text-xs">All</span>}
              />
            </div>
            <div className="space-y-1.5">
              {entries.map(([k, def]) => (
                <Checkbox
                  key={k}
                  checked={keys.has(k)}
                  onChange={() => toggle(keys, setKeys, k)}
                  label={
                    <span className="text-sm">
                      {def.name} <span className="font-mono text-[11px] text-[var(--muted-foreground)]">{k}</span>
                    </span>
                  }
                />
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--muted-foreground)]">Accounts</span>
              <Checkbox
                size="sm"
                checked={targets.size === childAccounts.length}
                indeterminate={targets.size > 0 && targets.size < childAccounts.length}
                onChange={() =>
                  setTargets(targets.size === childAccounts.length ? new Set() : new Set(childAccounts.map((a) => a.key)))
                }
                label={<span className="text-xs">All</span>}
              />
            </div>
            <div className="max-h-48 space-y-1.5 overflow-y-auto">
              {childAccounts.map((a) => (
                <Checkbox key={a.key} checked={targets.has(a.key)} onChange={() => toggle(targets, setTargets, a.key)} label={<span className="text-sm">{a.dealer}</span>} />
              ))}
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3">
            <div role="radiogroup" aria-label="What to copy">
              <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">Copy</span>
              <Opt on={withValues} title="Names and values" desc="Each account starts with the group's value." onPick={() => setWithValues(true)} />
              <Opt on={!withValues} title="Names only" desc="Values left blank to fill in per account." onPick={() => setWithValues(false)} />
            </div>
            <div role="radiogroup" aria-label="When an account already has one">
              <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">If an account has it</span>
              <Opt on={!overwrite} title="Keep its value" desc="Only adds what's missing." onPick={() => setOverwrite(false)} />
              <Opt
                on={overwrite}
                title="Replace it"
                desc={withValues ? "Overwrites with the group's value." : 'Names only never blanks a value.'}
                onPick={() => setOverwrite(true)}
              />
            </div>
          </section>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm hover:bg-[var(--muted)]">
            Cancel
          </button>
          <button
            type="button"
            onClick={run}
            disabled={busy || keys.size === 0 || targets.size === 0}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
          >
            {busy ? 'Copying…' : `Copy to ${targets.size} account${targets.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
