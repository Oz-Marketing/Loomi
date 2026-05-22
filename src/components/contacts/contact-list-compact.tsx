'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  MagnifyingGlassIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  EnvelopeIcon,
  PhoneIcon,
  MapPinIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';

interface Contact {
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

const PAGE_SIZE = 20;

function daysUntil(dateStr: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function formatRelativeDate(iso: string) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days < 0) return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function ContactListCompact({
  accountKey,
}: {
  accountKey: string;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        accountKey,
        limit: String(PAGE_SIZE),
      });
      if (debouncedSearch) params.set('search', debouncedSearch);

      const res = await fetch(`/api/contacts?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch contacts');
      }
      const data = await res.json();
      setContacts(data.contacts || []);
      setTotalCount(data.meta?.total ?? data.contacts?.length ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contacts');
      setContacts([]);
      setTotalCount(0);
    }
    setLoading(false);
  }, [accountKey, debouncedSearch]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  return (
    <div>
      {/* Search + refresh bar */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted-foreground)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
        <button
          onClick={fetchContacts}
          disabled={loading}
          className="p-2 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          title="Refresh"
        >
          <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 mb-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && contacts.length === 0 && (
        <div className="text-center py-8 text-[var(--muted-foreground)]">
          <ArrowPathIcon className="w-5 h-5 animate-spin mx-auto mb-2" />
          <p className="text-sm">Loading contacts...</p>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && contacts.length === 0 && (
        <div className="text-center py-8 border border-dashed border-[var(--border)] rounded-xl">
          <p className="text-[var(--muted-foreground)] text-sm">
            {debouncedSearch ? 'No contacts match your search.' : 'No contacts found.'}
          </p>
        </div>
      )}

      {/* Contact rows */}
      {contacts.length > 0 && (
        <div className="space-y-1">
          {contacts.map((contact) => {
            const isExpanded = expandedId === contact.id;
            const vehicleStr = [contact.vehicleYear, contact.vehicleMake, contact.vehicleModel]
              .filter(Boolean)
              .join(' ');

            // Alert pills
            const alerts: { label: string; color: string }[] = [];
            if (contact.nextServiceDate) {
              const d = daysUntil(contact.nextServiceDate);
              if (d !== null && d < 0) {
                alerts.push({ label: 'Service overdue', color: 'bg-red-500/15 text-red-400' });
              }
            }
            if (contact.leaseEndDate) {
              const d = daysUntil(contact.leaseEndDate);
              if (d !== null && d >= 0 && d <= 90) {
                alerts.push({ label: `Lease: ${d}d`, color: 'bg-amber-500/15 text-amber-400' });
              }
            }
            if (contact.warrantyEndDate) {
              const d = daysUntil(contact.warrantyEndDate);
              if (d !== null && d >= 0 && d <= 90) {
                alerts.push({ label: `Warranty: ${d}d`, color: 'bg-amber-500/15 text-amber-400' });
              }
            }

            return (
              <div key={contact.id} className="glass-card rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : contact.id)}
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-[var(--muted)]/30 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold bg-[var(--primary)]/10 text-[var(--primary)] flex-shrink-0">
                      {(contact.firstName || contact.fullName || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">
                        {contact.fullName || `${contact.firstName} ${contact.lastName}`.trim() || 'Unknown'}
                      </p>
                      <div className="flex items-center gap-3 text-[10px] text-[var(--muted-foreground)]">
                        {contact.email && <span className="truncate">{contact.email}</span>}
                        {contact.phone && <span className="flex-shrink-0">{contact.phone}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                    {alerts.map((alert, i) => (
                      <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${alert.color}`}>
                        {alert.label}
                      </span>
                    ))}
                    {vehicleStr && (
                      <span className="text-[10px] text-[var(--muted-foreground)] bg-[var(--muted)] px-2 py-0.5 rounded-full hidden sm:inline">
                        {vehicleStr}
                      </span>
                    )}
                    {isExpanded ? (
                      <ChevronUpIcon className="w-4 h-4 text-[var(--muted-foreground)]" />
                    ) : (
                      <ChevronDownIcon className="w-4 h-4 text-[var(--muted-foreground)]" />
                    )}
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-3 pb-3 pt-1 border-t border-[var(--border)] animate-fade-in-up">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                      {/* Contact info */}
                      <div className="space-y-2">
                        <h4 className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">Contact</h4>
                        {contact.email && (
                          <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
                            <EnvelopeIcon className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="truncate">{contact.email}</span>
                          </div>
                        )}
                        {contact.phone && (
                          <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
                            <PhoneIcon className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>{contact.phone}</span>
                          </div>
                        )}
                        {(contact.address1 || contact.city) && (
                          <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
                            <MapPinIcon className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="truncate">
                              {[contact.address1, contact.city, contact.state, contact.postalCode]
                                .filter(Boolean)
                                .join(', ')}
                            </span>
                          </div>
                        )}
                        {contact.source && (
                          <DetailRow label="Source" value={contact.source} />
                        )}
                        {contact.dateAdded && (
                          <DetailRow label="Added" value={formatRelativeDate(contact.dateAdded)} />
                        )}
                        {contact.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {contact.tags.map(tag => (
                              <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Vehicle info */}
                      <div className="space-y-2">
                        <h4 className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">Vehicle</h4>
                        {vehicleStr ? (
                          <>
                            <DetailRow label="Vehicle" value={vehicleStr} />
                            <DetailRow label="VIN" value={contact.vehicleVin} mono />
                            <DetailRow label="Mileage" value={contact.vehicleMileage} />
                          </>
                        ) : (
                          <p className="text-[10px] text-[var(--muted-foreground)] italic">No vehicle data</p>
                        )}
                      </div>

                      {/* Dates + lifecycle */}
                      <div className="space-y-2">
                        <h4 className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1">
                          <ClockIcon className="w-3 h-3" />
                          Lifecycle
                        </h4>
                        <DateRow label="Last Service" dateStr={contact.lastServiceDate} type="past" />
                        <DateRow label="Next Service" dateStr={contact.nextServiceDate} type="future" />
                        <DateRow label="Purchase" dateStr={contact.purchaseDate} type="past" />
                        <DateRow label="Lease End" dateStr={contact.leaseEndDate} type="future" />
                        <DateRow label="Warranty End" dateStr={contact.warrantyEndDate} type="future" />
                      </div>

                      {/* Conversations */}
                      <ConversationPanel contactId={contact.id} accountKey={accountKey} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-3 text-xs text-[var(--muted-foreground)]">
          <span>
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1.5 rounded hover:bg-[var(--muted)] disabled:opacity-30 transition-colors"
            >
              <ChevronLeftIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={(page + 1) * PAGE_SIZE >= totalCount}
              className="p-1.5 rounded hover:bg-[var(--muted)] disabled:opacity-30 transition-colors"
            >
              <ChevronRightIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[var(--muted-foreground)]">{label}</span>
      <span className={mono ? 'font-mono text-[10px]' : ''}>{value}</span>
    </div>
  );
}

interface ConvoMessage {
  id: string;
  type: string;
  direction: string;
  body: string;
  dateAdded: string;
  subject?: string;
}

interface ConvoStats {
  totalMessages: number;
  smsCount: number;
  emailCount: number;
  lastMessageDate: string | null;
  lastMessageDirection: string | null;
}

function ConversationPanel({ contactId, accountKey }: { contactId: string; accountKey: string }) {
  const [messages, setMessages] = useState<ConvoMessage[]>([]);
  const [stats, setStats] = useState<ConvoStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [convoError, setConvoError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/contacts/${contactId}/activity?accountKey=${accountKey}`)
      .then(r => r.json())
      .then(data => {
        if (data.error && !data.messages) {
          setConvoError(data.error);
        } else {
          setMessages(data.messages || []);
          setStats(data.stats || null);
          if (data.error) setConvoError(data.error);
        }
        setLoading(false);
      })
      .catch(() => {
        setConvoError('Failed to load conversations');
        setLoading(false);
      });
  }, [contactId, accountKey]);

  return (
    <div className="space-y-2">
      <h4 className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1">
        <ChatBubbleLeftRightIcon className="w-3 h-3" />
        Messages
      </h4>

      {loading && (
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]">
          <ArrowPathIcon className="w-3 h-3 animate-spin" />
          Loading...
        </div>
      )}

      {!loading && convoError && messages.length === 0 && (
        <p className="text-[10px] text-[var(--muted-foreground)] italic">{convoError}</p>
      )}

      {!loading && !convoError && messages.length === 0 && (
        <p className="text-[10px] text-[var(--muted-foreground)] italic">No messages</p>
      )}

      {/* Stats summary */}
      {stats && stats.totalMessages > 0 && (
        <div className="flex items-center gap-3 text-[10px] text-[var(--muted-foreground)]">
          {stats.smsCount > 0 && (
            <span className="flex items-center gap-1">
              <PhoneIcon className="w-3 h-3" />
              {stats.smsCount} SMS
            </span>
          )}
          {stats.emailCount > 0 && (
            <span className="flex items-center gap-1">
              <EnvelopeIcon className="w-3 h-3" />
              {stats.emailCount} email
            </span>
          )}
        </div>
      )}

      {/* Recent messages */}
      {messages.length > 0 && (
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {messages.slice(0, 10).map((msg) => {
            const isInbound = msg.direction === 'inbound';
            const typeLabel = (msg.type || '').toUpperCase();
            const isEmail = typeLabel === 'EMAIL';
            return (
              <div
                key={msg.id}
                className={`p-2 rounded-md text-[10px] ${
                  isInbound
                    ? 'bg-[var(--primary)]/5 border-l-2 border-[var(--primary)]'
                    : 'bg-[var(--muted)] border-l-2 border-[var(--muted-foreground)]'
                }`}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-medium flex items-center gap-1">
                    {isInbound ? '← In' : '→ Out'}
                    <span className="text-[var(--muted-foreground)] font-normal">
                      {isEmail ? 'Email' : typeLabel || 'MSG'}
                    </span>
                  </span>
                  {msg.dateAdded && (
                    <span className="text-[var(--muted-foreground)]">
                      {formatRelativeDate(msg.dateAdded)}
                    </span>
                  )}
                </div>
                {msg.subject && (
                  <p className="font-medium text-[10px] mb-0.5 truncate">{msg.subject}</p>
                )}
                <p className="text-[var(--muted-foreground)] line-clamp-2">
                  {msg.body || '(no content)'}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DateRow({ label, dateStr, type }: { label: string; dateStr: string; type: 'past' | 'future' }) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;

  const days = daysUntil(dateStr);
  let statusColor = 'text-[var(--muted-foreground)]';
  let statusText = '';

  if (type === 'future' && days !== null) {
    if (days < 0) {
      statusColor = 'text-red-400';
      statusText = `${Math.abs(days)}d overdue`;
    } else if (days <= 30) {
      statusColor = 'text-amber-400';
      statusText = `${days}d`;
    } else if (days <= 90) {
      statusColor = 'text-yellow-400';
      statusText = `${days}d`;
    } else {
      statusText = `${days}d`;
    }
  }

  const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[var(--muted-foreground)]">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className="text-[10px]">{formatted}</span>
        {statusText && (
          <span className={`text-[9px] font-medium ${statusColor}`}>{statusText}</span>
        )}
      </span>
    </div>
  );
}
