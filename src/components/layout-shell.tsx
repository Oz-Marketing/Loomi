'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Sidebar } from '@/components/sidebar';
import { TopUtilityBar } from '@/components/top-utility-bar';
import { AppLogo } from '@/components/app-logo';
import { stripSubaccountPrefix } from '@/lib/account-slugs';

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
    return (
      <div className="flex-1 flex flex-col min-h-screen">
        <header className="flex-shrink-0 flex items-center justify-between px-6 h-14 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
          <AppLogo className="h-7 w-auto" />
          <button
            type="button"
            onClick={() => router.push('/campaigns')}
            className="inline-flex items-center gap-1.5 px-3 h-9 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)]"
            aria-label="Exit campaign builder"
          >
            <XMarkIcon className="w-4 h-4" />
            Exit
          </button>
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
