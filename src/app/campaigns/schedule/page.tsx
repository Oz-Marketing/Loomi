'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAccount, type AccountData } from '@/contexts/account-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import type { Contact } from '@/components/contacts/contacts-table';
import { LIFECYCLE_PRESETS } from '@/lib/smart-list-presets';
import { evaluateFilter } from '@/lib/smart-list-engine';
import type { FilterDefinition } from '@/lib/smart-list-types';
import {
  resolveAccountAddress,
  resolveAccountCity,
  resolveAccountDealerName,
  resolveAccountEmail,
  resolveAccountPhone,
  resolveAccountPostalCode,
  resolveAccountProvider,
  resolveAccountState,
  resolveAccountWebsite,
} from '@/lib/account-resolvers';
import { providerDisplayName } from '@/lib/esp/provider-display';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  PaperAirplaneIcon,
  PencilSquareIcon,
  PlusIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';

interface TemplateRawResponse {
  raw?: string;
  slug?: string;
  error?: string;
}

interface TemplateLibraryItem {
  id: string;
  design: string;
  name: string;
  editorType?: string;
  type?: string;
  category?: string | null;
  published?: boolean;
  updatedAt?: string;
}

interface PreviewResponse {
  html?: string;
  error?: string;
}

interface ContactsResponse {
  contacts?: Contact[];
  error?: string;
}

interface AudiencesResponse {
  audiences?: SavedAudience[];
}

interface SavedAudience {
  id: string;
  name: string;
  filters: string;
  color?: string | null;
  accountKey?: string | null;
}

interface ScheduleResponse {
  ok?: boolean;
  scheduled?: {
    id?: string;
    scheduleId?: string;
    campaignId?: string;
    status?: string;
  };
  error?: string;
}

type AudienceOption = {
  key: string;
  label: string;
  definition: FilterDefinition | null;
  type: 'all' | 'lifecycle' | 'custom';
};

function toLocalDateTimeInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDateTime(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  return value.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function parseAudienceDefinition(filters: string): FilterDefinition | null {
  try {
    const parsed = JSON.parse(filters) as FilterDefinition;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.groups)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value);
}

function designToLabel(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');
}

function parseFrontmatterValue(raw: string, key: string): string {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return '';
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = match[1].match(new RegExp(`^${escaped}:\\s*(.+)$`, 'm'));
  if (!line) return '';
  return line[1].trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '');
}

function tokenKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) return trimmed;
  return `{{${trimmed.replace(/^\{+|\}+$/g, '')}}}`;
}

function buildAccountCompileValues(account: AccountData | null): Record<string, string> {
  if (!account) return {};

  const values: Record<string, string> = {};
  const dealerName = resolveAccountDealerName(account);
  const locationPhone = resolveAccountPhone(account);

  const setValue = (rawKey: string, rawValue: unknown) => {
    const key = tokenKey(rawKey);
    const value = String(rawValue ?? '').trim();
    if (!key || !value) return;
    values[key] = value;
  };

  setValue('location.name', dealerName);
  setValue('location.email', resolveAccountEmail(account));
  setValue('location.phone', locationPhone);
  setValue('location.address', resolveAccountAddress(account));
  setValue('location.city', resolveAccountCity(account));
  setValue('location.state', resolveAccountState(account));
  setValue('location.postal_code', resolveAccountPostalCode(account));
  setValue('location.website', resolveAccountWebsite(account));

  if (account.customValues) {
    for (const [fieldKey, customValue] of Object.entries(account.customValues)) {
      setValue(`custom_values.${fieldKey}`, customValue?.value || '');
    }
  }

  if (!values['{{custom_values.dealer_name}}']) {
    setValue('custom_values.dealer_name', dealerName);
  }
  if (!values['{{custom_values.crm_name}}']) {
    setValue('custom_values.crm_name', dealerName);
  }
  if (!values['{{custom_values.logo_url}}']) {
    setValue('custom_values.logo_url', account.logos?.light || account.logos?.dark || '');
  }
  if (!values['{{custom_values.website_url}}']) {
    setValue('custom_values.website_url', resolveAccountWebsite(account));
  }
  if (!values['{{custom_values.sales_phone}}']) {
    setValue('custom_values.sales_phone', account.phoneSales || account.salesPhone || locationPhone);
  }
  if (!values['{{custom_values.service_phone}}']) {
    setValue('custom_values.service_phone', account.phoneService || account.servicePhone || locationPhone);
  }
  if (!values['{{custom_values.parts_phone}}']) {
    setValue('custom_values.parts_phone', account.phoneParts || account.partsPhone || locationPhone);
  }

  if (account.previewValues && typeof account.previewValues === 'object') {
    for (const [rawKey, rawValue] of Object.entries(account.previewValues)) {
      const normalizedKey = rawKey.replace(/^\{\{|\}\}$/g, '').trim();
      if (!normalizedKey || normalizedKey.startsWith('contact.')) continue;
      setValue(normalizedKey, rawValue);
    }
  }

  return values;
}

