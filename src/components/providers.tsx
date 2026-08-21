'use client';

import { SessionProvider } from 'next-auth/react';
import { AccountProvider, useAccount } from '@/contexts/account-context';
import { ThemeProvider, useTheme } from '@/contexts/theme-context';
import { UnsavedChangesProvider } from '@/contexts/unsaved-changes-context';
import { LoomiDialogProvider } from '@/contexts/loomi-dialog-context';
import { SidebarCollapseProvider } from '@/contexts/sidebar-collapse-context';
import { BudgetChannelsProvider } from '@/contexts/budget-channels-context';
import { Toaster } from 'sonner';
import { AiBubble } from '@/components/ai-bubble';
import { SupportModal } from '@/components/support-modal';

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
                {/* Fetches nothing until a budget screen actually asks — see
                    the note in budget-channels-context. */}
                <BudgetChannelsProvider>
                  {children}
                  <ThemedToaster />
                  {/* Deliberately OUTSIDE NonClientOnly: clients get no sidebar
                      and no utility bar, so the help desk is the one dev-facing
                      affordance they must still be able to reach. */}
                  <SupportModal />
                  <NonClientOnly>
                    <AiBubble />
                  </NonClientOnly>
                </BudgetChannelsProvider>
              </SidebarCollapseProvider>
            </LoomiDialogProvider>
          </UnsavedChangesProvider>
        </AccountProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
