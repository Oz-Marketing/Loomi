'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { FontSelect } from '@/components/font-select';
import { createPortal } from 'react-dom';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  BuildingStorefrontIcon,
  GlobeAltIcon,
  PaintBrushIcon,
  PencilSquareIcon,
  SwatchIcon,
  UsersIcon,
  CloudArrowUpIcon,
  PhotoIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  QuestionMarkCircleIcon,
  PuzzlePieceIcon,
  TagIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { AdminOnly } from '@/components/route-guard';
import { UsersTab } from '@/components/settings/users-tab';
import { AppearanceTab } from '@/components/settings/appearance-tab';
import { CustomFieldsTab } from '@/components/settings/custom-fields-tab';
import { AccountDomainsTab } from '@/components/account-domains-tab';
import { CrmIntegrationCards } from '@/components/crm-integration-cards';
import { ReportingIntegrationCards } from '@/components/reporting-integration-cards';
// Sending + Suppressions tabs now live under /messaging/settings.
import { OemMultiSelect } from '@/components/oem-multi-select';
import { UserAvatar } from '@/components/user-avatar';
import { AccountAvatar } from '@/components/account-avatar';
import { MediaPickerModal } from '@/components/media-picker-modal';
import { ContactsTable } from '@/components/contacts/contacts-table';
import type { Contact } from '@/lib/contacts/types';
import type { AccountData } from '@/contexts/account-context';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { useUnsavedChanges } from '@/contexts/unsaved-changes-context';
import { getAccountOems, industryHasBrands, brandsForIndustry } from '@/lib/oems';
import {
  resolveAccountAddress,
  resolveAccountCity,
  resolveAccountEmail,
  resolveAccountPhone,
  resolveAccountPostalCode,
  resolveAccountState,
  resolveAccountTimezone,
  resolveAccountWebsite,
} from '@/lib/account-resolvers';
import { useIndustries } from '@/lib/hooks/use-industries';

const WEBSAFE_FONTS = [
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Helvetica', value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Palatino', value: '"Palatino Linotype", "Book Antiqua", Palatino, serif' },
  { label: 'Garamond', value: 'Garamond, Georgia, serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Lucida Console', value: '"Lucida Console", Monaco, monospace' },
];

const DEFAULT_HEADING_FONT = WEBSAFE_FONTS[1].value;
const DEFAULT_BODY_FONT = WEBSAFE_FONTS[0].value;

function validHexColor(value: string, fallback: string): string {
  return /^#(?:[0-9a-fA-F]{3}){1,2}$/.test(value) ? value : fallback;
}

type DetailTab = 'company' | 'branding' | 'contacts' | 'contact-fields' | 'domains' | 'integrations' | 'users' | 'appearance';

/** Banner art for the Meta integration card (Meta wordmark on light bg). */
const META_LOGO_URL =
  'https://loomi-media.sfo3.digitaloceanspaces.com/media/_admin/9a1f951b8d3c42b9925bd23e72426eb9/meta-facebook-rebranding-name-news_dezeen_2364_col_hero2.jpg';
type AccountImageVariant = 'light' | 'dark' | 'white' | 'black' | 'storefront';

type TabDef = { key: DetailTab; label: string; icon?: React.ComponentType<{ className?: string }> };

const TABS: TabDef[] = [
  { key: 'company', label: 'Company', icon: BuildingStorefrontIcon },
  { key: 'branding', label: 'Branding', icon: PaintBrushIcon },
  { key: 'contacts', label: 'Contacts', icon: UsersIcon },
  { key: 'domains', label: 'Domains', icon: GlobeAltIcon },
  { key: 'integrations', label: 'Integrations', icon: PuzzlePieceIcon },
];

// Sending + Suppressions used to live here but moved into the
// messaging-scoped settings page at /subaccount/<slug>/messaging/settings
// since they're tightly coupled to the email engine. Legacy URLs are
// redirected from the [tab] page below.
// Order: Company → Users → Branding → rest. Shared with the sidebar settings
// nav (see SUBACCOUNT_SETTINGS_SECTIONS in settings-nav).
const SETTINGS_TABS: TabDef[] = [
  { key: 'company', label: 'Company', icon: BuildingStorefrontIcon },
  { key: 'users', label: 'Users', icon: UsersIcon },
  { key: 'branding', label: 'Branding', icon: PaintBrushIcon },
  { key: 'domains', label: 'Domains', icon: GlobeAltIcon },
  { key: 'integrations', label: 'Integrations', icon: PuzzlePieceIcon },
  { key: 'contact-fields', label: 'Custom Fields', icon: TagIcon },
  { key: 'appearance', label: 'Appearance', icon: SwatchIcon },
];

// Settings mode lives at two URL shapes:
//   • Studio scoped:  /subaccount/<slug>/settings/<tab>            (section in path)
//   • Admin browse:   [<surface>/]settings/subaccounts/<key>?tab=  (section in query —
//     keeps the single [key] route, no per-tab route files needed)
// These read/write the active section for whichever shape we're on.
function isStudioSettingsScheme(pathname: string): boolean {
  return pathname.split('/').filter(Boolean)[0] === 'subaccount';
}
function readSettingsSectionTab(
  pathname: string,
  search?: { get(name: string): string | null } | null,
): string | undefined {
  if (isStudioSettingsScheme(pathname)) {
    const segments = pathname.split('/').filter(Boolean);
    const i = segments.indexOf('settings');
    return i >= 0 ? segments[i + 1] : undefined;
  }
  return search?.get('tab') ?? undefined;
}
function buildSettingsSectionPath(pathname: string, key: string, tab: string): string {
  if (isStudioSettingsScheme(pathname)) {
    const slug = pathname.split('/').filter(Boolean)[1];
    return `/subaccount/${slug}/settings/${tab}`;
  }
  // Preserve any surface prefix (e.g. /reporting) that sits before /settings.
  const i = pathname.indexOf('/settings/subaccounts');
  const prefix = i > 0 ? pathname.slice(0, i) : '';
  return `${prefix}/settings/subaccounts/${key}?tab=${tab}`;
}

interface SubAccountDetailPageProps {
  /** Base path for navigation, e.g. '/subaccounts' or '/settings/subaccounts' */
  basePath: string;
  /** When true, renders as a sub-account settings page with settings-style header and extra tabs */
  settingsMode?: boolean;
  /** Account key to use (for settings mode, where there's no :key route param) */
  accountKeyProp?: string;
}

