'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { Sidebar } from '@/components/sidebar';
import { TopUtilityBar } from '@/components/top-utility-bar';
import { BlastNameField } from '@/components/campaigns/blast-name-field';
import { stripSubaccountPrefix } from '@/lib/account-slugs';
import { SurfaceShell } from '@/components/surface-shell';
import {
  BUILDER_STEPS,
  builderBlastId,
  builderChannel,
  builderCompletion,
  builderStep,
  builderStepHref,
  isBuilderPath,
  reachableSteps,
  stripBuilderPrefix,
  type BuilderChannel,
  type BuilderStepKey,
} from '@/lib/messaging/blast-builder-steps';
import { BLAST_DRAFT_SAVED_EVENT, flushBuilderSaves } from '@/lib/messaging/builder-autosave';
import { toast } from '@/lib/toast';

/** The draft the header reads: the email half for an Email + Text blast. */
function builderDraftEndpoint(channel: BuilderChannel, id: string): string {
  return channel === 'sms'
    ? `/api/blasts/sms/${encodeURIComponent(id)}`
    : `/api/blasts/email/${encodeURIComponent(id)}`;
}

/** Which steps a draft has unlocked, read fresh; null when it can't be read. */
async function fetchReachableSteps(
  channel: BuilderChannel,
  id: string,
): Promise<Set<BuilderStepKey> | null> {
  const res = await fetch(builderDraftEndpoint(channel, id), { cache: 'no-store' });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const c = data?.campaign;
  if (!c) return null;
  // Recipients counts as done only once the Recipients step has saved a
  // non-empty audience — see isAudienceConfirmed. "Has an account" was the
  // old test, and every draft has one from the moment it's created.
  return reachableSteps(builderCompletion(channel, c));
}

/**
 * Which builder steps the user may jump to.
 *
 * The rule is "you can revisit anything you've satisfied, plus the step
 * you're standing on" — never a forward jump over an unfilled
 * prerequisite, because the send itself is gated server-side on the same
 * two facts (POST /api/blasts/email/[id]/schedule rejects a blast with no
 * subject or no body). Letting someone reach Schedule early would only
 * hand them a dead Send button.
 *
 * Re-checked on every step change and whenever a step announces a save, so
 * choosing an audience unlocks Message without leaving the page.
 *
 * Fails OPEN: if the draft can't be read we unlock everything rather than
 * trapping the user in step 1. The navigation itself re-checks, and the
 * server gate is the real guarantee.
 */
