'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { Sidebar } from '@/components/sidebar';
import { TopUtilityBar } from '@/components/top-utility-bar';
import { AppLogo } from '@/components/app-logo';
import { stripSubaccountPrefix } from '@/lib/account-slugs';
import { SurfaceShell } from '@/components/surface-shell';
import { useAccount } from '@/contexts/account-context';
import {
  BUILDER_STEPS,
  builderBlastId,
  builderChannel,
  builderStep,
  builderStepHref,
  isBuilderPath,
  reachableSteps,
  stripBuilderPrefix,
  type BuilderChannel,
  type BuilderStepKey,
} from '@/lib/messaging/blast-builder-steps';

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
 * Fails OPEN: if the draft can't be read we unlock everything rather than
 * trapping the user in step 1. The server gate is the real guarantee.
 */
function useBuilderReachableSteps(
  channel: BuilderChannel,
  id: string,
): Set<BuilderStepKey> {
  const [reachable, setReachable] = useState<Set<BuilderStepKey>>(
    () => new Set(BUILDER_STEPS.map((s) => s.key)),
  );
  // Re-check on every step change: the user just saved the step they came
  // from, so what's reachable has probably grown.
  const pathname = usePathname();

  useEffect(() => {
    if (!id) return;
    let canceled = false;

    // Multi-channel drafts carry an email id, so they hydrate from the
    // email endpoint; SMS-only drafts have their own.
    const endpoint =
      channel === 'sms'
        ? `/api/blasts/sms/${encodeURIComponent(id)}`
        : `/api/blasts/email/${encodeURIComponent(id)}`;

    (async () => {
      try {
        const res = await fetch(endpoint);
        if (!res.ok) return;
        const data = await res.json();
        const c = data?.campaign;
        if (!c || canceled) return;

        // Recipients is done once an audience has been saved. Every
        // selection mode — including "All contacts", which deliberately
        // clears the three source fields — stamps accountKeys.
        const hasRecipients =
          Array.isArray(c.accountKeys) && c.accountKeys.length > 0;
        // Message is done when there is something to send. Mirrors the
        // server-side gate exactly.
        const hasMessage =
          channel === 'sms'
            ? Boolean(String(c.message || '').trim())
            : Boolean(String(c.subject || '').trim())
              && Boolean(String(c.htmlContent || '').trim());

        setReachable(reachableSteps({ hasRecipients, hasMessage }));
      } catch {
        // Network hiccup — leave the permissive default in place.
      }
    })();

    return () => {
      canceled = true;
    };
  }, [channel, id, pathname]);

  return reachable;
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
              disabled={!canVisit}
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
                // Flush a focused field's onBlur so the step we're
                // leaving persists before the route changes — same
                // reasoning as the exit button below.
                const el = document.activeElement as HTMLElement | null;
                if (el && typeof el.blur === 'function') el.blur();
                router.push(builderStepHref(path, channel, step.key));
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
                    ? 'bg-[var(--primary)] text-white'
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
  const { userRole } = useAccount();
  const isClientRole = userRole === 'client';
  const normalizedPath = stripSubaccountPrefix(pathname);
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

  if (isFullScreen) {
    return <div className="flex-1">{children}</div>;
  }

  // Clients get a chrome-less experience — no sidebar, no top utility bar. Their
  // whole product is the Ad Generator page (which carries its own account logo),
  // so we render the page bare on its own background.
  if (isClientRole) {
    return <div className="flex-1 min-w-0">{children}</div>;
  }

  if (isFlowBuilder || isMediaLibrary) {
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
    const title =
      channel === 'multi'
        ? 'Create a Multi-Channel Campaign'
        : channel === 'sms'
          ? 'Create a Text Campaign'
          : 'Create an Email Campaign';
    return (
      <div className="flex-1 flex flex-col min-h-screen">
        <header className="flex-shrink-0 grid grid-cols-[1fr_auto_1fr] items-center px-6 h-16 border-b border-[var(--border)] bg-[var(--card)]/80 backdrop-blur-md">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => {
                // Best-effort: flush any focused input's onBlur so the
                // currently-typed value gets persisted before we navigate.
                // Autosave handles the rest, so no exit-confirmation
                // prompt — work is already preserved as a draft.
                const active = document.activeElement as HTMLElement | null;
                if (active && typeof active.blur === 'function') active.blur();
                router.push('/messaging/blasts');
              }}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
              aria-label="Exit campaign builder"
              title="Exit"
            >
              <ArrowLeftIcon className="w-4 h-4" />
            </button>
            <AppLogo className="h-7 w-auto" />
            <span className="hidden sm:inline text-sm font-semibold text-[var(--foreground)] truncate">
              {title}
            </span>
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
