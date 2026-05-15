'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  AdjustmentsHorizontalIcon,
  ArrowLeftIcon,
  ArrowPathIcon,
  BuildingStorefrontIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  LinkIcon,
  PaintBrushIcon,
  PencilSquareIcon,
  SwatchIcon,
  UsersIcon,
  XMarkIcon,
  ShieldCheckIcon,
  CloudArrowUpIcon,
  PhotoIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  QuestionMarkCircleIcon,
  CogIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { AdminOnly } from '@/components/route-guard';
import { UsersTab } from '@/components/settings/users-tab';
import { AppearanceTab } from '@/components/settings/appearance-tab';
import { OemMultiSelect } from '@/components/oem-multi-select';
import { UserAvatar } from '@/components/user-avatar';
import { AccountAvatar } from '@/components/account-avatar';
import { MediaPickerModal } from '@/components/media-picker-modal';
import { ContactsTable } from '@/components/contacts/contacts-table';
import type { Contact } from '@/components/contacts/contacts-table';
import type { AccountData } from '@/contexts/account-context';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { useUnsavedChanges } from '@/contexts/unsaved-changes-context';
import { getAccountOems, industryHasBrands, brandsForIndustry } from '@/lib/oems';
import type { EspCapabilities } from '@/lib/esp/types';
import {
  createFallbackProviderEntry,
  extractProviderCatalog,
  fetchProviderCatalogPayload,
  mergeProviderCatalog,
  normalizeProviderId,
  type ProviderCatalogEntry,
} from '@/lib/esp/provider-catalog';
import {
  createProviderStatusResolver,
  resolveCustomValuesSyncReadiness,
} from '@/lib/esp/provider-status';
import {
  collectOAuthProviderIds,
  fetchRequiredScopesMap,
  missingProviderScopes,
} from '@/lib/esp/provider-scopes';
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
import { providerCardTheme, providerDisplayName, providerUnsupportedMessage } from '@/lib/esp/provider-display';

const CATEGORY_SUGGESTIONS = ['Automotive', 'Powersports', 'Ecommerce', 'Healthcare', 'Real Estate', 'Hospitality', 'Retail', 'General'];

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

function providerSecretLabel(auth: EspCapabilities['auth']): string {
  if (auth === 'api-key') return 'API Key';
  if (auth === 'both') return 'Credential Secret';
  return 'Credential';
}

function providerSecretPlaceholder(auth: EspCapabilities['auth']): string {
  if (auth === 'api-key') return 'Enter API key';
  if (auth === 'both') return 'Enter API key or token';
  return 'Enter credential';
}

type DetailTab = 'company' | 'branding' | 'integration' | 'custom-values' | 'contacts' | 'users' | 'appearance';
type AccountImageVariant = 'light' | 'dark' | 'white' | 'black' | 'storefront';
type GhlAgencyStatus = {
  connected: boolean;
  source: 'oauth' | 'env' | 'none';
  mode: 'legacy' | 'hybrid' | 'agency';
  scopes: string[];
  connectUrl?: string;
};
type GhlLocationLink = {
  locationId: string;
  locationName: string | null;
  linkedAt?: string;
};

function deriveProviderCatalogFromAccount(accountData: AccountData | null | undefined): ProviderCatalogEntry[] {
  if (!accountData) return [];
  const providers = new Set<string>();
  const addProvider = (value: unknown) => {
    const provider = normalizeProviderId(value);
    if (provider) providers.add(provider);
  };

  addProvider(accountData.espProvider);
  addProvider(accountData.activeEspProvider);
  addProvider(accountData.activeConnection?.provider);
  (accountData.connectedProviders || []).forEach(addProvider);
  (accountData.oauthConnections || []).forEach((connection) => addProvider(connection.provider));
  (accountData.espConnections || []).forEach((connection) => addProvider(connection.provider));

  return Array.from(providers).sort().map((provider) => createFallbackProviderEntry(provider));
}

function shouldUseAgencyAuthorize(
  provider: string,
  oauthMode: ProviderCatalogEntry['oauthMode'] | undefined,
): boolean {
  return normalizeProviderId(provider) === 'ghl' && oauthMode === 'agency';
}

function buildAuthorizeHref(input: {
  provider: string;
  accountKey: string;
  oauthMode: ProviderCatalogEntry['oauthMode'] | undefined;
}): string {
  const provider = normalizeProviderId(input.provider);
  const params = new URLSearchParams({ provider });
  if (shouldUseAgencyAuthorize(provider, input.oauthMode)) {
    params.set('mode', 'agency');
  } else {
    params.set('accountKey', input.accountKey);
  }
  return `/api/esp/connections/authorize?${params.toString()}`;
}

type TabDef = { key: DetailTab; label: string; icon?: React.ComponentType<{ className?: string }> };

const TABS: TabDef[] = [
  { key: 'company', label: 'Company', icon: BuildingStorefrontIcon },
  { key: 'branding', label: 'Branding', icon: PaintBrushIcon },
  { key: 'integration', label: 'Integrations', icon: LinkIcon },
  { key: 'custom-values', label: 'Custom Values', icon: AdjustmentsHorizontalIcon },
  { key: 'contacts', label: 'Contacts', icon: UsersIcon },
];

