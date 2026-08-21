'use client';

/**
 * Budget Channels — the spend axis every budget line is placed on.
 *
 * This list was a 44-entry constant in lib/budget/channels until now, which
 * made Loomi's budget taxonomy Oz Marketing's: it mirrored Oz Reports' own
 * `channels` table, numeric ids and all. Another agency runs different
 * channels, groups them differently and bills them differently, and none of
 * that should need a deploy.
 *
 * Grouped by display group, because that's how the budget hub renders them and
 * the grouping is itself one of the things being edited — a channel moved to a
 * different group should visibly move here too.
 *
 * Two things this screen deliberately does NOT let you do:
 *   - change a channel's key. Budget lines store it as a plain string, so a
 *     rename would detach every line ever placed on it. The label renames.
 *   - delete a channel. Archiving retires it from the pickers and leaves the
 *     history that references it intact.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArchiveBoxIcon,
  ArrowDownIcon,
  ArrowPathIcon,
  ArrowUpIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { Select, type SelectOption } from '@/components/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { Tooltip } from '@/app/app/tools/_shared/Tooltip';
import PrimaryButton from '@/components/primary-button';
import { ChannelIcon } from '@/components/icons/channel-icon';
import { LINE_TYPES, PACER_PLATFORMS } from '@/lib/budget/channels';
import { KIND_OPTIONS } from '@/lib/projects/ui';
import { useBudgetChannels } from '@/contexts/budget-channels-context';
import { toast } from '@/lib/toast';

type AdminChannel = {
  id: string;
  key: string;
  label: string;
  category: string;
  lineType: string;
  billingKey: string | null;
  pacer: string | null;
  intakeKinds: string[];
  icon: string | null;
  externalIds: number[];
  sortOrder: number;
  archived: boolean;
};

type RateCard = { key: string; label: string };

const NONE = '';
/** Sentinel for "name a group that doesn't exist yet" in the group picker. */
const NEW_GROUP = '__new__';

