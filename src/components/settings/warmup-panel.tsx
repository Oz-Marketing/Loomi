'use client';

/**
 * Domain warm-up panel for Settings → Email & Texts → Sending Config.
 *
 * Every sending domain Loomi is being pointed at is brand new, so this is not
 * an advanced option tucked away for the one account that needs it — it is the
 * first thing staff setting up an account should see, and it has to teach as
 * well as control. Hence the ramp table: "what is my cap today" is answerable
 * from a single number, but "why is my 20,000-person send going to take two
 * weeks, and when can I stop worrying" needs the whole shape visible.
 *
 * The thresholds in the guidance are the published ones every major provider
 * agrees on (bounces under 2%, complaints under 0.1%), stated as numbers rather
 * than "keep it low" because a number is something staff can actually check.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowTrendingUpIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PauseCircleIcon,
  PlayCircleIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';

interface Allowance {
  domain: string;
  dailyCap: number | null;
  usedToday: number;
  remaining: number | null;
  day: number | null;
  totalDays: number;
  status: 'none' | 'active' | 'paused' | 'completed';
}

interface WarmupResponse {
  domain: string | null;
  allowance: Allowance | null;
  schedule: number[];
  sharedWith: string[];
}

const num = (n: number) => n.toLocaleString();

/** Best practice, ordered by when it matters rather than by importance. */
const GUIDANCE: { title: string; body: string }[] = [
  {
    title: 'Authenticate the domain before the first send',
    body:
      'DKIM, SPF and DMARC must be in place on day one. A warm-up on an unauthenticated domain teaches providers nothing — the mail is filtered on identity, not volume.',
  },
  {
    title: 'Send to your most engaged contacts first',
    body:
      'Loomi does this automatically while a warm-up is active: contacts who have clicked go first, then openers, then everyone else. Opens are the signal that earns reputation, so the early days should be spent on people likely to produce them.',
  },
  {
    title: 'Keep bounces under 2% and complaints under 0.1%',
    body:
      'These are the published thresholds. Crossing them during a warm-up does more damage than sending nothing, because the ramp is exactly when providers are deciding what to make of the domain.',
  },
  {
    title: 'Send consistently — gaps cost progress',
    body:
      'A domain that sends daily for a week then goes quiet for a month restarts from a colder position. Steady, modest volume beats occasional large batches.',
  },
  {
    title: 'Clean the list before the ramp, not during it',
    body:
      'Warming up slowly spreads bad addresses across more days; it does not remove them. Verify or drop never-engaged and imported contacts first.',
  },
];