const SETTINGS_TABS: TabDef[] = [
  { key: 'company', label: 'Company', icon: BuildingStorefrontIcon },
  { key: 'branding', label: 'Branding', icon: PaintBrushIcon },
  { key: 'users', label: 'Users', icon: UsersIcon },
  { key: 'integration', label: 'Integrations', icon: LinkIcon },
  { key: 'custom-values', label: 'Custom Values', icon: AdjustmentsHorizontalIcon },
  { key: 'appearance', label: 'Appearance', icon: SwatchIcon },
];

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
  const { confirm, prompt } = useLoomiDialog();
  const key = settingsMode ? (accountKeyProp || '') : (params.key as string);
  const { refreshAccounts: refreshAccountList, userRole } = useAccount();
  const { markClean } = useUnsavedChanges();

  const [activeTab, setActiveTab] = useState<DetailTab>('company');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [isEditingDealerName, setIsEditingDealerName] = useState(false);

  // Integration detail modals
  const [integrationModal, setIntegrationModal] = useState<string | null>(null);
  const [learnMoreModal, setLearnMoreModal] = useState<string | null>(null);
  const [showAdvancedDetails, setShowAdvancedDetails] = useState(false);
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalogEntry[]>([]);
  const [genericProviderSecrets, setGenericProviderSecrets] = useState<Record<string, string>>({});
  const [genericProviderConnecting, setGenericProviderConnecting] = useState<Record<string, boolean>>({});
  const [genericProviderDisconnecting, setGenericProviderDisconnecting] = useState<Record<string, boolean>>({});
  const [requiredScopesByProvider, setRequiredScopesByProvider] = useState<Record<string, string[]>>({});

  // ── Company fields ──
  const [dealer, setDealer] = useState('');
  const [category, setCategory] = useState('General');
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

  // ── Integration fields ──
  const [providerReimporting, setProviderReimporting] = useState<Record<string, boolean>>({});
  const [ghlAgencyStatus, setGhlAgencyStatus] = useState<GhlAgencyStatus | null>(null);
  const [ghlAgencyLoading, setGhlAgencyLoading] = useState(false);
  const [ghlAgencyError, setGhlAgencyError] = useState<string | null>(null);
  const [ghlLocationsError, setGhlLocationsError] = useState<string | null>(null);
  const [ghlLocationLink, setGhlLocationLink] = useState<GhlLocationLink | null>(null);
  const [ghlLinking, setGhlLinking] = useState(false);
  const [ghlUnlinking, setGhlUnlinking] = useState(false);
  const [ghlSelectedLocationId, setGhlSelectedLocationId] = useState('');

  // ── Custom Values ──
  type CustomValueDef = { name: string; value: string };
  const [customValues, setCustomValues] = useState<Record<string, CustomValueDef>>({});
  const [customValueDefaults, setCustomValueDefaults] = useState<Record<string, CustomValueDef>>({});
  const [savedCustomValues, setSavedCustomValues] = useState<Record<string, CustomValueDef>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingDeleteNames, setPendingDeleteNames] = useState<string[]>([]);

  // Compute whether any custom values are empty (for tab badge)
  const customValuesAllKeys = new Set(
    [...Object.keys(customValueDefaults), ...Object.keys(customValues)].filter((k) => k !== 'storefront_image'),
  );
  const customValuesEmptyCount = Array.from(customValuesAllKeys).filter(k => {
    const val = (customValues[k] || customValueDefaults[k] || { value: '' }).value;
    return !val || val.trim() === '';
  }).length;
  const hasEmptyCustomValues = customValuesEmptyCount > 0 && customValuesAllKeys.size > 0;
  const integrationProviderId = normalizeProviderId(integrationModal);
  const integrationProviderEntry = integrationProviderId
    ? providerCatalog.find((entry) => normalizeProviderId(entry.provider) === integrationProviderId)
    : null;
  const isGhlAgencyIntegrationModal =
    integrationProviderId === 'ghl'
    && integrationProviderEntry?.oauthMode === 'agency';

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

  function applyProviderCatalog(catalog: ProviderCatalogEntry[]) {
    setProviderCatalog(catalog);
  }

  async function resolveProviderCatalog(
    accountData?: AccountData | null,
  ): Promise<ProviderCatalogEntry[]> {
    const [accountPayload, globalPayload] = await Promise.all([
      fetchProviderCatalogPayload(`/api/esp/providers?accountKey=${encodeURIComponent(key)}`),
      fetchProviderCatalogPayload('/api/esp/providers'),
    ]);
    const accountEntries = extractProviderCatalog(accountPayload);
    const accountProvider = normalizeProviderId(
      accountPayload?.accountProvider || accountData?.espProvider,
    );
    const globalEntries = extractProviderCatalog(globalPayload).map((entry) => ({
      ...entry,
      activeForAccount: accountProvider
        ? entry.provider === accountProvider
        : entry.activeForAccount,
    }));
    const derivedEntries = deriveProviderCatalogFromAccount(accountData || account);

    return mergeProviderCatalog(
      accountEntries,
      mergeProviderCatalog(globalEntries, derivedEntries),
    );
  }

  async function refreshAccountData() {
    try {
      const res = await fetch(`/api/accounts/${key}`);
      if (!res.ok) return;
      const data = await res.json();
      populateFromAccount(data as AccountData);
    } catch {
      // Non-blocking UI metadata refresh.
    }
  }

  async function refreshProviderCatalog() {
    try {
      const catalog = await resolveProviderCatalog();
      applyProviderCatalog(catalog);
    } catch {
      // Non-blocking UI metadata refresh.
    }
  }

  async function refreshGhlAgencyStatus(): Promise<GhlAgencyStatus | null> {
    setGhlAgencyLoading(true);
    setGhlAgencyError(null);
    try {
      const res = await fetch('/api/esp/connections/ghl/agency');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === 'string' ? data.error : 'Failed to load agency OAuth status',
        );
      }

      const status: GhlAgencyStatus = {
        connected: data.connected === true,
        source: data.source === 'oauth' || data.source === 'env' ? data.source : 'none',
        mode:
          data.mode === 'legacy' || data.mode === 'hybrid' || data.mode === 'agency'
            ? data.mode
            : 'legacy',
        scopes: Array.isArray(data.scopes) ? data.scopes.map(String) : [],
        connectUrl: typeof data.connectUrl === 'string' ? data.connectUrl : undefined,
      };
      setGhlAgencyStatus(status);
      return status;
    } catch (err) {
      setGhlAgencyStatus(null);
      setGhlAgencyError(err instanceof Error ? err.message : 'Failed to load agency OAuth status');
      return null;
    } finally {
      setGhlAgencyLoading(false);
    }
  }

  async function refreshGhlLocationLink(): Promise<GhlLocationLink | null> {
    setGhlLocationsError(null);
    try {
      const res = await fetch(
        `/api/esp/connections/ghl/location-link?accountKey=${encodeURIComponent(key)}`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === 'string' ? data.error : 'Failed to load linked location',
        );
      }
      const link = data.link && typeof data.link === 'object'
        ? {
          locationId: String(data.link.locationId || ''),
          locationName: data.link.locationName ? String(data.link.locationName) : null,
          linkedAt: typeof data.link.linkedAt === 'string' ? data.link.linkedAt : undefined,
        }
        : null;
      setGhlLocationLink(link?.locationId ? link : null);
      if (link?.locationId) {
        setGhlSelectedLocationId(link.locationId);
      }
      return link?.locationId ? link : null;
    } catch (err) {
      setGhlLocationLink(null);
      setGhlLocationsError(err instanceof Error ? err.message : 'Failed to load linked location');
      return null;
    }
  }

  async function handleGhlLocationLink(): Promise<void> {
    const locationId = ghlSelectedLocationId.trim();
    if (!locationId) {
      toast.error('Enter a location ID before linking');
      return;
    }

    setGhlLinking(true);
    setGhlLocationsError(null);
    try {
      const res = await fetch('/api/esp/connections/ghl/location-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountKey: key,
          locationId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to link location');
      }

      await Promise.all([
        refreshProviderCatalog(),
        refreshAccountData(),
        refreshAccountList(),
        refreshGhlLocationLink(),
      ]);
      toast.success(`Linked to ${data.link?.locationName || locationId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to link location');
    } finally {
      setGhlLinking(false);
    }
  }

  async function handleGhlLocationUnlink(): Promise<void> {
    const linkedId = ghlLocationLink?.locationId || '';
    if (!linkedId) return;
    const unlinkConfirmed = await confirm({
      title: 'Unlink GHL Location',
      message: 'Unlink this sub-account from its GHL location?',
      confirmLabel: 'Unlink',
      destructive: true,
    });
    if (!unlinkConfirmed) return;

    setGhlUnlinking(true);
    try {
      const res = await fetch('/api/esp/connections/ghl/location-link', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountKey: key }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to unlink location');
      }

      setGhlLocationLink(null);
      setGhlSelectedLocationId('');
      await Promise.all([
        refreshProviderCatalog(),
        refreshAccountData(),
        refreshAccountList(),
      ]);
      toast.success('Location unlinked');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unlink location');
    } finally {
      setGhlUnlinking(false);
    }
  }

  // Load required OAuth scopes for catalog providers (provider-agnostic).
  useEffect(() => {
    const catalogEntries = providerCatalog;
    if (catalogEntries.length === 0) return;
    const oauthProviders = collectOAuthProviderIds(catalogEntries);
    const missingProviders = missingProviderScopes(oauthProviders, requiredScopesByProvider);
    if (missingProviders.length === 0) return;

    let cancelled = false;
    fetchRequiredScopesMap(missingProviders).then((scopeMap) => {
      if (cancelled) return;
      setRequiredScopesByProvider((prev) => {
        return { ...prev, ...scopeMap };
      });
    });

    return () => {
      cancelled = true;
    };
  }, [providerCatalog, requiredScopesByProvider]);

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

        const catalog = await resolveProviderCatalog(resolvedAccount);
        if (cancelled) return;
        applyProviderCatalog(catalog);
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
    const segments = pathname.split('/').filter(Boolean);
    const settingsIdx = segments.indexOf('settings');
    return settingsIdx >= 0 ? segments[settingsIdx + 1] : undefined;
  }, [settingsMode, pathname]);

  // Settings mode: sync activeTab from URL on initial load and popstate
  useEffect(() => {
    if (!settingsMode) return;
    const allTabKeys = SETTINGS_TABS.map(t => t.key);
    const syncFromUrl = () => {
      const segments = window.location.pathname.split('/').filter(Boolean);
      const settingsIdx = segments.indexOf('settings');
      const tab = settingsIdx >= 0 ? segments[settingsIdx + 1] : 'company';
      if (allTabKeys.includes(tab as DetailTab)) {
        setActiveTab(tab as DetailTab);
      }
    };
    // Sync on mount — if no tab in URL, push default tab into the URL
    if (settingsUrlTab && allTabKeys.includes(settingsUrlTab as DetailTab)) {
      setActiveTab(settingsUrlTab as DetailTab);
    } else if (!settingsUrlTab) {
      // No tab segment — add /company to URL
      const segments = pathname.split('/').filter(Boolean);
      const slug = segments[1];
      window.history.replaceState({}, '', `/subaccount/${slug}/settings/company`);
    }
    // Sync on browser back/forward
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, [settingsMode, settingsUrlTab, pathname]);

  // Handle ?tab= query param for deep-linking to a specific tab (non-settings mode)
  useEffect(() => {
    if (settingsMode) return;
    const tabParam = searchParams.get('tab') as DetailTab | null;
    if (tabParam && ['company', 'branding', 'integration', 'custom-values', 'contacts'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [settingsMode, searchParams]);

  // Handle OAuth callback query params.
  useEffect(() => {
    const connected = searchParams.get('esp_connected');
    const errorMessage = searchParams.get('esp_error');
    const provider = searchParams.get('esp_provider');
    const label = providerDisplayName(provider);
    const currentDetailPath = settingsMode
      ? pathname.replace(/\?.*$/, '')
      : `${basePath}/${key}`;

    if (connected === 'true') {
      toast.success(`Successfully connected to ${label}!`);
      setActiveTab('integration');
      refreshProviderCatalog();
      refreshAccountData();
      router.replace(currentDetailPath, { scroll: false });
    } else if (errorMessage) {
      toast.error(`${label} connection failed: ${errorMessage}`);
      setActiveTab('integration');
      router.replace(currentDetailPath, { scroll: false });
    }
  }, [searchParams, basePath, key, router, settingsMode, pathname]);

  useEffect(() => {
    if (!isGhlAgencyIntegrationModal) {
      setGhlAgencyStatus(null);
      setGhlAgencyError(null);
      setGhlLocationsError(null);
      setGhlLocationLink(null);
      setGhlSelectedLocationId('');
      return;
    }

    let cancelled = false;
    (async () => {
      await refreshGhlAgencyStatus();
      if (cancelled) return;

      const link = await refreshGhlLocationLink();
      if (cancelled) return;

      if (link?.locationId) {
        setGhlSelectedLocationId(link.locationId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isGhlAgencyIntegrationModal, key]);

  useEffect(() => {
    setShowAdvancedDetails(false);
  }, [integrationModal]);

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
      // Keep an explicit empty value so clearing can be confirmed/deleted from connected ESP.
      nextValues.storefront_image = { name: storefrontName, value: '' };
    }

    return nextValues;
  }

  // Detect custom values that were previously filled but are now empty (would be deleted from connected ESP)
  function getClearedValueNames(): string[] {
    const currentValues = buildCustomValuesForSave();
    const allKeys = new Set([
      ...Object.keys(customValueDefaults),
      ...Object.keys(currentValues),
      ...Object.keys(savedCustomValues),
    ]);
    const cleared: string[] = [];
    for (const k of allKeys) {
      const savedVal = (savedCustomValues[k] || customValueDefaults[k])?.value || '';
      const currentVal = (currentValues[k] || customValueDefaults[k])?.value || '';
      const savedName = (savedCustomValues[k] || customValueDefaults[k])?.name || k;
      // Was filled before, now empty
      if (savedVal.trim() && !currentVal.trim()) {
        cleared.push(savedName);
      }
    }
    return cleared;
  }

  function handleSave() {
    // Check if any values were cleared — if so, ask user to confirm deletion from connected ESP.
    if (canSyncCustomValuesToActiveProvider) {
      const cleared = getClearedValueNames();
      if (cleared.length > 0) {
        setPendingDeleteNames(cleared);
        setShowDeleteConfirm(true);
        return; // Wait for modal response
      }
    }
    // No cleared values — save normally
    doSave(false);
  }

  async function doSave(deleteManaged: boolean) {
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
        _deleteManaged: deleteManaged, // Tell backend to delete cleared Loomi-managed values in the connected ESP
      };

      const res = await fetch(`/api/accounts/${key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const updated = await res.json();
        // Surface provider sync warning if present.
        const syncWarning =
          ((updated as Record<string, unknown>)._syncWarning as string | undefined);
        delete (updated as Record<string, unknown>)._syncWarning;
        setAccount(updated as AccountData);
        setCustomValues(customValuesToSave);
        setSavedCustomValues(customValuesToSave); // Update saved state after successful save
        formSnapshotRef.current = buildFormSnapshot(updated as AccountData);
        await refreshAccountList();
        markClean();
        if (syncWarning) {
          toast.success('Saved locally!');
          toast.warning(syncWarning);
        } else {
          toast.success(deleteManaged ? 'Saved! Cleared values removed from connected platform.' : 'Saved!');
        }
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to save');
      }
    } catch {
      toast.error('Failed to save');
    }
    setSaving(false);
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

  // ── Refresh provider business details (best effort) ──
  async function handleProviderReimport(providerId: string) {
    const normalizedProvider = normalizeProviderId(providerId);
    if (!normalizedProvider) return;
    setProviderReimporting((prev) => ({ ...prev, [normalizedProvider]: true }));
    try {
      const res = await fetch('/api/esp/connections/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: normalizedProvider, accountKey: key }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || `Failed to refresh details from ${providerDisplayName(normalizedProvider)}`);
      } else if (data.location) {
        setBizEmail(data.location.email || '');
        setBizPhone(data.location.phone || '');
        setBizAddress(data.location.address || '');
        setBizCity(data.location.city || '');
        setBizState(data.location.state || '');
        setBizZip(data.location.postalCode || '');
        setBizWebsite(data.location.website || '');
        setBizTimezone(data.location.timezone || '');
        setDealer(data.location.name || dealer);
        toast.success(`Business details refreshed from ${providerDisplayName(normalizedProvider)}!`);
      } else if (data.account) {
        const accountName = typeof data.account.name === 'string' ? data.account.name : '';
        if (accountName) setDealer(accountName);
        toast.success(`Sub-account details refreshed from ${providerDisplayName(normalizedProvider)}!`);
      } else {
        toast.error(data.error || `No sub-account details were returned by ${providerDisplayName(normalizedProvider)}`);
      }
    } catch {
      toast.error(`Failed to refresh details from ${providerDisplayName(normalizedProvider)}`);
    } finally {
      setProviderReimporting((prev) => ({ ...prev, [normalizedProvider]: false }));
    }
  }

  // ── Connect Provider with Direct Credentials ──
  async function handleProviderCredentialConnect(providerId: string) {
    const secret = (genericProviderSecrets[providerId] || '').trim();
    if (!secret) {
      toast.error('Credential is required');
      return;
    }

    setGenericProviderConnecting(prev => ({ ...prev, [providerId]: true }));
    try {
      const res = await fetch('/api/esp/connections/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountKey: key,
          provider: providerId,
          apiKey: secret,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Failed to connect ${providerDisplayName(providerId)}`);
        return;
      }

      setGenericProviderSecrets(prev => ({ ...prev, [providerId]: '' }));
      await refreshProviderCatalog();
      await refreshAccountData();
      await refreshAccountList();
      const connectedName = data.accountName || data.accountId || providerDisplayName(providerId);
      toast.success(`Connected to ${connectedName}`);
    } catch {
      toast.error(`Failed to connect ${providerDisplayName(providerId)}`);
    } finally {
      setGenericProviderConnecting(prev => ({ ...prev, [providerId]: false }));
    }
  }

  // ── Disconnect Provider ──
  async function handleProviderDisconnect(providerId: string) {
    const providerLabel = providerDisplayName(providerId);
    const confirmMessage = `Disconnect this sub-account from ${providerLabel}? You can reconnect later.`;
    const disconnectConfirmed = await confirm({
      title: 'Disconnect Provider',
      message: confirmMessage,
      confirmLabel: 'Disconnect',
      destructive: true,
    });
    if (!disconnectConfirmed) return;

    setGenericProviderDisconnecting(prev => ({ ...prev, [providerId]: true }));
    try {
      const res = await fetch('/api/esp/connections/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountKey: key, provider: providerId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Failed to disconnect ${providerDisplayName(providerId)}`);
        return;
      }

      await refreshProviderCatalog();
      await refreshAccountData();
      await refreshAccountList();
      toast.success(`Disconnected from ${providerLabel}`);
    } catch {
      toast.error(`Failed to disconnect ${providerLabel}`);
    } finally {
      setGenericProviderDisconnecting(prev => ({ ...prev, [providerId]: false }));
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
  const canSeeCustomValues = userRole === 'developer' || userRole === 'super_admin';
  const visibleTabs = settingsMode
    ? SETTINGS_TABS.filter((tab) => {
        if (tab.key === 'custom-values' && !canSeeCustomValues) return false;
        return true;
      })
    : TABS.filter((tab) => {
        if (tab.key === 'contacts' && !showContactsTab) return false;
        if (tab.key === 'custom-values' && !canSeeCustomValues) return false;
        return true;
      });
  const showSaveButton = !settingsMode || !['users', 'appearance'].includes(activeTab);
  const backHref = basePath;
  const showBrandsSelector = industryHasBrands(category);
  const isAutomotiveIndustry = category.trim().toLowerCase() === 'automotive';
  const isEcommerceIndustry = category.trim().toLowerCase() === 'ecommerce';
  const catalogProviders =
    providerCatalog.length > 0
      ? providerCatalog
      : deriveProviderCatalogFromAccount(account);
  const providerStatusResolver = createProviderStatusResolver({
    providerCatalog: catalogProviders,
    account,
  });
  const providerById = providerStatusResolver.providerById;
  const getProviderStatus = providerStatusResolver.getProviderStatus;
  const providerCards = catalogProviders.map((entry) => {
    const provider = normalizeProviderId(entry.provider);
    return {
      ...entry,
      provider,
      status: getProviderStatus(provider),
    };
  });
  const activeProvider =
    normalizeProviderId(catalogProviders.find((entry) => entry.activeForAccount)?.provider) ||
    normalizeProviderId(account.espProvider) ||
    normalizeProviderId(catalogProviders[0]?.provider) ||
    '';
  const activeProviderEntry = providerById.get(activeProvider);
  const activeProviderStatus = getProviderStatus(activeProvider);
  const activeProviderSupportsCustomValues =
    activeProviderEntry?.capabilities.customValues === true;
  const activeProviderSupportsBusinessDetailsSync =
    activeProviderEntry?.businessDetailsSyncSupported === true;
  const activeProviderSyncReadiness = resolveCustomValuesSyncReadiness({
    supportsCustomValues: activeProviderSupportsCustomValues,
    providerStatus: activeProviderStatus,
    requiredScopes: requiredScopesByProvider[activeProvider] || [],
  });
  const activeProviderNeedsReauthorization = activeProviderSyncReadiness.needsReauthorization;
  const connectedProviderBadges = providerCards.filter((provider) => provider.status.connected);
  const activeProviderConnected = activeProviderStatus.connected;
  const canSyncCustomValuesToActiveProvider = activeProviderSyncReadiness.readyForSync;
  const hasAnyProviderConnection = providerStatusResolver.hasAnyProviderConnection;

  // ── Settings mode: tab click navigates via pushState (no full route transition) ──
  const handleTabClick = (tabKey: DetailTab) => {
    if (settingsMode) {
      const segments = pathname.split('/').filter(Boolean);
      const slug = segments[1]; // /subaccount/[slug]/settings/...
      const newUrl = `/subaccount/${slug}/settings/${tabKey}`;
      window.history.pushState({}, '', newUrl);
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
            <div className="flex items-center justify-between">
              <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--foreground)]">
                  <CogIcon className="w-6 h-6" />
                  Settings for {dealer || key}
                </h1>
                <p className="text-sm text-[var(--muted-foreground)] mt-1">
                  Manage settings and configuration for this sub-account
                </p>
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
                {connectedProviderBadges.map((provider) => (
                  <span
                    key={provider.provider}
                    className="inline-flex items-center gap-1 text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                  >
                    {provider.status.oauthConnected ? (
                      <ShieldCheckIcon className="w-2.5 h-2.5" />
                    ) : (
                      <LinkIcon className="w-2.5 h-2.5" />
                    )}
                    {providerDisplayName(provider.provider)}
                  </span>
                ))}
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

        {/* ── Sidebar nav + content wrapper ── */}
        <div className="flex gap-6">
        {/* Vertical nav */}
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
                {tab.key === 'custom-values' && hasEmptyCustomValues && (
                  <ExclamationTriangleIcon className="w-3.5 h-3.5 text-amber-400" />
                )}
              </span>
            </button>
          ))}
        </nav>

        {/* Tab content */}
        <div className="flex-1 min-w-0">

        {/* ════════════ COMPANY TAB ════════════ */}
        {activeTab === 'company' && (
          <div className="max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className={sectionCardClass}>
              <h3 className={sectionHeadingClass}>Business Details</h3>
              <p className="text-[11px] text-[var(--muted-foreground)] mb-4 -mt-2">
                {activeProviderConnected && activeProviderSupportsBusinessDetailsSync
                  ? 'These details are synced to your connected platform when saved.'
                  : activeProviderConnected
                    ? `${providerUnsupportedMessage(activeProvider, 'business detail push sync')} Changes are saved locally in Loomi.`
                    : 'Connect an integration to sync these details. Until then, changes are saved locally in Loomi.'}
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
                      {CATEGORY_SUGGESTIONS.map(c => <option key={c} value={c}>{c}</option>)}
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
                    <label className={labelClass} style={{ marginBottom: 0 }}>
                      Pacer Markup Rate
                    </label>
                    <span className="relative inline-flex items-center group">
                      <QuestionMarkCircleIcon className="w-4 h-4 text-[var(--muted-foreground)]/80 hover:text-[var(--foreground)] transition-colors cursor-help" />
                      <span className="absolute bottom-full left-1/2 z-[70] mb-1 hidden -translate-x-1/2 group-hover:block group-focus-within:block">
                        <span className="relative block w-64 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 shadow-xl">
                          <span className="block text-[11px] leading-4 text-[var(--foreground)]">
                            Used by the Meta Ads Pacer budget calculator:
                            actual spend = client billed × markup.
                          </span>
                          <span className="mt-1 block text-[10px] leading-4 text-[var(--muted-foreground)]">
                            Leave blank to use the platform default (0.77).
                          </span>
                          <span className="absolute left-1/2 top-full -translate-x-1/2 w-0 h-0 border-x-[6px] border-x-transparent border-t-[7px] border-t-[var(--background)]" />
                        </span>
                      </span>
                    </span>
                  </div>
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
              <h3 className={sectionHeadingClass}>Websafe Fonts</h3>
              <p className="text-[11px] text-[var(--muted-foreground)] mb-4 -mt-2">
                Choose fallback-safe font stacks for headings and body copy.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Heading Font</label>
                  <select value={brandHeadingFont} onChange={(e) => setBrandHeadingFont(e.target.value)} className={inputClass}>
                    {WEBSAFE_FONTS.map((font) => (
                      <option key={font.value} value={font.value}>{font.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Body Font</label>
                  <select value={brandBodyFont} onChange={(e) => setBrandBodyFont(e.target.value)} className={inputClass}>
                    {WEBSAFE_FONTS.map((font) => (
                      <option key={font.value} value={font.value}>{font.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40">
                <p className="text-sm text-[var(--foreground)]" style={{ fontFamily: brandHeadingFont }}>
                  Heading preview
                </p>
                <p className="text-xs text-[var(--muted-foreground)] mt-1" style={{ fontFamily: brandBodyFont }}>
                  Body preview in selected websafe stack.
                </p>
              </div>
            </section>
          </div>
        )}

        {/* ════════════ INTEGRATIONS TAB ════════════ */}
        {activeTab === 'integration' && (
          <div className="max-w-7xl space-y-6">
            <div>
              <h2 className="text-sm font-semibold text-[var(--foreground)] mb-1">Connected Services</h2>
              <p className="text-xs text-[var(--muted-foreground)]">Link third-party platforms to sync contacts, campaigns, and engagement data.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">

              {providerCards.map((provider) => {
                const providerId = provider.provider;
                const providerLabel = providerDisplayName(providerId);
                const providerTheme = providerCardTheme(providerId);
                const connected = provider.status.connected;
                const supportsDirectCredentials = provider.credentialConnectSupported === true;

                return (
                  <div key={providerId} className="glass-card rounded-xl border border-[var(--border)] overflow-hidden flex flex-col">
                    <div className={`flex items-center justify-center h-32 ${providerTheme.headerClassName || 'bg-[var(--muted)]'} rounded-t-xl`}>
                      {providerTheme.logoSrc ? (
                        <img
                          src={providerTheme.logoSrc}
                          alt={providerTheme.logoAlt || providerLabel}
                          className="max-h-20 max-w-[180px] object-contain"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full border border-[var(--border)] bg-[var(--card)] flex items-center justify-center text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                          {providerId.slice(0, 3)}
                        </div>
                      )}
                    </div>
                    <div className="p-4 flex-1 flex flex-col">
                      <h3 className="text-sm font-semibold text-[var(--foreground)] mb-0.5">{providerLabel}</h3>
                      <p className="text-[11px] text-[var(--muted-foreground)] mb-3 leading-relaxed">
                        {providerTheme.description}
                      </p>

                      {connected ? (
                        <div className="space-y-3 mt-auto">
                          <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                            <CheckCircleIcon className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                            <span className="text-emerald-400 text-xs font-medium flex-1 truncate">
                              {provider.status.connectionType === 'oauth'
                                ? 'Connected via OAuth'
                                : `Connected${provider.status.accountName ? ` — ${provider.status.accountName}` : ''}`}
                            </span>
                            {provider.status.oauthConnected && (
                              <span className="text-[10px] text-emerald-400/70 bg-emerald-500/10 px-1.5 py-0.5 rounded">Secure</span>
                            )}
                          </div>
                          <button
                            onClick={() => setIntegrationModal(providerId)}
                            className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                          >
                            Manage
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2 mt-auto">
                          <button
                            onClick={() => setLearnMoreModal(providerId)}
                            className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                          >
                            Learn More
                          </button>
                          {provider.oauthSupported && provider.oauthMode === 'agency' ? (
                            <button
                              onClick={() => setIntegrationModal(providerId)}
                              className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${providerTheme.connectButtonClassName || 'bg-[var(--primary)] text-white hover:opacity-90'}`}
                            >
                              Link Location
                            </button>
                          ) : provider.oauthSupported ? (
                            <a
                              href={buildAuthorizeHref({
                                provider: providerId,
                                accountKey: key,
                                oauthMode: provider.oauthMode,
                              })}
                              className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${providerTheme.connectButtonClassName || 'bg-[var(--primary)] text-white hover:opacity-90'}`}
                            >
                              Connect {providerLabel}
                            </a>
                          ) : supportsDirectCredentials ? (
                            <button
                              onClick={() => setIntegrationModal(providerId)}
                              className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${providerTheme.connectButtonClassName || 'bg-[var(--primary)] text-white hover:opacity-90'}`}
                            >
                              Connect {providerLabel}
                            </button>
                          ) : (
                            <button
                              onClick={() => setIntegrationModal(providerId)}
                              className="w-full px-4 py-2.5 border border-[var(--border)] rounded-lg text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                            >
                              Configure Provider
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

            </div>

            {/* ══════ Provider Detail Modal ══════ */}
            {integrationModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setIntegrationModal(null)}>
                <div className="glass-card glass-modal rounded-xl p-0 max-w-lg w-full mx-4 border border-[var(--border)] shadow-2xl overflow-hidden animate-fade-in-up max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                  <div className="p-6 space-y-5 overflow-y-auto flex-1 min-h-0">
                    {(() => {
                      const provider = providerById.get(normalizeProviderId(integrationModal));
                      if (!provider) {
                        return (
                          <div className="space-y-3">
                            <h3 className="text-lg font-semibold text-[var(--foreground)]">Provider</h3>
                            <p className="text-sm text-[var(--muted-foreground)]">Provider metadata is unavailable.</p>
                          </div>
                        );
                      }

                      const enabledCapabilities = Object.entries(provider.capabilities)
                        .filter(([key, value]) => key !== 'auth' && Boolean(value))
                        .map(([key]) => key);
                      const providerId = normalizeProviderId(provider.provider);
                      const providerTheme = providerCardTheme(providerId);
                      const providerLabel = providerDisplayName(provider.provider);
                      const resolvedStatus = getProviderStatus(providerId);
                      const connected = resolvedStatus.connected;
                      const connectedAccountName = resolvedStatus.accountName || provider.accountName || resolvedStatus.locationName || provider.locationName;
                      const connectedAccountId = resolvedStatus.accountId || provider.accountId || resolvedStatus.locationId || account.activeLocationId;
                      const secret = genericProviderSecrets[providerId] || '';
                      const connecting = genericProviderConnecting[providerId] === true;
                      const disconnecting = genericProviderDisconnecting[providerId] === true;
                      const reimporting = providerReimporting[providerId] === true;
                      const supportsDirectCredentials = provider.credentialConnectSupported === true;
                      const providerSyncReadiness = resolveCustomValuesSyncReadiness({
                        supportsCustomValues: provider.capabilities.customValues === true,
                        providerStatus: resolvedStatus,
                        requiredScopes: requiredScopesByProvider[providerId] || [],
                      });
                      const needsReauthorization = providerSyncReadiness.needsReauthorization;
                      const grantedScopesSet = new Set(resolvedStatus.scopes);
                      const requiredScopesForProvider = requiredScopesByProvider[providerId] || [];
                      const missingScopes = requiredScopesForProvider.filter(
                        (scope) => !grantedScopesSet.has(scope),
                      );
                      const canRefreshBusinessDetails =
                        connected && provider.businessDetailsRefreshSupported === true;
                      const webhookEndpointEntries = Object.entries(provider.webhookEndpoints || {})
                        .filter(([family, endpoint]) => Boolean(family.trim()) && Boolean((endpoint || '').trim()));
                      const isGhlAgencyMode = providerId === 'ghl' && provider.oauthMode === 'agency';
                      const agencyConnected = isGhlAgencyMode && ghlAgencyStatus?.connected === true;
                      const agencyConnectHref =
                        ghlAgencyStatus?.connectUrl
                        || '/api/esp/connections/authorize?provider=ghl&mode=agency';

                      return (
                        <>
                          {/* ── Logo Header ── */}
                          {providerTheme.logoSrc && (
                            <div className={`-mx-6 -mt-6 flex items-center justify-center px-6 py-6 ${providerTheme.headerClassName || 'bg-[var(--muted)]'}`}>
                              <img
                                src={providerTheme.logoSrc}
                                alt={providerTheme.logoAlt || providerLabel}
                                className="w-full max-w-[200px] object-contain"
                              />
                            </div>
                          )}

                          {/* ── Title + Description ── */}
                          <div className="pt-2">
                            <h3 className="text-lg font-semibold text-[var(--foreground)]">
                              {providerLabel}
                            </h3>
                            <p className="text-sm text-[var(--muted-foreground)] mt-1 leading-relaxed">
                              {providerTheme.description || 'This integration is registered in Loomi.'}
                            </p>
                          </div>

                          {/* ── Connection Status Banner ── */}
                          {connected ? (
                            <div className={`flex items-start gap-3 rounded-lg px-4 py-3 ${
                              (isGhlAgencyMode && !ghlLocationLink?.locationId && !resolvedStatus.locationId)
                                ? 'border border-amber-500/20 bg-amber-500/5'
                                : 'border border-emerald-500/20 bg-emerald-500/5'
                            }`}>
                              <CheckCircleIcon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                                (isGhlAgencyMode && !ghlLocationLink?.locationId && !resolvedStatus.locationId)
                                  ? 'text-amber-400'
                                  : 'text-emerald-400'
                              }`} />
                              <div className="min-w-0 flex-1">
                                {(isGhlAgencyMode && !ghlLocationLink?.locationId && !resolvedStatus.locationId) ? (
                                  <>
                                    <p className="text-sm font-medium text-amber-400">Connected — no location linked</p>
                                    <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                                      Link a GHL location below to enable features for this sub-account.
                                    </p>
                                  </>
                                ) : (
                                  <>
                                    <p className="text-sm font-medium text-emerald-400">
                                      Connected to {connectedAccountName || connectedAccountId || 'this provider'}
                                    </p>
                                    {connectedAccountId && (
                                      <p className="text-[11px] font-mono text-[var(--muted-foreground)] mt-0.5 truncate">
                                        {resolvedStatus.oauthConnected ? 'Location' : 'Account'}: {connectedAccountId}
                                      </p>
                                    )}
                                    {resolvedStatus.installedAt && (
                                      <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
                                        Since {new Date(resolvedStatus.installedAt).toLocaleDateString()}
                                      </p>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/50 px-4 py-3">
                              <div className="w-2 h-2 rounded-full bg-[var(--muted-foreground)]" />
                              <p className="text-sm text-[var(--muted-foreground)]">Not connected</p>
                            </div>
                          )}

                          {/* ── Re-auth Warning ── */}
                          {needsReauthorization && (
                            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
                              <ExclamationTriangleIcon className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                              <div className="space-y-2">
                                <p className="text-sm font-medium text-amber-400">Missing permissions</p>
                                <p className="text-xs text-[var(--muted-foreground)]">
                                  {isGhlAgencyMode
                                    ? `This integration is missing ${missingScopes.length} required scope${missingScopes.length === 1 ? '' : 's'}. `
                                      + 'Make sure these scopes are enabled in your GHL marketplace app settings, then click "Refresh Agency Token" to update. '
                                      + 'This fixes all sub-accounts at once.'
                                    : `This integration is missing ${missingScopes.length} required permission${missingScopes.length === 1 ? '' : 's'}. Re-authorize to grant them.`
                                  }
                                </p>
                                {missingScopes.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {missingScopes.map((scope) => (
                                      <span key={scope} className="px-1.5 py-0.5 text-[9px] font-mono bg-amber-500/10 text-amber-400 rounded-full border border-amber-500/20">
                                        {scope}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <div className="flex items-center gap-2 pt-1">
                                  {isGhlAgencyMode && (
                                    <button
                                      onClick={async () => {
                                        try {
                                          const res = await fetch('/api/esp/connections/ghl/agency', { method: 'POST' });
                                          const data = await res.json().catch(() => ({}));
                                          if (!res.ok) throw new Error(data.error || 'Token refresh failed');
                                          if (data.allScopesGranted) {
                                            toast.success(`Agency token refreshed — all ${data.scopes?.length || 0} scopes granted!`);
                                          } else {
                                            toast.warning(`Token refreshed but ${data.missingRequiredScopes?.length || 0} scope(s) still missing. Check your GHL marketplace app settings.`);
                                          }
                                          window.location.reload();
                                        } catch (err) {
                                          toast.error(err instanceof Error ? err.message : 'Token refresh failed');
                                        }
                                      }}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors border border-amber-500/20"
                                    >
                                      <ArrowPathIcon className="w-3.5 h-3.5" />
                                      Refresh Agency Token
                                    </button>
                                  )}
                                  <a
                                    href={buildAuthorizeHref({
                                      provider: providerId,
                                      accountKey: key,
                                      oauthMode: provider.oauthMode,
                                    })}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors border border-[var(--border)]"
                                  >
                                    Re-authorize
                                  </a>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* ── GHL Location Linking ── */}
                          {isGhlAgencyMode && (
                            <>
                              {!agencyConnected ? (
                                <div className="space-y-3">
                                  {ghlAgencyError && (
                                    <p className="text-[11px] text-amber-400">{ghlAgencyError}</p>
                                  )}
                                  <a
                                    href={agencyConnectHref}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-colors"
                                  >
                                    {ghlAgencyLoading ? 'Checking...' : 'Connect Agency OAuth'}
                                  </a>
                                </div>
                              ) : (
                                <div className="space-y-3">
                                  <div>
                                    <label className={labelClass}>Link to GHL Location</label>
                                    <input
                                      type="text"
                                      value={ghlSelectedLocationId}
                                      onChange={(event) => setGhlSelectedLocationId(event.target.value)}
                                      placeholder="Paste GHL Location ID"
                                      className={`${inputClass} text-xs font-mono`}
                                    />
                                    <p className="text-[10px] text-[var(--muted-foreground)] mt-1">
                                      Find this in your GHL dashboard URL: app.gohighlevel.com/v2/location/<strong>{'<ID>'}</strong>/...
                                    </p>
                                  </div>

                                  {ghlLocationsError && (
                                    <p className="text-[11px] text-amber-400">{ghlLocationsError}</p>
                                  )}

                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => handleGhlLocationLink()}
                                      disabled={!ghlSelectedLocationId.trim() || ghlLinking}
                                      className="px-3 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                                    >
                                      {ghlLinking ? 'Linking...' : 'Link Location'}
                                    </button>
                                    {ghlLocationLink?.locationId && (
                                      <button
                                        onClick={() => handleGhlLocationUnlink()}
                                        disabled={ghlUnlinking}
                                        className="px-3 py-2 border border-red-500/30 rounded-lg text-xs text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                                      >
                                        {ghlUnlinking ? 'Unlinking...' : 'Unlink Location'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </>
                          )}

                          {/* ── Action Buttons ── */}
                          {connected ? (
                            <div className="flex items-center gap-2">
                              {canRefreshBusinessDetails && (
                                <button
                                  onClick={() => handleProviderReimport(providerId)}
                                  disabled={reimporting}
                                  className="flex items-center gap-1.5 px-3 py-2 border border-[var(--border)] rounded-lg text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
                                >
                                  <ArrowPathIcon className={`w-3.5 h-3.5 ${reimporting ? 'animate-spin' : ''}`} />
                                  {reimporting ? 'Refreshing...' : 'Refresh Business Details'}
                                </button>
                              )}
                              <button
                                onClick={() => handleProviderDisconnect(providerId)}
                                disabled={disconnecting}
                                className="flex items-center gap-1.5 px-3 py-2 border border-red-500/30 rounded-lg text-xs text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                              >
                                <XMarkIcon className="w-3.5 h-3.5" />
                                {disconnecting
                                  ? (isGhlAgencyMode ? 'Unlinking...' : 'Disconnecting...')
                                  : (isGhlAgencyMode ? 'Unlink Location' : 'Disconnect')}
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {provider.oauthSupported && !isGhlAgencyMode && (
                                <a
                                  href={buildAuthorizeHref({
                                    provider: providerId,
                                    accountKey: key,
                                    oauthMode: provider.oauthMode,
                                  })}
                                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-colors"
                                >
                                  Connect with OAuth
                                </a>
                              )}

                              {supportsDirectCredentials && (
                                <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 p-3">
                                  <div>
                                    <label className={labelClass}>{providerSecretLabel(provider.capabilities.auth)}</label>
                                    <input
                                      type="password"
                                      value={secret}
                                      onChange={(e) => {
                                        const value = e.target.value;
                                        setGenericProviderSecrets(prev => ({ ...prev, [providerId]: value }));
                                      }}
                                      placeholder={providerSecretPlaceholder(provider.capabilities.auth)}
                                      className={`${inputClass} font-mono text-xs`}
                                    />
                                  </div>
                                  <button
                                    onClick={() => handleProviderCredentialConnect(providerId)}
                                    disabled={!secret.trim() || connecting}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-colors disabled:opacity-50"
                                  >
                                    {connecting ? (
                                      <><ArrowPathIcon className="w-4 h-4 animate-spin" /> Connecting...</>
                                    ) : (
                                      <><LinkIcon className="w-4 h-4" /> Connect with Credentials</>
                                    )}
                                  </button>
                                </div>
                              )}

                              {!provider.oauthSupported && !supportsDirectCredentials && !isGhlAgencyMode && (
                                <p className="text-xs text-[var(--muted-foreground)]">
                                  This provider does not expose a connection flow in Loomi yet.
                                </p>
                              )}
                            </div>
                          )}

                          {/* ── Collapsible Advanced Details ── */}
                          <div className="border-t border-[var(--border)] pt-3">
                            <button
                              onClick={() => setShowAdvancedDetails(prev => !prev)}
                              className="flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors w-full"
                            >
                              <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${showAdvancedDetails ? 'rotate-0' : '-rotate-90'}`} />
                              Advanced Details
                            </button>

                            {showAdvancedDetails && (
                              <div className="mt-3 space-y-4">
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <label className={labelClass}>Auth Type</label>
                                    <div className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]">
                                      {provider.capabilities.auth}
                                    </div>
                                  </div>
                                  <div>
                                    <label className={labelClass}>Credential Validation</label>
                                    <div className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]">
                                      {provider.validationSupported ? 'Supported' : 'Not available'}
                                    </div>
                                  </div>
                                  <div>
                                    <label className={labelClass}>Details Refresh</label>
                                    <div className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]">
                                      {provider.businessDetailsRefreshSupported ? 'Supported' : 'Not available'}
                                    </div>
                                  </div>
                                  <div>
                                    <label className={labelClass}>Details Push Sync</label>
                                    <div className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]">
                                      {provider.businessDetailsSyncSupported ? 'Supported' : 'Not available'}
                                    </div>
                                  </div>
                                </div>

                                {(resolvedStatus.scopes.length > 0 || missingScopes.length > 0) && (
                                  <div>
                                    <label className={labelClass}>
                                      OAuth Scopes
                                      {requiredScopesForProvider.length > 0 && (
                                        <span className="ml-1 font-normal text-[var(--muted-foreground)]">
                                          ({resolvedStatus.scopes.length} granted{missingScopes.length > 0 ? `, ${missingScopes.length} missing` : ''})
                                        </span>
                                      )}
                                    </label>
                                    <div className="flex flex-wrap gap-1">
                                      {resolvedStatus.scopes.map((scope) => (
                                        <span key={scope} className="px-1.5 py-0.5 text-[9px] font-mono bg-emerald-500/10 text-emerald-400 rounded-full border border-emerald-500/20">
                                          ✓ {scope}
                                        </span>
                                      ))}
                                      {missingScopes.map((scope) => (
                                        <span key={`missing-${scope}`} className="px-1.5 py-0.5 text-[9px] font-mono bg-red-500/10 text-red-400 rounded-full border border-red-500/20">
                                          ✗ {scope}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                <div>
                                  <label className={labelClass}>Enabled Capabilities</label>
                                  {enabledCapabilities.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {enabledCapabilities.map((capability) => (
                                        <span key={capability} className="px-1.5 py-0.5 text-[10px] font-medium bg-[var(--muted)] text-[var(--muted-foreground)] rounded-full border border-[var(--border)] uppercase">
                                          {capability}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-xs text-[var(--muted-foreground)]">No runtime capabilities reported.</p>
                                  )}
                                </div>

                                {webhookEndpointEntries.length > 0 && (
                                  <div>
                                    <label className={labelClass}>Webhook Endpoints</label>
                                    <div className="space-y-2">
                                      {webhookEndpointEntries.map(([family, endpoint]) => (
                                        <div key={`${family}:${endpoint}`} className="px-3 py-1.5 text-[11px] rounded-lg border border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)] font-mono break-all">
                                          <span className="block mb-1 text-[9px] uppercase tracking-wide text-[var(--muted-foreground)] font-sans">
                                            {family}
                                          </span>
                                          {endpoint}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </>
                      );
                    })()}

                  </div>
                  <div className="flex-shrink-0 border-t border-[var(--border)] px-6 py-4 flex justify-end">
                    <button
                      onClick={() => setIntegrationModal(null)}
                      className="px-4 py-2 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ══════ Learn More Info Modal ══════ */}
            {learnMoreModal && (() => {
              const lmProviderId = normalizeProviderId(learnMoreModal);
              const lmTheme = providerCardTheme(lmProviderId);
              const lmLabel = providerDisplayName(learnMoreModal);
              const lmFeatures = lmTheme.features || [];
              return (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setLearnMoreModal(null)}>
                  <div className="glass-card glass-modal rounded-xl p-0 max-w-lg w-full mx-4 border border-[var(--border)] shadow-2xl overflow-hidden animate-fade-in-up max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                    <div className="p-6 space-y-5 overflow-y-auto flex-1 min-h-0">
                      {/* ── Logo Header ── */}
                      {lmTheme.logoSrc && (
                        <div className={`-mx-6 -mt-6 mb-2 flex items-center justify-center px-6 py-6 ${lmTheme.headerClassName || 'bg-[var(--muted)]'}`}>
                          <img
                            src={lmTheme.logoSrc}
                            alt={lmTheme.logoAlt || lmLabel}
                            className="w-full max-w-[200px] object-contain"
                          />
                        </div>
                      )}

                      {/* ── Title + Description ── */}
                      <div className="pt-2">
                        <h3 className="text-lg font-semibold text-[var(--foreground)]">{lmLabel}</h3>
                        <p className="text-sm text-[var(--muted-foreground)] mt-1 leading-relaxed">
                          {lmTheme.description}
                        </p>
                      </div>

                      {/* ── Features List ── */}
                      {lmFeatures.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-[var(--foreground)] uppercase tracking-wide mb-3">Available Integrations</h4>
                          <ul className="space-y-2">
                            {lmFeatures.map((feature) => (
                              <li key={feature} className="flex items-center gap-2.5 text-sm text-[var(--muted-foreground)]">
                                <CheckCircleIcon className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                                {feature}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                    <div className="flex-shrink-0 border-t border-[var(--border)] px-6 py-4 flex justify-end">
                      <button
                        onClick={() => setLearnMoreModal(null)}
                        className="px-4 py-2 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

          </div>
        )}

        {/* ════════════ CUSTOM VALUES TAB ════════════ */}
        {activeTab === 'custom-values' && (
          <div className="max-w-7xl grid grid-cols-1 gap-6">

            {/* ── Custom Values Sync ── */}
            <section className={sectionCardClass}>
              <h3 className={sectionHeadingClass}>Custom Values</h3>
              <p className="text-[11px] text-[var(--muted-foreground)] mb-4 -mt-2">
                Fill in values for this sub-account. Filled values are automatically synced to the connected ESP when supported.
                Clearing a value will remove it from the connected ESP after confirmation.
                Use <span className="font-mono">{'{{custom_values.field_key}}'}</span> in templates.
              </p>

              {/* Deletion confirmation modal */}
              {showDeleteConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                  <div className="glass-card glass-modal rounded-xl p-6 max-w-md w-full mx-4 border border-[var(--border)] shadow-2xl">
                    <div className="flex items-start gap-3 mb-4">
                      <ExclamationTriangleIcon className="w-6 h-6 text-amber-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-sm font-semibold text-[var(--foreground)]">Remove from connected ESP?</h4>
                        <p className="text-xs text-[var(--muted-foreground)] mt-1">
                          The following custom values were cleared and will be <strong>deleted from the connected ESP</strong>:
                        </p>
                      </div>
                    </div>
                    <ul className="ml-9 mb-4 space-y-1">
                      {pendingDeleteNames.map(name => (
                        <li key={name} className="text-xs text-[var(--foreground)] flex items-center gap-1.5">
                          <TrashIcon className="w-3 h-3 text-red-400" />
                          {name}
                        </li>
                      ))}
                    </ul>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => {
                          setShowDeleteConfirm(false);
                          setPendingDeleteNames([]);
                          doSave(false); // Save without deleting from connected ESP
                        }}
                        className="px-4 py-2 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                      >
                        Keep in ESP
                      </button>
                      <button
                        onClick={() => {
                          setShowDeleteConfirm(false);
                          setPendingDeleteNames([]);
                          doSave(true); // Save and delete from connected ESP
                        }}
                        className="px-4 py-2 text-xs font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
                      >
                        Remove from ESP
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeProviderSupportsCustomValues && !activeProviderConnected && (
                <div className="glass-card rounded-lg p-3 mb-3 border border-amber-500/20 bg-amber-500/5">
                  <p className="text-[11px] text-amber-400">
                    {providerDisplayName(activeProvider)} is not connected. Custom values can be saved locally but won&apos;t sync until you{' '}
                    {activeProviderEntry?.oauthSupported ? (
                      <a
                        href={buildAuthorizeHref({
                          provider: activeProvider,
                          accountKey: key,
                          oauthMode: activeProviderEntry.oauthMode,
                        })}
                        className="underline font-medium hover:text-amber-300"
                      >
                        connect {providerDisplayName(activeProvider)}
                      </a>
                    ) : (
                      <span className="font-medium">connect this provider from the Integrations tab</span>
                    )}
                    .
                  </p>
                </div>
              )}

              {activeProviderNeedsReauthorization && (
                <div className="glass-card rounded-lg p-3 mb-3 border border-amber-500/20 bg-amber-500/5">
                  <p className="text-[11px] text-amber-400">
                    <strong>Missing permissions:</strong> This sub-account&apos;s OAuth token is missing one or more required scopes for custom value sync in {providerDisplayName(activeProvider)}.{' '}
                    Use <strong>Refresh Agency Token</strong> on the Integration tab to update scopes, or{' '}
                    <a
                      href={buildAuthorizeHref({
                        provider: activeProvider,
                        accountKey: key,
                        oauthMode: activeProviderEntry?.oauthMode,
                      })}
                      className="underline font-medium hover:text-amber-300"
                    >
                      re-authorize
                    </a>{' '}
                    if needed.
                  </p>
                </div>
              )}

              {!activeProviderSupportsCustomValues && (
                <div className="glass-card rounded-lg p-3 mb-3 border border-amber-500/20 bg-amber-500/5">
                  <p className="text-[11px] text-amber-400">
                    {providerDisplayName(activeProvider)} does not currently support custom value field sync. Values will be saved locally in Loomi.
                  </p>
                </div>
              )}

              {/* Filled / empty summary */}
              {(() => {
                const allKeys = new Set(
                  [...Object.keys(customValueDefaults), ...Object.keys(customValues)].filter((k) => k !== 'storefront_image'),
                );
                const filledCount = Array.from(allKeys).filter(k => {
                  const val = (customValues[k] || customValueDefaults[k] || { value: '' }).value;
                  return val && val.trim() !== '';
                }).length;
                const totalCount = allKeys.size;
                const emptyCount = totalCount - filledCount;

                return totalCount > 0 ? (
                  <div className="flex items-center gap-3 mb-4 text-[11px]">
                    <span className="flex items-center gap-1 text-emerald-400">
                      <CheckCircleIcon className="w-3.5 h-3.5" />
                      {filledCount} filled
                    </span>
                    {emptyCount > 0 && (
                      <span className="flex items-center gap-1 text-amber-400">
                        <ExclamationTriangleIcon className="w-3.5 h-3.5" />
                        {emptyCount} empty &mdash; won&apos;t sync
                      </span>
                    )}
                  </div>
                ) : null;
              })()}

              <div className="space-y-2">
                {(() => {
                  // Merge defaults + overrides for display
                  const allKeys = new Set(
                    [...Object.keys(customValueDefaults), ...Object.keys(customValues)].filter((k) => k !== 'storefront_image'),
                  );
                  const sortedKeys = Array.from(allKeys).sort();

                  return sortedKeys.map(fieldKey => {
                    const hasOverride = fieldKey in customValues;
                    const def = customValues[fieldKey] || customValueDefaults[fieldKey] || { name: '', value: '' };
                    const hasValue = def.value && def.value.trim() !== '';

                    return (
                      <div key={fieldKey} className={`glass-card rounded-lg p-3 flex items-start gap-3 ${!hasValue ? 'opacity-60' : ''}`}>
                        {/* Status icon */}
                        <div
                          className="mt-4 flex-shrink-0"
                          title={
                            hasValue
                              ? activeProviderSupportsCustomValues
                                ? `Value set — will sync to ${providerDisplayName(activeProvider)}`
                                : 'Value set — saved locally in Loomi'
                              : 'Empty — will not sync until filled in'
                          }
                        >
                          {hasValue ? (
                            <CheckCircleIcon className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <ExclamationTriangleIcon className="w-4 h-4 text-amber-400" />
                          )}
                        </div>
                        <div className="flex-1 grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[10px] text-[var(--muted-foreground)] mb-0.5">
                              Field Key
                            </label>
                            <div className="font-mono text-xs text-[var(--muted-foreground)] py-1.5">{fieldKey}</div>
                          </div>
                          <div>
                            <label className="block text-[10px] text-[var(--muted-foreground)] mb-0.5">Display Name</label>
                            <input
                              type="text"
                              value={def.name}
                              onChange={e => setCustomValues(prev => ({
                                ...prev,
                                [fieldKey]: { name: e.target.value, value: (prev[fieldKey] || customValueDefaults[fieldKey] || { value: '' }).value },
                              }))}
                              className="w-full px-2 py-1 text-xs rounded border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:border-[var(--primary)]"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-[var(--muted-foreground)] mb-0.5">Value</label>
                            <input
                              type="text"
                              value={def.value}
                              onChange={e => setCustomValues(prev => ({
                                ...prev,
                                [fieldKey]: { name: (prev[fieldKey] || customValueDefaults[fieldKey] || { name: '' }).name, value: e.target.value },
                              }))}
                              placeholder={customValueDefaults[fieldKey]?.value || 'Enter value...'}
                              className="w-full px-2 py-1 text-xs rounded border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:border-[var(--primary)]"
                            />
                          </div>
                        </div>
                        {hasOverride && !(fieldKey in customValueDefaults) && (
                          <button
                            onClick={() => setCustomValues(prev => {
                              const next = { ...prev };
                              delete next[fieldKey];
                              return next;
                            })}
                            className="mt-4 text-[var(--muted-foreground)] hover:text-red-400 transition-colors"
                            title="Remove custom value"
                          >
                            <TrashIcon className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>

              {/* Add new custom value */}
              <button
                onClick={async () => {
                  const fieldKey = await prompt({
                    title: 'Add Custom Value',
                    message: 'Enter a field key (e.g. sales_phone, custom_url):',
                    placeholder: 'sales_phone',
                    required: true,
                    confirmLabel: 'Add',
                  });
                  if (!fieldKey || !fieldKey.trim()) return;
                  const cleanKey = fieldKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
                  if (customValues[cleanKey] || customValueDefaults[cleanKey]) {
                    toast.error(`Field key "${cleanKey}" already exists.`);
                    return;
                  }
                  setCustomValues(prev => ({
                    ...prev,
                    [cleanKey]: { name: cleanKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), value: '' },
                  }));
                }}
                className="mt-3 text-xs text-[var(--primary)] hover:underline flex items-center gap-1"
              >
                <span className="text-sm">+</span> Add Custom Value
              </button>
            </section>

          </div>
        )}

        {/* ════════════ CONTACTS TAB ════════════ */}
        {showContactsTab && activeTab === 'contacts' && (
          <AccountContactsTab accountKey={key} isConnected={hasAnyProviderConnection} />
        )}

        {/* ════════════ USERS TAB (settings mode only) ════════════ */}
        {settingsMode && activeTab === 'users' && <UsersTab />}

        {/* ════════════ APPEARANCE TAB (settings mode only) ════════════ */}
        {settingsMode && activeTab === 'appearance' && <AppearanceTab />}

        </div>{/* end tab content */}
        </div>{/* end flex sidebar+content */}
      </div>
  );

  return settingsMode ? content : <AdminOnly>{content}</AdminOnly>;
}

// ════════════════════════════════════════
// Account Contacts Tab
// ════════════════════════════════════════

function AccountContactsTab({ accountKey, isConnected }: { accountKey: string; isConnected: boolean }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/esp/contacts?accountKey=${encodeURIComponent(accountKey)}&limit=100`);
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
    if (isConnected) {
      fetchData();
    } else {
      setLoading(false);
    }
  }, [isConnected, fetchData]);

  if (!isConnected) {
    return (
      <div className="text-center py-16 border border-dashed border-[var(--border)] rounded-xl">
        <ExclamationTriangleIcon className="w-8 h-8 text-[var(--muted-foreground)] mx-auto mb-3" />
        <p className="text-[var(--muted-foreground)] text-sm font-medium">No ESP Connection</p>
        <p className="text-[var(--muted-foreground)] text-xs mt-1">
          Connect this sub-account to an ESP provider to view contacts.
        </p>
      </div>
    );
  }

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
