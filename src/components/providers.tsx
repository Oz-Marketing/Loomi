'use client';

import { SessionProvider } from 'next-auth/react';
import { AccountProvider, useAccount } from '@/contexts/account-context';
import { ThemeProvider, useTheme } from '@/contexts/theme-context';
import { UnsavedChangesProvider } from '@/contexts/unsaved-changes-context';
import { LoomiDialogProvider } from '@/contexts/loomi-dialog-context';
import { SidebarCollapseProvider } from '@/contexts/sidebar-collapse-context';
import { Toaster } from 'sonner';
import { AiBubble } from '@/components/ai-bubble';
import { SunIcon, MoonIcon } from '@heroicons/react/24/outline';

function ThemedToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      visibleToasts={3}
      closeButton
      toastOptions={{
        style: theme === 'dark'
          ? {
              background: 'rgba(24, 24, 27, 0.85)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid #27272a',
              color: '#fafafa',
            }
          : {
              background: 'rgba(255, 255, 255, 0.85)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid #e4e4e7',
              color: '#09090b',
            },
      }}
    />
  );
}

/**
 * Floating theme toggle — gated to developer accounts so non-devs never see
 * it in production. Position adjusts: in local dev it sits above the Next.js
 * dev indicator (bottom-[64px]); in production there's no indicator so it
 * sits flush against the bottom-left corner.
 */
function DevThemeToggle() {
  const { userRole } = useAccount();
  const { theme, toggleTheme } = useTheme();
  if (userRole !== 'developer') return null;
  const isDark = theme === 'dark';
  const isDev = process.env.NODE_ENV === 'development';
  return (
    <button
      onClick={toggleTheme}
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      className={`fixed left-5 z-[2147483646] w-9 h-9 rounded-full flex items-center justify-center bg-black/80 text-white/90 hover:bg-black/90 hover:text-white transition-colors text-sm cursor-pointer ${
        isDev ? 'bottom-[64px]' : 'bottom-5'
      }`}
      style={{ backdropFilter: 'blur(8px)' }}
    >
      {isDark ? <SunIcon className="w-4.5 h-4.5" /> : <MoonIcon className="w-4.5 h-4.5" />}
    </button>
  );
}

/** Renders its children for everyone EXCEPT clients — clients get a bare,
 *  chrome-less Ad Generator with no assistant/dev affordances. */
function NonClientOnly({ children }: { children: React.ReactNode }) {
  const { userRole } = useAccount();
  return userRole === 'client' ? null : <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider>
        <AccountProvider>
          <UnsavedChangesProvider>
            <LoomiDialogProvider>
              <SidebarCollapseProvider>
                {children}
                <ThemedToaster />
                <NonClientOnly>
                  <AiBubble />
                  <DevThemeToggle />
                </NonClientOnly>
              </SidebarCollapseProvider>
            </LoomiDialogProvider>
          </UnsavedChangesProvider>
        </AccountProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
