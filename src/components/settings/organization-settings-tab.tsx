'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAccount } from '@/contexts/account-context';
import { useUnsavedChanges } from '@/contexts/unsaved-changes-context';
import PrimaryButton from '@/components/primary-button';
import { toast } from '@/lib/toast';

/**
 * Organization-tier settings (shown in Org mode). The org profile — name today,
 * brand kit next (Phase 2 inheritance). Its sub-accounts are managed in the
 * Sub-Accounts tab, so this stays focused on the org itself.
 */
interface LogoSet {
  light: string;
  dark: string;
  white: string;
  black: string;
}

function parseLogos(raw: string | null | undefined): LogoSet {
  try {
    const v = raw ? JSON.parse(raw) : {};
    return {
      light: typeof v.light === 'string' ? v.light : '',
      dark: typeof v.dark === 'string' ? v.dark : '',
      white: typeof v.white === 'string' ? v.white : '',
      black: typeof v.black === 'string' ? v.black : '',
    };
  } catch {
    return { light: '', dark: '', white: '', black: '' };
  }
}

// The org brand kit's colors + fonts (same shape as Account.branding), which
// cascade to sub-accounts that leave a field empty.
const BRAND_COLORS = ['primary', 'secondary', 'accent', 'background', 'text'] as const;
const BRAND_FONTS = ['heading', 'body'] as const;
type BrandingSet = { colors: Record<string, string>; fonts: Record<string, string> };

function parseBranding(raw: string | null | undefined): BrandingSet {
  const empty: BrandingSet = { colors: {}, fonts: {} };
  try {
    const v = raw ? JSON.parse(raw) : {};
    return {
      colors: v && typeof v.colors === 'object' ? { ...v.colors } : {},
      fonts: v && typeof v.fonts === 'object' ? { ...v.fonts } : {},
    };
  } catch {
    return empty;
  }
}

