'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Select } from '@/components/select';
import { HelpTip } from '@/components/ui/help-tip';
import type { CreativeDefinition } from '@/lib/playbooks/creative';

/**
 * The agency-wide creative playbook library (docs/playbooks.md §5).
 *
 * Authoring lives here rather than in a sub-account's settings on purpose: a
 * playbook exists to be applied to MANY rooftops, and building it from inside
 * one of them is how it quietly becomes that rooftop's private setting.
 */

interface PlaybookRow {
  id: string;
  key: string;
  name: string;
  scopeValue: string | null;
  version: number;
  definition: CreativeDefinition;
  published: boolean;
  appliedCount: number;
  updatedAt: string;
}

interface Options {
  adTemplates: { id: string; name: string; sizes: { id: string; label: string }[] }[];
  emailTemplates: { slug: string; title: string; hasOffersBlock: boolean }[];
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function PlaybookLibrary() {
  const { data, mutate, isLoading } = useSWR<{ playbooks: PlaybookRow[] }>(
    '/api/playbooks/library',
    fetcher,
    { revalidateOnFocus: false },
  );
  // Template choices come from the agency-wide pool, not one sub-account's.
  const { data: opts } = useSWR<Options>('/api/playbooks/library/options', fetcher, {
    revalidateOnFocus: false,
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const playbooks = data?.playbooks ?? [];

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch('/api/playbooks/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await mutate();
      return json.playbook as PlaybookRow | undefined;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--muted-foreground)]">
          A playbook pairs one ad design with one offer-email template, so a sub-account picks the
          bundle instead of each piece.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            const created = await post({ name: 'New playbook' });
            if (created) setEditing(created.id);
          }}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          New playbook
        </button>
      </div>

      {isLoading && <p className="text-xs text-[var(--muted-foreground)]">Loading…</p>}

      {!isLoading && playbooks.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[var(--border)] py-16 text-center">
          <p className="text-sm text-[var(--foreground)]">No playbooks yet.</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Build one here, publish it, and it becomes selectable on every sub-account&apos;s ad
            automation Config tab.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {playbooks.map((p) => (
          <PlaybookCard
            key={p.id}
            playbook={p}
            options={opts}
            open={editing === p.id}
            busy={busy}
            onToggle={() => setEditing(editing === p.id ? null : p.id)}
            onSave={(patch) => post({ id: p.id, ...patch })}
            onDelete={() => post({ id: p.id, delete: true })}
          />
        ))}
      </div>
    </div>
  );
}

