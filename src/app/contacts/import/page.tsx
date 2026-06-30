'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  CloudArrowUpIcon,
  ExclamationTriangleIcon,
  ListBulletIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { useFilterableFields } from '@/hooks/use-filterable-fields';
import { toast } from '@/lib/toast';
import PrimaryButton from '@/components/primary-button';
import { CONTACT_FIELDS, IGNORE_FIELD, type ContactField } from '@/lib/contacts/normalize';
import { consumePendingImportFile } from '@/lib/contacts/pending-import';
import type { CustomFieldDto } from '@/lib/contacts/custom-field-types';

// ── Types ──

type MappingTarget = ContactField | typeof IGNORE_FIELD | `custom:${string}`;
type Mapping = Record<string, MappingTarget>;

interface ParseResponse {
  headers: string[];
  totalRows: number;
  sampleRows: Record<string, string>[];
  // Canonical field name OR a "custom:<key>" reference when the server
  // matched a header against a declared custom field's csvAliases.
  suggestedMapping: Record<string, ContactField | `custom:${string}`>;
  canonicalFields: readonly ContactField[];
}

interface ImportSummary {
  totalRows: number;
  imported: number;
  updated: number;
  skipped: number;
  issues: { rowNumber: number; reason: string }[];
  listMembershipsAdded?: number;
}

interface ListTarget {
  id: string;
  name: string;
  accountKey: string;
}

const CANONICAL_FIELD_SET: ReadonlySet<string> = new Set(CONTACT_FIELDS);

/**
 * Validate the column→field mapping client-side, mirroring the server's
 * parseMapping rules. Surfaces a readable, per-column message before we
 * submit instead of letting the API reject the payload with an opaque 400.
 * Returns an error string naming the offending column, or null when valid.
 */
function validateMapping(mapping: Mapping): string | null {
  for (const [header, target] of Object.entries(mapping)) {
    if (typeof target !== 'string' || !target) {
      return `Column "${header}" has no field selected — pick a field or choose "Ignore".`;
    }
    if (target === IGNORE_FIELD) continue;
    if (target.startsWith('custom:')) {
      if (!target.slice('custom:'.length).trim()) {
        return `Column "${header}" is mapped to a custom field with no name.`;
      }
      continue;
    }
    if (!CANONICAL_FIELD_SET.has(target)) {
      return `Column "${header}" is mapped to an unknown field "${target}".`;
    }
  }
  return null;
}

// User-friendly labels for the canonical fields dropdown.
const FIELD_LABELS: Record<ContactField, string> = {
  email: 'Email',
  phone: 'Phone',
  firstName: 'First Name',
  lastName: 'Last Name',
  fullName: 'Full Name',
  address1: 'Address',
  city: 'City',
  state: 'State',
  postalCode: 'Postal Code',
  country: 'Country',
  source: 'Source',
  tags: 'Tags',
  dateAdded: 'Date Added',
  vehicleYear: 'Vehicle Year',
  vehicleMake: 'Vehicle Make',
  vehicleModel: 'Vehicle Model',
  vehicleVin: 'Vehicle VIN',
  vehicleMileage: 'Vehicle Mileage',
  lastServiceDate: 'Last Service Date',
  nextServiceDate: 'Next Service Date',
  leaseEndDate: 'Lease End Date',
  warrantyEndDate: 'Warranty End Date',
  purchaseDate: 'Purchase Date',
};