export function OrganizationSettingsTab() {
  const { organizationId, organizationData, accounts, refreshOrganizations } = useAccount();
  const { markClean } = useUnsavedChanges();

  const [name, setName] = useState('');
  const [savedName, setSavedName] = useState('');
  const [logos, setLogos] = useState<LogoSet>({ light: '', dark: '', white: '', black: '' });
  const [savedLogosSig, setSavedLogosSig] = useState('');
  const [primary, setPrimary] = useState('');
  const [savedPrimary, setSavedPrimary] = useState('');
  const [branding, setBranding] = useState<BrandingSet>({ colors: {}, fonts: {} });
  const [savedBrandingSig, setSavedBrandingSig] = useState('');
  const [saving, setSaving] = useState(false);
  const [titleActionsEl, setTitleActionsEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTitleActionsEl(document.getElementById('settings-title-actions'));
  }, []);

  useEffect(() => {
    if (organizationData) {
      setName(organizationData.name);
      setSavedName(organizationData.name);
      const parsed = parseLogos(organizationData.logos);
      setLogos(parsed);
      setSavedLogosSig(JSON.stringify(parsed));
      setPrimary(organizationData.primaryAccountKey ?? '');
      setSavedPrimary(organizationData.primaryAccountKey ?? '');
      const b = parseBranding(organizationData.branding);
      setBranding(b);
      setSavedBrandingSig(JSON.stringify(b));
    }
  }, [organizationData]);

  if (!organizationId || !organizationData) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-[var(--muted-foreground)]">Select an organization to manage its settings.</p>
      </div>
    );
  }

  // The org's own sub-accounts, for the primary ("house") account picker.
  const memberKeys = organizationData.accountKeys;

  const nameDirty = name.trim().length > 0 && name.trim() !== savedName;
  const logosDirty = JSON.stringify(logos) !== savedLogosSig;
  const primaryDirty = primary !== savedPrimary;
  const brandingDirty = JSON.stringify(branding) !== savedBrandingSig;
  const dirty = nameDirty || logosDirty || primaryDirty || brandingDirty;

  const setColor = (k: string, v: string) =>
    setBranding((prev) => ({ ...prev, colors: { ...prev.colors, [k]: v } }));
  const setFont = (k: string, v: string) =>
    setBranding((prev) => ({ ...prev, fonts: { ...prev.fonts, [k]: v } }));

  const save = async () => {
    setSaving(true);
    try {
      // Persist logos as JSON (same shape as Account.logos). Empty optional
      // slots are dropped so the org brand kit stays tidy.
      const logosPayload = {
        light: logos.light,
        dark: logos.dark,
        ...(logos.white ? { white: logos.white } : {}),
        ...(logos.black ? { black: logos.black } : {}),
      };
      // Drop empty color/font slots so the org brand kit only cascades the
      // values that were actually set.
      const trimMap = (m: Record<string, string>) =>
        Object.fromEntries(Object.entries(m).filter(([, v]) => v && v.trim()));
      const brandingPayload = { colors: trimMap(branding.colors), fonts: trimMap(branding.fonts) };

      const r = await fetch(`/api/organizations/${organizationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          logos: JSON.stringify(logosPayload),
          branding: JSON.stringify(brandingPayload),
          primaryAccountKey: primary || null,
        }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setSavedName(name.trim());
      setSavedLogosSig(JSON.stringify(logos));
      setSavedBrandingSig(JSON.stringify(branding));
      setSavedPrimary(primary);
      markClean();
      await refreshOrganizations();
      toast.success('Organization saved!');
    } catch {
      toast.error('Failed to save organization');
    }
    setSaving(false);
  };

  const sectionCardClass = 'glass-section-card rounded-xl p-6';
  const sectionHeadingClass = 'text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-4';
  const inputClass = 'w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:border-[var(--primary)]';
  const labelClass = 'block text-xs font-medium text-[var(--muted-foreground)] mb-1.5';

  return (
    <div className="max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-6">
      <section className={sectionCardClass}>
        <h3 className={sectionHeadingClass}>General</h3>
        <div className="space-y-4">
          <div>
            <label className={labelClass}>Organization Key</label>
            <div className="px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)] font-mono">
              {organizationData.key}
            </div>
          </div>
          <div>
            <label className={labelClass}>Organization Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Primary sub-account</label>
            <select value={primary} onChange={(e) => setPrimary(e.target.value)} className={inputClass}>
              <option value="">None (roll-up only)</option>
              {memberKeys.map((key) => (
                <option key={key} value={key}>{accounts[key]?.dealer || key}</option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
              The &ldquo;house&rdquo; sub-account this organization operates from — its own campaigns, contacts,
              and flows live here, separate from the other sub-accounts it rolls up.
            </p>
          </div>
          <p className="text-[11px] text-[var(--muted-foreground)]">
            Manage this organization&apos;s sub-accounts in the Sub-Accounts tab.
          </p>
        </div>
      </section>

      <section className={sectionCardClass}>
        <h3 className={sectionHeadingClass}>Branding</h3>
        <p className="text-[11px] text-[var(--muted-foreground)] -mt-2 mb-4">
          The organization brand kit — inherited by its sub-accounts unless they override it.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([
            ['Light Logo URL', 'light'],
            ['Dark Logo URL', 'dark'],
            ['White Logo URL (optional)', 'white'],
            ['Black Logo URL (optional)', 'black'],
          ] as const).map(([label, key]) => (
            <div key={key}>
              <label className="block text-[10px] text-[var(--muted-foreground)] mb-1">{label}</label>
              <input
                type="text"
                value={logos[key]}
                onChange={(e) => setLogos((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder="https://..."
                className={inputClass}
              />
            </div>
          ))}
        </div>

        {/* Brand colors */}
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mt-6 mb-2">Colors</h4>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {BRAND_COLORS.map((k) => (
            <div key={k}>
              <label className="block text-[10px] text-[var(--muted-foreground)] mb-1 capitalize">{k}</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={branding.colors[k] || '#000000'}
                  onChange={(e) => setColor(k, e.target.value)}
                  className="h-8 w-8 flex-shrink-0 rounded border border-[var(--border)] bg-transparent p-0.5 cursor-pointer"
                  aria-label={`${k} color`}
                />
                <input
                  type="text"
                  value={branding.colors[k] || ''}
                  onChange={(e) => setColor(k, e.target.value)}
                  placeholder="#—"
                  className="w-full min-w-0 px-2 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:border-[var(--primary)]"
                />
              </div>
            </div>
          ))}
        </div>

        {/* Brand fonts */}
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mt-6 mb-2">Fonts</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {BRAND_FONTS.map((k) => (
            <div key={k}>
              <label className="block text-[10px] text-[var(--muted-foreground)] mb-1 capitalize">{k} font</label>
              <input
                type="text"
                value={branding.fonts[k] || ''}
                onChange={(e) => setFont(k, e.target.value)}
                placeholder="e.g. Inter, Helvetica, sans-serif"
                className={inputClass}
              />
            </div>
          ))}
        </div>
      </section>

      {titleActionsEl && createPortal(
        <PrimaryButton onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving...' : 'Save Settings'}
        </PrimaryButton>,
        titleActionsEl,
      )}
    </div>
  );
}
