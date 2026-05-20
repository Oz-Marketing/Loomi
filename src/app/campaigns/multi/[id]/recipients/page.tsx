'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ListBulletIcon,
  RectangleStackIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import type { Contact } from '@/components/contacts/contacts-table';
import { LIFECYCLE_PRESETS } from '@/lib/smart-list-presets';
import { evaluateFilter } from '@/lib/smart-list-engine';
import type { FilterDefinition } from '@/lib/smart-list-types';
import { isLikelyDialablePhone, normalizePhoneNumber } from '@/lib/contact-hygiene';
import { toast } from '@/lib/toast';
import PrimaryButton from '@/components/primary-button';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface EmailDraft {
  id: string;
  name: string;
  accountKeys: string[];
  sourceAudienceId: string;
  sourceFilter: string;
  metadata: string;
}

interface SavedAudience {
  id: string;
  name: string;
  filters: string;
  accountKey?: string | null;
}

type AudienceTab = 'lists' | 'segments';

type AudienceSelection =
  | { kind: 'all' }
  | { kind: 'segment'; id: string; name: string; filter: FilterDefinition };

function parseFilterDefinition(raw: string): FilterDefinition | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as FilterDefinition;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.groups)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value);
}

function parseLinkedSmsId(rawMetadata: string): string | null {
  if (!rawMetadata) return null;
  try {
    const parsed = JSON.parse(rawMetadata) as Record<string, unknown>;
    const value = parsed?.linkedSmsCampaignId;
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

export default function MultiRecipientsStepPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);
  const { isAccount, accountKey, accounts } = useAccount();

  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const [linkedSmsId, setLinkedSmsId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedAccountKey, setSelectedAccountKey] = useState('');
  const [tab, setTab] = useState<AudienceTab>('segments');
  const [selection, setSelection] = useState<AudienceSelection>({ kind: 'all' });

  const [savedAudiences, setSavedAudiences] = useState<SavedAudience[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/campaigns/email/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load campaign'))))
      .then((data: { campaign?: EmailDraft }) => {
        if (cancelled) return;
        const campaign = data.campaign;
        if (!campaign) {
          toast.error('Multi-channel campaign not found');
          router.push('/campaigns');
          return;
        }
        const smsId = parseLinkedSmsId(campaign.metadata || '');
        if (!smsId) {
          toast.error('Linked SMS draft missing — opening the email-only flow.');
          router.push(`/campaigns/${encodeURIComponent(id)}/recipients`);
          return;
        }
        setEmailDraft(campaign);
        setLinkedSmsId(smsId);
        if (campaign.accountKeys.length > 0) {
          setSelectedAccountKey(campaign.accountKeys[0]);
        }
        if (campaign.sourceAudienceId && campaign.sourceFilter) {
          const parsed = parseFilterDefinition(campaign.sourceFilter);
          if (parsed) {
            const preset = LIFECYCLE_PRESETS.find((p) => p.id === campaign.sourceAudienceId);
            setSelection({
              kind: 'segment',
              id: campaign.sourceAudienceId,
              name: preset?.name || 'Saved Segment',
              filter: parsed,
            });
          }
        }
      })
      .catch((err: Error) => {
        if (!cancelled) toast.error(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const accountOptions = useMemo(() => {
    const keys = isAccount && accountKey ? [accountKey] : Object.keys(accounts);
    return [...new Set(keys.filter(Boolean))]
      .map((k) => ({ key: k, dealer: accounts[k]?.dealer || k }))
      .sort((a, b) => a.dealer.localeCompare(b.dealer));
  }, [isAccount, accountKey, accounts]);

  useEffect(() => {
    if (!selectedAccountKey && accountOptions.length > 0) {
      setSelectedAccountKey(accountOptions[0].key);
    }
  }, [accountOptions, selectedAccountKey]);

  useEffect(() => {
    if (!selectedAccountKey) {
      setContacts([]);
      return;
    }
    let cancelled = false;
    setContactsLoading(true);
    fetch(`/api/esp/contacts?accountKey=${encodeURIComponent(selectedAccountKey)}&all=true`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to load contacts');
        return Array.isArray(data?.contacts) ? (data.contacts as Contact[]) : [];
      })
      .then((rows) => {
        if (!cancelled) setContacts(rows);
      })
      .catch(() => {
        if (!cancelled) setContacts([]);
      })
      .finally(() => {
        if (!cancelled) setContactsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAccountKey]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/audiences')
      .then((res) => (res.ok ? res.json() : { audiences: [] }))
      .then((data: { audiences?: SavedAudience[] }) => {
        if (cancelled) return;
        setSavedAudiences(Array.isArray(data.audiences) ? data.audiences : []);
      })
      .catch(() => {
        if (!cancelled) setSavedAudiences([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scopedAudiences = useMemo(
    () => savedAudiences.filter((a) => !a.accountKey || a.accountKey === selectedAccountKey),
    [savedAudiences, selectedAccountKey],
  );

  const { emailSendable, smsSendable } = useMemo(() => {
    if (contactsLoading) return { emailSendable: 0, smsSendable: 0 };
    const emailOk = contacts.filter((c) =>
      Boolean(c.id && isValidEmail(String(c.email || '').trim())),
    );
    const smsOk = contacts.filter((c) =>
      isLikelyDialablePhone(normalizePhoneNumber(String(c.phone || ''))),
    );
    if (selection.kind === 'all') {
      return { emailSendable: emailOk.length, smsSendable: smsOk.length };
    }
    return {
      emailSendable: evaluateFilter(emailOk, selection.filter).length,
      smsSendable: evaluateFilter(smsOk, selection.filter).length,
    };
  }, [contacts, contactsLoading, selection]);

  async function persistSelection() {
    if (!emailDraft || !linkedSmsId) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        accountKeys: [selectedAccountKey],
      };
      if (selection.kind === 'all') {
        payload.sourceAudienceId = null;
        payload.sourceFilter = null;
      } else {
        payload.sourceAudienceId = selection.id;
        payload.sourceFilter = JSON.stringify(selection.filter);
      }
      await Promise.all([
        fetch(`/api/campaigns/email/${encodeURIComponent(emailDraft.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        fetch(`/api/campaigns/sms/${encodeURIComponent(linkedSmsId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      ]);
    } finally {
      setSaving(false);
    }
  }

  async function handleContinue() {
    if (!emailDraft || !selectedAccountKey) return;
    try {
      await persistSelection();
      router.push(`/campaigns/multi/${encodeURIComponent(emailDraft.id)}/message`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save selection');
    }
  }

  async function handleBack() {
    if (emailDraft && linkedSmsId) {
      try {
        await persistSelection();
      } catch {
        // non-fatal
      }
    }
    router.push('/campaigns');
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto py-12 px-6">
        <p className="text-sm text-[var(--muted-foreground)] inline-flex items-center gap-2">
          <ArrowPathIcon className="w-4 h-4 animate-spin" />
          Loading campaign…
        </p>
      </div>
    );
  }

  const tabButton = (
    key: AudienceTab,
    label: string,
    icon: React.ComponentType<{ className?: string }>,
  ) => {
    const Icon = icon;
    const active = tab === key;
    return (
      <button
        type="button"
        onClick={() => setTab(key)}
        className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
          active
            ? 'border-[var(--primary)] text-[var(--foreground)]'
            : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
        }`}
      >
        <Icon className="w-4 h-4" />
        {label}
      </button>
    );
  };

  return (
    <div className="pb-32">
      <div className="max-w-5xl mx-auto py-8 px-6">
        <div className="mb-8 flex items-start justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">
              Recipients
            </p>
            <h1 className="text-2xl font-bold">{emailDraft?.name || 'Campaign'}</h1>
            <p className="text-sm text-[var(--muted-foreground)] mt-1.5">
              One audience for both channels. Email needs a valid address; SMS needs a dialable
              phone — counts shown for each.
            </p>
          </div>
          <div className="flex items-end gap-6 flex-shrink-0">
            <div className="text-right">
              <p className="text-3xl sm:text-4xl font-bold tabular-nums leading-none">
                {contactsLoading ? (
                  <ArrowPathIcon className="w-6 h-6 inline animate-spin text-[var(--muted-foreground)]" />
                ) : (
                  emailSendable.toLocaleString()
                )}
              </p>
              <p className="text-xs text-[var(--muted-foreground)] mt-1.5">Email recipients</p>
            </div>
            <div className="text-right">
              <p className="text-3xl sm:text-4xl font-bold tabular-nums leading-none">
                {contactsLoading ? (
                  <ArrowPathIcon className="w-6 h-6 inline animate-spin text-[var(--muted-foreground)]" />
                ) : (
                  smsSendable.toLocaleString()
                )}
              </p>
              <p className="text-xs text-[var(--muted-foreground)] mt-1.5">SMS recipients</p>
            </div>
          </div>
        </div>

        {accountOptions.length > 1 && !isAccount && (
          <div className="glass-section-card rounded-2xl p-5 border border-[var(--border)] mb-5">
            <label className="block text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-2">
              Sending Subaccount
            </label>
            <select
              value={selectedAccountKey}
              onChange={(e) => setSelectedAccountKey(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
            >
              {accountOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.dealer}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          type="button"
          onClick={() => setSelection({ kind: 'all' })}
          className={`w-full text-left rounded-2xl border-2 p-5 mb-5 flex items-start gap-4 transition-all ${
            selection.kind === 'all'
              ? 'border-[var(--primary)] bg-[var(--primary)]/[0.05]'
              : 'border-[var(--border)] hover:border-[var(--muted-foreground)]'
          }`}
        >
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
              selection.kind === 'all'
                ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
            }`}
          >
            <UsersIcon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--foreground)]">All Contacts</p>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Send to every deliverable contact in this subaccount. Email and SMS will resolve
              to their respective sendable subsets at send time.
            </p>
          </div>
          {selection.kind === 'all' && (
            <CheckCircleIcon className="w-5 h-5 text-[var(--primary)] flex-shrink-0" />
          )}
        </button>

        <div className="glass-section-card rounded-2xl border border-[var(--border)] overflow-hidden">
          <div className="border-b border-[var(--border)] flex items-center gap-1 px-5">
            {tabButton('lists', 'Lists', ListBulletIcon)}
            {tabButton('segments', 'Segments', RectangleStackIcon)}
          </div>
          <div className="p-5">
            {tab === 'lists' && (
              <div className="py-8 text-center">
                <ListBulletIcon className="w-10 h-10 text-[var(--muted-foreground)] mx-auto mb-3 opacity-50" />
                <p className="text-sm font-medium">Lists are coming with the local contact store</p>
              </div>
            )}
            {tab === 'segments' && (
              <div className="space-y-5">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold mb-2.5">
                    Pre-built
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {LIFECYCLE_PRESETS.map((preset) => {
                      const active = selection.kind === 'segment' && selection.id === preset.id;
                      return (
                        <AudienceCard
                          key={preset.id}
                          title={preset.name}
                          subtitle={preset.description}
                          active={active}
                          onClick={() =>
                            setSelection({
                              kind: 'segment',
                              id: preset.id,
                              name: preset.name,
                              filter: preset.definition,
                            })
                          }
                        />
                      );
                    })}
                  </div>
                </div>
                {scopedAudiences.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold mb-2.5">
                      Saved
                    </p>
                    <div className="space-y-2">
                      {scopedAudiences.map((a) => {
                        const filter = parseFilterDefinition(a.filters);
                        if (!filter) return null;
                        const active = selection.kind === 'segment' && selection.id === a.id;
                        return (
                          <AudienceCard
                            key={a.id}
                            title={a.name}
                            subtitle="Custom segment"
                            active={active}
                            onClick={() =>
                              setSelection({ kind: 'segment', id: a.id, name: a.name, filter })
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-[var(--card)]/80 backdrop-blur-md border-t border-[var(--border)] z-40">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-1.5 px-4 h-10 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)]"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back
          </button>
          <PrimaryButton
            onClick={handleContinue}
            disabled={!selectedAccountKey || saving || contactsLoading}
          >
            {saving ? 'Saving…' : 'Continue'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function AudienceCard({
  title,
  subtitle,
  active,
  onClick,
}: {
  title: string;
  subtitle: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl border-2 p-4 flex items-start gap-3 transition-all ${
        active
          ? 'border-[var(--primary)] bg-[var(--primary)]/[0.05]'
          : 'border-[var(--border)] hover:border-[var(--muted-foreground)]'
      }`}
    >
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
          active
            ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
            : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
        }`}
      >
        <RectangleStackIcon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--foreground)]">{title}</p>
        <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">{subtitle}</p>
      </div>
      {active && <CheckCircleIcon className="w-5 h-5 text-[var(--primary)] flex-shrink-0" />}
    </button>
  );
}
