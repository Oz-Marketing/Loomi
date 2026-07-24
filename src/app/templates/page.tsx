'use client';

import { Suspense, useState, type ComponentType, type SVGProps } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  BookOpenIcon,
  EnvelopeIcon,
  DocumentTextIcon,
  RectangleStackIcon,
  MegaphoneIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { AD_GENERATOR_ENABLED } from '@/lib/feature-flags';
import { EmailTemplatesPanel } from '@/app/email/templates/email-templates-view';
import { TemplatesHeaderActionsContext } from '@/components/templates/template-header-actions';
import { FormTemplatesTab } from '@/components/templates/form-templates-tab';
import { LandingPageTemplatesTab } from '@/components/templates/landing-page-templates-tab';
import { AdTemplatesTab } from '@/components/templates/ad-templates-tab';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

type TabId = 'email' | 'forms' | 'landing-pages' | 'ads';

interface TabDef {
  id: TabId;
  label: string;
  subtitle: string;
  icon: IconComponent;
}

const MANAGER_TABS: TabDef[] = [
  { id: 'email', label: 'Email', subtitle: 'Email templates for campaigns and flows.', icon: EnvelopeIcon },
  { id: 'forms', label: 'Forms', subtitle: 'Reusable form templates.', icon: DocumentTextIcon },
  { id: 'landing-pages', label: 'Landing Pages', subtitle: 'Saved landing page templates.', icon: RectangleStackIcon },
];

// The Ad Generator is still feature-flagged, so the Ads tab only joins the
// manager set when the flag is on (any admin+ can then edit ad templates).
const ADS_TAB: TabDef = { id: 'ads', label: 'Ads', subtitle: 'Shared ad templates. Edit a layout here; create the account’s ad in the Ad Generator.', icon: MegaphoneIcon };

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
  const { userRole, account, accountKey, accountData, organizationId, organizationData } = useAccount();
  const campaignDraftQuery =
    searchParams.get('campaignDraft') === '1' ? '?campaignDraft=1' : '';

  const isClient = userRole === 'client';
  const canManage =
    userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin';
  // The Ad Generator is WIP — its Ads tab shows when the env flag is on (staging)
  // or for developers (any env), matching the route/nav gating.
  const showAdsTab = canManage && (AD_GENERATOR_ENABLED || userRole === 'developer');
  const tabs = canManage
    ? showAdsTab
      ? [...MANAGER_TABS, ADS_TAB]
      : MANAGER_TABS
    : CLIENT_TABS;

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

  const scopedAccountKey =
    account.mode === 'account' && accountKey ? accountKey : undefined;
  // In org mode, authoring is scoped to the organization: new templates are
  // owned by the org and inherited by every sub-account.
  const scopedOrgId =
    account.mode === 'org' && organizationId ? organizationId : undefined;
  const orgLabel = organizationData?.name ?? undefined;
  const accountLabel = accountData?.dealer ?? accountKey ?? undefined;

  const activeDef = tabs.find((t) => t.id === tab) ?? tabs[0];

  return (
    <TemplatesHeaderActionsContext.Provider value={actionsSlot}>
      <div>
        <div className={`page-sticky-header ${tabs.length > 1 ? 'has-tabs ' : ''}mb-4`}>
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
            {/* Right-aligned action slot the active tab portals its CTA + overflow into. */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <div ref={setActionsSlot} className="flex items-center gap-2" />
            </div>
          </div>

        {/* Tabs pinned inside the sticky header so they don't scroll away. */}
        {tabs.length > 1 && (
          <div className="mt-4 flex items-center gap-1 border-b border-[var(--border)]">
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
        </div>

        {tab === 'email' && (
          <EmailTemplatesPanel
            campaignDraftQuery={campaignDraftQuery}
            accountKey={scopedAccountKey}
            accountLabel={accountLabel}
            organizationId={scopedOrgId}
            orgLabel={orgLabel}
            canManage={canManage}
            isClient={isClient}
          />
        )}
        {tab === 'forms' && (
          <FormTemplatesTab
            accountKey={scopedAccountKey}
            organizationId={scopedOrgId}
            orgLabel={orgLabel}
          />
        )}
        {tab === 'landing-pages' && (
          <LandingPageTemplatesTab
            accountKey={scopedAccountKey}
            organizationId={scopedOrgId}
            orgLabel={orgLabel}
          />
        )}
        {tab === 'ads' && <AdTemplatesTab accountKey={scopedAccountKey} />}
      </div>
    </TemplatesHeaderActionsContext.Provider>
  );
}
