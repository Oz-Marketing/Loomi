'use client';

/**
 * The client / team lens.
 *
 * ── ONE REPORT, TWO LENSES — NOT TWO REPORTS ────────────────────────────────
 * A client and an optimizer want different things from the same numbers: the
 * client wants what happened, the optimizer wants what to change. The tempting
 * shape is two routes per platform. It is the wrong one — two components drift,
 * and within a quarter the client's CTR and the team's CTR are computed
 * differently and somebody is on a call defending the gap. It also leaves a rep
 * with no way to see what the client sees before sharing a screen.
 *
 * So: one route, one component, a `lens` prop, and sections that declare which
 * lens they belong to.
 *
 * ── THIS IS PRESENTATION, NOT A SECURITY BOUNDARY ───────────────────────────
 * The lens decides what to DRAW. It cannot decide what a client may receive —
 * anything sensitive is filtered server-side before the response is written
 * (see `stripInternalCost`, which withholds raw cost and the margin percent
 * from anyone without the `finance.spend.view` capability). Never move a rule from there to here.
 *
 * ── URL-BACKED ──────────────────────────────────────────────────────────────
 * `?view=client` survives a reload and pastes into Slack, which is what makes
 * "here's what they'll see" a link rather than a description. The param is only
 * honoured for agency users; a client role is pinned to the client lens whether
 * or not the URL says otherwise.
 */

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { EyeIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { MANAGEMENT_ROLES } from '@/lib/roles';

export type ReportLens = 'client' | 'team';

/** Search-param name, exported so links can be built without retyping it. */
export const LENS_PARAM = 'view';

export interface LensState {
  lens: ReportLens;
  /** False for client users — they get no toggle and no team sections. */
  canSwitch: boolean;
  setLens: (l: ReportLens) => void;
}

export function useReportLens(): LensState {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { userRole } = useAccount();

  // MANAGEMENT_ROLES, not ELEVATED_ROLES: an account admin optimizes campaigns
  // and needs the team lens. What they don't get is raw cost, and that is
  // withheld by the API rather than by this flag.
  const canSwitch = !!userRole && MANAGEMENT_ROLES.includes(userRole);

  // Agency users default to team — it is a superset, and defaulting them to the
  // client view would hide the diagnostics they opened the report for.
  const requested = params.get(LENS_PARAM);
  const lens: ReportLens = !canSwitch ? 'client' : requested === 'client' ? 'client' : 'team';

  const setLens = useCallback(
    (next: ReportLens) => {
      const q = new URLSearchParams(params.toString());
      // Team is the default for everyone who can switch, so it needs no param —
      // keeps the common URL clean and makes ?view=client the meaningful one.
      if (next === 'client') q.set(LENS_PARAM, 'client');
      else q.delete(LENS_PARAM);
      const qs = q.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return { lens, canSwitch, setLens };
}

/**
 * Segmented Team / Client switch. Renders nothing for client users — an
 * inert control that says "Client" to a client is just confusing.
 */
export function LensToggle({ lens, canSwitch, setLens }: LensState) {
  if (!canSwitch) return null;
  const base =
    'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors';
  return (
    <div
      className="inline-flex rounded-lg border border-[var(--border)] p-0.5"
      role="group"
      aria-label="Report view"
    >
      <button
        type="button"
        onClick={() => setLens('team')}
        aria-pressed={lens === 'team'}
        className={`${base} ${
          lens === 'team'
            ? 'bg-[var(--primary)] text-white'
            : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
        }`}
      >
        <WrenchScrewdriverIcon className="h-3.5 w-3.5" />
        Team
      </button>
      <button
        type="button"
        onClick={() => setLens('client')}
        aria-pressed={lens === 'client'}
        className={`${base} ${
          lens === 'client'
            ? 'bg-[var(--primary)] text-white'
            : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
        }`}
      >
        <EyeIcon className="h-3.5 w-3.5" />
        Client
      </button>
    </div>
  );
}

/**
 * Banner shown while an agency user is previewing the client lens, so nobody
 * mistakes a deliberately reduced report for a broken one.
 */
export function ClientPreviewNotice({ lens, canSwitch }: LensState) {
  if (!canSwitch || lens !== 'client') return null;
  return (
    <div className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--primary)]/25 bg-[var(--primary)]/5 px-3 py-2 text-xs text-[var(--muted-foreground)]">
      <EyeIcon className="h-4 w-4 shrink-0 text-[var(--primary)]" />
      You&rsquo;re previewing what a client sees. Optimization sections are hidden.
    </div>
  );
}