function useBuilderReachableSteps(
  channel: BuilderChannel,
  id: string,
): Set<BuilderStepKey> {
  const [reachable, setReachable] = useState<Set<BuilderStepKey>>(
    () => new Set(BUILDER_STEPS.map((s) => s.key)),
  );
  const pathname = usePathname();
  const [savedTick, setSavedTick] = useState(0);

  useEffect(() => {
    const onSaved = (e: Event) => {
      if ((e as CustomEvent<{ id?: string }>).detail?.id === id) setSavedTick((n) => n + 1);
    };
    window.addEventListener(BLAST_DRAFT_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(BLAST_DRAFT_SAVED_EVENT, onSaved);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let canceled = false;
    fetchReachableSteps(channel, id)
      .then((next) => {
        if (next && !canceled) setReachable(next);
      })
      .catch(() => {
        // Network hiccup — leave the permissive default in place.
      });
    return () => {
      canceled = true;
    };
  }, [channel, id, pathname, savedTick]);

  return reachable;
}

/**
 * Finish the current step's saves, then leave. Returns false (and says why)
 * when a save failed, so the caller stays put instead of navigating away from
 * work that isn't stored. Blurring first lets a field that saves on blur
 * start its save before the flush runs.
 */
async function flushBeforeLeaving(): Promise<boolean> {
  const el = document.activeElement as HTMLElement | null;
  if (el && typeof el.blur === 'function') el.blur();
  try {
    await flushBuilderSaves();
    return true;
  } catch (err) {
    toast.error(
      `Your latest changes couldn’t be saved, so you’re still on this step. ${
        err instanceof Error ? err.message : ''
      }`.trim(),
    );
    return false;
  }
}

function CampaignBuilderProgress({
  current,
  channel,
  path,
}: {
  current: BuilderStepKey;
  channel: BuilderChannel;
  path: string;
}) {
  const router = useRouter();
  const id = builderBlastId(path);
  const reachable = useBuilderReachableSteps(channel, id);
  const activeIndex = BUILDER_STEPS.findIndex((s) => s.key === current);
  const [leaving, setLeaving] = useState(false);

  const goToStep = async (target: BuilderStepKey) => {
    if (leaving) return;
    setLeaving(true);
    try {
      // The step being left saves first — the header used to navigate
      // immediately, dropping an audience the Recipients step hadn't saved.
      if (!(await flushBeforeLeaving())) return;
      // Then re-check against what was just saved: the button was enabled on
      // what the draft looked like a moment ago, and a step that has since
      // become empty (say, every contact unchecked) must not be jumped past.
      const fresh = await fetchReachableSteps(channel, id).catch(() => null);
      if (fresh && !fresh.has(target)) {
        toast.error(
          target === 'message'
            ? 'Choose who should receive this blast first.'
            : 'Choose recipients and add a subject and message first.',
        );
        return;
      }
      router.push(builderStepHref(path, channel, target));
    } finally {
      setLeaving(false);
    }
  };

  return (
    <nav className="hidden md:flex items-center gap-2" aria-label="Campaign builder progress">
      {BUILDER_STEPS.map((step, i) => {
        const isActive = i === activeIndex;
        const isDone = i < activeIndex;
        const canVisit = reachable.has(step.key) && !isActive;
        const locked = !reachable.has(step.key);

        return (
          <div key={step.key} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!canVisit || leaving}
              aria-current={isActive ? 'step' : undefined}
              title={
                locked
                  ? step.key === 'message'
                    ? 'Choose recipients first'
                    : 'Add a subject and message first'
                  : undefined
              }
              onClick={() => {
                if (!canVisit) return;
                void goToStep(step.key);
              }}
              className={`flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                isActive
                  ? 'bg-[var(--primary)]/15 text-[var(--primary)]'
                  : isDone
                    ? 'text-[var(--foreground)]'
                    : 'text-[var(--muted-foreground)]'
              } ${
                canVisit
                  ? 'hover:bg-[var(--muted)] cursor-pointer'
                  : locked
                    ? 'cursor-not-allowed opacity-60'
                    : 'cursor-default'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold ${
                  isActive
                    ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                    : isDone
                      ? 'bg-[var(--foreground)]/15 text-[var(--foreground)]'
                      : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                }`}
              >
                {i + 1}
              </span>
              {step.label}
            </button>
            {i < BUILDER_STEPS.length - 1 && (
              <div className="w-6 h-px bg-[var(--border)]" />
            )}
          </div>
        );
      })}
    </nav>
  );
}

