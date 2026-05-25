'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { Sidebar } from '@/components/sidebar';
import { TopUtilityBar } from '@/components/top-utility-bar';
import { AppLogo } from '@/components/app-logo';
import { stripSubaccountPrefix } from '@/lib/account-slugs';

const BUILDER_STEPS = [
  { key: 'recipients', label: 'Recipients' },
  { key: 'message', label: 'Message' },
  { key: 'schedule', label: 'Schedule' },
] as const;

type BuilderStepKey = (typeof BUILDER_STEPS)[number]['key'];

function campaignBuilderStep(path: string): BuilderStepKey {
  // Strip optional /subaccount/<slug> prefix so the regexes below match
  // admin + sub-account routes with one set of patterns. The builder
  // surfaces live under /messaging/campaigns/ now (or
  // /subaccount/<slug>/messaging/campaigns/ for sub-accounts):
  // Email: /messaging/campaigns/[id]/(recipients|template|schedule)
  // SMS:   /messaging/campaigns/sms/[id]/(recipients|message|schedule)
  // Multi: /messaging/campaigns/multi/[id]/(recipients|message|schedule)
  const stripped = path.replace(/^\/subaccount\/[^/]+/, '');
  const multiMatch = stripped.match(/^\/messaging\/campaigns\/multi\/[^/]+\/(recipients|message|schedule)$/);
  if (multiMatch) return multiMatch[1] as BuilderStepKey;
  const smsMatch = stripped.match(/^\/messaging\/campaigns\/sms\/[^/]+\/(recipients|message|schedule)$/);
  if (smsMatch) return smsMatch[1] as BuilderStepKey;
  const emailMatch = stripped.match(/^\/messaging\/campaigns\/[^/]+\/(recipients|template|schedule)$/);
  if (emailMatch) {
    const raw = emailMatch[1];
    return raw === 'template' ? 'message' : (raw as BuilderStepKey);
  }
  return 'recipients';
}

function campaignBuilderChannel(path: string): 'email' | 'sms' | 'multi' {
  const stripped = path.replace(/^\/subaccount\/[^/]+/, '');
  if (/^\/messaging\/campaigns\/multi\//.test(stripped)) return 'multi';
  if (/^\/messaging\/campaigns\/sms\//.test(stripped)) return 'sms';
  return 'email';
}

function CampaignBuilderProgress({ current }: { current: BuilderStepKey }) {
  const activeIndex = BUILDER_STEPS.findIndex((s) => s.key === current);
  return (
    <nav className="hidden md:flex items-center gap-2" aria-label="Campaign builder progress">
      {BUILDER_STEPS.map((step, i) => {
        const isActive = i === activeIndex;
        const isDone = i < activeIndex;
        return (
          <div key={step.key} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                isActive
                  ? 'bg-[var(--primary)]/15 text-[var(--primary)]'
                  : isDone
                    ? 'text-[var(--foreground)]'
                    : 'text-[var(--muted-foreground)]'
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
            </div>
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
  const normalizedPath = stripSubaccountPrefix(pathname);
  const mainRef = useRef<HTMLElement>(null);
  const [isMainScrolled, setIsMainScrolled] = useState(false);
  const isFullScreen =
    normalizedPath.startsWith('/preview')
    || normalizedPath.startsWith('/login')
    || normalizedPath.startsWith('/onboarding');

  // Template editor gets full-width layout (no sidebar)
  const isTemplateEditor = normalizedPath === '/templates/editor'
    || /^\/templates\/folder\/[^/]+$/.test(normalizedPath)
    || /^\/components\/[^/]+$/.test(normalizedPath)
    || /^\/components\/folder\/[^/]+$/.test(normalizedPath);

  // Campaign builder steps run as a focused, full-screen flow with only
  // the logo and a back affordance — no sidebar, no top utility bar.
  // (The template editor at /templates/editor uses its own chrome via the
  // existing isTemplateEditor branch.)
  const builderProbe = normalizedPath.replace(/^\/subaccount\/[^/]+/, '');
  const isCampaignBuilder =
    /^\/messaging\/campaigns\/[^/]+\/(recipients|template|schedule)$/.test(builderProbe) ||
    /^\/messaging\/campaigns\/sms\/[^/]+\/(recipients|message|schedule)$/.test(builderProbe) ||
    /^\/messaging\/campaigns\/multi\/[^/]+\/(recipients|message|schedule)$/.test(builderProbe);

  // Flow builder owns its own chrome (its own top bar lives in
  // FlowBuilder.tsx) so we hide the sidebar + TopUtilityBar entirely.
  // Matches /flows/<id>/edit only — the overview at /flows/<id> renders
  // inside the regular app shell.
  const isFlowBuilder = /^\/flows\/[^/]+\/edit$/.test(builderProbe);
  const isWebsiteBuilder =
    /^\/websites\/forms\/[^/]+$/.test(builderProbe) ||
    /^\/websites\/landing-pages\/[^/]+$/.test(builderProbe) ||
    builderProbe === '/websites/landing-pages/demo';

  useEffect(() => {
    if (isFullScreen || isTemplateEditor || isCampaignBuilder || isFlowBuilder || isWebsiteBuilder) {
      setIsMainScrolled(false);
      return;
    }

    const main = mainRef.current;
    if (!main) return;

    const handleScroll = () => {
      setIsMainScrolled(main.scrollTop > 0);
    };

    handleScroll();
    main.addEventListener('scroll', handleScroll, { passive: true });
    return () => main.removeEventListener('scroll', handleScroll);
  }, [
    pathname,
    isFullScreen,
    isTemplateEditor,
    isCampaignBuilder,
    isFlowBuilder,
    isWebsiteBuilder,
  ]);

  if (isFullScreen) {
    return <div className="flex-1">{children}</div>;
  }

  if (isFlowBuilder || isWebsiteBuilder) {
    return <div className="flex-1 min-w-0">{children}</div>;
  }

  if (isCampaignBuilder) {
    const step = campaignBuilderStep(normalizedPath);
    const channel = campaignBuilderChannel(normalizedPath);
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
                const active = document.activeElement as HTMLElement | null;
                if (active && typeof active.blur === 'function') active.blur();
                if (
                  confirm(
                    'Your changes are saved as a draft. You can resume from the Campaigns list. Exit the builder?',
                  )
                ) {
                  router.push('/messaging/campaigns');
                }
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
          <CampaignBuilderProgress current={step} />
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
    <>
      <Sidebar />
      <main
        ref={mainRef}
        data-scrolled={isMainScrolled ? 'true' : 'false'}
        className="flex-1 min-w-0 h-screen overflow-y-auto overflow-x-hidden overscroll-contain p-8 pl-[18.5rem]"
      >
        <TopUtilityBar />
        {children}
      </main>
    </>
  );
}

/**
 * Top-level layout shell.
 *
 * For public form pages (/f/<slug>) we render the children raw — no
 * sidebar, no top utility bar, no authed providers. The full AppShell
 * (with all its hooks + session-dependent fetches) only mounts for app
 * routes. Splitting on pathname here, rather than inside AppShell, keeps
 * hook order stable: navigating between public and app routes unmounts
 * one branch and mounts the other.
 */
export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith('/f/')) {
    return <>{children}</>;
  }
  return <AppShell>{children}</AppShell>;
}
