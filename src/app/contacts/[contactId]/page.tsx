'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useAccount } from '@/contexts/account-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  PaperAirplaneIcon,
  EnvelopeIcon,
  DevicePhoneMobileIcon,
  PhoneIcon,
  MapPinIcon,
  ClockIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';
import PrimaryButton from '@/components/primary-button';

// ── Types ──

interface ContactDetail {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  address1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  tags: string[];
  dateAdded: string;
  source: string;
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleVin: string;
  vehicleMileage: string;
  lastServiceDate: string;
  nextServiceDate: string;
  leaseEndDate: string;
  warrantyEndDate: string;
  purchaseDate: string;
}

interface AccountSummary {
  key: string;
  dealer: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  logos?: Record<string, unknown> | null;
}

interface ConvoMessage {
  id: string;
  channel?: unknown;
  type: unknown;
  direction: unknown;
  body: unknown;
  dateAdded: unknown;
  subject?: unknown;
  contentType?: unknown;
}

interface ConvoStats {
  totalMessages: number;
  smsCount: number;
  emailCount: number;
  lastMessageDate: string | null;
  lastMessageDirection: string | null;
}

type ComposeMessageChannel = 'SMS' | 'MMS';

interface DndState {
  email: boolean;
  sms: boolean;
}

// ── Helpers ──

function daysUntil(dateStr: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function formatRelativeDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days < 0) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDate(dateStr: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function toText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => toText(item)).filter(Boolean).join(' ').trim();
  }
  if (typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return toText(
      row.value ?? row.text ?? row.message ?? row.body ?? row.subject ?? row.url ?? row.link ?? row.label ?? row.name ?? row.type ?? row.id,
    );
  }
  return '';
}

function parseDndPayload(value: unknown): DndState {
  const out: DndState = { email: false, sms: false };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  const row = value as Record<string, unknown>;
  if (typeof row.email === 'boolean') out.email = row.email;
  if (typeof row.sms === 'boolean') out.sms = row.sms;
  return out;
}

function parseMediaUrlInput(raw: string): string[] {
  if (!raw.trim()) return [];
  return [
    ...new Set(
      raw
        .split(/[\n,\s]+/g)
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => /^https?:\/\/\S+$/i.test(item)),
    ),
  ];
}

function normalizeAccountSummary(value: unknown): AccountSummary | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const key = toText(row.key);
  const dealer = toText(row.dealer);
  if (!key || !dealer) return null;
  const logos = row.logos && typeof row.logos === 'object' ? (row.logos as Record<string, unknown>) : null;
  return {
    key,
    dealer,
    address: toText(row.address),
    city: toText(row.city),
    state: toText(row.state),
    postalCode: toText(row.postalCode),
    logos,
  };
}

function accountLogoUrl(account: AccountSummary | null): string {
  if (!account?.logos) return '';
  const candidates = ['light', 'dark', 'white', 'black'] as const;
  for (const key of candidates) {
    const value = account.logos[key];
    const url = toText(value);
    if (url) return url;
  }
  return '';
}

function accountAddressLine(account: AccountSummary | null): string {
  if (!account) return '';
  const full = [account.address, account.city, account.state, account.postalCode].filter(Boolean).join(', ');
  if (!full) return '';
  return full.length > 64 ? `${full.slice(0, 64)}...` : full;
}

// ── Page ──