export default function ScheduleCampaignPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAccount, accountKey, accounts } = useAccount();
  const subHref = useSubaccountHref();

  const design = (searchParams.get('design') || '').trim();
  const templateType = (searchParams.get('type') || 'template').trim();
  const builder = (searchParams.get('builder') || '').trim();
  const isCampaignDraft = searchParams.get('campaignDraft') === '1';

  const [templateRaw, setTemplateRaw] = useState('');
  const [templateLabel, setTemplateLabel] = useState('');
  const [templateLoading, setTemplateLoading] = useState(true);
  const [templateError, setTemplateError] = useState<string | null>(null);

  const [templateLibrary, setTemplateLibrary] = useState<TemplateLibraryItem[]>([]);
  const [templateLibraryLoading, setTemplateLibraryLoading] = useState(false);
  const [templateLibrarySearch, setTemplateLibrarySearch] = useState('');

  const [savedAudiences, setSavedAudiences] = useState<SavedAudience[]>([]);
  const [selectedAudienceKey, setSelectedAudienceKey] = useState('all');

  const [selectedAccountKey, setSelectedAccountKey] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);

  const [campaignName, setCampaignName] = useState('');
  const [subject, setSubject] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [sendAtLocal, setSendAtLocal] = useState(
    toLocalDateTimeInputValue(new Date(Date.now() + 30 * 60_000)),
  );

  const [submitting, setSubmitting] = useState(false);
  const [scheduleStep, setScheduleStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const accountOptions = useMemo(() => {
    const keys = isAccount && accountKey ? [accountKey] : Object.keys(accounts);
    const uniqueKeys = [...new Set(keys.filter(Boolean))];

    return uniqueKeys
      .map((key) => ({
        key,
        dealer: accounts[key]?.dealer || key,
      }))
      .sort((a, b) => a.dealer.localeCompare(b.dealer));
  }, [isAccount, accountKey, accounts]);

  const selectedAccount = selectedAccountKey ? accounts[selectedAccountKey] || null : null;
  const selectedAccountProvider = selectedAccount
    ? resolveAccountProvider(selectedAccount, '')
    : null;
  const scheduleProviderLabel = providerDisplayName(selectedAccountProvider);

  const editorHref = useMemo(() => {
    if (!design) return '/campaigns';
    const next = new URLSearchParams();
    if (builder) next.set('builder', builder);
    if (isCampaignDraft) next.set('campaignDraft', '1');
    const query = next.toString();
    const path = `/templates/${encodeURIComponent(design)}/${encodeURIComponent(templateType || 'template')}`;
    return query ? `${path}?${query}` : path;
  }, [builder, design, isCampaignDraft, templateType]);

  useEffect(() => {
    if (!selectedAccountKey && accountOptions.length > 0) {
      setSelectedAccountKey(accountOptions[0].key);
      return;
    }

    if (selectedAccountKey && !accountOptions.some((account) => account.key === selectedAccountKey)) {
      setSelectedAccountKey(accountOptions[0]?.key || '');
    }
  }, [accountOptions, selectedAccountKey]);

  // When no design is preselected, fetch the template library so the user
  // can pick one in-page instead of being bounced back to the editor.
  useEffect(() => {
    if (design) return;
    let cancelled = false;
    setTemplateLibraryLoading(true);
    fetch('/api/templates')
      .then((res) => (res.ok ? res.json() : []))
      .then((items: unknown) => {
        if (cancelled) return;
        setTemplateLibrary(Array.isArray(items) ? (items as TemplateLibraryItem[]) : []);
      })
      .catch(() => {
        if (!cancelled) setTemplateLibrary([]);
      })
      .finally(() => {
        if (!cancelled) setTemplateLibraryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [design]);

  useEffect(() => {
    let cancelled = false;

    async function loadTemplate() {
      if (!design) {
        setTemplateLoading(false);
        setTemplateError(null);
        return;
      }

      setTemplateLoading(true);
      setTemplateError(null);

      try {
        const res = await fetch(`/api/templates?design=${encodeURIComponent(design)}&format=raw`);
        const data: TemplateRawResponse = await res.json().catch(() => ({}));
        if (!res.ok || !data.raw) {
          const message = data.error || 'Unable to load template content for scheduling.';
          throw new Error(message);
        }

        if (cancelled) return;

        const raw = data.raw;
        setTemplateRaw(raw);
        setTemplateLabel(data.slug || design);

        const title = parseFrontmatterValue(raw, 'title') || designToLabel(design);
        setSubject((current) => current || title);
        setCampaignName((current) => current || title);
      } catch (err) {
        if (cancelled) return;
        setTemplateError(err instanceof Error ? err.message : 'Unable to load template content.');
      } finally {
        if (!cancelled) setTemplateLoading(false);
      }
    }

    loadTemplate();
    return () => {
      cancelled = true;
    };
  }, [design]);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/audiences')
      .then((res) => (res.ok ? res.json() : { audiences: [] }))
      .then((data: AudiencesResponse) => {
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

  useEffect(() => {
    let cancelled = false;

    async function loadContacts() {
      if (!selectedAccountKey) {
        setContacts([]);
        setContactsError(null);
        return;
      }

      setContactsLoading(true);
      setContactsError(null);
      try {
        const res = await fetch(`/api/esp/contacts?accountKey=${encodeURIComponent(selectedAccountKey)}&all=true`);
        const data: ContactsResponse = await res.json().catch(() => ({}));
        if (!res.ok) {
          const message = data.error || 'Failed to load contacts for the selected account.';
          throw new Error(message);
        }

        if (cancelled) return;
        const list = Array.isArray(data.contacts)
          ? data.contacts.map((contact) => ({ ...contact, _accountKey: selectedAccountKey }))
          : [];
        setContacts(list);
      } catch (err) {
        if (!cancelled) {
          setContacts([]);
          setContactsError(err instanceof Error ? err.message : 'Failed to load contacts for the selected account.');
        }
      } finally {
        if (!cancelled) setContactsLoading(false);
      }
    }

    loadContacts();
    return () => {
      cancelled = true;
    };
  }, [selectedAccountKey]);

  const audienceOptions = useMemo<AudienceOption[]>(() => {
    const options: AudienceOption[] = [
      {
        key: 'all',
        label: 'All Contacts',
        definition: null,
        type: 'all',
      },
    ];

    for (const preset of LIFECYCLE_PRESETS) {
      options.push({
        key: `preset:${preset.id}`,
        label: `Lifecycle · ${preset.name}`,
        definition: preset.definition,
        type: 'lifecycle',
      });
    }

    for (const audience of savedAudiences) {
      if (audience.accountKey && selectedAccountKey && audience.accountKey !== selectedAccountKey) {
        continue;
      }
      const definition = parseAudienceDefinition(audience.filters);
      if (!definition) continue;
      options.push({
        key: `audience:${audience.id}`,
        label: `Custom · ${audience.name}`,
        definition,
        type: 'custom',
      });
    }

    return options;
  }, [savedAudiences, selectedAccountKey]);

  useEffect(() => {
    if (audienceOptions.some((option) => option.key === selectedAudienceKey)) return;
    setSelectedAudienceKey('all');
  }, [audienceOptions, selectedAudienceKey]);

  const selectedAudience = useMemo(
    () => audienceOptions.find((option) => option.key === selectedAudienceKey) || audienceOptions[0],
    [audienceOptions, selectedAudienceKey],
  );

  const audienceContacts = useMemo(() => {
    if (!selectedAudience?.definition) return contacts;
    return evaluateFilter(contacts, selectedAudience.definition);
  }, [contacts, selectedAudience]);

  const recipientContacts = useMemo(
    () =>
      audienceContacts.filter(
        (contact) => Boolean(contact.id && isValidEmail(String(contact.email || '').trim())),
      ),
    [audienceContacts],
  );

  const recipientIds = useMemo(
    () => [...new Set(recipientContacts.map((contact) => String(contact.id).trim()).filter(Boolean))],
    [recipientContacts],
  );

  const compileTemplateHtml = async (): Promise<string> => {
    if (!templateRaw.trim()) {
      throw new Error('Template content is empty. Return to the editor and save your template first.');
    }

    const previewValues = buildAccountCompileValues(selectedAccount);
    const res = await fetch('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: templateRaw,
        previewValues,
      }),
    });

    const data: PreviewResponse = await res.json().catch(() => ({}));
    if (!res.ok || !data.html) {
      throw new Error(data.error || 'Failed to compile the selected template for scheduling.');
    }

    return data.html;
  };

  async function handleSchedule() {
    setError(null);
    setSuccess(null);
    setScheduleStep('');

    if (!design) {
      setError('Choose a template before scheduling.');
      return;
    }

    if (!selectedAccountKey) {
      setError('Select a sub-account before scheduling.');
      return;
    }

    if (!subject.trim()) {
      setError('Subject line is required.');
      return;
    }

    if (recipientIds.length === 0) {
      setError('No contacts with valid email addresses match the selected audience.');
      return;
    }

    const parsedSendAt = new Date(sendAtLocal);
    if (Number.isNaN(parsedSendAt.getTime())) {
      setError('Choose a valid send date and time.');
      return;
    }

    if (parsedSendAt.getTime() <= Date.now() + 30_000) {
      setError('Send time must be in the future.');
      return;
    }

    setSubmitting(true);
    try {
      // Step 1: Compile template HTML
      setScheduleStep('Compiling template...');
      const html = await compileTemplateHtml();

      // Step 2: Try to publish template to ESP (if EspTemplate exists for this account)
      setScheduleStep('Publishing template to ESP...');
      let templateId: string | undefined;
      try {
        const templatesRes = await fetch(
          `/api/esp/templates?accountKey=${encodeURIComponent(selectedAccountKey)}`,
        );
        if (templatesRes.ok) {
          const templates = await templatesRes.json();
          const trimmedName = (campaignName.trim() || subject.trim()).toLowerCase();
          const match = Array.isArray(templates)
            ? templates.find(
                (t: { name?: string; id?: string }) =>
                  t.name?.toLowerCase() === trimmedName,
              )
            : null;
          if (match?.id) {
            // Publish the template to the ESP so the remote ID is available
            const publishRes = await fetch(`/api/esp/templates/${match.id}/publish`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ providers: [selectedAccountProvider] }),
            });
            if (publishRes.ok) {
              templateId = match.id;
            }
          }
        }
      } catch {
        // Non-critical — adapter will create a fresh template from HTML
      }

      // Step 3: Schedule the campaign.
      // Klaviyo accounts retain their native scheduling path (Klaviyo's
      // API actually works). Everyone else (notably GHL, whose public
      // campaign API is read-only) goes through Loomi's own pipeline:
      // EmailCampaign rows are persisted in Postgres and the pg-boss
      // worker fires them at scheduledFor.
      setScheduleStep('Creating campaign and audience list...');
      const useLoomiPipeline = selectedAccountProvider !== 'klaviyo';

      let scheduledId = '';
      if (useLoomiPipeline) {
        const loomiPayload = {
          name: campaignName.trim() || subject.trim(),
          subject: subject.trim(),
          previewText: previewText.trim(),
          htmlContent: html,
          sourceType: 'drag-drop',
          scheduledFor: parsedSendAt.toISOString(),
          recipients: recipientContacts.map((contact) => ({
            contactId: String(contact.id).trim(),
            accountKey: selectedAccountKey,
            email: String(contact.email || '').trim(),
            fullName: String(contact.fullName || '').trim(),
          })),
        };
        const res = await fetch('/api/campaigns/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(loomiPayload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to schedule this campaign.');
        }
        scheduledId = data?.campaign?.id || '';
      } else {
        const espPayload: Record<string, unknown> = {
          accountKey: selectedAccountKey,
          name: campaignName.trim() || subject.trim(),
          subject: subject.trim(),
          previewText: previewText.trim(),
          html,
          sendAt: parsedSendAt.toISOString(),
          contactIds: recipientIds,
        };
        if (templateId) {
          espPayload.templateId = templateId;
        }
        const res = await fetch('/api/esp/campaigns/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(espPayload),
        });
        const data: ScheduleResponse = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          throw new Error(data.error || 'Failed to schedule this campaign.');
        }
        scheduledId = data.scheduled?.scheduleId || data.scheduled?.id || '';
      }

      setScheduleStep('');
      setSuccess(
        `Campaign scheduled for ${recipientIds.length.toLocaleString()} recipients on ${formatDateTime(parsedSendAt.toISOString())}${
          scheduledId ? ` (ID: ${scheduledId})` : ''
        }.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule this campaign.');
      setScheduleStep('');
    } finally {
      setSubmitting(false);
    }
  }

  const usesKlaviyo = selectedAccountProvider === 'klaviyo';
  const sendVerb = usesKlaviyo ? `Schedule in ${scheduleProviderLabel}` : 'Schedule Send';
  const sendDescription = usesKlaviyo
    ? `Loomi publishes the template to ${scheduleProviderLabel}, which handles the send.`
    : 'Loomi compiles the template and delivers it to your audience at the scheduled time.';

  const filteredLibrary = useMemo(() => {
    const query = templateLibrarySearch.trim().toLowerCase();
    if (!query) return templateLibrary;
    return templateLibrary.filter(
      (item) =>
        item.name?.toLowerCase().includes(query) ||
        item.design?.toLowerCase().includes(query) ||
        item.category?.toLowerCase().includes(query),
    );
  }, [templateLibrary, templateLibrarySearch]);

  // ── Template picker view (shown when no design has been selected yet) ──
  if (!design) {
    return (
      <div>
        <div className="page-sticky-header mb-8">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <PaperAirplaneIcon className="w-7 h-7 text-[var(--primary)]" />
              <div>
                <h2 className="text-2xl font-bold">Schedule Email Campaign</h2>
                <p className="text-[var(--muted-foreground)] mt-1 text-sm">
                  Start by choosing a template to send.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => router.push(subHref('/campaigns'))}
                className="inline-flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/40"
              >
                <ArrowLeftIcon className="w-4 h-4" />
                Back to Campaigns
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto space-y-6">
          {/* "Create new" CTA card */}
          <Link
            href={subHref('/templates')}
            className="block glass-section-card rounded-2xl p-6 border border-dashed border-[var(--border)] hover:border-[var(--primary)]/60 hover:bg-[var(--primary)]/[0.03] transition-all group"
          >
            <div className="flex items-center gap-5">
              <div className="w-14 h-14 rounded-xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center flex-shrink-0 group-hover:bg-[var(--primary)]/15">
                <PlusIcon className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-[var(--foreground)]">Create a new template</h3>
                <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
                  Build from scratch in the editor, then come back here to schedule.
                </p>
              </div>
              <SparklesIcon className="w-5 h-5 text-[var(--muted-foreground)] group-hover:text-[var(--primary)]" />
            </div>
          </Link>

          {/* Library picker */}
          <div className="glass-section-card rounded-2xl p-6 border border-[var(--border)]">
            <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
              <div>
                <h3 className="text-base font-semibold text-[var(--foreground)]">Template Library</h3>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  Pick a saved template to send to this audience.
                </p>
              </div>
              <input
                value={templateLibrarySearch}
                onChange={(event) => setTemplateLibrarySearch(event.target.value)}
                placeholder="Search templates…"
                className="w-full sm:w-64 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>

            {templateLibraryLoading ? (
              <p className="text-sm text-[var(--muted-foreground)] inline-flex items-center gap-2">
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
                Loading templates…
              </p>
            ) : filteredLibrary.length === 0 ? (
              <div className="text-center py-12">
                <DocumentTextIcon className="w-10 h-10 text-[var(--muted-foreground)] mx-auto mb-3 opacity-50" />
                <p className="text-sm text-[var(--muted-foreground)]">
                  {templateLibrarySearch
                    ? 'No templates match that search.'
                    : 'No templates yet. Create one to get started.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredLibrary.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      router.push(
                        `/campaigns/schedule?design=${encodeURIComponent(item.design)}`,
                      )
                    }
                    className="text-left rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 hover:border-[var(--primary)]/60 hover:bg-[var(--primary)]/[0.03] transition-all group"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-[var(--muted)] text-[var(--muted-foreground)] flex items-center justify-center flex-shrink-0 group-hover:bg-[var(--primary)]/10 group-hover:text-[var(--primary)]">
                        <EnvelopeIcon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--foreground)] truncate">
                          {item.name || designToLabel(item.design)}
                        </p>
                        <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5 truncate">
                          {item.category || item.design}
                        </p>
                        {item.published && (
                          <span className="inline-flex items-center gap-1 mt-2 text-[10px] text-emerald-300/90">
                            <CheckCircleIcon className="w-3 h-3" />
                            Published
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Scheduling view (a template has been selected) ──
  return (
    <div>
      <div className="page-sticky-header mb-8">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <PaperAirplaneIcon className="w-7 h-7 text-[var(--primary)]" />
            <div>
              <h2 className="text-2xl font-bold">Schedule Email Campaign</h2>
              <p className="text-[var(--muted-foreground)] mt-1 text-sm">
                Finalize your audience and delivery time. Loomi handles the send.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={editorHref}
              className="inline-flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/40"
            >
              <PencilSquareIcon className="w-4 h-4" />
              Edit Template
            </Link>
            <button
              type="button"
              onClick={() => router.push(subHref('/campaigns'))}
              className="inline-flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/40"
            >
              View Campaigns
            </button>
          </div>
        </div>
      </div>

      <div className="w-full max-w-[1325px] grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          {/* Selected template card */}
          <div className="glass-section-card rounded-2xl p-5 border border-[var(--border)]">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center flex-shrink-0">
                <DocumentTextIcon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-0.5">
                  Template
                </p>
                {templateLoading ? (
                  <p className="text-sm text-[var(--muted-foreground)] inline-flex items-center gap-2">
                    <ArrowPathIcon className="w-4 h-4 animate-spin" />
                    Loading template content…
                  </p>
                ) : templateError ? (
                  <p className="text-sm text-red-300">{templateError}</p>
                ) : (
                  <>
                    <p className="text-base font-semibold text-[var(--foreground)]">
                      {designToLabel(templateLabel || design)}
                    </p>
                    <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{design}</p>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => router.push('/campaigns/schedule')}
                className="inline-flex items-center gap-1.5 px-3 h-9 text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/40"
              >
                Change
              </button>
            </div>
          </div>

          {/* Campaign details */}
          <div className="glass-section-card rounded-2xl p-6 border border-[var(--border)]">
            <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-4">
              Campaign Details
            </h3>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
                  Campaign Name
                </label>
                <input
                  value={campaignName}
                  onChange={(event) => setCampaignName(event.target.value)}
                  placeholder="Spring Service Offer"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
                  Subject Line
                </label>
                <input
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="Your next service is due"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-[11px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
                  Preview Text
                </label>
                <input
                  value={previewText}
                  onChange={(event) => setPreviewText(event.target.value)}
                  placeholder="Lock in your appointment this week."
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
                  Send Date &amp; Time
                </label>
                <div className="relative">
                  <CalendarDaysIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] pointer-events-none" />
                  <input
                    type="datetime-local"
                    value={sendAtLocal}
                    min={toLocalDateTimeInputValue(new Date())}
                    onChange={(event) => setSendAtLocal(event.target.value)}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Audience */}
          <div className="glass-section-card rounded-2xl p-6 border border-[var(--border)]">
            <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-4">
              Audience
            </h3>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
                  Sub-Account
                </label>
                <select
                  value={selectedAccountKey}
                  onChange={(event) => setSelectedAccountKey(event.target.value)}
                  disabled={isAccount || accountOptions.length <= 1}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 disabled:opacity-70"
                >
                  {accountOptions.map((account) => (
                    <option key={account.key} value={account.key}>
                      {account.dealer}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
                  Audience Filter
                </label>
                <select
                  value={selectedAudienceKey}
                  onChange={(event) => setSelectedAudienceKey(event.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
                >
                  {audienceOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Unified stats strip */}
            <div className="mt-5 grid grid-cols-3 rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 divide-x divide-[var(--border)] overflow-hidden">
              <div className="px-4 py-3">
                <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">Total</p>
                <p className="text-lg font-semibold mt-0.5">{contacts.length.toLocaleString()}</p>
              </div>
              <div className="px-4 py-3">
                <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">Matched</p>
                <p className="text-lg font-semibold mt-0.5">{audienceContacts.length.toLocaleString()}</p>
              </div>
              <div className="px-4 py-3">
                <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">Sendable</p>
                <p className="text-lg font-semibold mt-0.5 text-[var(--primary)]">
                  {recipientIds.length.toLocaleString()}
                </p>
              </div>
            </div>

            {contactsLoading && (
              <p className="mt-3 text-xs text-[var(--muted-foreground)] inline-flex items-center gap-1.5">
                <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                Loading contacts…
              </p>
            )}
            {contactsError && <p className="mt-3 text-xs text-red-300">{contactsError}</p>}
          </div>
        </div>

        {/* Right column: scheduling CTA + result */}
        <div className="space-y-5">
          <div className="glass-section-card rounded-2xl p-6 border border-[var(--border)] xl:sticky xl:top-24">
            <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-3">
              Ready to Schedule
            </h3>
            <p className="text-sm text-[var(--muted-foreground)] leading-relaxed mb-5">
              {sendDescription}
            </p>

            <div className="space-y-2.5 mb-5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--muted-foreground)]">Recipients</span>
                <span className="font-semibold text-[var(--foreground)]">
                  {recipientIds.length.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--muted-foreground)]">Sending at</span>
                <span className="font-semibold text-[var(--foreground)] text-right">
                  {sendAtLocal ? formatDateTime(new Date(sendAtLocal).toISOString()) : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--muted-foreground)]">From</span>
                <span className="font-semibold text-[var(--foreground)] text-right truncate ml-3">
                  {selectedAccount?.dealer || '—'}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSchedule}
              disabled={
                submitting ||
                templateLoading ||
                Boolean(templateError) ||
                contactsLoading ||
                !selectedAccountKey ||
                recipientIds.length === 0
              }
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-xl bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? (
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
              ) : (
                <PaperAirplaneIcon className="w-4 h-4" />
              )}
              {submitting ? 'Scheduling…' : sendVerb}
            </button>

            {submitting && scheduleStep && (
              <p className="text-xs text-[var(--muted-foreground)] mt-3 inline-flex items-center gap-1.5">
                <ArrowPathIcon className="w-3 h-3 animate-spin flex-shrink-0" />
                {scheduleStep}
              </p>
            )}
          </div>

          {error && (
            <div className="glass-section-card rounded-2xl p-5 border border-red-500/20 bg-red-500/10">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {success && (
            <div className="glass-section-card rounded-2xl p-5 border border-emerald-500/20 bg-emerald-500/10">
              <p className="text-sm text-emerald-200">{success}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
