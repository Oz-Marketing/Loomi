'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { AccountsList } from '@/components/accounts-list';
import { SubAccountDetailPage } from '@/components/subaccount-detail';
import { UserDetail } from '@/components/users/user-detail';
import { NewUser } from '@/components/users/new-user';
import { UsersTab } from '@/components/settings/users-tab';
import { TeamsTab } from '@/components/settings/teams-tab';
import { CustomFieldBlueprintsTab } from '@/components/settings/custom-field-blueprints-tab';
import { IndustriesTab } from '@/components/settings/industries-tab';
import { RateCardsTab } from '@/components/settings/rate-cards-tab';
import { DefaultMarkupTab } from '@/components/settings/default-markup-tab';
import { AlertRulesTab } from '@/components/settings/alert-rules-tab';
import { CoopGuidelinesTab } from '@/components/settings/coop-guidelines-tab';
import { NotificationsTab } from '@/components/settings/notifications-tab';
import { AppearanceTab } from '@/components/settings/appearance-tab';
import { KnowledgeBaseTab } from '@/components/settings/knowledge-base-tab';
import {
  useAgencySettingsNav,
  type SettingsTabKey,
} from '@/components/settings/use-settings-tabs';

/**
 * Agency Settings — the platform-management tier, in a large modal rather than
 * the app shell.
 *
 * It sits over whatever you were doing instead of replacing the sidebar and
 * navigating away, so the tier reads as somewhere you step into and back out
 * of. Nothing about the surrounding page changes while it's open: no route
 * change, no scope switch, no nav swap.
 *
 * Because the account scope is left alone, the tabs that would otherwise filter
 * by it are told explicitly that they're in agency scope (`agencyScope` on
 * UsersTab, no `restrictKeys` on the sub-account list) — the settings here are
 * fleet-wide regardless of which sub-account you happen to be sitting in.
 *
 * Drill-ins stay inside the overlay. Opening a sub-account or a user used to
 * push a route, which closed the modal in all but name: the record appeared on
 * a page behind it, in the app shell this tier deliberately doesn't live in.
 * They render here instead, over the tab they came from, and their back arrows
 * return to the list.
 */

/** What's open on top of the active tab, if anything. */
type Drill =
  | { kind: 'subaccount'; key: string }
  | { kind: 'user'; id: string }
  | { kind: 'new-user' };

export function AgencySettingsModal({ onClose }: { onClose: () => void }) {
  const groups = useAgencySettingsNav();
  const firstKey = groups[0]?.items[0]?.key;
  const [active, setActive] = useState<SettingsTabKey | undefined>(firstKey);
  const [drill, setDrill] = useState<Drill | null>(null);

  /** Switching tabs always lands on the list, never a stale drill-in. */
  const selectTab = (key: SettingsTabKey) => {
    setDrill(null);
    setActive(key);
  };

  // Settle on the first available tab once the registry resolves (it depends on
  // role + loaded accounts, so the first render can legitimately be empty).
  useEffect(() => {
    if (!active && firstKey) setActive(firstKey);
  }, [active, firstKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // The page behind shouldn't scroll while the modal owns the screen.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  const activeTab = groups.flatMap((g) => g.items).find((i) => i.key === active);

  return createPortal(
    <div
      className="animate-overlay-in fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Agency Settings"
    >
      <div
        // glass-modal supplies the hairline border, shadow and entrance
        // animation; -solid overrides its fill to near-opaque, which a panel
        // this large needs so the page behind doesn't read through the content.
        className="glass-modal glass-modal-solid flex h-full max-h-[92vh] w-full max-w-[1400px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Rail. `--accent` is the themed hairline tint (white in dark, black
            in light) — a hardcoded white/2% was invisible on the light panel. */}
        <nav className="hidden w-60 flex-shrink-0 flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--accent)] p-3 md:flex">
          <p className="px-3 pb-2 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Agency Settings
          </p>
          {groups.map((group, groupIndex) => (
            <div key={group.group} className="space-y-px">
              <p
                className={`px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]/70 ${
                  groupIndex === 0 ? 'pt-2' : 'pt-6'
                }`}
              >
                {group.label}
              </p>
              {group.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => selectTab(item.key)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                    item.key === active
                      ? 'bg-[var(--primary)]/10 font-medium text-[var(--primary)]'
                      : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]'
                  }`}
                >
                  <item.icon className="h-5 w-5 flex-shrink-0" />
                  {item.navLabel ?? item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-4">
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold text-[var(--foreground)]">
                {activeTab?.titleLabel ?? 'Agency Settings'}
              </h2>
              <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                Platform configuration, shared by every account.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Tabs portal their primary action here, same as the page does.
                  Its own id, not the page's: a modal opened over a settings
                  page would otherwise resolve to that page's slot and render
                  the button behind the overlay. */}
              <div id="agency-settings-title-actions" className="flex items-center gap-2" />
              <button
                type="button"
                onClick={onClose}
                aria-label="Close Agency Settings"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Mobile rail — the sidebar is hidden under md. */}
          <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] px-4 py-2 md:hidden">
            {groups.flatMap((g) => g.items).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setActive(item.key)}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  item.key === active
                    ? 'bg-[var(--primary)]/10 font-medium text-[var(--primary)]'
                    : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)]'
                }`}
              >
                {item.navLabel ?? item.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {/* Drill-ins render over the tab they came from, so the tier keeps
                its rail and its close button and the app shell behind is never
                navigated. */}
            {drill?.kind === 'subaccount' && (
              <SubAccountDetailPage
                basePath="/settings/subaccounts"
                accountKeyProp={drill.key}
                onBack={() => setDrill(null)}
              />
            )}
            {drill?.kind === 'user' && (
              <UserDetail userId={drill.id} onBack={() => setDrill(null)} />
            )}
            {drill?.kind === 'new-user' && (
              // Agency Settings lists the agency's own people, so a new one
              // starts as an admin — created as a Client it would save and
              // immediately disappear from the roster it was added to.
              <NewUser
                defaultRole="admin"
                onCancel={() => setDrill(null)}
                onCreated={(userId) => setDrill({ kind: 'user', id: userId })}
              />
            )}

            {!drill && active === 'subaccounts' && (
              // No restrictKeys: agency settings span the whole fleet even when
              // the surrounding page is scoped to one org or sub-account.
              <AccountsList
                listPath="/settings/subaccounts"
                detailBasePath="/settings/subaccounts"
                restrictKeys={undefined}
                onOpenAccount={(key) => setDrill({ kind: 'subaccount', key })}
                onOpenUser={(id) => setDrill({ kind: 'user', id })}
                onCreateUser={() => setDrill({ kind: 'new-user' })}
              />
            )}
            {!drill && active === 'users' && (
              <UsersTab
                agencyScope
                onOpenUser={(id) => setDrill({ kind: 'user', id })}
                onCreateUser={() => setDrill({ kind: 'new-user' })}
              />
            )}
            {active === 'teams' && <TeamsTab />}
            {active === 'contact-field-blueprints' && <CustomFieldBlueprintsTab />}
            {active === 'knowledge' && <KnowledgeBaseTab />}
            {active === 'industries' && <IndustriesTab />}
            {active === 'markup' && (
              <div className="space-y-4">
                <RateCardsTab />
                <DefaultMarkupTab />
              </div>
            )}
            {active === 'alerts' && <AlertRulesTab />}
            {active === 'coop-guidelines' && <CoopGuidelinesTab />}
            {active === 'notifications' && <NotificationsTab />}
            {active === 'appearance' && <AppearanceTab />}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