export function SubAccountDetailPage({ basePath, settingsMode, accountKeyProp }: SubAccountDetailPageProps) {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { confirm } = useLoomiDialog();
  const key = settingsMode ? (accountKeyProp || '') : (params.key as string);
  const { refreshAccounts: refreshAccountList } = useAccount();
  const { markClean } = useUnsavedChanges();

  const [activeTab, setActiveTab] = useState<DetailTab>('company');
  // Which integration card is open in the Integrations tab (null = no modal).
  const [activeIntegration, setActiveIntegration] = useState<string | null>(null);
  const [savingIntegration, setSavingIntegration] = useState(false);
  // Close the integration modal on Escape.
  useEffect(() => {
    if (!activeIntegration) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveIntegration(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeIntegration]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [isEditingDealerName, setIsEditingDealerName] = useState(false);

  // ── Company fields ──
  const [dealer, setDealer] = useState('');
  const [category, setCategory] = useState('General');
  const categorySuggestions = useIndustries();
  const [oems, setOems] = useState<string[]>([]);
  const [storefrontImage, setStorefrontImage] = useState('');
  const [bizEmail, setBizEmail] = useState('');
  const [bizPhone, setBizPhone] = useState('');
  const [bizPhoneSales, setBizPhoneSales] = useState('');
  const [bizPhoneService, setBizPhoneService] = useState('');
  const [bizPhoneParts, setBizPhoneParts] = useState('');
  const [bizAddress, setBizAddress] = useState('');
  const [bizCity, setBizCity] = useState('');
  const [bizState, setBizState] = useState('');
  const [bizZip, setBizZip] = useState('');
  const [bizWebsite, setBizWebsite] = useState('');
  const [bizTimezone, setBizTimezone] = useState('');
  const [accountRepId, setAccountRepId] = useState<string | null>(null);
  // Per-account override for the Pacer markup rate. Empty string = use
  // the global default (0.77). Stored as a free-form string for the input
  // and parsed at save time so we can distinguish "" (unset) from "0".
  const [markup, setMarkup] = useState<string>('');
  // Facebook ad account ("act_...") for the Meta Ads Pacer's Sync-from-
  // Facebook job. Empty string = not connected.
  const [metaAdAccountId, setMetaAdAccountId] = useState<string>('');
  // Reporting margin (%) for the Meta Ads report.
  const [facebookAdsMargin, setFacebookAdsMargin] = useState<string>('');
  const [allUsers, setAllUsers] = useState<{ id: string; name: string; title?: string | null; email: string; avatarUrl?: string | null; role?: string; accountKeys?: string[] }[]>([]);

  // ── Branding fields ──
  const [logoLight, setLogoLight] = useState('');
  const [logoDark, setLogoDark] = useState('');
  const [logoWhite, setLogoWhite] = useState('');
  const [logoBlack, setLogoBlack] = useState('');
  const [brandPrimaryColor, setBrandPrimaryColor] = useState('#2563eb');
  const [brandSecondaryColor, setBrandSecondaryColor] = useState('#1d4ed8');
  const [brandAccentColor, setBrandAccentColor] = useState('#0ea5e9');
  const [brandBackgroundColor, setBrandBackgroundColor] = useState('#ffffff');
  const [brandTextColor, setBrandTextColor] = useState('#111827');
  const [brandHeadingFont, setBrandHeadingFont] = useState(DEFAULT_HEADING_FONT);
  const [brandBodyFont, setBrandBodyFont] = useState(DEFAULT_BODY_FONT);
  // Uploaded custom font files (e.g. OEM-required). Persisted immediately via
  // the fonts API (like logos), not through the branding Save button.
  type CustomFontDef = { family: string; weight?: string; style?: string; url: string };
  const [customFonts, setCustomFonts] = useState<CustomFontDef[]>([]);
  const [fontUpload, setFontUpload] = useState<{ family: string; weight: string; style: string; file: File | null }>({
    family: '',
    weight: '400',
    style: 'normal',
    file: null,
  });
  const [fontUploading, setFontUploading] = useState(false);
  const fontFileRef = useRef<HTMLInputElement>(null);
  const [fontDragging, setFontDragging] = useState(false);

  // ── Custom Values ──
  type CustomValueDef = { name: string; value: string };
  const [customValues, setCustomValues] = useState<Record<string, CustomValueDef>>({});
  const [customValueDefaults, setCustomValueDefaults] = useState<Record<string, CustomValueDef>>({});
  const [savedCustomValues, setSavedCustomValues] = useState<Record<string, CustomValueDef>>({});

  // ── Populate from fetched data ──
  function populateFromAccount(accountData: AccountData) {
    setAccount(accountData);
    setIsEditingDealerName(false);
    setDealer(accountData.dealer || '');
    setCategory(accountData.category || 'General');
    setOems(getAccountOems(accountData));
    // Business details from account-level fields.
    setBizEmail(resolveAccountEmail(accountData));
    setBizPhone(resolveAccountPhone(accountData));
    setBizPhoneSales(accountData.phoneSales || accountData.salesPhone || '');
    setBizPhoneService(accountData.phoneService || accountData.servicePhone || '');
    setBizPhoneParts(accountData.phoneParts || accountData.partsPhone || '');
    setBizAddress(resolveAccountAddress(accountData));
    setBizCity(resolveAccountCity(accountData));
    setBizState(resolveAccountState(accountData));
    setBizZip(resolveAccountPostalCode(accountData));
    setBizWebsite(resolveAccountWebsite(accountData));
    setBizTimezone(resolveAccountTimezone(accountData));
    setStorefrontImage(accountData.storefrontImage || accountData.customValues?.storefront_image?.value || '');
    setAccountRepId(accountData.accountRepId ?? null);
    setMarkup(
      typeof accountData.markup === 'number' && Number.isFinite(accountData.markup)
        ? String(accountData.markup)
        : '',
    );
    setMetaAdAccountId(accountData.metaAdAccountId || '');
    setFacebookAdsMargin(
      typeof accountData.facebookAdsMargin === 'number' && Number.isFinite(accountData.facebookAdsMargin)
        ? String(accountData.facebookAdsMargin)
        : '',
    );
    // Logos
    setLogoLight(accountData.logos?.light || '');
    setLogoDark(accountData.logos?.dark || '');
    setLogoWhite(accountData.logos?.white || '');
    setLogoBlack(accountData.logos?.black || '');
    // Branding
    setBrandPrimaryColor(accountData.branding?.colors?.primary || '#2563eb');
    setBrandSecondaryColor(accountData.branding?.colors?.secondary || '#1d4ed8');
    setBrandAccentColor(accountData.branding?.colors?.accent || '#0ea5e9');
    setBrandBackgroundColor(accountData.branding?.colors?.background || '#ffffff');
    setBrandTextColor(accountData.branding?.colors?.text || '#111827');
    setBrandHeadingFont(accountData.branding?.fonts?.heading || DEFAULT_HEADING_FONT);
    setBrandBodyFont(accountData.branding?.fonts?.body || DEFAULT_BODY_FONT);
    // Custom values
    setCustomValues(accountData.customValues || {});
    setSavedCustomValues(accountData.customValues || {});
    // Custom fonts
    setCustomFonts(accountData.customFonts ?? []);

    // Snapshot for change detection
    formSnapshotRef.current = buildFormSnapshot(accountData);
  }

  /** Build a flat object capturing saveable form fields from an account. */
  function buildFormSnapshot(a: AccountData) {
    return {
      dealer: a.dealer || '',
      category: a.category || 'General',
      oems: JSON.stringify(getAccountOems(a)),
      bizEmail: resolveAccountEmail(a),
      bizPhone: resolveAccountPhone(a),
      bizPhoneSales: a.phoneSales || a.salesPhone || '',
      bizPhoneService: a.phoneService || a.servicePhone || '',
      bizPhoneParts: a.phoneParts || a.partsPhone || '',
      bizAddress: resolveAccountAddress(a),
      bizCity: resolveAccountCity(a),
      bizState: resolveAccountState(a),
      bizZip: resolveAccountPostalCode(a),
      bizWebsite: resolveAccountWebsite(a),
      bizTimezone: resolveAccountTimezone(a),
      accountRepId: a.accountRepId ?? '',
      logoLight: a.logos?.light || '',
      logoDark: a.logos?.dark || '',
      logoWhite: a.logos?.white || '',
      logoBlack: a.logos?.black || '',
      brandPrimaryColor: a.branding?.colors?.primary || '#2563eb',
      brandSecondaryColor: a.branding?.colors?.secondary || '#1d4ed8',
      brandAccentColor: a.branding?.colors?.accent || '#0ea5e9',
      brandBackgroundColor: a.branding?.colors?.background || '#ffffff',
      brandTextColor: a.branding?.colors?.text || '#111827',
      brandHeadingFont: a.branding?.fonts?.heading || DEFAULT_HEADING_FONT,
      brandBodyFont: a.branding?.fonts?.body || DEFAULT_BODY_FONT,
    };
  }

  const formSnapshotRef = useRef<Record<string, string> | null>(null);

  const hasFormChanges = useMemo(() => {
    const snap = formSnapshotRef.current;
    if (!snap) return false;
    const current: Record<string, string> = {
      dealer, category, oems: JSON.stringify(oems),
      bizEmail, bizPhone, bizPhoneSales, bizPhoneService, bizPhoneParts,
      bizAddress, bizCity, bizState, bizZip, bizWebsite, bizTimezone,
      accountRepId: accountRepId ?? '',
      logoLight, logoDark, logoWhite, logoBlack,
      brandPrimaryColor, brandSecondaryColor, brandAccentColor,
      brandBackgroundColor, brandTextColor, brandHeadingFont, brandBodyFont,
    };
    return Object.keys(snap).some(k => snap[k] !== current[k]);
  }, [
    dealer, category, oems, bizEmail, bizPhone, bizPhoneSales, bizPhoneService, bizPhoneParts,
    bizAddress, bizCity, bizState, bizZip, bizWebsite, bizTimezone, accountRepId,
    logoLight, logoDark, logoWhite, logoBlack,
    brandPrimaryColor, brandSecondaryColor, brandAccentColor,
    brandBackgroundColor, brandTextColor, brandHeadingFont, brandBodyFont,
  ]);

  // ── Fetch on mount ──
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [accountData, cvDefaults, usersData] = await Promise.all([
          fetch(`/api/accounts/${key}`).then(r => {
            if (!r.ok) throw new Error('not found');
            return r.json();
          }),
          fetch('/api/custom-values').then(r => r.json()).catch(() => ({})),
          fetch('/api/users').then(r => r.ok ? r.json() : []).catch(() => []),
        ]);
        if (cancelled) return;

        const resolvedAccount = accountData as AccountData;
        populateFromAccount(resolvedAccount);
        setAllUsers(usersData as typeof allUsers);
        if (cvDefaults?.defaults && typeof cvDefaults.defaults === 'object') {
          setCustomValueDefaults(cvDefaults.defaults);
        }
      } catch {
        if (cancelled) return;
        toast.error('Sub-account not found');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key]);

  // ── Settings mode: resolve tab from URL path ──
  const settingsUrlTab = useMemo(() => {
    if (!settingsMode) return undefined;
    return readSettingsSectionTab(pathname, searchParams);
  }, [settingsMode, pathname, searchParams]);

  // Settings mode: sync activeTab from URL on initial load and popstate
  useEffect(() => {
    if (!settingsMode) return;
    const allTabKeys = SETTINGS_TABS.map(t => t.key);
    const syncFromUrl = () => {
      const url = new URL(window.location.href);
      const tab = readSettingsSectionTab(url.pathname, url.searchParams) ?? 'company';
      if (allTabKeys.includes(tab as DetailTab)) {
        setActiveTab(tab as DetailTab);
      }
    };
    // Sync on mount — if no tab in URL, push default tab into the URL
    if (settingsUrlTab && allTabKeys.includes(settingsUrlTab as DetailTab)) {
      setActiveTab(settingsUrlTab as DetailTab);
    } else if (!settingsUrlTab) {
      // No tab segment — add /company to URL (scheme-aware)
      window.history.replaceState({}, '', buildSettingsSectionPath(pathname, key, 'company'));
    }
    // Sync on browser back/forward
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, [settingsMode, settingsUrlTab, pathname]);

  // Handle ?tab= query param for deep-linking to a specific tab (non-settings mode)
  useEffect(() => {
    if (settingsMode) return;
    const tabParam = searchParams.get('tab') as DetailTab | null;
    if (tabParam && ['company', 'branding', 'contacts'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [settingsMode, searchParams]);

  // ── Save ──
  function buildCustomValuesForSave(): Record<string, CustomValueDef> {
    const nextValues = { ...customValues };
    const storefrontName =
      nextValues.storefront_image?.name ||
      savedCustomValues.storefront_image?.name ||
      customValueDefaults.storefront_image?.name ||
      'Storefront Image';
    const trimmedStorefront = storefrontImage.trim();

    if (trimmedStorefront) {
      nextValues.storefront_image = { name: storefrontName, value: trimmedStorefront };
    } else if (
      nextValues.storefront_image ||
      (savedCustomValues.storefront_image?.value || '').trim()
    ) {
      // Keep an explicit empty value so the cleared state persists on save.
      nextValues.storefront_image = { name: storefrontName, value: '' };
    }

    return nextValues;
  }

  async function handleSave() {
    setSaving(true);
    try {
      const customValuesToSave = buildCustomValuesForSave();
      const hasBrands = industryHasBrands(category);
      const selectedOems = hasBrands ? oems : [];
      const body: Record<string, unknown> = {
        dealer,
        category,
        // Always send oems so PATCH can clear stale values when industry has no brands.
        oems: selectedOems,
        oem: selectedOems[0] || null,
        storefrontImage: storefrontImage.trim() || undefined,
        email: bizEmail || undefined,
        phone: bizPhone || undefined,
        phoneSales: bizPhoneSales || undefined,
        phoneService: bizPhoneService || undefined,
        phoneParts: bizPhoneParts || undefined,
        address: bizAddress || undefined,
        city: bizCity || undefined,
        state: bizState || undefined,
        postalCode: bizZip || undefined,
        website: bizWebsite || undefined,
        timezone: bizTimezone || undefined,
        logos: {
          light: logoLight,
          dark: logoDark,
          white: logoWhite || undefined,
          black: logoBlack || undefined,
        },
        branding: {
          colors: {
            primary: brandPrimaryColor || undefined,
            secondary: brandSecondaryColor || undefined,
            accent: brandAccentColor || undefined,
            background: brandBackgroundColor || undefined,
            text: brandTextColor || undefined,
          },
          fonts: {
            heading: brandHeadingFont || undefined,
            body: brandBodyFont || undefined,
          },
        },
        customValues: Object.keys(customValuesToSave).length > 0 ? customValuesToSave : undefined,
        accountRepId: accountRepId || null,
        // Markup: empty string clears the override on the server.
        // Numeric string passes through as-is (parsed server-side).
        markup: markup.trim() === '' ? null : markup,
        // Facebook ad account id ("act_..."). Empty string clears the link.
        metaAdAccountId: metaAdAccountId.trim(),
      };

      const res = await fetch(`/api/accounts/${key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const updated = await res.json();
        setAccount(updated as AccountData);
        setCustomValues(customValuesToSave);
        setSavedCustomValues(customValuesToSave); // Update saved state after successful save
        formSnapshotRef.current = buildFormSnapshot(updated as AccountData);
        await refreshAccountList();
        markClean();
        toast.success('Saved!');
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to save');
      }
    } catch {
      toast.error('Failed to save');
    }
    setSaving(false);
  }

  // Self-contained save for the integration modal — PATCHes only the Meta
  // fields (merge-update) so it doesn't depend on the page's form-change
  // tracking, which intentionally ignores these account-level settings.
  async function handleSaveIntegration() {
    setSavingIntegration(true);
    try {
      const res = await fetch(`/api/accounts/${key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metaAdAccountId: metaAdAccountId.trim(),
          markup: markup.trim() === '' ? null : markup,
          facebookAdsMargin: facebookAdsMargin.trim() === '' ? null : facebookAdsMargin,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || 'Failed to save');
        return;
      }
      const updated = await res.json();
      setAccount(updated as AccountData);
      await refreshAccountList();
      toast.success('Meta Ads settings saved');
      setActiveIntegration(null);
    } catch {
      toast.error('Failed to save');
    } finally {
      setSavingIntegration(false);
    }
  }

  // ── Delete ──
  async function handleDelete() {
    const deleteConfirmed = await confirm({
      title: 'Delete Sub-account',
      message: `Delete "${dealer || key}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!deleteConfirmed) return;
    try {
      const res = await fetch(`/api/accounts?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (res.ok) {
        await refreshAccountList();
        router.push(basePath);
      } else {
        toast.error('Failed to delete');
      }
    } catch {
      toast.error('Failed to delete');
    }
  }

  // ── Logo upload handler ──
  async function handleLogoUpload(variant: AccountImageVariant, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('variant', variant);

    try {
      const res = await fetch(`/api/accounts/${key}/logos`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.url) {
        if (variant === 'storefront') {
          setStorefrontImage(data.url);
          toast.success('Storefront image uploaded!');
        } else {
          const setters = { light: setLogoLight, dark: setLogoDark, white: setLogoWhite, black: setLogoBlack };
          setters[variant](data.url);
          toast.success(`${variant} logo uploaded!`);
        }
      } else {
        toast.error(data.error || 'Upload failed');
      }
    } catch {
      toast.error('Upload failed');
    }
  }

  // ── Custom font handlers (persist immediately, like logos) ──
  async function handleFontUpload() {
    if (!fontUpload.file || !fontUpload.family.trim()) {
      toast.error('Pick a font file and enter a family name');
      return;
    }
    setFontUploading(true);
    const fd = new FormData();
    fd.append('file', fontUpload.file);
    fd.append('family', fontUpload.family.trim());
    fd.append('weight', fontUpload.weight);
    fd.append('style', fontUpload.style);
    try {
      const res = await fetch(`/api/accounts/${key}/fonts`, { method: 'POST', body: fd });
      const data = await res.json();
      if (res.ok) {
        setCustomFonts(data.customFonts ?? []);
        setFontUpload({ family: '', weight: '400', style: 'normal', file: null });
        toast.success('Font uploaded!');
      } else {
        toast.error(data.error || 'Upload failed');
      }
    } catch {
      toast.error('Upload failed');
    } finally {
      setFontUploading(false);
    }
  }

  async function handleFontDelete(url: string) {
    try {
      const res = await fetch(`/api/accounts/${key}/fonts?url=${encodeURIComponent(url)}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        setCustomFonts(data.customFonts ?? []);
        toast.success('Font removed');
      } else {
        toast.error(data.error || 'Delete failed');
      }
    } catch {
      toast.error('Delete failed');
    }
  }

  if (loading) {
    const loadingEl = <div className="text-[var(--muted-foreground)]">Loading...</div>;
    return settingsMode ? loadingEl : <AdminOnly>{loadingEl}</AdminOnly>;
  }

  if (!account) {
    const notFoundEl = (
      <div className="text-center py-16">
        <p className="text-[var(--muted-foreground)]">Sub-account not found</p>
        {!settingsMode && (
          <Link href={basePath} className="text-sm text-[var(--primary)] mt-2 inline-block hover:underline">
            Back to Sub-Accounts
          </Link>
        )}
      </div>
    );
    return settingsMode ? notFoundEl : <AdminOnly>{notFoundEl}</AdminOnly>;
  }

  const inputClass = 'w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:border-[var(--primary)]';
  const labelClass = 'block text-xs font-medium text-[var(--muted-foreground)] mb-1.5';
  const sectionHeadingClass = 'text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-4';
  const sectionCardClass = 'glass-section-card rounded-xl p-6';
  const isSettingsEmbed = basePath.startsWith('/settings/');
  const showContactsTab = !isSettingsEmbed;
  const visibleTabs = settingsMode
    ? SETTINGS_TABS
    : TABS.filter((tab) => {
        if (tab.key === 'contacts' && !showContactsTab) return false;
        return true;
      });
  const showSaveButton = !settingsMode || !['users', 'appearance'].includes(activeTab);
  const backHref = basePath;
  const showBrandsSelector = industryHasBrands(category);
  const isAutomotiveIndustry = category.trim().toLowerCase() === 'automotive';
  const isEcommerceIndustry = category.trim().toLowerCase() === 'ecommerce';

  // ── Settings mode: tab click navigates via pushState (no full route transition) ──
  const handleTabClick = (tabKey: DetailTab) => {
    if (settingsMode) {
      window.history.pushState({}, '', buildSettingsSectionPath(pathname, key, tabKey));
      setActiveTab(tabKey);
    } else {
      setActiveTab(tabKey);
    }
  };

  const content = (
      <div>
        {/* ── Header ── */}
        {settingsMode ? (
          <div className="page-sticky-header mb-8">
            <div className="flex items-center justify-between gap-4">
              <div className="group flex min-w-0 items-center gap-3">
                <AccountAvatar
                  name={dealer || key}
                  accountKey={key}
                  storefrontImage={storefrontImage}
                  logos={{ light: logoLight, dark: logoDark, white: logoWhite, black: logoBlack }}
                  size={44}
                  className="flex-shrink-0 rounded-xl border border-[var(--border)]"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    {isEditingDealerName ? (
                      <input
                        type="text"
                        value={dealer}
                        onChange={(event) => setDealer(event.target.value)}
                        onBlur={() => setIsEditingDealerName(false)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            setIsEditingDealerName(false);
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            setDealer(account?.dealer || '');
                            setIsEditingDealerName(false);
                          }
                        }}
                        className="w-full max-w-md min-w-0 bg-transparent border-b border-[var(--border)] text-2xl font-bold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)]"
                        autoFocus
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setIsEditingDealerName(true)}
                        className="truncate text-left text-2xl font-bold text-[var(--foreground)] transition hover:opacity-80"
                        title="Edit name"
                      >
                        {dealer || key}
                      </button>
                    )}
                    {!isEditingDealerName && (
                      <button
                        type="button"
                        onClick={() => setIsEditingDealerName(true)}
                        className="flex-shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] opacity-0 transition hover:bg-[var(--muted)] hover:text-[var(--foreground)] group-hover:opacity-100"
                        title="Edit sub-account name"
                      >
                        <PencilSquareIcon className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
                    Manage settings and configuration for this sub-account
                  </p>
                </div>
              </div>
              {showSaveButton && (
                <button
                  onClick={handleSave}
                  disabled={saving || !hasFormChanges}
                  className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity flex-shrink-0"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="page-sticky-header flex items-center gap-3 mb-6">
            <Link
              href={backHref}
              className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <ArrowLeftIcon className="w-4 h-4" />
            </Link>
            <AccountAvatar
              name={dealer || key}
              accountKey={key}
              storefrontImage={storefrontImage}
              logos={{ light: logoLight, dark: logoDark, white: logoWhite, black: logoBlack }}
              size={40}
              className="rounded-xl flex-shrink-0 border border-[var(--border)]"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                {isEditingDealerName ? (
                  <input
                    type="text"
                    value={dealer}
                    onChange={(event) => setDealer(event.target.value)}
                    onBlur={() => setIsEditingDealerName(false)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        setIsEditingDealerName(false);
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setDealer(account?.dealer || '');
                        setIsEditingDealerName(false);
                      }
                    }}
                    className="w-full max-w-2xl min-w-0 bg-transparent border-b border-[var(--border)] text-2xl font-bold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)]"
                    autoFocus
                  />
                ) : (
                  <h2 className="text-2xl font-bold truncate">{dealer || key}</h2>
                )}
                <button
                  type="button"
                  onClick={() => setIsEditingDealerName((prev) => !prev)}
                  className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                  title="Edit sub-account name"
                >
                  <PencilSquareIcon className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                <span className="font-mono">{key}</span>
              </div>
            </div>
            <button
              onClick={handleSave}
              disabled={saving || !hasFormChanges}
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity flex-shrink-0"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}

        {/* ── Sidebar nav + content wrapper ──
            In settings mode the section nav lives in the app sidebar
            (SettingsNav), so we drop the inner rail and go full-width. The
            admin drill-in (non-settings) keeps its own rail. */}
        <div className={settingsMode ? '' : 'flex gap-6'}>
        {/* Vertical nav (admin drill-in only) */}
        {!settingsMode && (
        <nav className="flex flex-col gap-1 w-48 shrink-0 sticky top-4 self-start">
          {visibleTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => handleTabClick(tab.key)}
              className={`flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors text-left ${
                activeTab === tab.key
                  ? 'bg-[var(--accent)] text-[var(--foreground)]'
                  : 'text-[var(--muted-foreground)] hover:bg-[var(--accent)]/50 hover:text-[var(--foreground)]'
              }`}
            >
              {tab.icon && <tab.icon className="w-4 h-4 shrink-0" />}
              <span className="flex items-center gap-1.5">
                {tab.label}
              </span>
            </button>
          ))}
        </nav>
        )}

        {/* Tab content */}
        <div className="flex-1 min-w-0">

        {/* ════════════ COMPANY TAB ════════════ */}
        {activeTab === 'company' && (
          <div className="max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className={sectionCardClass}>
              <h3 className={sectionHeadingClass}>Business Details</h3>
              <p className="text-[11px] text-[var(--muted-foreground)] mb-4 -mt-2">
                Changes are saved locally in Loomi.
              </p>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>{isEcommerceIndustry ? 'Support Email' : 'Email'}</label>
                    <input type="email" value={bizEmail} onChange={e => setBizEmail(e.target.value)} className={inputClass} placeholder={isEcommerceIndustry ? 'support@store.com' : 'info@dealer.com'} />
                  </div>
                  <div>
                    <label className={labelClass}>{isEcommerceIndustry ? 'Support Phone' : 'Main Phone'}</label>
                    <input type="tel" value={bizPhone} onChange={e => setBizPhone(e.target.value)} className={inputClass} placeholder="(801) 555-1234" />
                  </div>
                </div>
                {isAutomotiveIndustry && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className={labelClass}>Sales Phone</label>
                      <input type="tel" value={bizPhoneSales} onChange={e => setBizPhoneSales(e.target.value)} className={inputClass} placeholder="(801) 555-1001" />
                    </div>
                    <div>
                      <label className={labelClass}>Service Phone</label>
                      <input type="tel" value={bizPhoneService} onChange={e => setBizPhoneService(e.target.value)} className={inputClass} placeholder="(801) 555-1002" />
                    </div>
                    <div>
                      <label className={labelClass}>Parts Phone</label>
                      <input type="tel" value={bizPhoneParts} onChange={e => setBizPhoneParts(e.target.value)} className={inputClass} placeholder="(801) 555-1003" />
                    </div>
                  </div>
                )}
                {!isEcommerceIndustry && (
                  <>
                    <div>
                      <label className={labelClass}>Street Address</label>
                      <input type="text" value={bizAddress} onChange={e => setBizAddress(e.target.value)} className={inputClass} placeholder="1234 Main St" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className={labelClass}>City</label>
                        <input type="text" value={bizCity} onChange={e => setBizCity(e.target.value)} className={inputClass} placeholder="Ogden" />
                      </div>
                      <div>
                        <label className={labelClass}>State</label>
                        <input type="text" value={bizState} onChange={e => setBizState(e.target.value)} className={inputClass} placeholder="UT" />
                      </div>
                      <div>
                        <label className={labelClass}>Zip Code</label>
                        <input type="text" value={bizZip} onChange={e => setBizZip(e.target.value)} className={inputClass} placeholder="84401" />
                      </div>
                    </div>
                  </>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>{isEcommerceIndustry ? 'Store URL' : 'Website'}</label>
                    <input type="url" value={bizWebsite} onChange={e => setBizWebsite(e.target.value)} className={inputClass} placeholder={isEcommerceIndustry ? 'https://store.com' : 'https://dealer.com'} />
                  </div>
                  <div>
                    <label className={labelClass}>Timezone</label>
                    <select value={bizTimezone} onChange={e => setBizTimezone(e.target.value)} className={inputClass}>
                      <option value="">Select...</option>
                      <option value="US/Eastern">Eastern (ET)</option>
                      <option value="US/Central">Central (CT)</option>
                      <option value="US/Mountain">Mountain (MT)</option>
                      <option value="US/Pacific">Pacific (PT)</option>
                      <option value="US/Alaska">Alaska (AKT)</option>
                      <option value="US/Hawaii">Hawaii (HT)</option>
                    </select>
                  </div>
                </div>
              </div>
            </section>

            <section className={sectionCardClass}>
              <h3 className={sectionHeadingClass}>General</h3>
              <div className="space-y-5">
                <div className={`grid grid-cols-1 gap-4 ${showBrandsSelector ? 'md:grid-cols-2' : ''}`}>
                  <div>
                    <label className={labelClass}>Industry</label>
                    <select value={category} onChange={e => setCategory(e.target.value)} className={inputClass}>
                      {categorySuggestions.map(c => <option key={c} value={c}>{c}</option>)}
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

                <div>
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <label className="text-xs font-medium text-[var(--muted-foreground)]">
                      Sub-Account Rep
                    </label>
                    <span className="relative inline-flex items-center group">
                      <QuestionMarkCircleIcon className="w-4 h-4 text-[var(--muted-foreground)]/80 hover:text-[var(--foreground)] transition-colors cursor-help" />
                      <span className="absolute bottom-full left-1/2 z-[70] mb-1 hidden -translate-x-1/2 group-hover:block group-focus-within:block">
                        <span className="relative block w-64 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 shadow-xl">
                          <span className="block text-[11px] leading-4 text-[var(--foreground)]">
                            Missing a rep in this list?
                          </span>
                          <span className="mt-1 block text-[10px] leading-4 text-[var(--muted-foreground)]">
                            Account reps come from users with Admin or Super Admin roles.
                          </span>
                          <Link
                            href="/settings/users"
                            className="pointer-events-auto mt-2 inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--muted)] px-2 py-1 text-[10px] font-medium text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors"
                          >
                            Manage Users
                          </Link>
                          <span className="absolute left-1/2 top-full -translate-x-1/2 w-0 h-0 border-x-[6px] border-x-transparent border-t-[7px] border-t-[var(--background)]" />
                        </span>
                      </span>
                    </span>
                  </div>
                  {(() => {
                    const assignedUsers = allUsers.filter(
                      (u) =>
                        // Show all eligible rep roles regardless of account assignment.
                        // Keep the current selection visible as a fallback for legacy data.
                        u.id === accountRepId ||
                        u.role === 'admin' ||
                        u.role === 'super_admin',
                    );
                    if (assignedUsers.length === 0) {
                      return (
                        <p className="text-xs text-[var(--muted-foreground)] italic py-2">
                          No admin or super admin users available
                        </p>
                      );
                    }
                    return (
                      <div className="max-h-80 overflow-y-auto rounded-xl border border-[var(--border)] divide-y divide-[var(--border)]">
                        {assignedUsers.map((u) => {
                          const isRep = accountRepId === u.id;
                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => setAccountRepId(isRep ? null : u.id)}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                                isRep
                                  ? 'bg-[var(--primary)]/10'
                                  : 'hover:bg-[var(--muted)]/50'
                              }`}
                            >
                              <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                                isRep
                                  ? 'border-[var(--primary)] bg-[var(--primary)]'
                                  : 'border-[var(--muted-foreground)]/40'
                              }`}>
                                {isRep && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-white" />
                                )}
                              </span>
                              <UserAvatar
                                name={u.name}
                                email={u.email}
                                avatarUrl={u.avatarUrl}
                                size={28}
                                className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-[var(--foreground)] truncate">
                                  {u.name}
                                </p>
                                {u.title && (
                                  <p className="text-[11px] text-[var(--muted-foreground)] truncate leading-tight">
                                    {u.title}
                                  </p>
                                )}
                              </div>
                              {isRep && (
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--primary)] flex-shrink-0">
                                  Rep
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </section>

            <section className="lg:col-span-2 glass-section-card rounded-xl p-6 border border-red-500/20">
              <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-3">Danger Zone</h3>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between p-4 border border-red-500/20 rounded-xl">
                <div>
                  <p className="text-sm font-medium">Delete this sub-account</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Permanently remove {dealer || key} and all associated data.
                  </p>
                </div>
                <button
                  onClick={handleDelete}
                  className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg text-sm font-medium hover:bg-red-500/20 transition-colors flex-shrink-0"
                >
                  Delete Sub-Account
                </button>
              </div>
            </section>
          </div>
        )}

        {/* ════════════ BRANDING TAB ════════════ */}
        {activeTab === 'branding' && (
          <div className="max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className={`${sectionCardClass} lg:col-span-2`}>
              <h3 className={sectionHeadingClass}>Logo Variants</h3>
              <p className="text-[11px] text-[var(--muted-foreground)] mb-6 -mt-2">
                Upload, choose from media library, or paste URLs for each logo variant. Used in email templates and previews.
              </p>
              <div className="mb-6">
                <LogoSlot
                  accountKey={key}
                  label="Storefront Image"
                  variant="storefront"
                  value={storefrontImage}
                  onChange={setStorefrontImage}
                  onUpload={(file) => handleLogoUpload('storefront', file)}
                  required={false}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {([
                  { label: 'Light Logo', variant: 'light' as const, value: logoLight, setter: setLogoLight, required: true },
                  { label: 'Dark Logo', variant: 'dark' as const, value: logoDark, setter: setLogoDark, required: true },
                  { label: 'White Logo', variant: 'white' as const, value: logoWhite, setter: setLogoWhite, required: false },
                  { label: 'Black Logo', variant: 'black' as const, value: logoBlack, setter: setLogoBlack, required: false },
                ]).map(({ label, variant, value, setter, required }) => (
                  <LogoSlot
                    key={variant}
                    accountKey={key}
                    label={label}
                    variant={variant}
                    value={value}
                    onChange={setter}
                    onUpload={(file) => handleLogoUpload(variant, file)}
                    required={required}
                  />
                ))}
              </div>
            </section>

            <section className={sectionCardClass}>
              <h3 className={sectionHeadingClass}>Brand Colors</h3>
              <p className="text-[11px] text-[var(--muted-foreground)] mb-4 -mt-2">
                Set reusable color values for this sub-account. These are available as custom value fallbacks in previews.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {([
                  { label: 'Primary', value: brandPrimaryColor, onChange: setBrandPrimaryColor, fallback: '#2563eb' },
                  { label: 'Secondary', value: brandSecondaryColor, onChange: setBrandSecondaryColor, fallback: '#1d4ed8' },
                  { label: 'Accent', value: brandAccentColor, onChange: setBrandAccentColor, fallback: '#0ea5e9' },
                  { label: 'Background', value: brandBackgroundColor, onChange: setBrandBackgroundColor, fallback: '#ffffff' },
                  { label: 'Text', value: brandTextColor, onChange: setBrandTextColor, fallback: '#111827' },
                ]).map(({ label, value, onChange, fallback }) => (
                  <div key={label}>
                    <label className={labelClass}>{label} Color</label>
                    <div className="flex items-center bg-[var(--card)] border border-[var(--border)] rounded-lg overflow-hidden">
                      <input
                        type="color"
                        value={validHexColor(value, fallback)}
                        onChange={(e) => onChange(e.target.value)}
                        className="w-10 h-9 bg-transparent border-none p-1 cursor-pointer flex-shrink-0"
                      />
                      <input
                        type="text"
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={fallback}
                        className="flex-1 px-3 py-2 text-sm font-mono bg-transparent focus:outline-none"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className={sectionCardClass}>
              <h3 className={sectionHeadingClass}>Fonts</h3>
              <p className="text-[11px] text-[var(--muted-foreground)] mb-4 -mt-2">
                Websafe stacks for everyday copy, plus uploaded OEM/brand fonts for the Ad Generator.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Heading Font</label>
                  <FontSelect value={brandHeadingFont} onChange={setBrandHeadingFont} options={WEBSAFE_FONTS} />
                </div>
                <div>
                  <label className={labelClass}>Body Font</label>
                  <FontSelect value={brandBodyFont} onChange={setBrandBodyFont} options={WEBSAFE_FONTS} />
                </div>
              </div>

              <div className="mt-6 pt-5 border-t border-[var(--border)]">
                <p className="text-sm font-semibold text-[var(--foreground)]">Custom fonts</p>
                <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5 mb-4">
                  Upload brand font files (woff2, woff, ttf, otf) to use across your creative.
                </p>

                {customFonts.length > 0 && (
                  <div className="mb-4 space-y-2">
                    {customFonts.map((f) => (
                      <div key={f.url} className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[var(--foreground)]">{f.family}</p>
                          <p className="text-[11px] text-[var(--muted-foreground)]">{f.weight || '400'} · {f.style || 'normal'}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleFontDelete(f.url)}
                          className="text-[11px] font-medium text-rose-400 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setFontDragging(true);
                  }}
                  onDragLeave={() => setFontDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setFontDragging(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) setFontUpload((s) => ({ ...s, file: f }));
                  }}
                  onClick={() => fontFileRef.current?.click()}
                  className={`relative flex h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-all ${
                    fontDragging
                      ? 'border-[var(--primary)] bg-[var(--primary)]/5'
                      : 'border-[var(--border)] bg-[var(--muted)]/50 hover:border-[var(--muted-foreground)]'
                  }`}
                >
                  <CloudArrowUpIcon className="h-6 w-6 text-[var(--muted-foreground)]" />
                  <span className="text-[11px] text-[var(--muted-foreground)]">
                    {fontUpload.file ? fontUpload.file.name : 'Drop font file or click to upload'}
                  </span>
                  <input
                    ref={fontFileRef}
                    type="file"
                    accept=".woff2,.woff,.ttf,.otf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setFontUpload((s) => ({ ...s, file: f }));
                      e.target.value = '';
                    }}
                  />
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>Family name</label>
                    <input
                      type="text"
                      value={fontUpload.family}
                      placeholder="e.g. Toyota Type"
                      onChange={(e) => setFontUpload((s) => ({ ...s, family: e.target.value }))}
                      className={inputClass}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Weight</label>
                      <FontSelect
                        previewFont={false}
                        value={fontUpload.weight}
                        onChange={(v) => setFontUpload((s) => ({ ...s, weight: v }))}
                        options={['300', '400', '500', '600', '700', '800', '900'].map((w) => ({ value: w, label: w }))}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Style</label>
                      <FontSelect
                        previewFont={false}
                        value={fontUpload.style}
                        onChange={(v) => setFontUpload((s) => ({ ...s, style: v }))}
                        options={[{ value: 'normal', label: 'Normal' }, { value: 'italic', label: 'Italic' }]}
                      />
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleFontUpload}
                  disabled={fontUploading}
                  className="mt-3 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {fontUploading ? 'Uploading…' : 'Upload font'}
                </button>
              </div>
            </section>
          </div>
        )}

        {/* ════════════ INTEGRATIONS TAB ════════════ */}
        {/* ════════════ CONTACTS TAB ════════════ */}
        {showContactsTab && activeTab === 'contacts' && (
          <AccountContactsTab accountKey={key} />
        )}

        {/* ════════════ DOMAINS TAB ════════════ */}
        {activeTab === 'domains' && key && <AccountDomainsTab accountKey={key} />}

        {activeTab === 'integrations' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <button
              type="button"
              onClick={() => setActiveIntegration('facebook')}
              className="group overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] text-left transition-all hover:border-[var(--primary)] hover:shadow-md"
            >
              <div className="h-28 w-full overflow-hidden border-b border-[var(--border)] bg-[#f5f5f7]">
                <img
                  src={META_LOGO_URL}
                  alt="Meta Ads"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[var(--foreground)]">Meta Ads</span>
                  <span
                    className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium"
                    style={{ color: account?.metaAdAccountId?.trim() ? '#22c55e' : 'var(--muted-foreground)' }}
                  >
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{ background: account?.metaAdAccountId?.trim() ? '#22c55e' : 'var(--muted-foreground)' }}
                    />
                    {account?.metaAdAccountId?.trim() ? 'Connected' : 'Not connected'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  Sync ad spend into the Meta Ads Pacer.
                </p>
              </div>
            </button>

            {key && <CrmIntegrationCards accountKey={key} />}
            {key && <ReportingIntegrationCards accountKey={key} />}
          </div>
        )}

        {activeIntegration === 'facebook' &&
          createPortal(
            <div
              className="fixed inset-0 z-[220] flex items-center justify-center bg-black/50 p-4"
              onClick={() => setActiveIntegration(null)}
              role="dialog"
              aria-modal="true"
            >
              <div
                className="glass-modal w-[560px] max-w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="relative h-28 w-full overflow-hidden bg-[#f5f5f7]">
                  <img
                    src={META_LOGO_URL}
                    alt="Meta Ads"
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setActiveIntegration(null)}
                    aria-label="Close"
                    className="absolute right-2 top-2 rounded-full bg-black/40 p-1.5 text-white transition-colors hover:bg-black/60"
                  >
                    <XMarkIcon className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-6">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-bold text-[var(--foreground)]">Meta Ads</h3>
                    <span
                      className="inline-flex items-center gap-1.5 text-xs font-medium"
                      style={{ color: account?.metaAdAccountId?.trim() ? '#22c55e' : 'var(--muted-foreground)' }}
                    >
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: account?.metaAdAccountId?.trim() ? '#22c55e' : 'var(--muted-foreground)' }}
                      />
                      {account?.metaAdAccountId?.trim() ? 'Connected' : 'Not connected'}
                    </span>
                  </div>

                  <p className="mt-2 mb-5 text-sm leading-relaxed text-[var(--muted-foreground)]">
                    Links this account to a Meta ad account so the{' '}
                    <span className="font-medium text-[var(--foreground)]">Ad Pacer</span>{' '}
                    can pull actual spend, daily budget, and delivery status
                    automatically with its &ldquo;Sync from Facebook&rdquo; button.
                    Spend authenticates through your agency&rsquo;s Meta System
                    User token, configured once for all accounts.
                  </p>

                  <div className="space-y-5">
                    <div>
                      <label className={labelClass} style={{ marginBottom: 0 }}>
                        Facebook Ad Account ID
                      </label>
                      <p className="mb-1.5 text-[11px] text-[var(--muted-foreground)]">
                        Find it in Meta Ads Manager. Leave blank to disable syncing.
                      </p>
                      <input
                        type="text"
                        value={metaAdAccountId}
                        onChange={(e) => setMetaAdAccountId(e.target.value)}
                        placeholder="act_1234567890"
                        className={`${inputClass} max-w-[280px]`}
                      />
                    </div>

                    <div>
                      <label className={labelClass} style={{ marginBottom: 0 }}>
                        Pacer Markup Rate
                      </label>
                      <p className="mb-1.5 text-[11px] text-[var(--muted-foreground)]">
                        Budget calculator: actual spend = client billed × markup.
                        Blank uses the platform default (0.77).
                      </p>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={markup}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === '' || /^\d*\.?\d*$/.test(v)) setMarkup(v);
                        }}
                        placeholder="0.77"
                        className={`${inputClass} max-w-[160px]`}
                      />
                    </div>

                    <div>
                      <label className={labelClass} style={{ marginBottom: 0 }}>
                        Reporting Margin (%)
                      </label>
                      <p className="mb-1.5 text-[11px] text-[var(--muted-foreground)]">
                        Ad report markup: billed cost = actual ÷ (1 − margin/100).
                        Blank bills at face value.
                      </p>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={facebookAdsMargin}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === '' || /^\d*\.?\d*$/.test(v)) setFacebookAdsMargin(v);
                        }}
                        placeholder="23"
                        className={`${inputClass} max-w-[160px]`}
                      />
                    </div>
                  </div>

                  <div className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-3.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
                    In the Ad Pacer, linked campaigns show a &ldquo;Synced from
                    Facebook&rdquo; badge. Rows auto-link to a campaign by matching
                    name; use the per-row dropdown to fix any mismatches.
                  </div>

                  <div className="mt-6 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveIntegration(null)}
                      className="h-10 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 text-sm hover:border-[var(--muted-foreground)]"
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveIntegration}
                      disabled={savingIntegration}
                      className="h-10 rounded-lg border border-[var(--primary)] bg-[var(--primary)] px-4 text-sm font-semibold text-white hover:bg-[var(--primary)]/90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {savingIntegration ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )}

        {/* ════════════ USERS TAB (settings mode only) ════════════ */}
        {settingsMode && activeTab === 'users' && <UsersTab />}

        {/* ════════════ CUSTOM FIELDS TAB (settings mode only) ════════════
            Sub-account-scoped — declares contact custom fields that the
            filter engine, CSV importer, and contact detail page all
            surface. Admin-level blueprints live at /settings under the
            top-level Field Blueprints tab. */}
        {settingsMode && activeTab === 'contact-fields' && <CustomFieldsTab />}

        {/* ════════════ APPEARANCE TAB (settings mode only) ════════════ */}
        {settingsMode && activeTab === 'appearance' && <AppearanceTab />}

        {/* Sending + Suppressions tabs moved to /messaging/settings — see
            the route at src/app/subaccount/[slug]/messaging/settings. */}

        </div>{/* end tab content */}
        </div>{/* end flex sidebar+content */}
      </div>
  );

  return settingsMode ? content : <AdminOnly>{content}</AdminOnly>;
}

// ════════════════════════════════════════
// Account Contacts Tab
// ════════════════════════════════════════

function AccountContactsTab({ accountKey }: { accountKey: string }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/contacts?accountKey=${encodeURIComponent(accountKey)}&limit=100`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch contacts');
      }
      const data = await res.json();
      setContacts(data.contacts || []);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch contacts');
      setContacts([]);
    }
    setLoading(false);
  }, [accountKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <ContactsTable
      contacts={contacts}
      loading={loading}
      error={fetchError}
      accountKey={accountKey}
    />
  );
}

// ════════════════════════════════════════
// Logo Upload Slot Component
// ════════════════════════════════════════
function LogoSlot({
  accountKey,
  label,
  variant,
  value,
  onChange,
  onUpload,
  required,
}: {
  accountKey: string;
  label: string;
  variant: AccountImageVariant;
  value: string;
  onChange: (v: string) => void;
  onUpload: (file: File) => void;
  required: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [imgVersion, setImgVersion] = useState(0);
  const [showMediaPicker, setShowMediaPicker] = useState(false);

  // Reset error when URL changes (re-upload or manual edit)
  useEffect(() => { setImgError(false); }, [value]);

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File must be under 5MB');
      return;
    }
    setUploading(true);
    await onUpload(file);
    setUploading(false);
    // Reset error + bust browser cache (handles same-URL re-uploads and stale 404s)
    setImgError(false);
    setImgVersion((v) => v + 1);
  }, [onUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const inputClass = 'w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:border-[var(--primary)]';

  // Variant-specific preview backgrounds so each logo is visible in its intended context
  const previewStyle: Record<AccountImageVariant, React.CSSProperties> = {
    storefront: {
      backgroundImage: 'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
      backgroundSize: '16px 16px',
      backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
    },
    light: { backgroundColor: '#1f2937' },   // dark bg for light logos
    dark: { backgroundColor: '#f9fafb' },    // light bg for dark logos
    white: { backgroundColor: '#1f2937' },   // dark bg for white logos
    black: { backgroundColor: '#f9fafb' },   // light bg for black logos
  };

  return (
    <div data-variant={variant}>
      <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-2">
        {label} {!required && <span className="opacity-50">(optional)</span>}
      </label>

      {/* Upload zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`relative rounded-xl border-2 border-dashed transition-all cursor-pointer flex items-center justify-center overflow-hidden ${
          dragging
            ? 'border-[var(--primary)] bg-[var(--primary)]/5'
            : value
            ? 'border-[var(--border)]'
            : 'border-[var(--border)] bg-[var(--muted)]/50 hover:border-[var(--muted-foreground)]'
        }`}
        style={{ height: variant === 'storefront' ? '160px' : '120px' }}
      >
        {/* Variant-specific preview background */}
        {value && !uploading && (
          <div
            className="absolute inset-0 rounded-[10px]"
            style={previewStyle[variant]}
          />
        )}
        {uploading ? (
          <div className="flex flex-col items-center gap-2 text-[var(--muted-foreground)]">
            <ArrowPathIcon className="w-5 h-5 animate-spin" />
            <span className="text-[10px]">Uploading...</span>
          </div>
        ) : value && !imgError ? (
          <img
            src={imgVersion ? `${value}?v=${imgVersion}` : value}
            alt={label}
            className="relative max-w-full max-h-full object-contain p-3"
            onError={() => setImgError(true)}
          />
        ) : value && imgError ? (
          <div className="relative flex flex-col items-center gap-1.5 text-amber-400/80">
            <ExclamationTriangleIcon className="w-5 h-5" />
            <span className="text-[10px]">Image not found — click to re-upload</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-[var(--muted-foreground)]">
            <CloudArrowUpIcon className="w-6 h-6" />
            <span className="text-[10px]">Drop image or click to upload</span>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {/* URL fallback + remove */}
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowMediaPicker(true);
          }}
          className="px-2.5 py-1.5 text-[10px] font-medium rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)]/40 transition-colors flex-shrink-0 inline-flex items-center gap-1.5"
          title="Select from media library"
        >
          <PhotoIcon className="w-3.5 h-3.5" />
          Media Library
        </button>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="https://... or upload above"
          className={`${inputClass} flex-1`}
        />
        {value && (
          <button
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
            title="Remove logo"
          >
            <TrashIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {showMediaPicker && (
        <MediaPickerModal
          accountKey={accountKey}
          fullScreen
          onSelect={(url) => {
            onChange(url);
            setImgError(false);
            setImgVersion((v) => v + 1);
            setShowMediaPicker(false);
          }}
          onClose={() => setShowMediaPicker(false)}
        />
      )}
    </div>
  );
}
