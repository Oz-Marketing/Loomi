'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAccount } from '@/contexts/account-context';
import { useUnsavedChanges } from '@/contexts/unsaved-changes-context';
import { toast } from '@/lib/toast';
import { OemMultiSelect } from '@/components/oem-multi-select';
import PrimaryButton from '@/components/primary-button';
import { Select } from '@/components/select';
import { getAccountOems, industryHasBrands, brandsForIndustry } from '@/lib/oems';
import { HelpTip } from '@/components/ui/help-tip';
import { useIndustries } from '@/lib/hooks/use-industries';
import { organizationOptions, subAccountCount } from '@/lib/organization-options';

// ════════════════════════════════════════
// Account Settings Tab
// ════════════════════════════════════════
export function AccountSettingsTab() {
  const {
    accountKey,
    accountData,
    accounts,
    refreshAccounts,
  } = useAccount();
  // Name of the parent ACCOUNT (if any) — for the "inherits the brand kit"
  // hint. Follows the hierarchy that replaced Organizations; falls back to the
  // legacy org name so accounts not yet migrated still show a hint.
  const parentOrgName =
    (accountData?.parentAccountKey
      ? accounts[accountData.parentAccountKey]?.dealer ?? accountData.parentAccountKey
      : null) ??
    null;
  const { markClean } = useUnsavedChanges();
  const categorySuggestions = useIndustries();

  const [dealer, setDealer] = useState('');
  const [category, setCategory] = useState('');
  const [oems, setOems] = useState<string[]>([]);
  const [logoLight, setLogoLight] = useState('');
  const [logoDark, setLogoDark] = useState('');
  const [logoWhite, setLogoWhite] = useState('');
  const [logoBlack, setLogoBlack] = useState('');
  const [parentAccountKey, setParentAccountKey] = useState('');
  const [saving, setSaving] = useState(false);
  // Portal target for the Save button — lives in the settings title bar.
  const [titleActionsEl, setTitleActionsEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTitleActionsEl(document.getElementById('settings-title-actions'));
  }, []);

  const parentOptions = useMemo(
    () => organizationOptions(accounts, accountKey),
    [accounts, accountKey],
  );

  // How many accounts roll up to this one. Surfaced because being an
  // Organization is derived from OTHER accounts pointing here — without this
  // the page gives no hint that it's a parent.
  const rooftopCount = useMemo(() => subAccountCount(accounts, accountKey), [accounts, accountKey]);

  const snapshotRef = useRef<Record<string, string> | null>(null);

  useEffect(() => {
    if (accountData) {
      // Edit the account's OWN logos (not the org-inherited resolved set), so
      // saving never persists inherited values back onto the sub-account.
      const own = accountData.ownLogos ?? accountData.logos;
      setDealer(accountData.dealer || '');
      setCategory(accountData.category || '');
      setOems(getAccountOems(accountData));
      setParentAccountKey(accountData.parentAccountKey || '');
      setLogoLight(own?.light || '');
      setLogoDark(own?.dark || '');
      setLogoWhite(own?.white || '');
      setLogoBlack(own?.black || '');
      snapshotRef.current = {
        dealer: accountData.dealer || '',
        category: accountData.category || '',
        oems: JSON.stringify(getAccountOems(accountData)),
        logoLight: own?.light || '',
        logoDark: own?.dark || '',
        logoWhite: own?.white || '',
        logoBlack: own?.black || '',
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
        <p className="text-[var(--muted-foreground)] text-sm">Select an account to manage settings.</p>
        <p className="text-[var(--muted-foreground)] text-xs mt-1">Use the account switcher in the sidebar.</p>
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
        parentAccountKey: parentAccountKey || null,
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
            <label className={labelClass}>Account Key</label>
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
              <Select
                value={category}
                onChange={setCategory}
                options={[
                  { value: '', label: 'Select industry…' },
                  ...categorySuggestions.map((cat) => ({ value: cat, label: cat })),
                  // Preserve a saved value no longer in the list so it isn't
                  // silently blanked on save.
                  ...(category && !categorySuggestions.includes(category)
                    ? [{ value: category, label: category }]
                    : []),
                ]}
                previewFont={false}
                ariaLabel="Industry"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <label className="text-xs font-medium text-[var(--muted-foreground)]">
                  Group
                </label>
                <HelpTip title="Group">
                  <p>
                    The account this one belongs to. Its contacts roll up to that account, and it
                    inherits that account&rsquo;s brand kit and templates.
                  </p>
                  <p>
                    There is no separate promote step — an account becomes a group the
                    moment another account points at it here. To dissolve one, set this field back
                    to <strong>None</strong> on each of its accounts.
                  </p>
                </HelpTip>
              </div>
              <Select
                value={parentAccountKey}
                onChange={setParentAccountKey}
                options={[
                  { value: '', label: 'None — standalone account' },
                  ...parentOptions.map((o) => ({ value: o.key, label: o.label })),
                ]}
                previewFont={false}
                ariaLabel="Group"
              />
              {rooftopCount > 0 && (
                <p className="mt-1.5 text-[11px] leading-4 text-[var(--muted-foreground)]">
                  This account is itself a group — {rooftopCount} account
                  {rooftopCount === 1 ? '' : 's'} roll{rooftopCount === 1 ? 's' : ''} up to it.
                </p>
              )}
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
        {parentOrgName && (
          <p className="text-[11px] text-[var(--muted-foreground)] -mt-2 mb-3">
            Leave a slot empty to inherit <span className="font-medium text-[var(--foreground)]">{parentOrgName}</span>&apos;s brand kit.
          </p>
        )}
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

      {titleActionsEl && createPortal(
        <PrimaryButton
          onClick={handleSave}
          disabled={saving || !hasChanges}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </PrimaryButton>,
        titleActionsEl,
      )}
    </div>
  );
}