// Inner shell — every path-aware hook lives here. Split out so the
// public form route can render raw children without instantiating any
// of this component's hooks (LayoutShell decides which wrapper to
// instantiate based on pathname).
function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const normalizedPath = stripSubaccountPrefix(pathname);

  // Rendered inside the campaign detail's editor sheet, which is an iframe over
  // the campaign. The sheet supplies the chrome — the way back, the asset's
  // name, a link to the same editor as an ordinary page — so the sidebar and
  // the utility bar would be a second, wrong copy of it.
  //
  // The frame is named, and a frame's name survives navigation inside it, so an
  // editor that links on to its own next step (Recipients → Message, a landing
  // page's overview → its builder) stays chrome-less without having to carry
  // the query param forward. Read after mount so the server's markup and the
  // first client render agree; the initial src always carries `embed=1`, so
  // this only matters for a reload inside the frame.
  const [framed, setFramed] = useState(false);
  useEffect(() => {
    if (window.name === 'loomi-embed') setFramed(true);
  }, []);
  const isEmbed = searchParams.get('embed') === '1' || framed;
  const isFullScreen =
    normalizedPath.startsWith('/preview')
    || normalizedPath.startsWith('/login')
    || normalizedPath.startsWith('/onboarding')
    || normalizedPath.startsWith('/forgot-password')
    || normalizedPath.startsWith('/reset-password');

  // Template editor gets full-width layout (no sidebar)
  const isTemplateEditor = normalizedPath === '/templates/editor'
    || /^\/templates\/folder\/[^/]+$/.test(normalizedPath)
    || /^\/components\/[^/]+$/.test(normalizedPath)
    || /^\/components\/folder\/[^/]+$/.test(normalizedPath);

  // Campaign builder steps run as a focused, full-screen flow with only
  // the logo and a back affordance — no sidebar, no top utility bar.
  // (The template editor at /templates/editor uses its own chrome via the
  // existing isTemplateEditor branch.)
  // Campaign builder steps run as a focused, full-screen flow with only the
  // logo and a back affordance — no sidebar, no top utility bar.
  //
  // The route patterns live in lib/messaging/blast-builder-steps.ts. They used
  // to be inlined here AND in two helpers above, which is how the
  // Campaigns → Blasts rename managed to fix one copy and leave the progress
  // nav stuck on step 1.
  const builderProbe = stripBuilderPrefix(normalizedPath);
  const isCampaignBuilder = isBuilderPath(normalizedPath);

  // Flow builder owns its own chrome (its own top bar lives in
  // FlowBuilder.tsx) so we hide the sidebar + TopUtilityBar entirely.
  // Matches /flows/<id>/edit only — the overview at /flows/<id> renders
  // inside the regular app shell.
  const isFlowBuilder = /^\/flows\/[^/]+\/edit$/.test(builderProbe);
  const isWebsiteBuilder =
    // Only the builder (/edit) is a full-viewport workspace — the
    // overview, settings, and submissions pages stay inside the
    // standard app shell so the user keeps their sidebar context.
    /^\/websites\/forms\/[^/]+\/edit$/.test(builderProbe) ||
    /^\/websites\/landing-pages\/[^/]+\/edit$/.test(builderProbe) ||
    builderProbe === '/websites/landing-pages/demo';

  // Ad Template Builder — the same focused full-viewport editor treatment as
  // the website builders. Only the builder gets it; the generator + admin
  // pages keep the standard app shell.
  const isAdBuilder = /^\/ad-generator\/builder$/.test(builderProbe);

  // Media Library — a full-viewport asset workspace that owns its own chrome
  // (top bar + back link live in app/media/page.tsx). Unlike the builders this
  // is a BROWSING surface, so it keeps its own account breadcrumb and an
  // explicit way back to the dashboard; without one there'd be no nav at all.
  // `builderProbe` has already stripped any /subaccount/<slug> prefix, so this
  // covers /media and /subaccount/<slug>/media alike.
  const isMediaLibrary = builderProbe === '/media';

  // Docs — a full-viewport reference surface with its own top bar and side
  // rail (src/app/docs/layout.tsx). Like the media library it is a BROWSING
  // surface rather than a builder, so it carries its own way back to the app;
  // unlike it, it is reached from all three hosts, and the host chrome is
  // exactly what shouldn't follow you into a manual.
  const isDocs = builderProbe === '/docs' || builderProbe.startsWith('/docs/');

  // The surfaces that already own their whole canvas keep their own wrapper
  // below; everything else, embedded, simply loses the shell.
  const isEmbedBare =
    isEmbed && !isWebsiteBuilder && !isAdBuilder && !isTemplateEditor && !isCampaignBuilder;

  if (isFullScreen || isEmbedBare) {
    return <div className="flex-1 min-w-0">{children}</div>;
  }

  // Clients used to get a chrome-less page — no sidebar, no top utility bar —
  // because their whole product was the Ad Generator list, which draws its OWN
  // account logo and help button. Their product is now Campaigns, an ordinary
  // app-shell page that draws no chrome of its own, so the bare branch left them
  // with no logo, no nav, no account context and no way to sign out.
  //
  // They take the standard shell instead. Both halves of it are already
  // client-aware: `Sidebar` gives them a single Campaigns entry with no account
  // switcher and no surface switch, and `TopUtilityBar` hides the role badge
  // while `AgencySettingsButton` returns null below the admin tier. Help moves
  // from the Ad Generator's own button to the "?" in the top bar, which opens
  // the same help desk.

  if (isFlowBuilder || isMediaLibrary || isDocs) {
    // Own their full canvas edge-to-edge — no shell padding, no sidebar.
    return <div className="flex-1 min-w-0">{children}</div>;
  }

  if (isWebsiteBuilder || isAdBuilder) {
    // Mirror the email template editor wrapper (p-4 + main) so the
    // Forms / Landing Pages / Ad builders inherit the same breathing room
    // and the inner `h-[calc(100vh-2rem)]` math lines up correctly.
    return <main className="flex-1 p-4">{children}</main>;
  }

  if (isCampaignBuilder) {
    const step = builderStep(normalizedPath);
    const channel = builderChannel(normalizedPath);
    return (
      <div className="flex-1 flex flex-col min-h-screen">
        <header className="flex-shrink-0 grid grid-cols-[1fr_auto_1fr] items-center px-6 h-16 border-b border-[var(--border)] bg-[var(--card)]/80 backdrop-blur-md">
          <div className="flex items-center gap-3 min-w-0">
            {/* Embedded, the sheet's own "Back to campaign" is the way out; a
                second one leading to the blast list would be a trap door. */}
            {!isEmbed && (
              <button
                type="button"
                onClick={async () => {
                  // Finish the step's pending saves first, so leaving is never
                  // how a choice gets lost. No exit-confirmation prompt — once
                  // saved, the work is preserved as a draft.
                  if (!(await flushBeforeLeaving())) return;
                  router.push('/messaging/blasts');
                }}
                className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
                aria-label="Exit campaign builder"
                title="Exit"
              >
                <ArrowLeftIcon className="w-4 h-4" />
              </button>
            )}
            <BlastNameField id={builderBlastId(normalizedPath)} channel={channel} />
          </div>
          <CampaignBuilderProgress current={step} channel={channel} path={pathname} />
          <div />
        </header>
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    );
  }

  if (isTemplateEditor) {
    return (
      <main className="flex-1 p-4">
        {children}
      </main>
    );
  }

  return (
    <SurfaceShell sidebar={<Sidebar />} topBar={<TopUtilityBar />}>
      {children}
    </SurfaceShell>
  );
}

