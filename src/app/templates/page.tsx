'use client';

import { Suspense, useState, type ComponentType, type SVGProps } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  BookOpenIcon,
  EnvelopeIcon,
  DocumentTextIcon,
  RectangleStackIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { FlowIcon } from '@/components/icon-map';
import { EmailTemplatesPanel, TemplatesHeaderActionsContext } from '@/app/email/templates/page';
import { FormTemplatesTab } from '@/components/templates/form-templates-tab';
import { FlowTemplatesTab } from '@/components/templates/flow-templates-tab';
import { LandingPageTemplatesTab } from '@/components/templates/landing-page-templates-tab';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

type TabId = 'email' | 'forms' | 'flows' | 'landing-pages';

interface TabDef {
  id: TabId;
  label: string;
  subtitle: string;
  icon: IconComponent;
}

const MANAGER_TABS: TabDef[] = [
  { id: 'email', label: 'Email', subtitle: 'Email templates for campaigns and flows.', icon: EnvelopeIcon },
  { id: 'forms', label: 'Forms', subtitle: 'Reusable form templates.', icon: DocumentTextIcon },
  { id: 'flows', label: 'Flows', subtitle: 'Reusable flow templates you can adopt into an account.', icon: FlowIcon as IconComponent },
  { id: 'landing-pages', label: 'Landing Pages', subtitle: 'Saved landing page templates.', icon: RectangleStackIcon },
];

// Clients only ever had access to email templates — keep the unified
// page scoped to that surface for them.
const CLIENT_TABS: TabDef[] = [MANAGER_TABS[0]];

export default function TemplatesPage() {
  return (
    <Suspense fallback={null}>
      <TemplatesPageInner />
    </Suspense>
  );
}

function TemplatesPageInner() {
  const searchParams = useSearchParams();
  const { userRole, account, accountKey, accountData } = useAccount();
  const campaignDraftQuery =
    searchParams.get('campaignDraft') === '1' ? '?campaignDraft=1' : '';

  const isClient = userRole === 'client';
  const canManage =
    userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin';
  const tabs = canManage ? MANAGER_TABS : CLIENT_TABS;

  const requestedTab = searchParams.get('tab') as TabId | null;
  const initialTab: TabId =
    requestedTab && tabs.some((t) => t.id === requestedTab)
      ? requestedTab
      : tabs[0].id;
  const [tab, setTab] = useState<TabId>(initialTab);

  // Sticky-header action slot — the active tab's primary CTA + overflow
  // menu portal in here (e.g. the Email tab's Create Template + Manage
  // tags, via ManagementView → TemplatesHeaderActionsContext).
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  // Email-tab "Template Library" toggle + a key bump to refresh the
  // management view after a library copy. Lifted here so the toggle can
  // live in the sticky header alongside the CTA.
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [emailRefreshKey, setEmailRefreshKey] = useState(0);

  const scopedAccountKey =
    account.mode === 'account' && accountKey ? accountKey : undefined;
  const accountLabel = accountData?.dealer ?? accountKey ?? undefined;

  const activeDef = tabs.find((t) => t.id === tab) ?? tabs[0];
  // The library toggle only makes sense inside a sub-account, where "your
  // templates" and the shared system library are distinct.
  const showLibraryToggle = tab === 'email' && Boolean(scopedAccountKey);

  return (
    <TemplatesHeaderActionsContext.Provider value={actionsSlot}>
      <div>
        <div className="page-sticky-header mb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <BookOpenIcon className="w-7 h-7 text-[var(--primary)] flex-shrink-0" />
              <div className="min-w-0">
                <h1 className="text-2xl font-bold">Templates</h1>
                <p className="text-[var(--muted-foreground)] text-sm mt-0.5 truncate">
                  {activeDef.subtitle}
                </p>
              </div>
            </div>
            {/* Right-aligned actions: the Library toggle (Email + sub-account)
                plus a slot the active tab portals its CTA + overflow into. */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {showLibraryToggle && (
                <button
                  type="button"
                  onClick={() => setLibraryOpen((v) => !v)}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
                    libraryOpen
                      ? 'border-[var(--primary)]/40 text-[var(--primary)] bg-[var(--primary)]/5'
                      : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'
                  }`}
                >
                  <BookOpenIcon className="w-4 h-4" />
                  {libraryOpen ? 'Back to your templates' : 'Browse System Templates'}
                </button>
              )}
              <div ref={setActionsSlot} className="flex items-center gap-2" />
            </div>
          </div>
        </div>

        {/* Tabs live between the sticky header and the page content (not
            inside the sticky header) so they scroll with the content. */}
        {tabs.length > 1 && (
          <div className="mb-4 flex items-center gap-1 border-b border-[var(--border)]">
            {tabs.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    active
                      ? 'border-[var(--primary)] text-[var(--primary)]'
                      : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                  }`}
                >
                  <t.icon className="w-4 h-4" />
                  {t.label}
                </button>
              );
            })}
          </div>
        )}

        {tab === 'email' && (
          <EmailTemplatesPanel
            campaignDraftQuery={campaignDraftQuery}
            accountKey={scopedAccountKey}
            accountLabel={accountLabel}
            canManage={canManage}
            isClient={isClient}
            libraryOpen={libraryOpen}
            refreshKey={emailRefreshKey}
            onCopyComplete={() => {
              setEmailRefreshKey((n) => n + 1);
              setLibraryOpen(false);
            }}
          />
        )}
        {tab === 'forms' && <FormTemplatesTab accountKey={scopedAccountKey} />}
        {tab === 'flows' && <FlowTemplatesTab />}
        {tab === 'landing-pages' && (
          <LandingPageTemplatesTab accountKey={scopedAccountKey} />
        )}
      </div>
    </TemplatesHeaderActionsContext.Provider>
  );
}