export function WarmupPanel({ accountKey }: { accountKey: string }) {
  const [data, setData] = useState<WarmupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!accountKey) return;
    try {
      const res = await fetch(`/api/accounts/${accountKey}/warmup`);
      if (!res.ok) return;
      setData((await res.json()) as WarmupResponse);
    } finally {
      setLoading(false);
    }
  }, [accountKey]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: 'start' | 'pause' | 'resume') {
    setBusy(true);
    try {
      const res = await fetch(`/api/accounts/${accountKey}/warmup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Could not update the warm-up');
      setData(body as WarmupResponse);
      toast.success(
        action === 'start'
          ? 'Warm-up started at day 1.'
          : action === 'pause'
            ? 'Warm-up paused — the daily cap no longer applies.'
            : 'Warm-up resumed.',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the warm-up');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
        <div className="h-5 w-40 rounded bg-[var(--muted)] animate-pulse" />
      </section>
    );
  }

  const allowance = data?.allowance ?? null;
  const status = allowance?.status ?? 'none';
  const schedule = data?.schedule ?? [];

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center flex-shrink-0">
          <ArrowTrendingUpIcon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-[var(--foreground)]">Domain Warm-up</h3>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
            A new sending domain that opens with a large blast gets throttled or filtered, and the
            damage sticks to the domain long after the campaign. A warm-up raises the daily limit
            gradually and sends to your most engaged contacts first.
          </p>
        </div>
      </div>

      {/* No From address yet — nothing to warm, and saying so beats an inert button. */}
      {!data?.domain ? (
        <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-3 text-xs text-[var(--muted-foreground)]">
          Set a From address above and save, then a warm-up can be started for its domain.
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-[var(--border)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">
                  Sending domain
                </p>
                <p className="text-sm font-medium mt-0.5 break-all">{data.domain}</p>
              </div>
              <StatusPill status={status} day={allowance?.day ?? null} total={allowance?.totalDays ?? 0} />
            </div>

            {status === 'active' && allowance?.dailyCap != null && (
              <div className="mt-4">
                <div className="flex items-end justify-between gap-3 mb-1.5">
                  <p className="text-sm">
                    <span className="text-2xl font-semibold tabular-nums">
                      {num(allowance.remaining ?? 0)}
                    </span>
                    <span className="text-[var(--muted-foreground)]">
                      {' '}
                      of {num(allowance.dailyCap)} left today
                    </span>
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)] tabular-nums">
                    {num(allowance.usedToday)} sent
                  </p>
                </div>
                <div className="h-2 rounded-full bg-[var(--muted)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--primary)] transition-[width]"
                    style={{
                      width: `${Math.min(100, (allowance.usedToday / allowance.dailyCap) * 100)}%`,
                    }}
                  />
                </div>
                <p className="text-[11px] text-[var(--muted-foreground)] mt-2">
                  Blasts beyond today&apos;s limit are not cancelled — they keep sending on
                  following days until the whole audience is covered.
                </p>
              </div>
            )}

            {status === 'completed' && (
              <p className="text-xs text-[var(--muted-foreground)] mt-3">
                This domain has finished its ramp and sends without a daily limit.
              </p>
            )}

            {status === 'paused' && (
              <p className="text-xs text-amber-400 mt-3">
                Paused — the daily limit is not being enforced. Resume to continue the ramp where it
                left off.
              </p>
            )}

            {/* Starting a warm-up for a shared domain throttles the siblings too.
                That is correct (one domain, one reputation, one budget) but it
                must not be a surprise. */}
            {data.sharedWith.length > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2">
                <ExclamationTriangleIcon className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-200/90">
                  {data.sharedWith.length === 1 ? 'Another account also sends' : 'Other accounts also send'}{' '}
                  from this domain ({data.sharedWith.join(', ')}). They share one reputation, so they
                  share this daily limit.
                </p>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {status === 'none' || status === 'completed' ? (
                <button
                  type="button"
                  onClick={() => act('start')}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary)]/90 disabled:opacity-40"
                >
                  <PlayCircleIcon className="w-4 h-4" />
                  {status === 'completed' ? 'Restart warm-up' : 'Start warm-up'}
                </button>
              ) : status === 'active' ? (
                <button
                  type="button"
                  onClick={() => act('pause')}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium rounded-lg border border-[var(--border)] hover:border-[var(--muted-foreground)] disabled:opacity-40"
                >
                  <PauseCircleIcon className="w-4 h-4" />
                  Pause
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => act('resume')}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary)]/90 disabled:opacity-40"
                >
                  <PlayCircleIcon className="w-4 h-4" />
                  Resume
                </button>
              )}
            </div>
            {status === 'completed' ? (
              <p className="text-[11px] text-[var(--muted-foreground)] mt-2">
                Restarting resets the ramp to day 1 — only worth doing if the domain&apos;s
                reputation needs rebuilding.
              </p>
            ) : status === 'none' ? (
              <p className="text-[11px] text-[var(--muted-foreground)] mt-2">
                Start this before the first campaign, not after. Warming a domain that has already
                sent badly is much slower than warming a clean one.
              </p>
            ) : null}
          </div>

          {/* The whole ramp, so a send can be planned against it rather than
              discovered a day at a time. */}
          {schedule.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold mb-2">
                Daily limits
              </p>
              <div className="overflow-x-auto">
                <div className="flex gap-1.5 min-w-max pb-1">
                  {schedule.map((cap, i) => {
                    const dayNumber = i + 1;
                    const isToday = status === 'active' && allowance?.day === dayNumber;
                    const isPast = status === 'active' && (allowance?.day ?? 0) > dayNumber;
                    return (
                      <div
                        key={dayNumber}
                        className={`rounded-lg border px-2.5 py-1.5 text-center ${
                          isToday
                            ? 'border-[var(--primary)] bg-[var(--primary)]/10'
                            : isPast
                              ? 'border-[var(--border)] opacity-50'
                              : 'border-[var(--border)]'
                        }`}
                      >
                        <p className="text-[10px] text-[var(--muted-foreground)]">Day {dayNumber}</p>
                        <p className="text-xs font-semibold tabular-nums">{num(cap)}</p>
                      </div>
                    );
                  })}
                  <div className="rounded-lg border border-dashed border-[var(--border)] px-2.5 py-1.5 text-center">
                    <p className="text-[10px] text-[var(--muted-foreground)]">After</p>
                    <p className="text-xs font-semibold">No limit</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Guidance is the point of this panel for a brand-new domain, so it is
          on screen rather than behind a tooltip. */}
      <div className="mt-5 pt-4 border-t border-[var(--border)]">
        <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold mb-3">
          Best practice for a new domain
        </p>
        <ul className="space-y-3">
          {GUIDANCE.map((item) => (
            <li key={item.title} className="flex items-start gap-2">
              <CheckCircleIcon className="w-4 h-4 text-[var(--primary)] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium leading-snug">{item.title}</p>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5 leading-relaxed">
                  {item.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function StatusPill({
  status,
  day,
  total,
}: {
  status: Allowance['status'];
  day: number | null;
  total: number;
}) {
  const map: Record<Allowance['status'], { label: string; tone: string }> = {
    none: { label: 'Not warming up', tone: 'bg-zinc-500/15 text-zinc-300' },
    active: { label: day ? `Day ${day} of ${total}` : 'Active', tone: 'bg-[var(--primary)]/15 text-[var(--primary)]' },
    paused: { label: 'Paused', tone: 'bg-amber-500/15 text-amber-400' },
    completed: { label: 'Warmed up', tone: 'bg-emerald-500/15 text-emerald-400' },
  };
  const { label, tone } = map[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}>
      {label}
    </span>
  );
}
