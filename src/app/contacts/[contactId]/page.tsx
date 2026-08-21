'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { VehicleCard, type GarageVehicle } from '@/components/contacts/vehicle-card';
import { ContactHistory, type ContactEventDto } from '@/components/contacts/contact-history';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount } from '@/contexts/account-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { useFilterableFields } from '@/hooks/use-filterable-fields';
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  EnvelopeIcon,
  DevicePhoneMobileIcon,
  TagIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  InlineEditableField,
  type EditableFieldType,
} from '@/components/contacts/contact-inline-edit';
import {
  ContactActivityThread,
  type ConvoMessage as ThreadConvoMessage,
  type ConvoStats as ThreadConvoStats,
} from '@/components/contacts/contact-activity-thread';

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
  // Account-extensible properties keyed by the custom field's `key`.
  // Empty object when the contact has no custom data.
  customFields?: Record<string, unknown>;
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

interface DndState {
  email: boolean;
  sms: boolean;
}

// ── Helpers ──

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

/** Coerce a user-edited value into the shape the PATCH endpoint
 *  expects on the wire. Empty strings become null so a cleared field
 *  round-trips as "unset" instead of staying as "". Arrays pass
 *  through (the API stores them in customFields as-is). */
function normalizeForWire(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return value;
}

/** Type-aware formatter for a contact's stored value against a declared
 *  custom field. Falls back to "—" for empty / unparseable cells so the
 *  Custom section never blanks out a row. For select / multiselect we
 *  look up the option label so the UI shows "Gold" instead of "tier_2". */
