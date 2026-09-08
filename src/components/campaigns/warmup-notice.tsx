'use client';

/**
 * Warm-up notice for the blast schedule step.
 *
 * The settings panel explains the ramp; this answers the one question that
 * matters at the moment of scheduling — "how long will THIS send take?" A
 * capped 8,400-recipient blast spread over twelve days is fine if you expected
 * it and alarming if you didn't, and the difference is entirely whether anyone
 * told you before you pressed the button.
 *
 * Renders nothing when the domain isn't capped, which is the common case.
 */
import { useEffect, useState } from 'react';
import { ArrowTrendingUpIcon } from '@heroicons/react/24/outline';
import { estimateDaysToSend } from '@/lib/sending/warmup-estimate';

interface Allowance {
  dailyCap: number | null;
  usedToday: number;
  remaining: number | null;
  day: number | null;
  totalDays: number;
  status: 'none' | 'active' | 'paused' | 'completed';
}

const num = (n: number) => n.toLocaleString();

export function WarmupNotice({
  accountKey,
  recipientCount,
}: {
  accountKey: string;
  recipientCount: number;
}) {
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const [schedule, setSchedule] = useState<number[]>([]);

  useEffect(() => {
    if (!accountKey) return;
    let cancelled = false;
    fetch(`/api/accounts/${accountKey}/warmup`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setAllowance(data.allowance ?? null);
        setSchedule(Array.isArray(data.schedule) ? data.schedule : []);
      })
      .catch(() => {
        // Advisory only — a failed lookup must not block scheduling.
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey]);

  if (!allowance || allowance.status !== 'active' || allowance.dailyCap == null) return null;

  const remaining = allowance.remaining ?? 0;
  const days = estimateDaysToSend(schedule, (allowance.day ?? 1) - 1, remaining, recipientCount);

  return (
    <div className="mt-4 rounded-xl border border-[var(--primary)]/25 bg-[var(--primary)]/5 px-4 py-3">
      <div className="flex items-start gap-2.5">
        <ArrowTrendingUpIcon className="w-4 h-4 text-[var(--primary)] flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[var(--foreground)]">
            This domain is warming up — day {allowance.day} of {allowance.totalDays},{' '}
            {num(allowance.dailyCap)}/day
          </p>
          <p className="text-xs text-[var(--muted-foreground)] mt-1 leading-relaxed">
            {days != null && days > 1 ? (
              <>
                {num(recipientCount)} recipients will go out over about{' '}
                <span className="font-medium text-[var(--foreground)]">{days} days</span> — roughly{' '}
                {num(remaining)} today, then more each day as the limit rises. The blast keeps
                sending on its own; nothing needs re-scheduling.
              </>
            ) : (
              <>
                {num(recipientCount)} recipients fit inside today&apos;s remaining{' '}
                {num(remaining)}, so this sends in one pass.
              </>
            )}
          </p>
          <p className="text-[11px] text-[var(--muted-foreground)] mt-1.5">
            Most engaged contacts are sent to first.
          </p>
        </div>
      </div>
    </div>
  );
}