/** Which Loomi surface the current request is being rendered for. */
export type Surface = 'studio' | 'reporting' | 'app' | 'marketing';

/**
 * Top-level layout shell.
 *
 * AppShell (studio sidebar + utility bar + authed providers) only mounts
 * for studio app routes. We bypass it for:
 *   - the `reporting` and `app` surfaces (host = reporting.* / app.*) —
 *     determined server-side in the root layout via the Host header and
 *     passed in as `surface`, since middleware rewrites mean
 *     `usePathname()` returns the BROWSER URL not the rewritten path. Each
 *     surface's own route-group layout provides its SurfaceShell chrome.
 *   - public unauthenticated routes (`/f/<slug>`, `/lp/<slug>`) — kept on
 *     pathname so behavior is unchanged for those
 *   - the `/reporting/*` pathname when accessed from the studio host (rare
 *     dev convenience — visiting localhost:3000/reporting directly)
 *
 * Splitting here, rather than inside AppShell, keeps hook order stable:
 * navigating between branches unmounts one and mounts the other.
 */
export function LayoutShell({
  children,
  surface = 'studio',
}: {
  children: React.ReactNode;
  surface?: Surface;
}) {
  const pathname = usePathname();
  if (
    surface === 'reporting' ||
    surface === 'app' ||
    pathname.startsWith('/f/') ||
    pathname.startsWith('/lp/') ||
    pathname.startsWith('/reporting') ||
    pathname.startsWith('/app')
  ) {
    return <>{children}</>;
  }
  return <AppShell>{children}</AppShell>;
}
