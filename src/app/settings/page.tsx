'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAccount } from '@/contexts/account-context';
import { useUnsavedChanges } from '@/contexts/unsaved-changes-context';
import {
  BuildingStorefrontIcon,
  UsersIcon, SwatchIcon, SparklesIcon,
  CogIcon, BellIcon, TagIcon, Squares2X2Icon, BriefcaseIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { CodeEditor } from '@/components/code-editor';
import { AccountsList } from '@/components/accounts-list';
import { OemMultiSelect } from '@/components/oem-multi-select';
import PrimaryButton from '@/components/primary-button';
import { getAccountOems, industryHasBrands, brandsForIndustry } from '@/lib/oems';
import { UsersTab } from '@/components/settings/users-tab';
import { AppearanceTab } from '@/components/settings/appearance-tab';
import { NotificationsTab } from '@/components/settings/notifications-tab';
import { CustomFieldsTab } from '@/components/settings/custom-fields-tab';
import { CustomFieldBlueprintsTab } from '@/components/settings/custom-field-blueprints-tab';
import { IndustriesTab } from '@/components/settings/industries-tab';
import { useIndustries } from '@/lib/hooks/use-industries';

type Tab =
  | 'subaccounts'
  | 'subaccount'
  | 'users'
  | 'knowledge'
  | 'industries'
  | 'contact-fields'
  | 'contact-field-blueprints'
  | 'notifications'
  | 'appearance';

export default function SettingsPage() {
  const { isAdmin, isAccount, userRole } = useAccount();
  const { confirmNavigation } = useUnsavedChanges();
  const router = useRouter();
  const pathname = usePathname();

  // Determine available tabs based on role/mode. `label` is the sidebar
  // nav text; `titleLabel` is the page-header title (singularised /
  // suffixed with "Settings" for clean grammar).
  const tabs: {
    key: Tab;
    label: string;
    titleLabel: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [];
  const hasAdminAccess = userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin';
  // Elevated = developer / super_admin only (no plain admin). Gates the
  // app-wide Industries manager.
  const isElevated = userRole === 'developer' || userRole === 'super_admin';
  if (hasAdminAccess && isAdmin) tabs.push({ key: 'subaccounts', label: 'Sub-Accounts', titleLabel: 'Sub-Account Settings', icon: BuildingStorefrontIcon });
  if (isAccount) tabs.push({ key: 'subaccount', label: 'Sub-Account', titleLabel: 'Sub-Account Settings', icon: BuildingStorefrontIcon });
  if (hasAdminAccess && isAccount) tabs.push({ key: 'contact-fields', label: 'Custom Fields', titleLabel: 'Contact Custom Fields', icon: TagIcon });
  if (hasAdminAccess && isAdmin) tabs.push({ key: 'contact-field-blueprints', label: 'Field Blueprints', titleLabel: 'Contact Field Blueprints', icon: Squares2X2Icon });
  if (hasAdminAccess) tabs.push({ key: 'users', label: 'Users', titleLabel: 'User Settings', icon: UsersIcon });
  if (hasAdminAccess && isAdmin) tabs.push({ key: 'knowledge', label: 'Knowledge Base', titleLabel: 'Knowledge Base Settings', icon: SparklesIcon });
  if (isElevated && isAdmin) tabs.push({ key: 'industries', label: 'Industries', titleLabel: 'Industry Settings', icon: BriefcaseIcon });
  tabs.push({ key: 'notifications', label: 'Notifications', titleLabel: 'Notification Settings', icon: BellIcon });
  tabs.push({ key: 'appearance', label: 'Appearance', titleLabel: 'Appearance Settings', icon: SwatchIcon });

  const pathSegments = pathname.split('/').filter(Boolean);
  const routeTab = pathSegments[0] === 'settings'
    ? pathSegments[1]
    : undefined;
  const defaultTab = tabs[0]?.key || 'appearance';
  const defaultTabPath = `/settings/${defaultTab}`;
  const activeTab = tabs.some(t => t.key === routeTab)
    ? (routeTab as Tab)
    : defaultTab;

  // Enforce canonical route per tab so browser history/back works correctly.
  useEffect(() => {
    if (tabs.length === 0) return;
    if (!routeTab || !tabs.some(t => t.key === routeTab)) {
      router.replace(defaultTabPath, { scroll: false });
    }
  }, [routeTab, defaultTabPath, router, tabs.length, isAdmin, isAccount, userRole]);

  const activeTabObj = tabs.find((t) => t.key === activeTab);
  const TitleIcon = activeTabObj?.icon ?? CogIcon;
  const titleText = activeTabObj?.titleLabel ?? 'Settings';

  return (
    <div className="animate-fade-in-up pt-4">
      <div className="mb-6 px-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--foreground)]">
            <TitleIcon className="w-6 h-6" />
            {titleText}
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Manage your preferences and configuration
          </p>
        </div>
        {/* Portal target for tab-specific action buttons (e.g. "Add User"
            on the Users tab). Each tab calls `createPortal` into this
            div, so swapping tabs swaps the actions. */}
        <div id="settings-title-actions" className="flex items-center gap-2" />
      </div>

      <div className="border-b border-[var(--border)] mb-6" />

      {/* Sidebar nav + content */}
      <div className="flex gap-6">
        {/* Vertical nav — sticky */}
        <nav className="flex flex-col gap-1 w-48 shrink-0 sticky top-4 self-start">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => {
                const destination = `/settings/${tab.key}`;
                confirmNavigation(() => router.push(destination), destination);
              }}
              className={`flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors text-left ${
                activeTab === tab.key
                  ? 'bg-[var(--accent)] text-[var(--foreground)]'
                  : 'text-[var(--muted-foreground)] hover:bg-[var(--accent)]/50 hover:text-[var(--foreground)]'
              }`}
            >
              <tab.icon className="w-4 h-4 shrink-0" />
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Tab content — no per-tab title bar; the active tab is
            indicated by the highlighted item in the sidebar nav, and
            tab-specific actions render into `#settings-title-actions`
            up in the main Settings header. */}
        <div className="flex-1 min-w-0">
          {activeTab === 'subaccounts' && <AccountsList listPath="/settings/subaccounts" detailBasePath="/settings/subaccounts" />}
          {activeTab === 'subaccount' && <AccountSettingsTab />}
          {activeTab === 'contact-fields' && hasAdminAccess && isAccount && <CustomFieldsTab />}
          {activeTab === 'contact-field-blueprints' && hasAdminAccess && isAdmin && <CustomFieldBlueprintsTab />}
          {activeTab === 'users' && <UsersTab />}
          {activeTab === 'knowledge' && hasAdminAccess && isAdmin && <KnowledgeBaseTab />}
          {activeTab === 'industries' && isElevated && isAdmin && <IndustriesTab />}
          {activeTab === 'notifications' && <NotificationsTab />}
          {activeTab === 'appearance' && <AppearanceTab />}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// Account Settings Tab
// ════════════════════════════════════════
function AccountSettingsTab() {
  const {
    accountKey,
    accountData,
    refreshAccounts,
  } = useAccount();
  const { markClean } = useUnsavedChanges();
  const categorySuggestions = useIndustries();

  const [dealer, setDealer] = useState('');
  const [category, setCategory] = useState('');
  const [oems, setOems] = useState<string[]>([]);
  const [logoLight, setLogoLight] = useState('');
  const [logoDark, setLogoDark] = useState('');
  const [logoWhite, setLogoWhite] = useState('');
  const [logoBlack, setLogoBlack] = useState('');
  const [saving, setSaving] = useState(false);

  const snapshotRef = useRef<Record<string, string> | null>(null);

  useEffect(() => {
    if (accountData) {
      setDealer(accountData.dealer || '');
      setCategory(accountData.category || '');
      setOems(getAccountOems(accountData));
      setLogoLight(accountData.logos?.light || '');
      setLogoDark(accountData.logos?.dark || '');
      setLogoWhite(accountData.logos?.white || '');
      setLogoBlack(accountData.logos?.black || '');
      snapshotRef.current = {
        dealer: accountData.dealer || '',
        category: accountData.category || '',
        oems: JSON.stringify(getAccountOems(accountData)),
        logoLight: accountData.logos?.light || '',
        logoDark: accountData.logos?.dark || '',
        logoWhite: accountData.logos?.white || '',
        logoBlack: accountData.logos?.black || '',
      };
    }
  }, [accountData]);

  const hasChanges = useMemo(() => {
    const snap = snapshotRef.current;
    if (!snap) return false;
    const current: Record<string, string> = {
      dealer, category, oems: JSON.stringify(oems),
      logoLight, logoDark, logoWhite, logoBlack,
    };
    return Object.keys(snap).some(k => snap[k] !== current[k]);
  }, [dealer, category, oems, logoLight, logoDark, logoWhite, logoBlack]);

  if (!accountData || !accountKey) {
    return (
      <div className="text-center py-16">
        <p className="text-[var(--muted-foreground)] text-sm">Select a sub-account to manage settings.</p>
        <p className="text-[var(--muted-foreground)] text-xs mt-1">Use the sub-account switcher in the sidebar.</p>
      </div>
    );
  }

  async function handleSave() {
    if (!accountKey) return;
    setSaving(true);
    try {
      const hasBrands = industryHasBrands(category);
      const selectedOems = hasBrands ? oems : [];
      const payload: Record<string, unknown> = {
        dealer,
        category,
        oems: selectedOems,
        logos: {
          light: logoLight,
          dark: logoDark,
          white: logoWhite || undefined,
          black: logoBlack || undefined,
        },
      };

      const res = await fetch(`/api/accounts/${encodeURIComponent(accountKey)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        snapshotRef.current = {
          dealer, category, oems: JSON.stringify(oems),
          logoLight, logoDark, logoWhite, logoBlack,
        };
        await refreshAccounts();
        markClean();
        toast.success('Settings saved!');
      } else {
        toast.error('Failed to save settings');
      }
    } catch {
      toast.error('Failed to save settings');
    }
    setSaving(false);
  }

  const inputClass = 'w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:border-[var(--primary)]';
  const labelClass = 'block text-xs font-medium text-[var(--muted-foreground)] mb-1.5';
  const showBrandsSelector = industryHasBrands(category);
  const sectionCardClass = 'glass-section-card rounded-xl p-6';
  const sectionHeadingClass = 'text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-4';

  return (
    <div className="max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-6">
      <section className={sectionCardClass}>
        <h3 className={sectionHeadingClass}>General</h3>
        <div className="space-y-4">
          <div>
            <label className={labelClass}>Sub-Account Key</label>
            <div className="px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]">
              {accountKey}
            </div>
          </div>

          <div className={`grid grid-cols-1 gap-4 ${showBrandsSelector ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
            <div>
              <label className={labelClass}>Dealer Name</label>
              <input type="text" value={dealer} onChange={e => setDealer(e.target.value)} className={inputClass} />
            </div>

            <div>
              <label className={labelClass}>Industry</label>
              <select value={category} onChange={e => setCategory(e.target.value)} className={inputClass}>
                <option value="">Select industry...</option>
                {categorySuggestions.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
                {/* Preserve a saved value no longer in the list so it isn't
                    silently blanked on save. */}
                {category && !categorySuggestions.includes(category) && (
                  <option value={category}>{category}</option>
                )}
              </select>
            </div>

            {showBrandsSelector && (
              <div>
                <label className={labelClass}>Brands</label>
                <OemMultiSelect
                  value={oems}
                  onChange={setOems}
                  options={brandsForIndustry(category)}
                  placeholder="Select brands..."
                  maxSelections={8}
                />
              </div>
            )}
          </div>
        </div>
      </section>

      <section className={sectionCardClass}>
        <h3 className={sectionHeadingClass}>Logos</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { label: 'Light Logo URL', value: logoLight, setter: setLogoLight },
            { label: 'Dark Logo URL', value: logoDark, setter: setLogoDark },
            { label: 'White Logo URL (optional)', value: logoWhite, setter: setLogoWhite },
            { label: 'Black Logo URL (optional)', value: logoBlack, setter: setLogoBlack },
          ].map(({ label, value, setter }) => (
            <div key={label}>
              <label className="block text-[10px] text-[var(--muted-foreground)] mb-1">{label}</label>
              <input
                type="text"
                value={value}
                onChange={e => setter(e.target.value)}
                placeholder="https://..."
                className={inputClass}
              />
            </div>
          ))}
        </div>
      </section>

      <div className="lg:col-span-2 flex items-center justify-end gap-3">
        <PrimaryButton
          onClick={handleSave}
          disabled={saving || !hasChanges}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// Knowledge Base Tab
// ════════════════════════════════════════
function KnowledgeBaseTab() {
  const { markClean, markDirty } = useUnsavedChanges();
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const hasChanges = content !== savedContent;

  useEffect(() => {
    if (hasChanges) {
      markDirty();
    } else {
      markClean();
    }
    // markClean/markDirty are stable refs from context — safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasChanges]);

  useEffect(() => {
    fetch('/api/knowledge')
      .then(r => r.json())
      .then(data => {
        const c = data.content || '';
        setContent(c);
        setSavedContent(c);
      })
      .catch(() => toast.error('Failed to load knowledge base'))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/knowledge', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        setSavedContent(content);
        markClean();
        toast.success('Knowledge base saved! AI will use the updated content immediately.');
      } else {
        toast.error('Failed to save knowledge base');
      }
    } catch {
      toast.error('Failed to save knowledge base');
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-[var(--muted-foreground)]">Loading knowledge base...</p>
      </div>
    );
  }

  const sectionCardClass = 'glass-section-card rounded-xl p-5';

  return (
    <div className="max-w-7xl grid grid-cols-1 gap-6">
      <section className={sectionCardClass}>
        <div className="flex items-start gap-3 p-3 rounded-xl border border-[var(--ai-assist-border)] bg-[var(--ai-hz-chip-bg)]">
          <span className="w-6 h-6 rounded-full ai-horizon-orb flex items-center justify-center flex-shrink-0 mt-0.5">
            <SparklesIcon className="w-3.5 h-3.5 text-zinc-900" />
          </span>
          <div>
            <p className="text-sm font-medium text-[var(--foreground)]">AI Knowledge Base</p>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              This markdown file powers both AI assistants (the global Loomi bubble and the template editor sidebar). Edit it to update what the AI knows about your platform, processes, and conventions. Changes take effect immediately.
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPreview(false)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                !showPreview
                  ? 'bg-[var(--primary)] text-white'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] border border-[var(--border)]'
              }`}
            >
              Editor
            </button>
            <button
              onClick={() => setShowPreview(true)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                showPreview
                  ? 'bg-[var(--primary)] text-white'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] border border-[var(--border)]'
              }`}
            >
              Preview
            </button>
          </div>
          <div className="flex items-center gap-3">
            {hasChanges && (
              <span className="text-xs text-amber-500 font-medium">Unsaved changes</span>
            )}
            <PrimaryButton
              onClick={handleSave}
              disabled={saving || !hasChanges}
            >
              {saving ? 'Saving...' : 'Save'}
            </PrimaryButton>
          </div>
        </div>
      </section>

      <section className="glass-section-card rounded-xl p-0 overflow-hidden">
        {!showPreview ? (
          <div style={{ height: 'calc(100vh - 340px)', minHeight: '400px' }}>
            <CodeEditor
              value={content}
              onChange={setContent}
              language="markdown"
              onSave={handleSave}
            />
          </div>
        ) : (
          <div
            className="overflow-auto p-6"
            style={{ height: 'calc(100vh - 340px)', minHeight: '400px' }}
          >
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <MarkdownPreview content={content} />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// Simple markdown renderer — no external dependencies
function MarkdownPreview({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Headings
    if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="text-xl font-bold text-[var(--foreground)] mt-6 mb-3 first:mt-0">{line.slice(2)}</h1>);
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-lg font-semibold text-[var(--foreground)] mt-5 mb-2">{line.slice(3)}</h2>);
    } else if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="text-sm font-semibold text-[var(--foreground)] mt-4 mb-1.5">{line.slice(4)}</h3>);
    }
    // Horizontal rule
    else if (line.trim() === '---') {
      elements.push(<hr key={i} className="border-[var(--border)] my-4" />);
    }
    // Code block
    else if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={`code-${i}`} className="bg-[var(--muted)] rounded-lg p-3 text-xs overflow-x-auto my-2 border border-[var(--border)]">
          <code className="text-[var(--foreground)]">{codeLines.join('\n')}</code>
        </pre>
      );
    }
    // Table (basic)
    else if (line.includes('|') && line.trim().startsWith('|')) {
      const tableLines: string[] = [line];
      i++;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      i--; // back up since outer loop will increment
      const headerCells = tableLines[0].split('|').filter(c => c.trim()).map(c => c.trim());
      const bodyRows = tableLines.slice(2); // skip header + separator
      elements.push(
        <div key={`table-${i}`} className="overflow-x-auto my-3">
          <table className="w-full text-xs border border-[var(--border)] rounded-lg">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {headerCells.map((cell, ci) => (
                  <th key={ci} className="px-3 py-2 text-left font-medium text-[var(--muted-foreground)]">{cell}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => {
                const cells = row.split('|').filter(c => c.trim()).map(c => c.trim());
                return (
                  <tr key={ri} className="border-b border-[var(--border)] last:border-0">
                    {cells.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2 text-[var(--foreground)]">{renderInline(cell)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }
    // List items
    else if (line.trimStart().startsWith('- ')) {
      const indent = line.length - line.trimStart().length;
      elements.push(
        <div key={i} className="flex gap-2 text-xs text-[var(--foreground)]" style={{ paddingLeft: `${indent * 4 + 8}px` }}>
          <span className="text-[var(--muted-foreground)] flex-shrink-0">&#x2022;</span>
          <span>{renderInline(line.trimStart().slice(2))}</span>
        </div>
      );
    }
    // Numbered list
    else if (/^\d+\.\s/.test(line.trimStart())) {
      const match = line.trimStart().match(/^(\d+)\.\s(.*)$/);
      if (match) {
        elements.push(
          <div key={i} className="flex gap-2 text-xs text-[var(--foreground)] pl-2">
            <span className="text-[var(--muted-foreground)] flex-shrink-0 w-4 text-right">{match[1]}.</span>
            <span>{renderInline(match[2])}</span>
          </div>
        );
      }
    }
    // Empty line
    else if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />);
    }
    // Paragraph
    else {
      elements.push(
        <p key={i} className="text-xs leading-relaxed text-[var(--foreground)]">
          {renderInline(line)}
        </p>
      );
    }

    i++;
  }

  return <>{elements}</>;
}

// Inline markdown rendering: bold, italic, code, links
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // Match: **bold**, *italic*, `code`, [link](url)
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|(\[(.+?)\]\((.+?)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[1]) {
      parts.push(<strong key={match.index} className="font-semibold">{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<em key={match.index}>{match[4]}</em>);
    } else if (match[5]) {
      parts.push(<code key={match.index} className="px-1 py-0.5 rounded bg-[var(--muted)] text-[var(--primary)] text-[11px] font-mono">{match[6]}</code>);
    } else if (match[7]) {
      parts.push(<span key={match.index} className="text-[var(--primary)] underline">{match[8]}</span>);
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? <>{parts}</> : text;
}