export default function ContactsImportPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const subHref = useSubaccountHref();
  const { isAccount, accountKey, accounts, userRole } = useAccount();

  const listIdParam = searchParams?.get('listId') ?? null;
  const [listTarget, setListTarget] = useState<ListTarget | null>(null);
  const [listLoadError, setListLoadError] = useState<string | null>(null);

  // Tracks whether we've already pulled the New-List-modal handoff file.
  // We consume the stash at most once per page lifetime so a re-render
  // doesn't replay an old file or wipe a fresh user pick.
  const stashConsumedRef = useRef(false);

  // When a listId is in the URL, look the list up so we can show its
  // name in the header and pin the account picker to the list's account.
  useEffect(() => {
    if (!listIdParam) {
      setListTarget(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/contacts/lists/${encodeURIComponent(listIdParam)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load list');
        }
        if (cancelled) return;
        setListTarget({ id: data.list.id, name: data.list.name, accountKey: data.list.accountKey });
        setListLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setListTarget(null);
        setListLoadError(err instanceof Error ? err.message : 'Failed to load list');
      });
    return () => {
      cancelled = true;
    };
  }, [listIdParam]);

  // Account selection — fixed in sub-account scope, picker elsewhere.
  const accountOptions = useMemo(
    () =>
      Object.entries(accounts)
        .map(([key, account]) => ({ key, dealer: account.dealer || key }))
        .sort((a, b) => a.dealer.localeCompare(b.dealer)),
    [accounts],
  );

  const [selectedAccountKey, setSelectedAccountKey] = useState<string>(() => {
    if (isAccount && accountKey) return accountKey;
    return accountOptions[0]?.key ?? '';
  });

  // Surface this account's declared custom fields in the mapper
  // dropdown so users don't have to remember the key — they pick from
  // a list, same as canonical fields. The blueprint pre-deployment
  // also lets CSV header aliases auto-map at parse time on the server.
  const { customFields } = useFilterableFields(selectedAccountKey || null);

  // When a list target loads, lock the import to that list's account.
  useEffect(() => {
    if (listTarget) setSelectedAccountKey(listTarget.accountKey);
  }, [listTarget]);

  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParseResponse | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});

  const [dryRunning, setDryRunning] = useState(false);
  const [dryRun, setDryRun] = useState<ImportSummary | null>(null);
  const [committing, setCommitting] = useState(false);

  // Pick up the file handed off by the New List modal once the account
  // key is settled (immediately when standalone, after listTarget load
  // when targeting a list). Stash consumption is gated by a ref so
  // re-renders never replay or wipe a fresh manual pick.
  useEffect(() => {
    if (stashConsumedRef.current) return;
    if (listIdParam && !listTarget) return;
    if (!selectedAccountKey) return;

    const stashed = consumePendingImportFile();
    stashConsumedRef.current = true;
    if (stashed) {
      void handleFileChange(stashed);
    }
    // handleFileChange closes over selectedAccountKey, which is the
    // gate we explicitly wait for above — listing it as a dep would
    // re-run on unrelated parse-state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listIdParam, listTarget, selectedAccountKey]);

  // Account picker is hidden when targeting a list — the list dictates
  // the account, and changing it mid-flow would be confusing.
  const canPickAccount =
    !listTarget &&
    (userRole === 'developer' || userRole === 'super_admin' || (userRole === 'admin' && !isAccount));

  function resetAll() {
    setFile(null);
    setParsed(null);
    setMapping({});
    setDryRun(null);
  }

  async function handleFileChange(next: File | null) {
    setFile(next);
    setParsed(null);
    setMapping({});
    setDryRun(null);

    if (!next || !selectedAccountKey) return;

    setParsing(true);
    try {
      const form = new FormData();
      form.append('file', next);
      form.append('accountKey', selectedAccountKey);

      const res = await fetch('/api/contacts/import?mode=parse', {
        method: 'POST',
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to parse CSV');
      }

      const response = data as ParseResponse;
      setParsed(response);
      // Initialise mapping with whatever the server auto-detected.
      const initial: Mapping = {};
      for (const header of response.headers) {
        const suggested = response.suggestedMapping[header];
        initial[header] = suggested ?? IGNORE_FIELD;
      }
      setMapping(initial);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to parse CSV');
      setFile(null);
    } finally {
      setParsing(false);
    }
  }

  function updateMappingFor(header: string, target: MappingTarget) {
    setMapping((prev) => ({ ...prev, [header]: target }));
    // Mapping changed → invalidate any previous dry-run.
    setDryRun(null);
  }

  async function runDryRun() {
    if (!file || !selectedAccountKey || !parsed) return;
    const mappingError = validateMapping(mapping);
    if (mappingError) {
      toast.error(mappingError);
      return;
    }
    setDryRunning(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('accountKey', selectedAccountKey);
      form.append('mapping', JSON.stringify(mapping));

      const res = await fetch('/api/contacts/import?mode=dryRun', {
        method: 'POST',
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Dry-run failed');
      }
      setDryRun(data.summary as ImportSummary);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Dry-run failed');
    } finally {
      setDryRunning(false);
    }
  }

  async function commitImport() {
    if (!file || !selectedAccountKey || !parsed) return;
    const mappingError = validateMapping(mapping);
    if (mappingError) {
      toast.error(mappingError);
      return;
    }
    setCommitting(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('accountKey', selectedAccountKey);
      form.append('mapping', JSON.stringify(mapping));
      if (listTarget) form.append('listId', listTarget.id);

      const res = await fetch('/api/contacts/import?mode=commit', {
        method: 'POST',
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Import failed');
      }
      const summary = data.summary as ImportSummary;
      if (listTarget) {
        const added = summary.listMembershipsAdded ?? 0;
        toast.success(
          `Added ${added.toLocaleString()} contact${added === 1 ? '' : 's'} to "${listTarget.name}".`,
        );
        router.push(subHref(`/contacts/lists/${listTarget.id}`));
      } else {
        toast.success(
          `Imported ${summary.imported.toLocaleString()} new, updated ${summary.updated.toLocaleString()} existing.`,
        );
        router.push(subHref('/contacts'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setCommitting(false);
    }
  }

  const hasEmailMapping = useMemo(
    () => Object.values(mapping).some((target) => target === 'email'),
    [mapping],
  );
  const hasPhoneMapping = useMemo(
    () => Object.values(mapping).some((target) => target === 'phone'),
    [mapping],
  );
  const mappingValid = hasEmailMapping || hasPhoneMapping;

  const backHref = listTarget
    ? subHref(`/contacts/lists/${listTarget.id}`)
    : subHref('/contacts');

  return (
    <div className="space-y-6">
      <div className="page-sticky-header">
        <div className="flex items-center gap-3">
          <Link
            href={backHref}
            className="p-2 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)]/40 transition-colors"
          >
            <ArrowLeftIcon className="w-4 h-4" />
          </Link>
          {listTarget ? (
            <ListBulletIcon className="w-7 h-7 text-[var(--primary)]" />
          ) : (
            <UserGroupIcon className="w-7 h-7 text-[var(--primary)]" />
          )}
          <div>
            <h2 className="text-2xl font-bold">
              {listTarget ? `Upload to "${listTarget.name}"` : 'Import Contacts'}
            </h2>
            <p className="text-[var(--muted-foreground)] mt-1">
              {listTarget
                ? 'Upload a CSV. Contacts will be added to this list (existing contacts are matched, not overwritten).'
                : 'Upload a CSV. Loomi will match columns to contact fields and let you review before committing.'}
            </p>
          </div>
        </div>
      </div>

      {listLoadError && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 inline-flex items-center gap-2 text-xs text-amber-300">
          <ExclamationTriangleIcon className="w-4 h-4" />
          Couldn&apos;t load the target list: {listLoadError}
        </div>
      )}

      {/* Step 1: pick account + upload */}
      <section className="glass-section-card rounded-2xl p-5 border border-[var(--border)]">
        <p className="text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-4">
          1. Choose Account &amp; CSV
        </p>

        {canPickAccount && (
          <div className="mb-4">
            <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
              Import into
            </label>
            <select
              value={selectedAccountKey}
              onChange={(e) => {
                setSelectedAccountKey(e.target.value);
                resetAll();
              }}
              className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)]"
            >
              {accountOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.dealer}
                </option>
              ))}
            </select>
          </div>
        )}

        <label
          htmlFor="contact-csv-file"
          className={`block w-full rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
            file
              ? 'border-[var(--primary)] bg-[var(--primary)]/5'
              : 'border-[var(--border)] hover:border-[var(--muted-foreground)]'
          }`}
        >
          <CloudArrowUpIcon className="w-8 h-8 mx-auto text-[var(--muted-foreground)] mb-2" />
          {file ? (
            <>
              <p className="text-sm font-medium">{file.name}</p>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                {(file.size / 1024).toFixed(1)} KB · click to choose a different file
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">Click to choose a CSV</p>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                Up to 25 MB. First row is expected to be a header.
              </p>
            </>
          )}
          <input
            id="contact-csv-file"
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
          />
        </label>

        {parsing && (
          <p className="text-xs text-[var(--muted-foreground)] inline-flex items-center gap-2 mt-3">
            <ArrowPathIcon className="w-4 h-4 animate-spin" />
            Parsing…
          </p>
        )}
      </section>

      {/* Step 2: column mapping */}
      {parsed && (
        <section className="glass-section-card rounded-2xl p-5 border border-[var(--border)]">
          <div className="flex items-baseline justify-between gap-4 mb-4">
            <p className="text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
              2. Map CSV Columns ({parsed.totalRows.toLocaleString()} rows)
            </p>
            {!mappingValid && (
              <p className="text-[11px] text-amber-300 inline-flex items-center gap-1.5">
                <ExclamationTriangleIcon className="w-4 h-4" />
                Map at least one column to Email or Phone
              </p>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                  <th className="text-left py-2 pr-4 font-medium">CSV Column</th>
                  <th className="text-left py-2 pr-4 font-medium">Sample</th>
                  <th className="text-left py-2 font-medium">Maps to</th>
                </tr>
              </thead>
              <tbody>
                {parsed.headers.map((header) => {
                  const samples = parsed.sampleRows
                    .map((row) => row[header])
                    .filter((value) => value && value.trim())
                    .slice(0, 2);
                  return (
                    <tr key={header} className="border-b border-[var(--border)]/50 last:border-0">
                      <td className="py-2.5 pr-4 align-top">
                        <p className="font-medium truncate max-w-[200px]" title={header}>
                          {header}
                        </p>
                      </td>
                      <td className="py-2.5 pr-4 align-top text-xs text-[var(--muted-foreground)]">
                        {samples.length > 0 ? (
                          <div className="space-y-0.5">
                            {samples.map((value, idx) => (
                              <p key={idx} className="truncate max-w-[280px]" title={value}>
                                {value}
                              </p>
                            ))}
                          </div>
                        ) : (
                          <span className="italic">empty</span>
                        )}
                      </td>
                      <td className="py-2.5 align-top">
                        <FieldSelect
                          value={mapping[header] ?? IGNORE_FIELD}
                          mapping={mapping}
                          header={header}
                          declaredCustoms={customFields}
                          onChange={(target) => updateMappingFor(header, target)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Step 3: preview + commit */}
      {parsed && (
        <section className="glass-section-card rounded-2xl p-5 border border-[var(--border)]">
          <p className="text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-4">
            3. Preview &amp; Import
          </p>

          <div className="flex items-center gap-3 mb-4">
            <button
              type="button"
              onClick={runDryRun}
              disabled={!mappingValid || dryRunning || committing}
              className="inline-flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/40 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {dryRunning ? (
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircleIcon className="w-4 h-4" />
              )}
              {dryRunning ? 'Previewing…' : 'Run Preview'}
            </button>

            <PrimaryButton
              onClick={commitImport}
              disabled={!dryRun || committing || !mappingValid}
            >
              {committing ? 'Importing…' : `Import ${dryRun ? `${dryRun.totalRows - dryRun.skipped} contacts` : ''}`}
            </PrimaryButton>
          </div>

          {dryRun && (
            <div className="grid gap-3 sm:grid-cols-3 mb-4">
              <SummaryCard
                label="New contacts"
                value={dryRun.imported}
                tone="primary"
              />
              <SummaryCard
                label={listTarget ? 'Already in DB' : 'Updated contacts'}
                value={dryRun.updated}
                tone="neutral"
              />
              <SummaryCard
                label="Skipped rows"
                value={dryRun.skipped}
                tone={dryRun.skipped > 0 ? 'warn' : 'neutral'}
              />
            </div>
          )}

          {dryRun && dryRun.issues.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-xs font-semibold text-amber-300 mb-2">
                {dryRun.issues.length} row{dryRun.issues.length === 1 ? '' : 's'} skipped
                {dryRun.issues.length === 50 ? ' (showing first 50)' : ''}
              </p>
              <ul className="text-[11px] text-[var(--muted-foreground)] space-y-1 max-h-[200px] overflow-y-auto">
                {dryRun.issues.map((issue, idx) => (
                  <li key={idx}>
                    <span className="font-mono">Row {issue.rowNumber}</span> · {issue.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ── FieldSelect ──

// Sentinel option values used by the select; kept short so the
// onChange dispatch reads cleanly.
const SELECT_DECLARED_PREFIX = '__declared:';
const SELECT_NEW_CUSTOM = '__custom';

function FieldSelect({
  value,
  mapping,
  header,
  declaredCustoms,
  onChange,
}: {
  value: MappingTarget;
  mapping: Mapping;
  header: string;
  declaredCustoms: CustomFieldDto[];
  onChange: (target: MappingTarget) => void;
}) {
  // Which canonical fields are already claimed by another header.
  // We still show them in the dropdown (so the user can move the
  // mapping) but mark them visually so it's clear something else
  // currently owns it.
  const claimedBy = useMemo(() => {
    const out: Partial<Record<ContactField, string>> = {};
    for (const [otherHeader, target] of Object.entries(mapping)) {
      if (otherHeader === header) continue;
      if (typeof target === 'string' && !target.startsWith('custom:') && target !== IGNORE_FIELD) {
        out[target as ContactField] = otherHeader;
      }
    }
    return out;
  }, [mapping, header]);

  // Same idea for declared custom fields — show "owned by X" hint when
  // another header is already pulling into that custom key.
  const claimedCustomKeyBy = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [otherHeader, target] of Object.entries(mapping)) {
      if (otherHeader === header) continue;
      if (typeof target === 'string' && target.startsWith('custom:')) {
        const key = target.slice('custom:'.length).trim();
        if (key) out[key] = otherHeader;
      }
    }
    return out;
  }, [mapping, header]);

  const isCustom = typeof value === 'string' && value.startsWith('custom:');
  const customKey = isCustom ? value.slice('custom:'.length) : '';
  const isDeclared = isCustom && declaredCustoms.some((c) => c.key === customKey);
  const isAdHocCustom = isCustom && !isDeclared;

  // A column counts as mapped when it points somewhere actionable. A
  // custom: prefix without a key still surfaces in the API as invalid,
  // so we treat it as unmapped for visual feedback.
  const isMapped = value !== IGNORE_FIELD && !(isCustom && customKey.trim() === '');

  // The <select> driver value: route declared customs through a
  // synthetic `__declared:<key>` value so a single onChange handles all
  // three modes (canonical, declared custom, new ad-hoc custom).
  const selectValue = isDeclared
    ? `${SELECT_DECLARED_PREFIX}${customKey}`
    : isAdHocCustom
      ? SELECT_NEW_CUSTOM
      : value;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) { setSearch(''); return; }
    setTimeout(() => searchRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (next: string) => {
    if (next === SELECT_NEW_CUSTOM) {
      onChange(`custom:${header}`);
    } else if (next.startsWith(SELECT_DECLARED_PREFIX)) {
      onChange(`custom:${next.slice(SELECT_DECLARED_PREFIX.length)}`);
    } else if (next === IGNORE_FIELD) {
      onChange(IGNORE_FIELD);
    } else {
      onChange(next as ContactField);
    }
    setOpen(false);
  };

  const q = search.trim().toLowerCase();

  const canonicalOptions = CONTACT_FIELDS.filter((f) =>
    !q || FIELD_LABELS[f].toLowerCase().includes(q)
  );
  const declaredOptions = declaredCustoms.filter((cf) =>
    !q || cf.label.toLowerCase().includes(q) || cf.key.toLowerCase().includes(q)
  );
  const showAdHoc = !q || 'custom field'.includes(q);

  const selectedLabel =
    selectValue === IGNORE_FIELD
      ? '— Ignore —'
      : selectValue === SELECT_NEW_CUSTOM
        ? 'Custom field (ad-hoc)…'
        : selectValue.startsWith(SELECT_DECLARED_PREFIX)
          ? (declaredCustoms.find((c) => c.key === selectValue.slice(SELECT_DECLARED_PREFIX.length))?.label ?? selectValue)
          : FIELD_LABELS[selectValue as ContactField] ?? selectValue;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs focus:outline-none transition-colors min-w-[180px] ${
            isMapped
              ? 'border-[var(--primary)]/35 bg-[var(--primary)]/4 text-[var(--foreground)] focus:border-[var(--primary)]'
              : 'border-[var(--border)] bg-[var(--card)] focus:border-[var(--primary)]'
          }`}
        >
          <span className="truncate">{selectedLabel}</span>
          <svg className="w-3 h-3 flex-shrink-0 text-[var(--muted-foreground)]" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4l4 4 4-4"/></svg>
        </button>

        {open && (
          <div className="absolute z-50 mt-1 w-56 rounded-lg border border-[var(--border)] bg-[#18181b] dark:bg-[#18181b] shadow-xl overflow-hidden">
            <div className="p-2 border-b border-[var(--border)]">
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search fields…"
                className="w-full rounded-md border border-[var(--border)] bg-[#111113] px-2.5 py-1.5 text-xs focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div className="max-h-52 overflow-y-auto py-1">
              {!q && (
                <button type="button" onClick={() => handleSelect(IGNORE_FIELD)}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--muted)] transition-colors ${selectValue === IGNORE_FIELD ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]'}`}>
                  — Ignore —
                </button>
              )}
              {canonicalOptions.length > 0 && (
                <>
                  <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">Canonical fields</p>
                  {canonicalOptions.map((field) => {
                    const owned = claimedBy[field];
                    return (
                      <button key={field} type="button" onClick={() => handleSelect(field)}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--muted)] transition-colors ${selectValue === field ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'}`}>
                        {FIELD_LABELS[field]}{owned ? <span className="text-[var(--muted-foreground)]"> ({owned})</span> : null}
                      </button>
                    );
                  })}
                </>
              )}
              {declaredOptions.length > 0 && (
                <>
                  <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">Custom fields</p>
                  {declaredOptions.map((cf) => {
                    const owned = claimedCustomKeyBy[cf.key];
                    const val = `${SELECT_DECLARED_PREFIX}${cf.key}`;
                    return (
                      <button key={cf.key} type="button" onClick={() => handleSelect(val)}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--muted)] transition-colors ${selectValue === val ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'}`}>
                        {cf.label}{owned ? <span className="text-[var(--muted-foreground)]"> ({owned})</span> : null}
                      </button>
                    );
                  })}
                </>
              )}
              {showAdHoc && (
                <button type="button" onClick={() => handleSelect(SELECT_NEW_CUSTOM)}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--muted)] transition-colors ${selectValue === SELECT_NEW_CUSTOM ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]'}`}>
                  Custom field (ad-hoc)…
                </button>
              )}
              {canonicalOptions.length === 0 && declaredOptions.length === 0 && !showAdHoc && (
                <p className="px-3 py-3 text-xs text-[var(--muted-foreground)] italic">No matches</p>
              )}
            </div>
          </div>
        )}
      </div>

      {isAdHocCustom && (
        <input
          type="text"
          value={customKey}
          onChange={(e) => onChange(`custom:${e.target.value}`)}
          placeholder="custom key"
          className={`rounded-lg border px-2.5 py-1.5 text-xs focus:outline-none transition-colors w-[140px] ${
            customKey.trim()
              ? 'border-[var(--primary)]/35 bg-[var(--primary)]/4 focus:border-[var(--primary)]'
              : 'border-[var(--border)] bg-[var(--card)] focus:border-[var(--primary)]'
          }`}
        />
      )}

      {isMapped && (
        <CheckCircleIcon
          className="w-4 h-4 text-[var(--primary)] flex-shrink-0"
          aria-label="Mapped"
        />
      )}
    </div>
  );
}

// ── SummaryCard ──

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'primary' | 'neutral' | 'warn';
}) {
  const accent =
    tone === 'primary'
      ? 'border-[var(--primary)]/30 bg-[var(--primary)]/5'
      : tone === 'warn'
        ? 'border-amber-500/30 bg-amber-500/5'
        : 'border-[var(--border)] bg-[var(--muted)]/25';
  const text =
    tone === 'primary' ? 'text-[var(--primary)]' : tone === 'warn' ? 'text-amber-300' : 'text-[var(--foreground)]';

  return (
    <div className={`rounded-lg border px-4 py-3 ${accent}`}>
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${text}`}>{value.toLocaleString()}</p>
    </div>
  );
}
