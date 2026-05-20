'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Sidebar } from '@/components/sidebar';
import { TopUtilityBar } from '@/components/top-utility-bar';
import { AppLogo } from '@/components/app-logo';
import { stripSubaccountPrefix } from '@/lib/account-slugs';

const BUILDER_STEPS = [
  { key: 'recipients', label: 'Recipients' },
  { key: 'template', label: 'Message' },
  { key: 'schedule', label: 'Schedule' },
] as const;

type BuilderStepKey = (typeof BUILDER_STEPS)[number]['key'];

function campaignBuilderStep(path: string): BuilderStepKey {
  const match = path.match(/^\/campaigns\/[^/]+\/(recipients|template|edit|schedule)$/);
  const raw = match?.[1];
  // /edit is a sub-route of the Message step — progress bar shows
  // 'Message' highlighted while the user is in the block editor.
  if (raw === 'edit') return 'template';
  return (raw as BuilderStepKey) || 'recipients';
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

export function LayoutShell({ children }: { children: React.ReactNode }) {
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
  // the logo and an exit affordance — no sidebar, no top utility bar.
  // /edit is included so the block editor shares the same chrome.
  const isCampaignBuilder =
    /^\/campaigns\/[^/]+\/(recipients|template|edit|schedule)$/.test(normalizedPath);

  useEffect(() => {
    if (isFullScreen || isTemplateEditor || isCampaignBuilder) {
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
  }, [pathname, isFullScreen, isTemplateEditor, isCampaignBuilder]);

  if (isFullScreen) {
    return <div className="flex-1">{children}</div>;
  }

  if (isCampaignBuilder) {
    const step = campaignBuilderStep(normalizedPath);
    return (
      <div className="flex-1 flex flex-col min-h-screen">
        <header className="flex-shrink-0 grid grid-cols-[1fr_auto_1fr] items-center px-6 h-16 border-b border-[var(--border)] bg-[var(--card)]/80 backdrop-blur-md">
          <div className="flex items-center gap-3 min-w-0">
            <AppLogo className="h-7 w-auto" />
            <span className="hidden sm:inline text-sm font-semibold text-[var(--foreground)] truncate">
              Create an Email Campaign
            </span>
          </div>
          <CampaignBuilderProgress current={step} />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => router.push('/campaigns')}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)]"
              aria-label="Exit campaign builder"
            >
              <XMarkIcon className="w-4 h-4" />
              Exit
            </button>
          </div>
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