export function BudgetChannelsTab() {
  const { refresh } = useBudgetChannels();
  const [channels, setChannels] = useState<AdminChannel[] | null>(null);
  const [lineCounts, setLineCounts] = useState<Record<string, number>>({});
  const [cards, setCards] = useState<RateCard[]>([]);
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [newGroupIsCustom, setNewGroupIsCustom] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    try {
      const [chRes, cardRes] = await Promise.all([
        fetch('/api/budget-channels?admin=1'),
        fetch('/api/rate-cards'),
      ]);
      if (!chRes.ok) throw new Error();
      const data = await chRes.json();
      setChannels(data.channels as AdminChannel[]);
      setLineCounts(data.lineCounts ?? {});
      setLabelDrafts(
        Object.fromEntries((data.channels as AdminChannel[]).map((c) => [c.id, c.label])),
      );
      if (cardRes.ok) setCards(((await cardRes.json()).rateCards as RateCard[]) ?? []);
    } catch {
      toast.error('Failed to load channels');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Patch one channel, then re-prime the app-wide registry. */
  async function patch(channel: AdminChannel, body: Record<string, unknown>, note?: string) {
    setBusy(channel.id);
    try {
      const res = await fetch(`/api/budget-channels/${channel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Could not save that channel');
        // Snap the row back — a rejected edit that stays on screen reads as
        // saved.
        void load();
        return;
      }
      const updated = data.channel as AdminChannel;
      setChannels((prev) => (prev ?? []).map((c) => (c.id === updated.id ? updated : c)));
      setLabelDrafts((l) => ({ ...l, [updated.id]: updated.label }));
      // Every budget screen holds the registry — without this they keep the old
      // label until a reload.
      void refresh();
      if (note) toast.success(note);
    } catch {
      toast.error('Could not save that channel');
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!newLabel.trim()) {
      toast.error('Give the channel a name.');
      return;
    }
    if (!newGroup.trim()) {
      toast.error('Pick a display group.');
      return;
    }
    setBusy('new');
    try {
      const res = await fetch('/api/budget-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel.trim(), category: newGroup.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Could not create that channel');
        return;
      }
      setNewLabel('');
      setNewGroup('');
      setNewGroupIsCustom(false);
      setAdding(false);
      await load();
      void refresh();
      toast.success(`${(data.channel as AdminChannel).label} added`);
    } catch {
      toast.error('Could not create that channel');
    } finally {
      setBusy(null);
    }
  }

  /** Move one channel within the whole active list and persist the order. */
  async function move(channel: AdminChannel, delta: -1 | 1) {
    if (!channels) return;
    const list = channels.filter((c) => !c.archived);
    const i = list.findIndex((c) => c.id === channel.id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    const reordered = [...list];
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    const ids = [...reordered, ...channels.filter((c) => c.archived)].map((c) => c.id);

    setChannels([...reordered, ...channels.filter((c) => c.archived)]);
    try {
      const res = await fetch('/api/budget-channels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error();
      setChannels(((await res.json()).channels as AdminChannel[]) ?? []);
      void refresh();
    } catch {
      toast.error('Could not save that order');
      void load();
    }
  }

  const active = useMemo(() => (channels ?? []).filter((c) => !c.archived), [channels]);
  const archived = useMemo(() => (channels ?? []).filter((c) => c.archived), [channels]);

  /** Display groups that exist, so "new channel" offers them before free text. */
  const groups = useMemo(() => [...new Set(active.map((c) => c.category))], [active]);

  const cardOptions: SelectOption[] = useMemo(
    () => [
      { value: NONE, label: 'No rate card' },
      ...cards.map((c) => ({ value: c.key, label: c.label })),
    ],
    [cards],
  );
  const lineTypeOptions: SelectOption[] = LINE_TYPES.map((t) => ({
    value: t.key,
    label: t.label,
  }));
  const pacerOptions: SelectOption[] = [
    { value: NONE, label: 'Settles by hand' },
    ...PACER_PLATFORMS.map((p) => ({ value: p, label: p === 'meta' ? 'Meta' : 'Google' })),
  ];
  const groupOptions: SelectOption[] = groups.map((g) => ({ value: g, label: g }));
  /** Task kinds, for the per-channel intake picker. Kinds are code. */
  const kindOptions = useMemo(
    () => KIND_OPTIONS.map((k) => ({ value: k.key, label: k.label })),
    [],
  );

  if (!channels) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-[var(--muted-foreground)]">Loading channels…</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-4">
      <section className="glass-section-card rounded-xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Budget Channels</h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--muted-foreground)]">
              What money can be spent on. A channel carries the rate card it bills at, the kind of
              money it is, and whether the Ad Pacer reconciles it. Renaming one is safe — budget
              lines reference its key, not its name — but nothing already committed changes.
            </p>
          </div>
          {!adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] transition hover:border-[var(--primary)]"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Add channel
            </button>
          )}
        </div>

        {adding && (
          <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-[var(--primary)]/50 bg-[var(--primary)]/5 px-3 py-3">
            <div className="min-w-[180px] flex-1">
              <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
                Name
              </label>
              <input
                autoFocus
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Podcast"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div className="min-w-[160px]">
              <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
                Display group
              </label>
              {/* Pick an existing group, or name a new one — a group only
                  exists because a channel is in it, so creating one has to be
                  possible here. Was a native <datalist>, which paints an OS
                  dropdown that ignores the theme entirely. */}
              {newGroupIsCustom ? (
                <input
                  autoFocus
                  value={newGroup}
                  onChange={(e) => setNewGroup(e.target.value)}
                  placeholder="New group name"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                />
              ) : (
                <Select
                  value={newGroup}
                  onChange={(v) => {
                    if (v === NEW_GROUP) {
                      setNewGroupIsCustom(true);
                      setNewGroup('');
                    } else {
                      setNewGroup(v);
                    }
                  }}
                  options={[
                    ...groups.map((g) => ({ value: g, label: g })),
                    { value: NEW_GROUP, label: '+ New group…' },
                  ]}
                  previewFont={false}
                  placeholder="Pick a group"
                  ariaLabel="Display group"
                />
              )}
            </div>
            <p className="min-w-[200px] flex-1 text-[11px] leading-4 text-[var(--muted-foreground)]">
              Rate card, line type, pacing and which task kinds can spend on it are set on the
              row once it exists.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setNewLabel('');
                  setNewGroup('');
                  setNewGroupIsCustom(false);
                }}
                className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] transition hover:bg-[var(--muted)]"
              >
                Cancel
              </button>
              <PrimaryButton onClick={() => void create()} disabled={busy === 'new'}>
                {busy === 'new' ? 'Adding…' : 'Add'}
              </PrimaryButton>
            </div>
          </div>
        )}

        <div className="mt-5 space-y-5">
          {groups.map((group) => (
            <div key={group}>
              <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                {group}
              </p>
              <div className="space-y-1.5">
                {active
                  .filter((c) => c.category === group)
                  .map((channel) => {
                    const i = active.findIndex((c) => c.id === channel.id);
                    const lines = lineCounts[channel.key] ?? 0;
                    return (
                      <div
                        key={channel.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-3 py-2.5"
                      >
                        <div className="flex flex-shrink-0 flex-col">
                          <button
                            type="button"
                            aria-label={`Move ${channel.label} up`}
                            disabled={i === 0}
                            onClick={() => void move(channel, -1)}
                            className="rounded p-0.5 text-[var(--muted-foreground)] transition hover:text-[var(--foreground)] disabled:opacity-20"
                          >
                            <ArrowUpIcon className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${channel.label} down`}
                            disabled={i === active.length - 1}
                            onClick={() => void move(channel, 1)}
                            className="rounded p-0.5 text-[var(--muted-foreground)] transition hover:text-[var(--foreground)] disabled:opacity-20"
                          >
                            <ArrowDownIcon className="h-3 w-3" />
                          </button>
                        </div>

                        <ChannelIcon
                          channel={channel.key}
                          className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]"
                        />

                        <div className="min-w-[150px] flex-1">
                          <input
                            value={labelDrafts[channel.id] ?? ''}
                            onChange={(e) =>
                              setLabelDrafts((l) => ({ ...l, [channel.id]: e.target.value }))
                            }
                            onBlur={() => {
                              const next = (labelDrafts[channel.id] ?? '').trim();
                              if (next && next !== channel.label) {
                                void patch(channel, { label: next }, `Renamed to ${next}`);
                              }
                            }}
                            aria-label={`${channel.label} name`}
                            className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium text-[var(--foreground)] outline-none transition hover:border-[var(--border)] focus:border-[var(--primary)] focus:bg-[var(--input)]"
                          />
                          <p className="truncate px-1.5 text-[10px] font-mono text-[var(--muted-foreground)]">
                            {channel.key}
                            {lines > 0 && ` · ${lines} line${lines === 1 ? '' : 's'}`}
                          </p>
                        </div>

                        <div className="w-[140px]">
                          <Select
                            value={channel.category}
                            onChange={(v) => void patch(channel, { category: v })}
                            options={groupOptions}
                            previewFont={false}
                            ariaLabel={`${channel.label} display group`}
                          />
                        </div>

                        <div className="w-[150px]">
                          <Select
                            value={channel.lineType}
                            onChange={(v) => void patch(channel, { lineType: v })}
                            options={lineTypeOptions}
                            previewFont={false}
                            ariaLabel={`${channel.label} line type`}
                          />
                        </div>

                        <div className="w-[150px]">
                          <Select
                            value={channel.billingKey ?? NONE}
                            onChange={(v) => void patch(channel, { billingKey: v || null })}
                            options={cardOptions}
                            previewFont={false}
                            ariaLabel={`${channel.label} rate card`}
                          />
                        </div>

                        <div className="w-[140px]">
                          <Select
                            value={channel.pacer ?? NONE}
                            onChange={(v) => void patch(channel, { pacer: v || null })}
                            options={pacerOptions}
                            previewFont={false}
                            ariaLabel={`${channel.label} pacer platform`}
                          />
                        </div>

                        {/* Which task kinds may spend on this channel — the
                            editable form of the old KIND_BUDGET_CHANNELS map.
                            Empty means it's offered at intake nowhere, which is
                            the honest state for most of the 58: the hub needs
                            them all to reconcile, a rep picks a handful. */}
                        <div className="w-[190px]">
                          <MultiSelect
                            value={channel.intakeKinds}
                            onChange={(v) => void patch(channel, { intakeKinds: v })}
                            options={kindOptions}
                            placeholder="No intake"
                            // Above the settings modal's own z-260 layer.
                            menuZIndex={300}
                          />
                        </div>

                        <Tooltip
                          label={
                            lines > 0
                              ? `Retires it from the pickers. The ${lines} line${lines === 1 ? '' : 's'} already on it keep their channel and their frozen rate.`
                              : 'Retires it from the pickers. Nothing references it yet.'
                          }
                        >
                          <button
                            type="button"
                            disabled={busy === channel.id}
                            onClick={() =>
                              void patch(channel, { archived: true }, `${channel.label} archived`)
                            }
                            aria-label={`Archive ${channel.label}`}
                            className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-30"
                          >
                            <ArchiveBoxIcon className="h-4 w-4" />
                          </button>
                        </Tooltip>
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {archived.length > 0 && (
        <section className="glass-section-card rounded-xl p-6">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="text-sm font-semibold text-[var(--foreground)]"
          >
            Archived ({archived.length})
          </button>
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
            An archived channel stops being offered anywhere, but every line already on it still
            renders, reconciles and reports. That&rsquo;s why these are archived and not deleted.
          </p>
          {showArchived && (
            <div className="mt-3 space-y-2">
              {archived.map((channel) => (
                <div
                  key={channel.id}
                  className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2"
                >
                  <ChannelIcon
                    channel={channel.key}
                    className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]"
                  />
                  <span className="flex-1 text-sm text-[var(--muted-foreground)]">
                    {channel.label}
                  </span>
                  <span className="text-[11px] text-[var(--muted-foreground)]">
                    {(lineCounts[channel.key] ?? 0) > 0
                      ? `${lineCounts[channel.key]} lines`
                      : 'no lines'}
                  </span>
                  <button
                    type="button"
                    disabled={busy === channel.id}
                    onClick={() =>
                      void patch(channel, { archived: false }, `${channel.label} restored`)
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium transition hover:border-[var(--primary)] disabled:opacity-30"
                  >
                    <ArrowPathIcon className="h-3.5 w-3.5" />
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
