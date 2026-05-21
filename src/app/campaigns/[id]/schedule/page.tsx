'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ClockIcon,
  EnvelopeIcon,
  PaperAirplaneIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { useAccount } from '@/contexts/account-context';
import type { Contact } from '@/components/contacts/contacts-table';
import { evaluateFilter } from '@/lib/smart-list-engine';
import type { FilterDefinition } from '@/lib/smart-list-types';
import PrimaryButton from '@/components/primary-button';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface DraftCampaign {
  id: string;
  name: string;
  status: string;
  accountKeys: string[];
  subject: string;
  previewText: string;
  htmlContent: string;
  sourceAudienceId: string;
  sourceFilter: string;
}

type SendMode = 'now' | 'later';

function toLocalDateTimeInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDateTime(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  return value.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

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

export default function ScheduleStepPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);
  const { accounts } = useAccount();

  const [draft, setDraft] = useState<DraftCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);

  const [sendMode, setSendMode] = useState<SendMode>('later');
  const [sendAtLocal, setSendAtLocal] = useState(
    toLocalDateTimeInputValue(new Date(Date.now() + 30 * 60_000)),
  );
  const [submitting, setSubmitting] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/email/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load campaign'))))
      .then((data: { campaign?: DraftCampaign }) => {
        if (cancelled) return;
        if (!data.campaign) {
          toast.error('Campaign not found');
          router.push('/messaging/campaigns');
          return;
        }
        setDraft(data.campaign);
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

  const accountKey = draft?.accountKeys[0] || '';
  const account = accountKey ? accounts[accountKey] : null;

  // Load contacts for this account so we can resolve the audience to a
  // concrete recipient list at submit time.
  useEffect(() => {
    if (!accountKey) return;
    let cancelled = false;
    setContactsLoading(true);
    fetch(`/api/esp/contacts?accountKey=${encodeURIComponent(accountKey)}&all=true`)
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
  }, [accountKey]);

  // Resolve audience → list of sendable recipients.
  const recipients = useMemo(() => {
    if (!draft) return [] as { contactId: string; accountKey: string; email: string; fullName: string }[];
    const filter = draft.sourceFilter ? parseFilterDefinition(draft.sourceFilter) : null;
    const sendable = contacts.filter((c) =>
      Boolean(c.id && isValidEmail(String(c.email || '').trim())),
    );
    const matched = filter ? evaluateFilter(sendable, filter) : sendable;
    return matched.map((c) => ({
      contactId: String(c.id).trim(),
      accountKey,
      email: String(c.email || '').trim(),
      fullName: String(c.fullName || '').trim(),
    }));
  }, [draft, contacts, accountKey]);

  async function handleSchedule() {
    if (!draft) return;
    if (recipients.length === 0) {
      toast.error('No recipients to send to.');
      return;
    }

    let scheduledFor: string | null = null;
    if (sendMode === 'later') {
      const date = new Date(sendAtLocal);
      if (Number.isNaN(date.getTime())) {
        toast.error('Pick a valid send date and time.');
        return;
      }
      if (date.getTime() <= Date.now() + 30_000) {
        toast.error('Send time must be in the future.');
        return;
      }
      scheduledFor = date.toISOString();
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/campaigns/email/${encodeURIComponent(draft.id)}/schedule`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipients, scheduledFor }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to schedule campaign');
      }
      toast.success(
        sendMode === 'now'
          ? 'Campaign queued — will start sending in the next minute.'
          : `Campaign scheduled for ${formatDateTime(scheduledFor!)}`,
      );
      router.push('/messaging/campaigns');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to schedule campaign');
    } finally {
      setSubmitting(false);
    }
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

  const fromName = account?.senderName || account?.dealer || '';
  const fromEmail = account?.senderEmail || '';

  return (
    <div className="pb-32">
      <div className="max-w-7xl mx-auto py-8 px-6">
        <div className="mb-6">
          <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">
            Schedule
          </p>
          <h1 className="text-2xl font-bold">{draft?.name || 'Campaign'}</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1.5">
            Review the email and choose when this campaign should send.
          </p>
        </div>

        {/* Two-column: scheduling details on the left, sticky preview on
            the right so the user can keep eyes on the final email while
            picking a send time. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(440px,540px)] gap-6 items-start">
          {/* Left: summary + scheduling + checklist */}
          <div className="space-y-5 min-w-0">
            <div className="glass-section-card rounded-2xl p-5 border border-[var(--border)]">
              <p className="text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-4">
                Summary
              </p>

              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center flex-shrink-0">
                    <UsersIcon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                      Recipients
                    </p>
                    <p className="text-2xl font-bold tabular-nums mt-0.5">
                      {contactsLoading ? (
                        <ArrowPathIcon className="w-5 h-5 inline animate-spin text-[var(--muted-foreground)]" />
                      ) : (
                        recipients.length.toLocaleString()
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 pt-3 border-t border-[var(--border)]">
                  <div className="w-9 h-9 rounded-lg bg-[var(--muted)] text-[var(--muted-foreground)] flex items-center justify-center flex-shrink-0">
                    <EnvelopeIcon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                      Subject
                    </p>
                    <p className="text-sm font-medium mt-0.5 truncate">
                      {draft?.subject || (
                        <span className="text-[var(--muted-foreground)] italic">Not set</span>
                      )}
                    </p>
                    {draft?.previewText && (
                      <p className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">
                        {draft.previewText}
                      </p>
                    )}
                  </div>
                </div>

                <div className="pt-3 border-t border-[var(--border)]">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-1.5">
                    From
                  </p>
                  <p className="text-sm font-medium">
                    {fromName || <span className="text-[var(--muted-foreground)] italic">Not set</span>}
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {fromEmail || (
                      <span className="italic">Configure in Sending settings</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right: schedule controls */}
          <div className="space-y-5">
            <div className="glass-section-card rounded-2xl p-6 border border-[var(--border)]">
              <h3 className="text-base font-semibold mb-4">When should this send?</h3>

              <div className="space-y-3">
                <SendModeOption
                  active={sendMode === 'now'}
                  onClick={() => setSendMode('now')}
                  icon={PaperAirplaneIcon}
                  title="Send now"
                  description="Queue immediately. Sending starts within ~1 minute."
                />
                <SendModeOption
                  active={sendMode === 'later'}
                  onClick={() => setSendMode('later')}
                  icon={ClockIcon}
                  title="Schedule for later"
                  description="Pick a specific date and time. Loomi fires it then."
                />
              </div>

              {sendMode === 'later' && (
                <div className="mt-5 pt-5 border-t border-[var(--border)]">
                  <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
                    Send Date &amp; Time
                  </label>
                  <div className="relative">
                    <CalendarDaysIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] pointer-events-none" />
                    <input
                      type="datetime-local"
                      value={sendAtLocal}
                      min={toLocalDateTimeInputValue(new Date())}
                      onChange={(e) => setSendAtLocal(e.target.value)}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
                    />
                  </div>
                  <p className="text-[11px] text-[var(--muted-foreground)] mt-2">
                    Will send {sendAtLocal ? formatDateTime(new Date(sendAtLocal).toISOString()) : '—'}
                  </p>
                </div>
              )}
            </div>

            <div className="glass-section-card rounded-2xl p-5 border border-[var(--border)]">
              <h3 className="text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-3">
                Pre-flight checklist
              </h3>
              <ul className="space-y-2 text-sm">
                <ChecklistItem
                  ok={Boolean(draft?.subject?.trim())}
                  label="Subject line is set"
                />
                <ChecklistItem
                  ok={Boolean(draft?.htmlContent?.trim())}
                  label="Template content is loaded"
                />
                <ChecklistItem
                  ok={Boolean(fromEmail)}
                  label="Sender email configured in Sending settings"
                />
                <ChecklistItem
                  ok={recipients.length > 0}
                  label={`${recipients.length.toLocaleString()} sendable recipient${recipients.length === 1 ? '' : 's'}`}
                />
              </ul>
            </div>
          </div>

          {/* Sticky preview column — keeps the final email visible
              while the user picks a send time. */}
          <div className="lg:sticky lg:top-20">
            <div className="glass-section-card rounded-2xl border border-[var(--border)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
                <EnvelopeIcon className="w-4 h-4 text-[var(--muted-foreground)]" />
                <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                  Email preview
                </p>
              </div>
              <div className="bg-[var(--muted)]/30 p-4">
                {draft?.htmlContent ? (
                  <div className="bg-white rounded-lg border border-[var(--border)] overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50 text-xs text-gray-700">
                      <div className="truncate">
                        <span className="font-medium">Subject:</span>{' '}
                        {draft.subject || (
                          <span className="text-gray-400 italic">No subject set</span>
                        )}
                      </div>
                      {draft.previewText && (
                        <div className="truncate text-gray-500 mt-0.5">{draft.previewText}</div>
                      )}
                    </div>
                    <iframe
                      title="Email preview"
                      srcDoc={draft.htmlContent}
                      sandbox=""
                      className="w-full bg-white border-0"
                      style={{ height: 560 }}
                    />
                  </div>
                ) : (
                  <div className="py-16 text-center text-[var(--muted-foreground)]">
                    <EnvelopeIcon className="w-10 h-10 mx-auto opacity-40 mb-2" />
                    <p className="text-sm">No email template loaded yet.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-[var(--card)]/80 backdrop-blur-md border-t border-[var(--border)] z-40">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => router.push(`/campaigns/${encodeURIComponent(id)}/template`)}
            className="inline-flex items-center gap-1.5 px-4 h-10 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)]"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back
          </button>

          <PrimaryButton
            onClick={handleSchedule}
            disabled={
              submitting ||
              contactsLoading ||
              recipients.length === 0 ||
              !draft?.subject?.trim() ||
              !draft?.htmlContent?.trim()
            }
          >
            <PaperAirplaneIcon className="w-4 h-4" />
            {submitting
              ? 'Scheduling…'
              : sendMode === 'now'
                ? 'Send now'
                : 'Schedule send'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function SendModeOption({
  active,
  onClick,
  icon: Icon,
  title,
  description,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border-2 p-4 flex items-start gap-3 text-left transition-all ${
        active
          ? 'border-[var(--primary)] bg-[var(--primary)]/[0.05]'
          : 'border-[var(--border)] hover:border-[var(--muted-foreground)]'
      }`}
    >
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
          active
            ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
            : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
        }`}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--foreground)]">{title}</p>
        <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{description}</p>
      </div>
      {active && (
        <CheckCircleIcon className="w-5 h-5 text-[var(--primary)] flex-shrink-0" />
      )}
    </button>
  );
}

function ChecklistItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <CheckCircleIcon
        className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
          ok ? 'text-emerald-300' : 'text-[var(--muted-foreground)] opacity-40'
        }`}
      />
      <span
        className={`text-sm ${ok ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)]'}`}
      >
        {label}
      </span>
    </li>
  );
}
