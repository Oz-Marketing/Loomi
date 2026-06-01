'use client';

// Chat-thread style activity panel for the contact detail page.
//
// Replaces the flat "Activity" card. Renders messages as iMessage-style
// bubbles (inbound on the left, outbound on the right), groups them by
// day with sticky date dividers, and pins an SMS/MMS composer to the
// bottom of the panel so reps can reply inline.
//
// Data shapes (`ConvoMessage` / `ConvoStats`) match the existing
// /api/contacts/:id/activity response so this slots in as a drop-in
// for the old activity render block — the page owns the loaded
// messages array and passes it through.

import * as React from 'react';
import {
  ArrowPathIcon,
  PaperAirplaneIcon,
  EnvelopeIcon,
  DevicePhoneMobileIcon,
  ChatBubbleLeftRightIcon,
  PhotoIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import PrimaryButton from '@/components/primary-button';

export interface ConvoMessage {
  id: string;
  channel: 'EMAIL' | 'SMS' | 'MMS';
  direction: 'inbound' | 'outbound';
  body: string;
  dateAdded: string;
  subject?: string;
}

export interface ConvoStats {
  totalMessages: number;
  smsCount: number;
  emailCount: number;
  lastMessageDate: string | null;
  lastMessageDirection: 'inbound' | 'outbound' | null;
}

export type ComposeChannel = 'SMS' | 'MMS';

interface ContactActivityThreadProps {
  messages: ConvoMessage[];
  stats: ConvoStats | null;
  loading: boolean;
  error: string | null;
  /** Disable composer + show inline hint when contact has no phone. */
  hasPhone: boolean;
  /** Disable composer when contact is SMS-suppressed. */
  smsSuppressed: boolean;
  /** Called when the user clicks Send — parent owns the API call. */
  onSend: (input: {
    channel: ComposeChannel;
    message: string;
    mediaUrls: string[];
  }) => Promise<void>;
}

/**
 * Standalone activity thread component. Keeps composer state internal
 * (draft, channel, errors) so the parent page only needs to wire
 * `messages` + the `onSend` callback. Auto-scrolls to the newest
 * message when the list changes, mirroring iMessage / Slack thread
 * behavior — but only when the user is already pinned to the bottom,
 * so scrolling back to read older messages doesn't yank them forward.
 */
export function ContactActivityThread({
  messages,
  stats,
  loading,
  error,
  hasPhone,
  smsSuppressed,
  onSend,
}: ContactActivityThreadProps) {
  const [channel, setChannel] = React.useState<ComposeChannel>('SMS');
  const [draft, setDraft] = React.useState('');
  const [mediaUrls, setMediaUrls] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [composerError, setComposerError] = React.useState<string | null>(null);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const wasAtBottomRef = React.useRef(true);

  // Track whether the user is pinned to the bottom of the thread. When
  // they scroll up to read history we don't want to yank them back down
  // on every new message arrival — only auto-scroll when they were
  // already at the bottom.
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasAtBottomRef.current = distanceFromBottom < 60;
  };

  React.useEffect(() => {
    if (!wasAtBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    // requestAnimationFrame so layout has flushed the new message bubble
    // before we measure the scroll target.
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages.length]);

  // Group messages by calendar day (newest -> oldest from server, but
  // we render oldest -> newest because chat threads read top-to-bottom).
  const grouped = React.useMemo(() => groupByDay(messages), [messages]);

  async function handleSend() {
    const trimmed = draft.trim();
    const urls = parseMediaUrls(mediaUrls);

    if (!hasPhone) {
      setComposerError('Contact has no phone number on file.');
      return;
    }
    if (smsSuppressed) {
      setComposerError('SMS is suppressed for this contact. Unblock SMS first.');
      return;
    }
    if (!trimmed && urls.length === 0) {
      setComposerError(
        channel === 'MMS'
          ? 'Enter an MMS message or at least one media URL.'
          : 'Write an SMS message first.',
      );
      return;
    }

    setSending(true);
    setComposerError(null);
    try {
      await onSend({ channel, message: trimmed, mediaUrls: urls });
      setDraft('');
      setMediaUrls('');
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : 'Failed to send.');
    } finally {
      setSending(false);
    }
  }

  const composerDisabled = !hasPhone || smsSuppressed;

  return (
    <section className="glass-card rounded-2xl border border-[var(--border)]/70 flex flex-col h-[calc(100vh-180px)] xl:sticky xl:top-4 overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 px-4 py-3 border-b border-[var(--border)]/70 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ChatBubbleLeftRightIcon className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Activity</h3>
        </div>
        {stats && stats.totalMessages > 0 && (
          <div className="flex items-center gap-3 text-[11px] text-[var(--muted-foreground)]">
            {stats.smsCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <DevicePhoneMobileIcon className="w-3 h-3" />
                {stats.smsCount}
              </span>
            )}
            {stats.emailCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <EnvelopeIcon className="w-3 h-3" />
                {stats.emailCount}
              </span>
            )}
          </div>
        )}
      </header>

      {/* Thread */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2"
      >
        {loading && (
          <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] py-6 justify-center">
            <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
            Loading activity…
          </div>
        )}

        {!loading && error && messages.length === 0 && (
          <p className="text-xs text-red-300 italic px-2 py-6 text-center">{error}</p>
        )}

        {!loading && !error && messages.length === 0 && (
          <div className="px-4 py-10 text-center">
            <ChatBubbleLeftRightIcon className="w-8 h-8 text-[var(--muted-foreground)]/50 mx-auto mb-2" />
            <p className="text-xs text-[var(--foreground)]">No activity yet</p>
            <p className="text-[11px] text-[var(--muted-foreground)] mt-1 max-w-[260px] mx-auto">
              Sends, opens, clicks, and replies will show up here as they happen.
            </p>
          </div>
        )}

        {grouped.map((day) => (
          <div key={day.label} className="space-y-2">
            <DayDivider label={day.label} />
            {day.messages.map((msg) => (
              <ChatBubble key={msg.id} msg={msg} />
            ))}
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className="flex-shrink-0 border-t border-[var(--border)]/70 bg-[var(--card)]/40 backdrop-blur-sm px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-2">
          {(['SMS', 'MMS'] as const).map((ch) => (
            <button
              key={ch}
              type="button"
              onClick={() => setChannel(ch)}
              disabled={sending}
              className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                channel === ch
                  ? 'border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--primary)]'
                  : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {ch}
            </button>
          ))}
          {composerDisabled && (
            <span className="inline-flex items-center gap-1 text-[10px] text-amber-300 ml-auto">
              <ExclamationCircleIcon className="w-3 h-3" />
              {!hasPhone ? 'No phone on file' : 'SMS suppressed'}
            </span>
          )}
        </div>

        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (composerError) setComposerError(null);
          }}
          onKeyDown={(e) => {
            // ⌘/Ctrl + Enter sends, plain Enter inserts newline — matches
            // Slack / Linear / iMessage on macOS conventions.
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder={
            channel === 'MMS'
              ? 'Write an MMS caption (optional if media URLs provided)…'
              : 'Write an SMS message… (⌘ Enter to send)'
          }
          rows={3}
          maxLength={640}
          disabled={composerDisabled || sending}
          className="w-full text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-2 focus:outline-none focus:border-[var(--primary)] resize-none disabled:opacity-50"
        />

        {channel === 'MMS' && (
          <div className="mt-2">
            <label className="block text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-1 flex items-center gap-1">
              <PhotoIcon className="w-3 h-3" />
              Media URLs
            </label>
            <textarea
              value={mediaUrls}
              onChange={(e) => {
                setMediaUrls(e.target.value);
                if (composerError) setComposerError(null);
              }}
              placeholder="One per line"
              rows={2}
              disabled={composerDisabled || sending}
              className="w-full text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-2 focus:outline-none focus:border-[var(--primary)] resize-none disabled:opacity-50"
            />
          </div>
        )}

        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-[var(--muted-foreground)]">
            {draft.trim().length}/640
          </span>
          <PrimaryButton
            type="button"
            onClick={handleSend}
            disabled={sending || composerDisabled}
          >
            {sending ? (
              <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <PaperAirplaneIcon className="w-3.5 h-3.5" />
            )}
            {sending ? 'Sending…' : `Send ${channel}`}
          </PrimaryButton>
        </div>

        {composerError && (
          <p className="mt-1.5 text-[11px] text-red-300">{composerError}</p>
        )}
      </div>
    </section>
  );
}

// ── Chat bubble ──

function ChatBubble({ msg }: { msg: ConvoMessage }) {
  const isInbound = msg.direction === 'inbound';
  const isEmail = msg.channel === 'EMAIL';
  const time = formatTime(msg.dateAdded);
  const ChannelIcon = isEmail ? EnvelopeIcon : DevicePhoneMobileIcon;

  return (
    <div className={`flex ${isInbound ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[88%] ${isInbound ? '' : 'items-end flex flex-col'}`}>
        <div
          className={`rounded-2xl px-3 py-2 border ${
            isInbound
              ? 'bg-[var(--muted)]/50 border-[var(--border)] rounded-bl-md'
              : 'bg-[var(--primary)]/15 border-[var(--primary)]/30 rounded-br-md'
          }`}
        >
          {/* Email subject line — rendered as the bubble's "header" so
              the body reads as the email's content. SMS bubbles skip
              this row entirely. */}
          {isEmail && msg.subject && (
            <p className="text-[11px] font-semibold text-[var(--foreground)] mb-1 break-words">
              {msg.subject}
            </p>
          )}
          <p className="text-[12px] text-[var(--foreground)] whitespace-pre-wrap break-words leading-snug">
            {msg.body}
          </p>
        </div>
        <div
          className={`flex items-center gap-1 text-[10px] text-[var(--muted-foreground)] mt-0.5 px-1 ${
            isInbound ? '' : 'flex-row-reverse'
          }`}
        >
          <ChannelIcon className="w-2.5 h-2.5" />
          <span>{time}</span>
        </div>
      </div>
    </div>
  );
}

// ── Day divider ──

function DayDivider({ label }: { label: string }) {
  return (
    <div className="sticky top-0 z-10 -mx-3 px-3 py-1 flex items-center gap-2 bg-gradient-to-b from-[var(--card)] via-[var(--card)]/95 to-transparent">
      <div className="flex-1 h-px bg-[var(--border)]/60" />
      <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-medium">
        {label}
      </span>
      <div className="flex-1 h-px bg-[var(--border)]/60" />
    </div>
  );
}

// ── Helpers ──

interface DayGroup {
  label: string;
  messages: ConvoMessage[];
}

/** Group messages by calendar day with friendly labels and ensure
 *  display order is oldest → newest within each day (the API hands us
 *  newest-first; chat threads read top → bottom). */
function groupByDay(messages: ConvoMessage[]): DayGroup[] {
  const buckets = new Map<string, ConvoMessage[]>();
  for (const msg of messages) {
    const date = new Date(msg.dateAdded);
    if (isNaN(date.getTime())) continue;
    const key = date.toISOString().slice(0, 10);
    const arr = buckets.get(key) ?? [];
    arr.push(msg);
    buckets.set(key, arr);
  }
  // Sort buckets oldest → newest day; messages within each oldest → newest.
  const orderedKeys = Array.from(buckets.keys()).sort();
  return orderedKeys.map((key) => {
    const msgs = (buckets.get(key) ?? []).slice().sort(
      (a, b) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime(),
    );
    return { label: dayLabel(key), messages: msgs };
  });
}

function dayLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  if (isNaN(d.getTime())) return isoDate;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  // Within the past week → weekday name
  const dayMs = 24 * 60 * 60 * 1000;
  const diff = (today.getTime() - d.getTime()) / dayMs;
  if (diff >= 0 && diff < 7) {
    return d.toLocaleDateString('en-US', { weekday: 'long' });
  }
  // Within the same year → drop year
  if (d.getFullYear() === today.getFullYear()) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function parseMediaUrls(raw: string): string[] {
  if (!raw.trim()) return [];
  return [
    ...new Set(
      raw
        .split(/[\n,\s]+/g)
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((s) => /^https?:\/\/\S+$/i.test(s)),
    ),
  ];
}