function formatCustomFieldValue(
  raw: unknown,
  type: import('@/lib/contacts/custom-field-types').CustomFieldType,
  options: import('@/lib/contacts/custom-field-types').CustomFieldOption[] | null,
): string {
  if (raw === null || raw === undefined || raw === '') return '—';

  if (type === 'boolean') {
    if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
    const lower = String(raw).trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(lower)) return 'Yes';
    if (['false', 'no', 'n', '0'].includes(lower)) return 'No';
    return '—';
  }

  if (type === 'date') {
    const formatted = formatDate(String(raw));
    return formatted || '—';
  }

  if (type === 'number') {
    const n = Number(String(raw).trim());
    return Number.isFinite(n) ? n.toLocaleString() : '—';
  }

  if (type === 'select' || type === 'multiselect') {
    const labelFor = (val: string): string => {
      const opt = options?.find((o) => o.value === val);
      return opt ? opt.label : val;
    };
    if (type === 'select') return labelFor(String(raw).trim()) || '—';
    // Multiselect can arrive as an array or as a comma-separated
    // string from CSV imports — normalise both to a label list.
    const items = Array.isArray(raw)
      ? raw.map((v) => String(v).trim()).filter(Boolean)
      : String(raw)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
    if (items.length === 0) return '—';
    return items.map(labelFor).join(', ');
  }

  // text + anything unrecognised.
  const str = typeof raw === 'string' ? raw : String(raw);
  return str.trim() || '—';
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
  const router = useRouter();
  const params = useParams<{ contactId: string | string[] }>();
  const searchParams = useSearchParams();
  const contactId = Array.isArray(params.contactId) ? params.contactId[0] : params.contactId;
  const accountKey = searchParams.get('accountKey') || '';

  // Declared custom fields for this contact's owning sub-account.
  // Drives the "Custom" detail section: each row shows the field's
  // label + the contact's value (or "—"), formatted per declared type.
  const { customFields: declaredCustomFields } = useFilterableFields(accountKey || null);

  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [contactLoading, setContactLoading] = useState(true);
  const [contactError, setContactError] = useState<string | null>(null);
  const [dnd, setDnd] = useState<DndState>({ email: false, sms: false });

  const [messages, setMessages] = useState<ConvoMessage[]>([]);
  const [stats, setStats] = useState<ConvoStats | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [events, setEvents] = useState<ContactEventDto[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const [dndSaving, setDndSaving] = useState(false);
  const [dndError, setDndError] = useState<string | null>(null);
  const [dndSuccess, setDndSuccess] = useState<string | null>(null);

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

        // Service/purchase history — powers the timeline + the garage's
        // vehicle list. Non-fatal: the rest of the page renders without it.
        try {
          const eventsRes = await fetch(
            `/api/contacts/${encodeURIComponent(contactId)}/events?accountKey=${encodeURIComponent(accountKey)}`,
          );
          const eventsData = await eventsRes.json().catch(() => ({}));
          if (!active) return;
          if (!eventsRes.ok) {
            setEventsError(eventsData.error || 'Failed to fetch history');
            setEvents([]);
          } else {
            setEvents(Array.isArray(eventsData.events) ? eventsData.events : []);
            setEventsError(null);
          }
        } catch {
          if (active) setEvents([]);
        }
        if (active) setEventsLoading(false);
      } catch (err) {
        if (!active) return;
        setContactError(err instanceof Error ? err.message : 'Failed to fetch contact');
        setContactLoading(false);
        setMessagesLoading(false);
        setEventsLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [contactId, accountKey]);

  // ── Modal shell ────────────────────────────────────────────
  //
  // This route renders as a full-screen overlay rather than a page
  // inside the app shell, and closing returns to the contacts list.
  //
  // The list URL travels in `?from=` (set by the row click) because
  // `?segment=`, the search and the page number all live there — a bare
  // push to /contacts would drop whatever filter got the user here.
  //
  // NOT router.back(): history is not a reliable way to close a modal.
  // A refresh, a bookmark, or a back/forward shuffle can leave the
  // previous entry pointing anywhere — including at this same contact,
  // which reopens the modal the user just closed.
  const returnHref = useMemo(() => {
    const raw = searchParams.get('from') || '';
    // Same-origin, path-only. `//evil.com` is a protocol-relative URL
    // that a bare startsWith('/') check would wave through, so an
    // attacker-supplied `from` could turn a close into an off-site
    // redirect.
    if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
    return subHref('/contacts');
  }, [searchParams, subHref]);

  const handleClose = useCallback(() => {
    router.push(returnHref);
  }, [router, returnHref]);

  // Escape closes, and the page behind must not scroll while it's open.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // An inline-edit input handles its own Escape (cancel the edit);
      // only close the modal when the key wasn't meant for a field.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      handleClose();
    }
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [handleClose]);

  const fullName = useMemo(() => {
    if (!contact) return '';
    return contact.fullName || `${contact.firstName} ${contact.lastName}`.trim() || 'Unknown Contact';
  }, [contact]);

  /**
   * The contact's garage: the vehicle on the contact row (the CRM's latest)
   * plus every distinct vehicle seen across their service/purchase history.
   * Keyed by VIN when present, else year+make+model, so the same car serviced
   * five times shows once — carrying its most recent mileage/service date.
   */
  const garage = useMemo<GarageVehicle[]>(() => {
    const byKey = new Map<string, GarageVehicle>();
    const keyFor = (v: { vin?: string | null; year?: string | null; make?: string | null; model?: string | null }) =>
      (v.vin || '').trim().toUpperCase() ||
      [v.year, v.make, v.model].filter(Boolean).join(' ').toLowerCase();

    if (contact && (contact.vehicleMake || contact.vehicleModel || contact.vehicleYear || contact.vehicleVin)) {
      const primary: GarageVehicle = {
        year: contact.vehicleYear,
        make: contact.vehicleMake,
        model: contact.vehicleModel,
        vin: contact.vehicleVin,
        mileage: contact.vehicleMileage,
        color: typeof contact.customFields?.color === 'string' ? contact.customFields.color : undefined,
        lastServiceDate: contact.lastServiceDate,
        purchaseDate: contact.purchaseDate,
      };
      const k = keyFor(primary);
      if (k) byKey.set(k, primary);
    }

    // Events arrive newest-first, so the first sighting of a vehicle already
    // carries its freshest mileage/dates; later (older) rows only fill gaps.
    for (const e of events) {
      // Events use vehicle*-prefixed columns; map them onto the garage shape
      // before keying (a bare keyFor(e) would silently produce an empty key).
      const k = keyFor({
        vin: e.vehicleVin,
        year: e.vehicleYear,
        make: e.vehicleMake,
        model: e.vehicleModel,
      });
      if (!k) continue;
      const existing = byKey.get(k);
      if (existing) {
        if (!existing.mileage && e.vehicleMileage) existing.mileage = e.vehicleMileage;
        if (!existing.vin && e.vehicleVin) existing.vin = e.vehicleVin;
        if (e.type === 'service' && !existing.lastServiceDate && e.eventDate) {
          existing.lastServiceDate = e.eventDate;
        }
        if (e.type === 'sale' && !existing.purchaseDate && e.eventDate) {
          existing.purchaseDate = e.eventDate;
        }
        continue;
      }
      byKey.set(k, {
        year: e.vehicleYear ?? undefined,
        make: e.vehicleMake ?? undefined,
        model: e.vehicleModel ?? undefined,
        vin: e.vehicleVin ?? undefined,
        mileage: e.vehicleMileage ?? undefined,
        lastServiceDate: e.type === 'service' ? e.eventDate ?? undefined : undefined,
        purchaseDate: e.type === 'sale' ? e.eventDate ?? undefined : undefined,
      });
    }

    return [...byKey.values()];
  }, [contact, events]);

  const addedDateLabel = useMemo(() => {
    if (!contact?.dateAdded) return '';
    return formatRelativeDate(contact.dateAdded) || formatDate(contact.dateAdded);
  }, [contact?.dateAdded]);

  const accountLogo = useMemo(() => accountLogoUrl(account), [account]);
  const accountAddress = useMemo(() => accountAddressLine(account), [account]);

  // PATCH a single field on the contact (canonical column OR custom
  // field under custom:<key>). Optimistically updates local state,
  // re-syncs from the server response, and re-throws on error so the
  // inline-edit component can surface the failure.
  const patchContact = useCallback(
    async (input:
      | { kind: 'canonical'; column: string; value: unknown }
      | { kind: 'custom'; key: string; value: unknown }
    ): Promise<void> => {
      if (!contactId || !accountKey || !contact) {
        throw new Error('Contact not loaded yet.');
      }
      const body: Record<string, unknown> = {};
      if (input.kind === 'canonical') {
        body[input.column] = normalizeForWire(input.value);
      } else {
        // Merge with existing custom fields rather than overwriting the
        // whole blob — partial updates are the API contract for any
        // sane custom-field editor.
        const next: Record<string, unknown> = { ...(contact.customFields ?? {}) };
        const wireValue = normalizeForWire(input.value);
        if (wireValue === null || wireValue === '') {
          delete next[input.key];
        } else {
          next[input.key] = wireValue;
        }
        body.customFields = next;
      }

      const res = await fetch(
        `/api/contacts/${encodeURIComponent(contactId)}?accountKey=${encodeURIComponent(accountKey)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to save');
      }
      // Server is authoritative. Re-hydrate the contact so the UI
      // reflects whatever normalization the API performed (date
      // canonicalization, etc.).
      if (data.contact) {
        setContact(data.contact as ContactDetail);
      }
    },
    [contactId, accountKey, contact],
  );

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

  // 1:1 send hook for the activity thread. Re-throws on failure so
  // the thread component can surface the error inline; on success it
  // appends the new outbound bubble to local state so the user sees
  // their message immediately without waiting for a refetch.
  const handleThreadSend = useCallback(
    async (input: { channel: 'SMS' | 'MMS'; message: string; mediaUrls: string[] }) => {
      if (!contactId || !accountKey) {
        throw new Error('Contact not loaded yet.');
      }
      const trimmed = input.message.trim();
      if (trimmed.length > 640) {
        throw new Error(`${input.channel} must be 640 characters or fewer.`);
      }

      const res = await fetch(
        `/api/contacts/${encodeURIComponent(contactId)}/sms?accountKey=${encodeURIComponent(accountKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel: input.channel, message: trimmed, mediaUrls: input.mediaUrls }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to send message');
      }

      const sentMessage = data?.message && typeof data.message === 'object'
        ? (data.message as ConvoMessage)
        : null;
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
    },
    [contactId, accountKey],
  );

  // Adapt the page's loose ConvoMessage (subject/contentType typed as
  // `unknown` for resilience to API drift) to the thread's tighter
  // shape. Done once per messages list change rather than per render
  // so the thread's memoised day-grouping stays cheap.
  const messagesForThread = useMemo<ThreadConvoMessage[]>(
    () =>
      messages.map((m) => ({
        id: toText(m.id),
        channel: (toText(m.channel).toUpperCase() as ThreadConvoMessage['channel']) || 'SMS',
        direction: toText(m.direction).toLowerCase() === 'inbound' ? 'inbound' : 'outbound',
        body: toText(m.body),
        dateAdded: toText(m.dateAdded),
        subject: toText(m.subject) || undefined,
      })),
    [messages],
  );

  // Narrow the page's looser ConvoStats (lastMessageDirection: string)
  // to the thread's tighter shape ('inbound' | 'outbound' | null).
  // API drift would surface here as 'inbound'/'outbound' literals
  // anyway; the cast keeps types honest.
  const statsForThread = useMemo<ThreadConvoStats | null>(() => {
    if (!stats) return null;
    const dir = stats.lastMessageDirection;
    return {
      totalMessages: stats.totalMessages,
      smsCount: stats.smsCount,
      emailCount: stats.emailCount,
      lastMessageDate: stats.lastMessageDate,
      lastMessageDirection:
        dir === 'inbound' || dir === 'outbound' ? dir : null,
    };
  }, [stats]);

  const hasPhone = Boolean(contact?.phone);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-stretch justify-center bg-black/60 backdrop-blur-sm sm:p-4"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label={fullName || 'Contact details'}
    >
      {/* Header pinned, body scrolls. `min-h-0` on the scroll band is
          load-bearing — a flex child won't shrink below its content
          without it, so the overflow would never engage and the panel
          would grow past the viewport instead. */}
      <div
        className="glass-card w-full sm:max-w-[1500px] sm:rounded-2xl border border-[var(--border)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
      <div className="flex-shrink-0 border-b border-[var(--border)]/70 px-4 sm:px-6 py-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
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
                  <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">Account</p>
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

          <button
            type="button"
            onClick={handleClose}
            title="Close (Esc)"
            aria-label="Close contact details"
            className="ml-auto p-2 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)]/40 transition-colors flex-shrink-0"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-5 space-y-5">

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
              <div className="grid gap-2.5 sm:grid-cols-2">
                {/* Name is editable here rather than only in the header:
                    the API re-derives the stored `fullName` column from
                    these two, which is what the contacts list searches,
                    sorts and displays. */}
                <InlineEditableField
                  label="First name"
                  type="text"
                  fieldRef={{ kind: 'canonical', column: 'firstName' }}
                  displayValue={contact.firstName || '—'}
                  rawValue={contact.firstName}
                  onSave={(v) => patchContact({ kind: 'canonical', column: 'firstName', value: v })}
                />
                <InlineEditableField
                  label="Last name"
                  type="text"
                  fieldRef={{ kind: 'canonical', column: 'lastName' }}
                  displayValue={contact.lastName || '—'}
                  rawValue={contact.lastName}
                  onSave={(v) => patchContact({ kind: 'canonical', column: 'lastName', value: v })}
                />
                <InlineEditableField
                  label="Email"
                  type="text"
                  fieldRef={{ kind: 'canonical', column: 'email' }}
                  displayValue={contact.email || '—'}
                  rawValue={contact.email}
                  onSave={(v) => patchContact({ kind: 'canonical', column: 'email', value: v })}
                />
                <InlineEditableField
                  label="Phone"
                  type="text"
                  fieldRef={{ kind: 'canonical', column: 'phone' }}
                  displayValue={contact.phone || '—'}
                  rawValue={contact.phone}
                  onSave={(v) => patchContact({ kind: 'canonical', column: 'phone', value: v })}
                />
                <InlineEditableField
                  label="Address"
                  type="text"
                  fieldRef={{ kind: 'canonical', column: 'address1' }}
                  displayValue={contact.address1 || '—'}
                  rawValue={contact.address1}
                  onSave={(v) => patchContact({ kind: 'canonical', column: 'address1', value: v })}
                />
                <InlineEditableField
                  label="City / State / Zip"
                  type="text"
                  fieldRef={{ kind: 'canonical', column: 'city' }}
                  displayValue={[contact.city, contact.state, contact.postalCode].filter(Boolean).join(', ') || '—'}
                  rawValue={[contact.city, contact.state, contact.postalCode].filter(Boolean).join(', ')}
                  onSave={async (v) => {
                    const [city = '', state = '', postalCode = ''] = String(v ?? '').split(',').map((s) => s.trim());
                    await Promise.all([
                      patchContact({ kind: 'canonical', column: 'city', value: city }),
                      patchContact({ kind: 'canonical', column: 'state', value: state }),
                      patchContact({ kind: 'canonical', column: 'postalCode', value: postalCode }),
                    ]);
                  }}
                />
                <InlineEditableField
                  label="Source"
                  type="text"
                  fieldRef={{ kind: 'canonical', column: 'source' }}
                  displayValue={contact.source || '—'}
                  rawValue={contact.source}
                  onSave={(v) => patchContact({ kind: 'canonical', column: 'source', value: v })}
                />
                <InlineEditableField
                  label="Tags"
                  type="text"
                  fieldRef={{ kind: 'canonical', column: 'tags' }}
                  displayValue={contact.tags?.length ? contact.tags.join(', ') : '—'}
                  rawValue={contact.tags?.join(', ') ?? ''}
                  hint="Comma-separated"
                  onSave={(v) => patchContact({
                    kind: 'canonical',
                    column: 'tags',
                    value: [...new Set(String(v ?? '').split(',').map((t) => t.trim()).filter(Boolean))],
                  })}
                />
              </div>
            </section>

            {/* Garage — the contact's vehicle(s), with the EVOX jellybean for
                the selected one. Renders only for automotive contacts (those
                with vehicle data on the row or in their history). */}
            {garage.length > 0 && (
              <VehicleCard
                vehicles={garage}
                leaseEndDate={contact.leaseEndDate}
                warrantyEndDate={contact.warrantyEndDate}
                dealType={typeof contact.customFields?.deal_type === 'string' ? contact.customFields.deal_type : ''}
              />
            )}

            {/* Service + purchase timeline (hidden for non-automotive
                contacts with no history at all). */}
            {(garage.length > 0 || events.length > 0) && (
              <ContactHistory events={events} loading={eventsLoading} error={eventsError} />
            )}

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

            {/* Custom fields — always renders so reps see where to
                declare account-specific data. Hardcoded Vehicle +
                Lifecycle sections used to live here; those columns
                still exist on Contact for the filter engine + legacy
                data, but the detail page is now custom-fields-first.
                Declare a "Vehicle Make" or "Next Service Date"
                blueprint to bring them back as proper account-scoped
                fields. */}
            <SectionCard
              title="Custom Fields"
              icon={<TagIcon className="w-3.5 h-3.5" />}
              action={
                <Link
                  href={subHref('/settings/contact-fields')}
                  className="text-[11px] text-[var(--primary)] hover:underline"
                >
                  Manage fields →
                </Link>
              }
            >
              {declaredCustomFields.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--muted)]/15 px-4 py-6 text-center">
                  <p className="text-xs text-[var(--foreground)] mb-1">
                    No custom fields declared yet
                  </p>
                  <p className="text-[11px] text-[var(--muted-foreground)] max-w-[280px] mx-auto">
                    Declare fields like <span className="font-mono">last_service_date</span> or{' '}
                    <span className="font-mono">lifetime_value</span> in Settings → Custom Fields,
                    or have an admin deploy a blueprint.
                  </p>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {declaredCustomFields.map((cf) => {
                    const raw = contact.customFields?.[cf.key];
                    return (
                      <InlineEditableField
                        key={cf.id}
                        label={cf.label}
                        type={cf.type as EditableFieldType}
                        options={cf.options}
                        mono={cf.type === 'number'}
                        hint={cf.description ?? undefined}
                        displayValue={formatCustomFieldValue(raw, cf.type, cf.options)}
                        rawValue={raw}
                        fieldRef={{ kind: 'custom', key: cf.key }}
                        onSave={(v) => patchContact({ kind: 'custom', key: cf.key, value: v })}
                      />
                    );
                  })}
                </div>
              )}
            </SectionCard>
          </div>

          {/* Activity thread — pinned chat-style panel with composer at
              bottom. The page still owns the message list + send call
              so the thread component stays presentational. */}
          <ContactActivityThread
            messages={messagesForThread}
            stats={statsForThread}
            loading={messagesLoading}
            error={messagesError}
            hasPhone={hasPhone}
            smsSuppressed={dnd.sms}
            onSend={handleThreadSend}
          />
        </div>
      )}
      </div>
      </div>
    </div>
  );
}

// ── Subcomponents ──

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

/** Section shell with consistent card chrome + header. Replaces the
 *  ad-hoc <section className="glass-card …"> wrappers so every panel
 *  on the page reads as the same visual primitive. */
function SectionCard({
  title,
  icon,
  children,
  action,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  /** Optional inline-right control (link, button) rendered next to the title. */
  action?: React.ReactNode;
}) {
  return (
    <section className="glass-card rounded-2xl p-4 border border-[var(--border)]/70">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-1.5">
          {icon}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