export default function ContactDetailPage() {
  const { isAccount } = useAccount();
  const subHref = useSubaccountHref();
  const params = useParams<{ contactId: string | string[] }>();
  const searchParams = useSearchParams();
  const contactId = Array.isArray(params.contactId) ? params.contactId[0] : params.contactId;
  const accountKey = searchParams.get('accountKey') || '';

  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [contactLoading, setContactLoading] = useState(true);
  const [contactError, setContactError] = useState<string | null>(null);
  const [dnd, setDnd] = useState<DndState>({ email: false, sms: false });

  const [messages, setMessages] = useState<ConvoMessage[]>([]);
  const [stats, setStats] = useState<ConvoStats | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [dndSaving, setDndSaving] = useState(false);
  const [dndError, setDndError] = useState<string | null>(null);
  const [dndSuccess, setDndSuccess] = useState<string | null>(null);

  const [smsChannel, setSmsChannel] = useState<ComposeMessageChannel>('SMS');
  const [smsMediaUrlsText, setSmsMediaUrlsText] = useState('');
  const [smsDraft, setSmsDraft] = useState('');
  const [smsSending, setSmsSending] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [smsSuccess, setSmsSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!contactId || !accountKey) {
      setContactLoading(false);
      setMessagesLoading(false);
      setContactError('Missing contact identifier or account context.');
      setAccount(null);
      return;
    }

    let active = true;

    async function load() {
      setContactLoading(true);
      setMessagesLoading(true);
      setContactError(null);
      setMessagesError(null);

      try {
        const contactRes = await fetch(
          `/api/contacts/${encodeURIComponent(contactId)}?accountKey=${encodeURIComponent(accountKey)}`,
        );
        const contactData = await contactRes.json().catch(() => ({}));
        if (!contactRes.ok) {
          throw new Error(contactData.error || 'Failed to fetch contact');
        }

        if (!active) return;

        const nextContact = (contactData.contact || null) as ContactDetail | null;
        setContact(nextContact);
        setAccount(normalizeAccountSummary(contactData.account));
        setDnd(parseDndPayload(contactData.contact?.dnd ?? contactData.dnd));
        setContactLoading(false);

        const activityRes = await fetch(
          `/api/contacts/${encodeURIComponent(contactId)}/activity?accountKey=${encodeURIComponent(accountKey)}`,
        );
        const activityData = await activityRes.json().catch(() => ({}));
        if (!active) return;

        if (!activityRes.ok) {
          setMessagesError(activityData.error || 'Failed to fetch activity');
          setMessages([]);
          setStats(null);
        } else {
          setMessages(Array.isArray(activityData.messages) ? activityData.messages : []);
          setStats(activityData.stats || null);
          setMessagesError(null);
        }
        setMessagesLoading(false);
      } catch (err) {
        if (!active) return;
        setContactError(err instanceof Error ? err.message : 'Failed to fetch contact');
        setContactLoading(false);
        setMessagesLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [contactId, accountKey]);

  const fullName = useMemo(() => {
    if (!contact) return '';
    return contact.fullName || `${contact.firstName} ${contact.lastName}`.trim() || 'Unknown Contact';
  }, [contact]);

  const vehicleStr = useMemo(() => {
    if (!contact) return '';
    return [contact.vehicleYear, contact.vehicleMake, contact.vehicleModel].filter(Boolean).join(' ');
  }, [contact]);

  const addedDateLabel = useMemo(() => {
    if (!contact?.dateAdded) return '';
    return formatRelativeDate(contact.dateAdded) || formatDate(contact.dateAdded);
  }, [contact?.dateAdded]);

  const accountLogo = useMemo(() => accountLogoUrl(account), [account]);
  const accountAddress = useMemo(() => accountAddressLine(account), [account]);

  async function toggleSuppression(channel: 'email' | 'sms', enabled: boolean) {
    if (!contactId || !accountKey) return;
    setDndSaving(true);
    setDndError(null);
    setDndSuccess(null);

    // Optimistic.
    const previous = dnd;
    setDnd({ ...previous, [channel]: enabled });

    try {
      const res = await fetch(
        `/api/contacts/${encodeURIComponent(contactId)}/suppression?accountKey=${encodeURIComponent(accountKey)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [channel]: enabled }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to update suppression');
      }
      // Server is authoritative.
      setDnd(parseDndPayload(data.dnd ?? data.contact?.dnd));
      setDndSuccess(enabled ? `${channel === 'email' ? 'Email' : 'SMS'} suppressed.` : `${channel === 'email' ? 'Email' : 'SMS'} unsuppressed.`);
    } catch (err) {
      setDnd(previous);
      setDndError(err instanceof Error ? err.message : 'Failed to update suppression');
    } finally {
      setDndSaving(false);
    }
  }

  async function sendSmsMessage() {
    if (!contactId || !accountKey) return;
    const message = smsDraft.trim();
    const mediaUrls = parseMediaUrlInput(smsMediaUrlsText);

    if (!contact?.phone) {
      setSmsError('Contact has no phone number on file.');
      return;
    }
    if (!message && mediaUrls.length === 0) {
      setSmsError(`Enter a ${smsChannel} message or at least one media URL.`);
      return;
    }
    if (message.length > 640) {
      setSmsError(`${smsChannel} must be 640 characters or fewer.`);
      return;
    }
    if (dnd.sms) {
      setSmsError('This contact has SMS suppressed. Unblock SMS first.');
      return;
    }

    setSmsSending(true);
    setSmsError(null);
    setSmsSuccess(null);

    try {
      const res = await fetch(
        `/api/contacts/${encodeURIComponent(contactId)}/sms?accountKey=${encodeURIComponent(accountKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel: smsChannel, message, mediaUrls }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to send message');
      }

      const sentMessage = (data?.message && typeof data.message === 'object') ? data.message as ConvoMessage : null;
      if (sentMessage) {
        setMessages((prev) => [sentMessage, ...prev]);
        setStats((prev) => {
          const total = (prev?.totalMessages ?? 0) + 1;
          const smsCount = (prev?.smsCount ?? 0) + 1;
          return {
            totalMessages: total,
            smsCount,
            emailCount: prev?.emailCount ?? 0,
            lastMessageDate: toText(sentMessage.dateAdded) || new Date().toISOString(),
            lastMessageDirection: 'outbound',
          };
        });
      }
      setSmsDraft('');
      setSmsMediaUrlsText('');
      setSmsSuccess(`${smsChannel} sent.`);
    } catch (err) {
      setSmsError(err instanceof Error ? err.message : `Failed to send ${smsChannel}`);
    } finally {
      setSmsSending(false);
    }
  }

  const hasPhone = Boolean(contact?.phone);

  return (
    <div className="space-y-5">
      <div className="page-sticky-header">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href={subHref('/contacts')}
              className="mt-0.5 p-2 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)]/40 transition-colors"
            >
              <ArrowLeftIcon className="w-4 h-4" />
            </Link>

            <div className="w-11 h-11 rounded-full overflow-hidden flex items-center justify-center bg-[var(--primary)]/15 text-[var(--primary)] font-semibold flex-shrink-0">
              <span>{(contact?.firstName || fullName || '?').charAt(0).toUpperCase()}</span>
            </div>

            <div className="min-w-0">
              <h2 className="text-2xl font-bold truncate">{fullName || 'Contact Details'}</h2>
              <p className="text-[var(--muted-foreground)] mt-1">
                {contact ? `Added ${addedDateLabel || 'Unknown date'}` : 'Loading contact details...'}
              </p>
            </div>
          </div>

          {account && !isAccount && (
            <Link
              href={`/contacts?account=${encodeURIComponent(account.key)}`}
              className="glass-card rounded-xl border border-[var(--border)]/70 px-3 py-2 min-w-[280px] max-w-[360px] hover:border-[var(--primary)]/40 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg overflow-hidden flex items-center justify-center bg-[var(--muted)]/35 text-[var(--foreground)] font-semibold flex-shrink-0">
                  {accountLogo ? (
                    <img src={accountLogo} alt={account.dealer} className="w-full h-full object-contain" />
                  ) : (
                    <span>{account.dealer.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">Sub-Account</p>
                  <p className="text-sm font-medium truncate">{account.dealer}</p>
                  <p className="text-xs text-[var(--muted-foreground)] truncate">
                    {accountAddress || 'No address on file'}
                  </p>
                  <p className="text-[11px] text-[var(--primary)] mt-1 truncate">View account contacts</p>
                </div>
                <ArrowTopRightOnSquareIcon className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
              </div>
            </Link>
          )}
        </div>
      </div>

      {contactLoading && (
        <div className="glass-card rounded-xl p-8 text-center text-[var(--muted-foreground)]">
          <ArrowPathIcon className="w-5 h-5 animate-spin mx-auto mb-2" />
          Loading contact details...
        </div>
      )}

      {!contactLoading && contactError && (
        <div className="glass-card rounded-xl p-6 border border-red-500/20 text-red-300 text-sm">
          {contactError}
        </div>
      )}

      {!contactLoading && contact && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-4">
            {/* Contact info */}
            <section className="glass-card rounded-xl p-4 border border-[var(--border)]/70">
              <h3 className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] mb-3">Contact</h3>
              <div className="grid gap-2.5 sm:grid-cols-2 text-sm">
                <InfoPill icon={<EnvelopeIcon className="w-4 h-4" />} label="Email" value={contact.email} />
                <InfoPill icon={<PhoneIcon className="w-4 h-4" />} label="Phone" value={contact.phone} />
                <InfoPill
                  icon={<MapPinIcon className="w-4 h-4" />}
                  label="Address"
                  value={[contact.address1, contact.city, contact.state, contact.postalCode].filter(Boolean).join(', ')}
                  className="sm:col-span-2"
                />
              </div>
            </section>

            {/* Suppression (replaces 7-channel DND grid) */}
            <section className="glass-card rounded-xl p-4 border border-[var(--border)]/70">
              <h3 className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] mb-1">
                Do Not Disturb
              </h3>
              <p className="text-[11px] text-[var(--muted-foreground)] mb-3">
                Block sends to this contact on individual channels.
              </p>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <SuppressionTile
                  label="Email"
                  enabled={dnd.email}
                  disabled={!contact.email || dndSaving}
                  hint={contact.email || 'No email on file'}
                  icon={EnvelopeIcon}
                  onToggle={() => toggleSuppression('email', !dnd.email)}
                />
                <SuppressionTile
                  label="SMS"
                  enabled={dnd.sms}
                  disabled={!contact.phone || dndSaving}
                  hint={contact.phone || 'No phone on file'}
                  icon={DevicePhoneMobileIcon}
                  onToggle={() => toggleSuppression('sms', !dnd.sms)}
                />
              </div>
              {dndError && <p className="mt-2 text-[11px] text-red-300">{dndError}</p>}
              {dndSuccess && !dndError && (
                <p className="mt-2 text-[11px] text-emerald-300">{dndSuccess}</p>
              )}
            </section>

            {/* Vehicle */}
            <section className="glass-card rounded-xl p-4 border border-[var(--border)]/70">
              <h3 className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] mb-3">Vehicle</h3>
              <div className="grid gap-3 sm:grid-cols-3 text-sm">
                <StatTile label="Primary Vehicle" value={vehicleStr || 'No vehicle data'} />
                <StatTile label="VIN" value={contact.vehicleVin || '—'} mono />
                <StatTile label="Mileage" value={contact.vehicleMileage || '—'} />
              </div>
            </section>

            {/* Lifecycle */}
            <section className="glass-card rounded-xl p-4 border border-[var(--border)]/70">
              <h3 className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] mb-3 flex items-center gap-1.5">
                <ClockIcon className="w-3.5 h-3.5" />
                Lifecycle
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <LifecycleItem label="Last Service" dateStr={contact.lastServiceDate} type="past" />
                <LifecycleItem label="Next Service" dateStr={contact.nextServiceDate} type="future" />
                <LifecycleItem label="Purchase Date" dateStr={contact.purchaseDate} type="past" />
                <LifecycleItem label="Lease End" dateStr={contact.leaseEndDate} type="future" />
                <LifecycleItem label="Warranty End" dateStr={contact.warrantyEndDate} type="future" />
              </div>
            </section>
          </div>

          {/* Activity / 1:1 send */}
          <section className="glass-card rounded-xl p-4 border border-[var(--border)]/70 h-fit">
            <h3 className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] mb-3 flex items-center gap-1.5">
              <ChatBubbleLeftRightIcon className="w-3.5 h-3.5" />
              Activity
            </h3>

            {/* 1:1 send composer */}
            <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-2.5">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <p className="text-[11px] font-medium">Send 1:1 Message</p>
                {dnd.sms && <span className="text-[10px] text-amber-300">SMS suppressed</span>}
                {!hasPhone && <span className="text-[10px] text-amber-300">No phone on file</span>}
              </div>

              <div className="mb-2 flex items-center gap-1.5">
                {(['SMS', 'MMS'] as const).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setSmsChannel(ch)}
                    disabled={smsSending}
                    className={`px-2 py-1 text-[10px] rounded border ${
                      smsChannel === ch
                        ? 'border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--primary)]'
                        : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    {ch}
                  </button>
                ))}
              </div>

              <textarea
                value={smsDraft}
                onChange={(event) => {
                  setSmsDraft(event.target.value);
                  if (smsError) setSmsError(null);
                  if (smsSuccess) setSmsSuccess(null);
                }}
                placeholder={smsChannel === 'MMS' ? 'Write an MMS caption (optional if media URLs provided)...' : 'Write an SMS message...'}
                rows={3}
                maxLength={640}
                className="w-full text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-2 focus:outline-none focus:border-[var(--primary)]"
              />

              {smsChannel === 'MMS' && (
                <textarea
                  value={smsMediaUrlsText}
                  onChange={(event) => {
                    setSmsMediaUrlsText(event.target.value);
                    if (smsError) setSmsError(null);
                    if (smsSuccess) setSmsSuccess(null);
                  }}
                  placeholder="Media URLs (one per line)"
                  rows={2}
                  className="mt-2 w-full text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-2 focus:outline-none focus:border-[var(--primary)]"
                />
              )}

              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[10px] text-[var(--muted-foreground)]">{smsDraft.trim().length}/640</span>
                <PrimaryButton
                  type="button"
                  onClick={sendSmsMessage}
                  disabled={
                    smsSending ||
                    !hasPhone ||
                    dnd.sms ||
                    (!smsDraft.trim() && (smsChannel !== 'MMS' || parseMediaUrlInput(smsMediaUrlsText).length === 0))
                  }
                >
                  {smsSending ? (
                    <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <PaperAirplaneIcon className="w-3.5 h-3.5" />
                  )}
                  {smsSending ? 'Sending...' : `Send ${smsChannel}`}
                </PrimaryButton>
              </div>

              {smsError && <p className="mt-2 text-[11px] text-red-300">{smsError}</p>}
              {smsSuccess && !smsError && <p className="mt-2 text-[11px] text-emerald-300">{smsSuccess}</p>}
            </div>

            {messagesLoading && (
              <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                Loading activity...
              </div>
            )}

            {!messagesLoading && stats && stats.totalMessages > 0 && (
              <div className="flex items-center gap-3 text-[11px] text-[var(--muted-foreground)] mb-3">
                <span>{stats.totalMessages} events</span>
                {stats.smsCount > 0 && <span>{stats.smsCount} SMS</span>}
                {stats.emailCount > 0 && <span>{stats.emailCount} email</span>}
              </div>
            )}

            {!messagesLoading && messagesError && messages.length === 0 && (
              <p className="text-xs text-[var(--muted-foreground)] italic">{messagesError}</p>
            )}

            {!messagesLoading && !messagesError && messages.length === 0 && (
              <p className="text-xs text-[var(--muted-foreground)] italic">
                No activity yet. Sends, opens, clicks, and replies will show up here.
              </p>
            )}

            {messages.length > 0 && (
              <div className="space-y-2 max-h-[540px] overflow-y-auto pr-1">
                {messages.slice(0, 50).map((msg) => {
                  const direction = toText(msg.direction).toLowerCase();
                  const channel = toText(msg.channel).toUpperCase();
                  const typeLabel = channel === 'EMAIL' ? 'Email' : channel === 'MMS' ? 'MMS' : 'SMS';
                  const subjectText = toText(msg.subject);
                  const dateLabel = formatRelativeDate(toText(msg.dateAdded));
                  const isInbound = direction.includes('inbound');
                  const isEmail = channel === 'EMAIL';
                  const bodyText = toText(msg.body) || 'No content';
                  const metaLabel = `${isInbound ? 'Inbound' : 'Outbound'} • ${typeLabel}`;
                  const channelIcon = isEmail
                    ? <EnvelopeIcon className="w-3.5 h-3.5" />
                    : <DevicePhoneMobileIcon className="w-3.5 h-3.5" />;

                  return (
                    <div
                      key={toText(msg.id)}
                      className={`rounded-lg p-2.5 border ${
                        isInbound
                          ? 'bg-[var(--primary)]/6 border-[var(--primary)]/25'
                          : 'bg-[var(--muted)]/30 border-[var(--border)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[10px] mb-1.5">
                        <span className="font-medium inline-flex items-center gap-1.5">
                          {channelIcon}
                          {metaLabel}
                        </span>
                        <span className="text-[var(--muted-foreground)]">{dateLabel}</span>
                      </div>
                      {subjectText && subjectText !== bodyText && (
                        <p className="text-[11px] font-medium mb-1 truncate">{subjectText}</p>
                      )}
                      <p className="text-[11px] text-[var(--muted-foreground)] line-clamp-3">
                        {bodyText}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

// ── Subcomponents ──

function InfoPill({
  icon,
  label,
  value,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  className?: string;
}) {
  if (!value) return null;
  return (
    <div className={`rounded-lg border border-[var(--border)] bg-[var(--muted)]/25 px-3 py-2 ${className || ''}`}>
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-1">{label}</p>
      <div className="flex items-start gap-2 text-[var(--foreground)]">
        <span className="text-[var(--muted-foreground)] mt-0.5">{icon}</span>
        <span className="break-words">{value}</span>
      </div>
    </div>
  );
}

function SuppressionTile({
  label,
  enabled,
  disabled,
  hint,
  icon: Icon,
  onToggle,
}: {
  label: string;
  enabled: boolean;
  disabled?: boolean;
  hint: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        enabled
          ? 'border-[var(--primary)]/45 bg-[var(--primary)]/10'
          : 'border-[var(--border)] bg-[var(--muted)]/25 hover:border-[var(--primary)]/30'
      }`}
      aria-pressed={enabled}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
          <span className="text-sm truncate">{label}</span>
        </div>
        <span
          className={`inline-flex w-8 h-4 rounded-full border transition-colors ${
            enabled ? 'bg-[var(--primary)] border-[var(--primary)]' : 'bg-transparent border-[var(--border)]'
          }`}
        >
          <span
            className={`w-3 h-3 rounded-full bg-white mt-[1px] transition-transform ${
              enabled ? 'translate-x-4' : 'translate-x-[1px]'
            }`}
          />
        </span>
      </div>
      <p className="mt-1 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] truncate">
        {hint}
      </p>
    </button>
  );
}

function StatTile({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/25 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">{label}</p>
      <p className={`mt-1 text-sm ${mono ? 'font-mono text-xs break-all' : ''}`}>{value}</p>
    </div>
  );
}

function LifecycleItem({
  label,
  dateStr,
  type,
}: {
  label: string;
  dateStr: string;
  type: 'past' | 'future';
}) {
  if (!dateStr) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/25 px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">{label}</p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">No data</p>
      </div>
    );
  }

  const days = daysUntil(dateStr);
  let status = '';
  let statusClass = 'text-[var(--muted-foreground)]';
  if (type === 'future' && days !== null) {
    if (days < 0) {
      status = `${Math.abs(days)}d overdue`;
      statusClass = 'text-red-400';
    } else if (days <= 30) {
      status = `${days}d`;
      statusClass = 'text-amber-400';
    } else {
      status = `${days}d`;
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/25 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-sm">{formatDate(dateStr)}</span>
        {status ? <span className={`text-[11px] font-medium ${statusClass}`}>{status}</span> : null}
      </div>
    </div>
  );
}