function PlaybookCard({
  playbook,
  options,
  open,
  busy,
  onToggle,
  onSave,
  onDelete,
}: {
  playbook: PlaybookRow;
  options: Options | undefined;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<PlaybookRow | undefined>;
  onDelete: () => void;
}) {
  const [name, setName] = useState(playbook.name);
  const [scopeValue, setScopeValue] = useState(playbook.scopeValue ?? '');
  const [def, setDef] = useState<CreativeDefinition>(playbook.definition);

  const adTemplate = options?.adTemplates.find((t) => t.id === def.adTemplateId);
  const emailTemplate = options?.emailTemplates.find((t) => t.slug === def.emailTemplateSlug);
  // Generation refuses a shell with no marker, so it can't be a publish-time
  // surprise — the author sees it while they're choosing.
  const shellBroken = !!def.emailTemplateSlug && emailTemplate?.hasOffersBlock === false;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onToggle} className="text-sm font-semibold text-[var(--foreground)]">
          {playbook.name}
        </button>
        {playbook.scopeValue && (
          <span className="rounded-full bg-[var(--muted)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)]">
            {playbook.scopeValue}
          </span>
        )}
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
            playbook.published
              ? 'bg-emerald-500/15 text-emerald-500'
              : 'bg-amber-500/15 text-amber-500'
          }`}
        >
          {playbook.published ? `Published · v${playbook.version}` : 'Draft'}
        </span>
        <span className="text-[10px] text-[var(--muted-foreground)]">
          {playbook.appliedCount} sub-account{playbook.appliedCount === 1 ? '' : 's'}
        </span>
        <button
          onClick={onToggle}
          className="ml-auto text-[11px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
        >
          {open ? 'Close' : 'Edit'}
        </button>
      </div>

      {!open && (
        <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
          {adTemplate?.name ?? 'No ad template'} ·{' '}
          {emailTemplate?.title ?? (def.emailTemplateSlug ? def.emailTemplateSlug : 'brand-kit email')} ·{' '}
          {def.emailMaxOffers} offers
        </p>
      )}

      {open && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
                Name
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              />
            </label>
            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[var(--muted-foreground)]">
                Brand
                <HelpTip title="Brand" iconClassName="h-3 w-3">
                  <p>
                    Optional label, e.g. <strong>Chevrolet</strong>. Records who the playbook is
                    for; it does not restrict which sub-accounts can pick it.
                  </p>
                </HelpTip>
              </span>
              <input
                value={scopeValue}
                onChange={(e) => setScopeValue(e.target.value)}
                placeholder="Chevrolet"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <span className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
                Ad template
              </span>
              <Select
                value={def.adTemplateId}
                onChange={(v) => setDef({ ...def, adTemplateId: v, sizeIds: [] })}
                previewFont={false}
                options={[
                  { value: '', label: 'None' },
                  ...(options?.adTemplates ?? []).map((t) => ({ value: t.id, label: t.name })),
                ]}
              />
            </div>
            <div>
              <span className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
                Email template
              </span>
              <Select
                value={def.emailTemplateSlug}
                onChange={(v) => setDef({ ...def, emailTemplateSlug: v })}
                previewFont={false}
                options={[
                  { value: '', label: 'None — use the brand kit' },
                  ...(options?.emailTemplates ?? []).map((t) => ({
                    value: t.slug,
                    label: t.hasOffersBlock ? t.title : `${t.title} — no {{offers}} block`,
                  })),
                ]}
              />
              {shellBroken && (
                <p className="mt-1 text-[10px] text-amber-500">
                  No <strong>{'{{offers}}'}</strong> block — no email would be produced.
                </p>
              )}
            </div>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
                Max offers
              </span>
              <input
                value={String(def.emailMaxOffers)}
                onChange={(e) =>
                  setDef({ ...def, emailMaxOffers: Number(e.target.value.replace(/[^0-9]/g, '')) || 6 })
                }
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              />
            </label>
          </div>

          {/* Sizes come from the chosen design's own list — offering one it
              doesn't define would render nothing. */}
          {adTemplate && adTemplate.sizes.length > 0 && (
            <div>
              <span className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
                Sizes
              </span>
              <div className="flex flex-wrap gap-2">
                {adTemplate.sizes.map((sz) => {
                  const on = def.sizeIds.length === 0 || def.sizeIds.includes(sz.id);
                  return (
                    <button
                      key={sz.id}
                      onClick={() =>
                        setDef({
                          ...def,
                          sizeIds: def.sizeIds.includes(sz.id)
                            ? def.sizeIds.filter((s) => s !== sz.id)
                            : [...def.sizeIds, sz.id],
                        })
                      }
                      className={`rounded-lg border px-2 py-1 text-[11px] transition-colors ${
                        on
                          ? 'border-[var(--primary)] text-[var(--primary)]'
                          : 'border-[var(--border)] text-[var(--muted-foreground)]'
                      }`}
                    >
                      {sz.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                Select none to render all {adTemplate.sizes.length}.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2 border-t border-[var(--border)] pt-3">
            <button
              onClick={onDelete}
              disabled={busy}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-[var(--muted-foreground)] transition-colors hover:text-red-500 disabled:opacity-50"
            >
              <TrashIcon className="h-3.5 w-3.5" />
              Delete
            </button>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => onSave({ name, scopeValue, definition: def, publish: false })}
                disabled={busy}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-[var(--muted)] disabled:opacity-50"
              >
                Save as draft
              </button>
              <button
                onClick={() => onSave({ name, scopeValue, definition: def, publish: true })}
                disabled={busy}
                className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {playbook.published ? 'Save + publish' : 'Publish'}
              </button>
            </div>
          </div>
          <p className="text-[10px] text-[var(--muted-foreground)]">
            Publishing makes it selectable on sub-accounts. Sub-accounts already following it keep
            their own overrides — they are shown the new version, never force-updated.
          </p>
        </div>
      )}
    </div>
  );
}
