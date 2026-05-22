'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Contact } from '@/lib/contacts/types';
import { evaluateFilter } from '@/lib/smart-list-engine';
import { LIFECYCLE_PRESETS } from '@/lib/smart-list-presets';
import type { FilterDefinition } from '@/lib/smart-list-types';
import {
  ArrowPathIcon,
  ChevronRightIcon,
  EnvelopeIcon,
  RectangleStackIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import PrimaryButton from '@/components/primary-button';

type EmailCampaignSourceType = 'template-library' | 'drag-drop' | 'html';

type AudienceOption =
  | { key: 'all'; label: string; definition: null }
  | { key: `preset:${string}`; label: string; definition: FilterDefinition }
  | { key: `audience:${string}`; label: string; definition: FilterDefinition };

interface EmailTemplateApiRecord {
  id: string;
  accountKey?: string;
  name?: string;
  content?: string | null;
  account?: {
    key?: string;
    dealer?: string;
  };
  template?: {
    slug?: string;
    title?: string;
  };
}

interface EmailTemplateOption {
  id: string;
  accountKey: string;
  label: string;
  content: string;
  templateSlug: string;
}

interface SavedAudienceRecord {
  id: string;
  name: string;
  filters: string;
}

interface EmailCampaignModalProps {
  open: boolean;
  onClose: () => void;
  contacts: Contact[];
  selectedAccountKeys: string[];
  mode?: 'email' | 'both';
  accountKey?: string | null;
  onRequestSmsModal?: () => void;
}

function toLocalDateTimeInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function parseAudienceDefinition(filters: string): FilterDefinition | null {
  try {
    const parsed = JSON.parse(filters) as FilterDefinition;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.groups)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeTemplateRecord(record: EmailTemplateApiRecord): EmailTemplateOption {
  const accountKey = String(record.accountKey || record.account?.key || '').trim();
  const accountLabel = String(record.account?.dealer || accountKey || 'Sub-Account').trim();
  const name = String(record.name || record.template?.title || 'Untitled template').trim();
  const templateSlug = String(record.template?.slug || '').trim();

  return {
    id: String(record.id || '').trim(),
    accountKey,
    label: `${name} · ${accountLabel}`,
    content: String(record.content || '').trim(),
    templateSlug,
  };
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value);
}

export function EmailCampaignModal({
  open,
  onClose,
  contacts,
  selectedAccountKeys,
  mode = 'email',
  accountKey = null,
  onRequestSmsModal,
}: EmailCampaignModalProps) {
  const [step, setStep] = useState<'source' | 'compose'>('source');
  const [sourceType, setSourceType] = useState<EmailCampaignSourceType>('template-library');
  const [campaignName, setCampaignName] = useState('');
  const [subject, setSubject] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [textContent, setTextContent] = useState('');
  const [scheduled, setScheduled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(toLocalDateTimeInputValue(new Date(Date.now() + 30 * 60_000)));
  const [audienceKey, setAudienceKey] = useState<AudienceOption['key']>('all');
  const [savedAudiences, setSavedAudiences] = useState<SavedAudienceRecord[]>([]);
  const [templateOptions, setTemplateOptions] = useState<EmailTemplateOption[]>([]);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!open) return;

    setStep('source');
    setSourceType('template-library');
    setCampaignName('');
    setSubject('');
    setPreviewText('');
    setHtmlContent('');
    setTextContent('');
    setScheduled(false);
    setScheduledAt(toLocalDateTimeInputValue(new Date(Date.now() + 30 * 60_000)));
    setAudienceKey('all');
    setSelectedTemplateId('');
    setError('');
    setSuccess('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !sending) onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, sending, onClose]);

  useEffect(() => {
    if (!open) return;

    fetch('/api/audiences')
      .then((res) => (res.ok ? res.json() : { audiences: [] }))
      .then((data) => setSavedAudiences(Array.isArray(data?.audiences) ? data.audiences : []))
      .catch(() => setSavedAudiences([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (sourceType !== 'template-library') return;

    let cancelled = false;
    setTemplateLoading(true);

    const query = accountKey ? `?accountKey=${encodeURIComponent(accountKey)}` : '';
    fetch(`/api/emails${query}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: EmailTemplateApiRecord[]) => {
        if (cancelled || !Array.isArray(rows)) return;
        const normalized = rows
          .map(normalizeTemplateRecord)
          .filter((row) => row.id && (!selectedAccountKeys.length || selectedAccountKeys.includes(row.accountKey)))
          .sort((a, b) => a.label.localeCompare(b.label));
        setTemplateOptions(normalized);
      })
      .catch(() => {
        if (!cancelled) setTemplateOptions([]);
      })
      .finally(() => {
        if (!cancelled) setTemplateLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, sourceType, accountKey, selectedAccountKeys]);

  const audienceOptions = useMemo<AudienceOption[]>(() => {
    const options: AudienceOption[] = [
      { key: 'all', label: 'All contacts in current account filter', definition: null },
    ];

    for (const preset of LIFECYCLE_PRESETS) {
      options.push({
        key: `preset:${preset.id}`,
        label: `Lifecycle · ${preset.name}`,
        definition: preset.definition,
      });
    }

    for (const audience of savedAudiences) {
      const definition = parseAudienceDefinition(audience.filters);
      if (!definition) continue;
      options.push({
        key: `audience:${audience.id}`,
        label: `Custom · ${audience.name}`,
        definition,
      });
    }

    return options;
  }, [savedAudiences]);

  const baseContacts = useMemo(
    () =>
      contacts.filter((contact) => {
        if (!contact._accountKey) return false;
        if (selectedAccountKeys.length === 0) return true;
        return selectedAccountKeys.includes(contact._accountKey);
      }),
    [contacts, selectedAccountKeys],
  );

  const selectedAudience = useMemo(
    () => audienceOptions.find((option) => option.key === audienceKey) || audienceOptions[0],
    [audienceOptions, audienceKey],
  );

  const audienceContacts = useMemo(() => {
    if (!selectedAudience || !selectedAudience.definition) return baseContacts;
    return evaluateFilter(baseContacts, selectedAudience.definition);
  }, [baseContacts, selectedAudience]);

  const recipients = useMemo(
    () =>
      audienceContacts
        .filter((contact) => Boolean(contact.id && contact._accountKey && isValidEmail(String(contact.email || '').trim())))
        .map((contact) => ({
          contactId: contact.id,
          accountKey: contact._accountKey as string,
          email: String(contact.email || '').trim(),
          fullName: contact.fullName || `${contact.firstName} ${contact.lastName}`.trim(),
        })),
    [audienceContacts],
  );

  useEffect(() => {
    if (sourceType === 'template-library' && templateOptions.length > 0 && !selectedTemplateId) {
      setSelectedTemplateId(templateOptions[0].id);
    }
  }, [sourceType, templateOptions, selectedTemplateId]);

  useEffect(() => {
    if (sourceType !== 'drag-drop') return;
    if (htmlContent.trim()) return;
    setHtmlContent(
      `<div style="font-family:Arial,sans-serif;padding:24px;">
  <h1 style="margin:0 0 12px;">Headline</h1>
  <p style="margin:0 0 16px;line-height:1.5;">Write the primary campaign message here.</p>
  <a href="#" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">Primary CTA</a>
</div>`,
    );
  }, [sourceType, htmlContent]);

  useEffect(() => {
    if (sourceType !== 'html') return;
    if (htmlContent.trim()) return;
    setHtmlContent('<html><body><p>Hello {{contact.first_name}},</p><p>Your message goes here.</p></body></html>');
  }, [sourceType, htmlContent]);

  useEffect(() => {
    if (sourceType !== 'template-library') return;
    const selected = templateOptions.find((option) => option.id === selectedTemplateId);
    if (!selected) return;
    if (!htmlContent.trim()) {
      if (selected.content) {
        setHtmlContent(selected.content);
      } else if (selected.templateSlug) {
        setHtmlContent(
          `<div style="font-family:Arial,sans-serif;padding:24px;"><h2>${selected.label}</h2><p>Start editing this campaign template HTML.</p></div>`,
        );
      }
    }
    if (!subject.trim()) {
      setSubject(selected.label.split(' · ')[0] || 'Loomi Campaign');
    }
  }, [sourceType, templateOptions, selectedTemplateId, htmlContent, subject]);

  if (!open) return null;

  async function submitCampaign() {
    if (!subject.trim()) {
      setError('Subject is required.');
      return;
    }
    if (!htmlContent.trim()) {
      setError('Email HTML is required.');
      return;
    }
    if (recipients.length === 0) {
      setError('No contacts with valid email addresses match this audience.');
      return;
    }

    let scheduledIso = '';
    if (scheduled) {
      const parsed = new Date(scheduledAt);
      if (Number.isNaN(parsed.getTime())) {
        setError('Choose a valid scheduled time.');
        return;
      }
      scheduledIso = parsed.toISOString();
    }

    setSending(true);
    setError('');
    setSuccess('');

    try {
      const processNow = !scheduledIso || new Date(scheduledIso).getTime() <= Date.now();
      const res = await fetch('/api/campaigns/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: campaignName.trim() || `Email Campaign ${new Date().toLocaleDateString('en-US')}`,
          subject: subject.trim(),
          previewText: previewText.trim(),
          htmlContent,
          textContent: textContent.trim(),
          sourceType,
          recipients,
          scheduledFor: scheduledIso || null,
          processNow,
          audienceId: audienceKey === 'all' ? null : audienceKey.split(':')[1],
          metadata: JSON.stringify({
            audienceKey,
            audienceLabel: selectedAudience?.label || 'All contacts',
            mode,
          }),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to create email campaign');
      }

      if (scheduledIso) {
        const scheduledDate = new Date(scheduledIso);
        setSuccess(`Email campaign scheduled for ${scheduledDate.toLocaleString('en-US')}.`);
      } else {
        const sentCount = Number(data?.campaign?.sentCount || 0);
        setSuccess(`Email campaign sent to ${sentCount.toLocaleString()} contact${sentCount === 1 ? '' : 's'}.`);
      }

      if (mode === 'both' && onRequestSmsModal) {
        setTimeout(() => {
          onClose();
          onRequestSmsModal();
        }, 650);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create email campaign');
    } finally {
      setSending(false);
    }
  }

  const sourceCards: Array<{
    key: EmailCampaignSourceType;
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      key: 'template-library',
      title: 'Template Library',
      description: 'Start from an existing Loomi template.',
      icon: RectangleStackIcon,
    },
    {
      key: 'drag-drop',
      title: 'New Drag and Drop',
      description: 'Start from a blank visual template scaffold.',
      icon: SparklesIcon,
    },
    {
      key: 'html',
      title: 'HTML Email',
      description: 'Paste fully custom HTML.',
      icon: EnvelopeIcon,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[95] bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={() => {
        if (!sending) onClose();
      }}
    >
      <div
        className="glass-modal w-full max-w-3xl max-h-[90vh] overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">
              {mode === 'both' ? 'Create Email + SMS/MMS Campaign' : 'Create Email Campaign'}
            </h3>
            <p className="text-xs text-[var(--muted-foreground)] mt-1">
              {step === 'source'
                ? 'Choose how you want to build this campaign email.'
                : 'Set audience, content, and send timing.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-50"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        {step === 'source' ? (
          <div className="p-5 space-y-4">
            <div className="grid sm:grid-cols-3 gap-3">
              {sourceCards.map((card) => {
                const Icon = card.icon;
                const selected = sourceType === card.key;
                return (
                  <button
                    key={card.key}
                    type="button"
                    onClick={() => setSourceType(card.key)}
                    className={`text-left rounded-xl border p-4 transition-colors ${
                      selected
                        ? 'border-[var(--primary)] bg-[var(--primary)]/10'
                        : 'border-[var(--border)] hover:border-[var(--primary)]/45'
                    }`}
                  >
                    <Icon className={`w-5 h-5 mb-2 ${selected ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]'}`} />
                    <p className="text-sm font-medium">{card.title}</p>
                    <p className="text-xs text-[var(--muted-foreground)] mt-1 leading-relaxed">{card.description}</p>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 text-xs rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                Cancel
              </button>
              <PrimaryButton
                type="button"
                onClick={() => setStep('compose')}
              >
                Continue
                <ChevronRightIcon className="w-3.5 h-3.5" />
              </PrimaryButton>
            </div>
          </div>
        ) : (
          <div className="max-h-[calc(90vh-72px)] overflow-y-auto">
            <div className="p-5 space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--muted-foreground)] mb-1.5">
                    Campaign Name
                  </label>
                  <input
                    value={campaignName}
                    onChange={(event) => setCampaignName(event.target.value)}
                    placeholder="Spring Service Offer"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[var(--muted-foreground)] mb-1.5">
                    Audience
                  </label>
                  <select
                    value={audienceKey}
                    onChange={(event) => setAudienceKey(event.target.value as AudienceOption['key'])}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)]"
                  >
                    {audienceOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">Base Contacts</p>
                  <p className="text-sm font-medium mt-1">{baseContacts.length.toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">Audience Match</p>
                  <p className="text-sm font-medium mt-1">{audienceContacts.length.toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">Sendable Emails</p>
                  <p className="text-sm font-medium mt-1">{recipients.length.toLocaleString()}</p>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--muted-foreground)] mb-1.5">
                    Subject Line
                  </label>
                  <input
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                    placeholder="Your next service is due"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[var(--muted-foreground)] mb-1.5">
                    Preview Text
                  </label>
                  <input
                    value={previewText}
                    onChange={(event) => setPreviewText(event.target.value)}
                    placeholder="Lock in your appointment this week."
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>

              {sourceType === 'template-library' && (
                <div>
                  <label className="block text-[11px] font-medium text-[var(--muted-foreground)] mb-1.5">
                    Template
                  </label>
                  {templateLoading ? (
                    <div className="h-10 rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 flex items-center px-3 text-xs text-[var(--muted-foreground)]">
                      Loading templates...
                    </div>
                  ) : templateOptions.length === 0 ? (
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-3 py-2 text-xs text-[var(--muted-foreground)]">
                      No template-library emails were found for the currently selected accounts.
                    </div>
                  ) : (
                    <select
                      value={selectedTemplateId}
                      onChange={(event) => {
                        setSelectedTemplateId(event.target.value);
                        setHtmlContent('');
                      }}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)]"
                    >
                      {templateOptions.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {sourceType === 'drag-drop' && (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/15 px-3 py-2.5 text-xs text-[var(--muted-foreground)]">
                  Use this starter scaffold, then customize the HTML below. You can also build a full visual template in
                  {' '}
                  <a href="/email/templates" className="text-[var(--primary)] hover:underline">
                    Templates
                  </a>
                  {' '}
                  and return here to schedule it.
                </div>
              )}

              <div>
                <label className="block text-[11px] font-medium text-[var(--muted-foreground)] mb-1.5">
                  Email HTML
                </label>
                <textarea
                  value={htmlContent}
                  onChange={(event) => setHtmlContent(event.target.value)}
                  placeholder="<html><body><h1>Hello</h1></body></html>"
                  rows={10}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-mono focus:outline-none focus:border-[var(--primary)]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[var(--muted-foreground)] mb-1.5">
                  Plain Text Fallback (optional)
                </label>
                <textarea
                  value={textContent}
                  onChange={(event) => setTextContent(event.target.value)}
                  rows={3}
                  placeholder="Plain text version..."
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs focus:outline-none focus:border-[var(--primary)]"
                />
              </div>

              <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/15 px-3 py-2.5">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={scheduled}
                    onChange={(event) => setScheduled(event.target.checked)}
                    className="rounded border-[var(--border)]"
                  />
                  Schedule for later
                </label>
                {scheduled && (
                  <div className="mt-2">
                    <label className="block text-[11px] text-[var(--muted-foreground)] mb-1">Send at</label>
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      min={toLocalDateTimeInputValue(new Date())}
                      onChange={(event) => setScheduledAt(event.target.value)}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-xs focus:outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                )}
              </div>

              {mode === 'both' && (
                <p className="text-xs text-[var(--muted-foreground)]">
                  After this email is created, the SMS/MMS composer will open so you can schedule the matching text campaign.
                </p>
              )}

              {error && <p className="text-xs text-red-300">{error}</p>}
              {success && !error && <p className="text-xs text-emerald-300">{success}</p>}
            </div>

            <div className="p-4 border-t border-[var(--border)] flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setStep('source')}
                disabled={sending}
                className="px-3 py-2 text-xs rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
              >
                Back
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={sending}
                  className="px-3 py-2 text-xs rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
                >
                  Cancel
                </button>
                <PrimaryButton
                  type="button"
                  onClick={submitCampaign}
                  disabled={sending || recipients.length === 0}
                >
                  {sending ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" /> : <EnvelopeIcon className="w-3.5 h-3.5" />}
                  {sending
                    ? 'Submitting...'
                    : scheduled
                      ? mode === 'both'
                        ? 'Schedule Email + Continue'
                        : 'Schedule Email'
                      : mode === 'both'
                        ? 'Send Email + Continue'
                        : 'Send Email'}
                </PrimaryButton>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
