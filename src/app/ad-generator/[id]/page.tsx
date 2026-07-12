'use client';

/**
 * Ad Generator — pick a template, fill a guided form, see a live preview, and
 * download rendered PNGs per size. The preview uses the same pure template
 * function the server renders with, so what you see is what you get.
 *
 * Branding (dealer name, logo variant, brand color) is pulled from the ACTIVE
 * account's settings via useAccount() — never re-entered by hand.
 *
 * Reimagined replacement for the legacy Oz offer builder. Ads persist as
 * AdCreative rows (autosaved, with a frozen doc snapshot); AI copy, EVOX
 * vehicle imagery, MarketCheck incentives, and OEM compliance are wired in.
 * Export: per-size PNG or a single ZIP of every size. Still reserved:
 * campaignId (future multi-channel Campaign link).
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowDownTrayIcon, ExclamationTriangleIcon, PencilIcon, ArrowLeftIcon, ArrowRightIcon, ArrowPathIcon, CheckIcon, CloudIcon, BookmarkSquareIcon } from '@heroicons/react/24/outline';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { useAccount } from '@/contexts/account-context';
import { useUnsavedChanges } from '@/contexts/unsaved-changes-context';
import { MANAGEMENT_ROLES } from '@/lib/roles';
import { AccountLogo } from '@/components/account-logo';
import { MultiSelect } from '@/components/ui/multi-select';
import { AD_TEMPLATES, ALL_TEMPLATES } from '@/lib/ad-generator/templates';
import { adTemplateFromDoc } from '@/lib/ad-generator/doc-template';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import { availableCustomFonts, buildFontFaceCssFromUrls, usedFontFamilies } from '@/lib/ad-generator/fonts';
import { googleFontsCssUrl, usedGoogleFontFamilies } from '@/lib/ad-generator/google-fonts';
import { FontSelect, type FontSelectOption } from '@/components/font-select';
import { isFieldVisible, isClientField, type AdData, type AdTemplate, type FieldSpec } from '@/lib/ad-generator/types';
import { missingRequired, type OemOfferRule } from '@/lib/ad-generator/compliance';
import { OfferCard, type VehicleSlot } from '@/components/ad-generator/client-form/offer-card';
import { Field, DisclaimerField, evoxSeedFor } from '@/components/ad-generator/client-form/fields';
import { VehicleColorPicker } from '@/components/ad-generator/client-form/vehicle-colors';

const PREVIEW_W = 460;
const PREVIEW_H = 560;

const LOGO_VARIANTS = [
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
  { key: 'white', label: 'White' },
  { key: 'black', label: 'Black' },
] as const;
const COLOR_KEYS = [
  { key: 'primary', label: 'Primary' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'accent', label: 'Accent' },
] as const;
// Websafe families Chromium/browsers reliably have (single names; the template
// appends a system fallback). Custom uploaded fonts are added per account.
const WEBSAFE_FONTS = [
  'Arial',
  'Helvetica',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Georgia',
  'Times New Roman',
  'Palatino',
  'Garamond',
  'Courier New',
  'Lucida Console',
];

export default function AdGeneratorPage() {
  const { accountKey, accountData, userRole, accounts, isUnrestricted } = useAccount();
  // "Admins and up" get the full form; clients get a restricted subset (OEM
  // incentives, vehicle, offer, legal — with the disclaimer read-only). Branding
  // (logo/color/font) + background image are admin-only; clients get brand defaults.
  const isManager = !!userRole && MANAGEMENT_ROLES.includes(userRole);
  const { prompt } = useLoomiDialog();
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Published builder templates (DB) joined with the code-defined ones.
  const [dbTemplates, setDbTemplates] = useState<AdTemplate[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/ad-generator/templates-doc')
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d: { templates?: { id: string; doc: TemplateDoc | null }[] }) => {
        if (cancelled) return;
        const built = (d.templates ?? [])
          .filter((t) => t.doc)
          .map((t) => adTemplateFromDoc(t.id, t.doc as TemplateDoc));
        setDbTemplates(built);
      })
      .catch(() => {
        if (!cancelled) setDbTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // Resolve against ALL templates (incl. retired) so older ads still render.
  const templates = useMemo(() => [...ALL_TEMPLATES, ...dbTemplates], [dbTemplates]);

  const [templateId, setTemplateId] = useState(AD_TEMPLATES[0].id);
  // The ad's own frozen copy of the template design (snapshot at creation). When
  // present the ad renders from THIS — independent of later master-template
  // edits. Falls back to resolving templateId live for older / code-template ads.
  const [docSnapshot, setDocSnapshot] = useState<TemplateDoc | null>(null);
  const template = useMemo(
    () => (docSnapshot ? adTemplateFromDoc(templateId, docSnapshot) : templates.find((t) => t.id === templateId) ?? templates[0]),
    [docSnapshot, templates, templateId],
  );

  const [data, setData] = useState<AdData>(() => ({ ...AD_TEMPLATES[0].defaults }));
  const [sizeId, setSizeId] = useState(AD_TEMPLATES[0].sizes[0].id);
  const [busy, setBusy] = useState<string | null>(null);
  const [oemRule, setOemRule] = useState<OemOfferRule | null>(null);

  // ── this ad (AdCreative) ──
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const creativeId = String(params.id);
  const [creativeName, setCreativeName] = useState('Untitled ad');
  const [adStatus, setAdStatus] = useState<'draft' | 'ready'>('draft');
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const savedRef = useRef('');
  // The form autosaves, so tell the global unsaved-changes guard it's clean
  // whenever a save lands — otherwise the generic DOM dirty-tracker flags
  // "unsaved changes" forever (it never learns the autosave happened), firing
  // the modal on navigation even though everything is saved.
  const { markClean } = useUnsavedChanges();
  useEffect(() => {
    if (saveStatus === 'saved') markClean();
  }, [saveStatus, markClean]);

  // Load the creative once: its template + saved field values + name + status.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/ad-generator/creatives/${creativeId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { creative?: { name: string; templateId: string; status: string; data: AdData; doc?: TemplateDoc | null } }) => {
        if (cancelled || !d.creative) return;
        const c = d.creative;
        setTemplateId(c.templateId);
        if (c.doc && Array.isArray(c.doc.sizes) && Array.isArray(c.doc.elements) && c.doc.layouts) setDocSnapshot(c.doc);
        setData({ ...c.data });
        setCreativeName(c.name);
        setAdStatus(c.status === 'ready' ? 'ready' : 'draft');
        savedRef.current = JSON.stringify({ name: c.name, status: c.status === 'ready' ? 'ready' : 'draft', data: c.data });
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        toast.error('That ad could not be opened');
        router.push('/ad-generator');
      });
    return () => {
      cancelled = true;
    };
  }, [creativeId, router]);

  // ── Branding from the active account ──
  const logos = accountData?.logos;
  const logoVariants = useMemo(
    () =>
      LOGO_VARIANTS.map((v) => ({ key: v.key as string, label: v.label, url: logos?.[v.key] })).filter(
        (v) => !!v.url,
      ) as { key: string; label: string; url: string }[],
    [logos],
  );
  const colors = accountData?.branding?.colors;
  const colorSwatches = useMemo(
    () =>
      COLOR_KEYS.map((c) => ({ key: c.key as string, label: c.label, value: colors?.[c.key] })).filter(
        (c) => !!c.value,
      ) as { key: string; label: string; value: string }[],
    [colors],
  );

  // Admins get the roll-up (union of every subaccount's fonts); clients get only
  // the active account's own.
  const customFonts = useMemo(
    () => availableCustomFonts({ accountData, accounts, unrestricted: isUnrestricted }),
    [accountData, accounts, isUnrestricted],
  );
  const fontFamilies = useMemo(() => [...new Set(customFonts.map((f) => f.family))], [customFonts]);
  // Font picker = system default + the account's uploaded fonts + websafe stacks.
  const fontOptions = useMemo<FontSelectOption[]>(
    () => [
      { value: '', label: 'System default' },
      ...fontFamilies.map((fam) => ({ value: fam, label: fam })),
      ...WEBSAFE_FONTS.map((fam) => ({ value: fam, label: fam })),
    ],
    [fontFamilies],
  );
  // The selected doc-level font (declared here so the embed scoping below can
  // reference it; the picker + reset live further down).
  const [fontKey, setFontKey] = useState<string>('');
  // The account's "Brand default" font — used when this ad hasn't picked its own
  // doc-level font, so "Brand default" text resolves to the subaccount brand font.
  const brandDefaultFont = accountData?.branding?.fonts?.brandDefault || '';
  // Base64-embed ONLY the custom families this ad uses (its elements + the
  // selected doc-level font) — not the whole roll-up union (~MBs for an admin,
  // which made the editor laggy). Spaces fonts send no CORS header, so the
  // embedded base64 is what actually renders. Mirrors the builder.
  const customFamilySet = useMemo(() => new Set(customFonts.map((f) => f.family)), [customFonts]);
  const usedFamilies = useMemo(
    () => usedFontFamilies(docSnapshot?.elements ?? [], [fontKey, brandDefaultFont]).filter((fam) => customFamilySet.has(fam)),
    [docSnapshot, fontKey, brandDefaultFont, customFamilySet],
  );
  const usedFamilyKey = usedFamilies.join('');
  const [embeddedFontCss, setEmbeddedFontCss] = useState('');
  useEffect(() => {
    if (usedFamilies.length === 0) {
      setEmbeddedFontCss('');
      return;
    }
    let cancelled = false;
    const qs = `accountKey=${encodeURIComponent(accountKey ?? '')}&families=${encodeURIComponent(usedFamilies.join('\n'))}`;
    fetch(`/api/ad-generator/fonts?${qs}`)
      .then((r) => (r.ok ? r.json() : { css: '' }))
      .then((j: { css?: string }) => {
        if (!cancelled) setEmbeddedFontCss(j.css ?? '');
      })
      .catch(() => {
        if (!cancelled) setEmbeddedFontCss('');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey, usedFamilyKey]);
  // Page-level @font-face (embedded base64 for the used families).
  const usedCustomFonts = useMemo(
    () => customFonts.filter((f) => usedFamilies.includes(f.family)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customFonts, usedFamilyKey],
  );
  const pageFontFaceCss = useMemo(
    () => [buildFontFaceCssFromUrls(usedCustomFonts), embeddedFontCss].filter(Boolean).join('\n'),
    [embeddedFontCss, usedCustomFonts],
  );

  const [logoKey, setLogoKey] = useState<string>('light');
  const [colorKey, setColorKey] = useState<string>('primary');
  const [customColor, setCustomColor] = useState('');

  // Reset branding selections when the account changes.
  useEffect(() => {
    setLogoKey(logoVariants[0]?.key ?? 'light');
    setColorKey('primary');
    setCustomColor('');
    setFontKey('');
  }, [accountKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const logoUrl = logoVariants.find((v) => v.key === logoKey)?.url ?? logoVariants[0]?.url ?? '';
  const brandColor =
    colorKey === 'custom'
      ? customColor || undefined
      : colorSwatches.find((c) => c.key === colorKey)?.value ?? colorSwatches[0]?.value ?? undefined;

  // The ad's own font pick wins; otherwise fall back to the account brand font.
  const selectedFontFamily = fontKey || brandDefaultFont;
  // Google CSS2 <link> for every Google family the design actually uses (per
  // element) + the doc-level pick — mirrors the builder so the preview renders
  // real fonts. gstatic sends CORS, so the URL loads fine in the srcdoc iframe.
  const previewGoogleFontsUrl = useMemo(
    () => googleFontsCssUrl(usedGoogleFontFamilies(docSnapshot?.elements ?? [], selectedFontFamily || undefined)),
    [docSnapshot, selectedFontFamily],
  );

  const brandingData: AdData = useMemo(
    () => ({
      ...(accountData?.dealer ? { dealerName: accountData.dealer } : {}),
      ...(logoUrl ? { logoUrl } : {}),
      ...(brandColor ? { brandColor } : {}),
      // Always embed ALL account custom fonts so per-element brand fonts render
      // (not just a doc-level pick); a chosen brand font sets `fontFamily` too.
      ...(pageFontFaceCss ? { fontFaceCss: pageFontFaceCss } : {}),
      ...(selectedFontFamily ? { fontFamily: selectedFontFamily } : {}),
      ...(previewGoogleFontsUrl ? { googleFontsUrl: previewGoogleFontsUrl } : {}),
    }),
    [accountData?.dealer, logoUrl, brandColor, pageFontFaceCss, selectedFontFamily, previewGoogleFontsUrl],
  );

  const size = useMemo(() => template.sizes.find((s) => s.id === sizeId) ?? template.sizes[0], [template, sizeId]);

  // Style the read-only disclaimer PREVIEW to match the disclaimer element's
  // actual look (font / weight / color / alignment / line-height) instead of
  // generic form chrome — so the preview reflects the ad, not a gray box. Font
  // size is floored for form readability (the element's own size can be tiny).
  const disclaimerPreviewStyle = useMemo<CSSProperties | undefined>(() => {
    const doc = docSnapshot;
    if (!doc) return undefined;
    const el = doc.elements.find((e) => e.binding?.kind === 'field' && e.binding.key === 'disclaimer');
    if (!el) return undefined;
    const box = doc.layouts?.[sizeId]?.[el.id];
    const SYS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    const stack = selectedFontFamily ? `'${selectedFontFamily}', ${SYS}` : SYS;
    return {
      fontFamily: el.fontFamily ? `'${el.fontFamily}', ${stack}` : stack,
      fontWeight: el.fontWeight ?? 400,
      color: el.color === 'brand' ? brandColor || '#0f172a' : el.color || '#0f172a',
      textAlign: (el.align ?? 'left') as CSSProperties['textAlign'],
      lineHeight: el.lineHeight ?? 1.3,
      fontSize: Math.max(12, Math.round(box?.fontSize ?? 13)),
    };
  }, [docSnapshot, sizeId, brandColor, selectedFontFamily]);
  const renderData = useMemo(() => ({ ...data, ...brandingData }), [data, brandingData]);

  // Which of the template's sizes this ad includes (multi-select, persisted in
  // data._sizes; defaults to all). The preview pages through these; the ZIP
  // export renders only these.
  const selectedSizeIds = useMemo(() => {
    const raw = typeof data._sizes === 'string' ? data._sizes : '';
    const ids = raw ? raw.split(',').filter(Boolean).filter((id) => template.sizes.some((s) => s.id === id)) : [];
    return ids.length ? ids : template.sizes.map((s) => s.id);
  }, [data._sizes, template]);
  // Persist the included sizes (multi-select), in template order and never
  // empty; keep the previewed size within the set.
  const setSizes = (ids: string[]) => {
    const next = template.sizes.filter((s) => ids.includes(s.id)).map((s) => s.id);
    if (next.length === 0) return; // keep at least one
    setData((d) => ({ ...d, _sizes: next.join(',') }));
    if (!next.includes(sizeId)) setSizeId(next[0]);
  };
  // Keep the previewed size within the included set.
  useEffect(() => {
    if (!selectedSizeIds.includes(sizeId)) setSizeId(selectedSizeIds[0]);
  }, [selectedSizeIds, sizeId]);
  const sizeIndex = Math.max(0, selectedSizeIds.indexOf(sizeId));
  const stepSize = (dir: -1 | 1) => {
    const n = selectedSizeIds.length;
    setSizeId(selectedSizeIds[(sizeIndex + dir + n) % n]);
  };

  // Industry-aware tooling. The ad generator supports any industry/ad type via
  // data-driven templates; the automotive helpers (OEM incentive lookup, EVOX
  // vehicle picker) appear whenever the TEMPLATE is a vehicle offer (has an
  // offerType / vehicleImageUrl field) — regardless of the active account, so a
  // vehicle-offer template always gets the modern OEM UI (even in admin/global
  // context, with no account selected). Non-vehicle templates (events, grand
  // openings) still fall to the clean generic form.
  const isVehicleOffer = useMemo(
    () => template.fields.some((f) => f.key === 'offerType' || f.key === 'vehicleImageUrl'),
    [template],
  );
  const showAutomotiveTools = isVehicleOffer;

  // A template shows two offers when it carries o2_ fields (a "dual" template) —
  // that's a property of the template's design, not a client choice. Reps only
  // choose whether the two offers are on the SAME model (Offer 2 reuses Offer 1's
  // vehicle) or TWO models. (One-offer vs two-offer is now separate templates.)
  const isDual = useMemo(() => template.fields.some((f) => f.key.startsWith('o2_')), [template]);
  const [dualVehicleMode, setDualVehicleMode] = useState<'same' | 'two'>('same');
  // Offer sourcing: pull from OEM incentives (MarketCheck) or enter manually.
  const [offerSource, setOfferSource] = useState<'oem' | 'manual'>('oem');
  // Same-model dual: keep Offer 2's vehicle in sync with Offer 1's.
  useEffect(() => {
    if (!isDual || dualVehicleMode !== 'same') return;
    setData((d) => {
      if (d.o2_vehicleName === d.vehicleName && d.o2_vehicleImageUrl === (d.vehicleImageUrl ?? '')) return d;
      return { ...d, o2_vehicleName: d.vehicleName ?? '', o2_vehicleImageUrl: d.vehicleImageUrl ?? '' };
    });
  }, [isDual, dualVehicleMode, data.vehicleName, data.vehicleImageUrl]);

  // OEM compliance: pull the make-keyed required-field rule (resilient — null
  // when none/unmigrated → baseline applies), then compute which required fields
  // are still empty. Export is gated on this. Prefer the make of the offer's own
  // vehicle (set by an OEM incentive or the YMM picker) so a Subaru offer inside a
  // multi-make account validates against Subaru's rule, not the account default.
  const oemMake = data._vehMake?.trim() || accountData?.oem || accountData?.oems?.[0] || '';
  useEffect(() => {
    if (!oemMake) {
      setOemRule(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/ad-generator/oem-rules?make=${encodeURIComponent(oemMake)}`)
      .then((r) => (r.ok ? r.json() : { rule: null }))
      .then((d: { rule?: OemOfferRule | null }) => {
        if (!cancelled) setOemRule(d.rule ?? null);
      })
      .catch(() => {
        if (!cancelled) setOemRule(null);
      });
    return () => {
      cancelled = true;
    };
  }, [oemMake]);
  const missing = useMemo(() => missingRequired(renderData, oemRule), [renderData, oemRule]);
  const previewHtml = useMemo(() => template.render({ ...template.defaults, ...renderData }, size), [template, renderData, size]);

  // Autosave the field values / name / status (debounced) once the ad is loaded.
  useEffect(() => {
    if (!loaded) return;
    const name = creativeName.trim() || 'Untitled ad';
    const snapshot = JSON.stringify({ name, status: adStatus, data });
    if (snapshot === savedRef.current) return;
    const handle = window.setTimeout(async () => {
      setSaveStatus('saving');
      try {
        const res = await fetch(`/api/ad-generator/creatives/${creativeId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, status: adStatus, data }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        savedRef.current = snapshot;
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      }
    }, 1000);
    return () => window.clearTimeout(handle);
  }, [loaded, creativeName, adStatus, data, creativeId]);

  const groups = useMemo(() => {
    const m = new Map<string, FieldSpec[]>();
    for (const f of template.fields) {
      // Skip fields hidden by the current data (e.g. APR fields when the
      // offer type is Lease). Recomputes as the user changes the offer type.
      if (!isFieldVisible(f, data)) continue;
      const g = f.group || 'General';
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(f);
    }
    // Order sections by the template's designer-defined group order so the
    // client form matches the builder; any extra groups keep first-seen order.
    const order = docSnapshot?.fieldGroups ?? [];
    const rank = (g: string) => { const i = order.indexOf(g); return i < 0 ? order.length + 1 : i; };
    return [...m.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
  }, [template, data, docSnapshot]);

  const set = (key: string, value: string) => setData((d) => ({ ...d, [key]: value }));

  // The automotive Offer card owns the offer inputs + vehicle (not separate
  // cards). `manualOfferFields` = the editable offer inputs (offer numbers +
  // vehicle NAME) shown under "Manual entry" and summarized in the OEM recap —
  // the vehicle IMAGE is excluded (it's the color picker). `vehicleSlots` = the
  // vehicle image field(s), rendered as inline color pickers folded into the card.
  const manualOfferFields = useMemo(
    () =>
      groups
        .filter(([g]) => g.startsWith('Offer'))
        .flatMap(([, fs]) => fs)
        .filter((f) => !/vehicleimageurl/i.test(f.key)),
    [groups],
  );
  const vehicleSlots = useMemo<VehicleSlot[]>(
    () =>
      template.fields
        .filter((f) => /vehicleimageurl/i.test(f.key) && isFieldVisible(f, data))
        .filter((f) => !(isDual && dualVehicleMode === 'same' && f.key.startsWith('o2_')))
        .map((f) => {
          const prefix = f.key.startsWith('o2_') ? 'o2_' : '';
          return {
            imageKey: f.key,
            nameKey: `${prefix}vehicleName`,
            codeKey: `${prefix}vehicleColorCode`,
            label: prefix ? 'Offer 2' : 'Offer 1',
          };
        }),
    [template, data, isDual, dualVehicleMode],
  );

  async function download(targetSizeId: string) {
    setBusy(targetSizeId);
    try {
      const res = await fetch('/api/ad-generator/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: template.id, sizeId: targetSizeId, accountKey, data: renderData, ...(docSnapshot ? { doc: docSnapshot } : {}) }),
      });
      if (!res.ok) {
        const msg = (await res.json().catch(() => null))?.error || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${template.id}-${targetSizeId}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(`Couldn't render: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(null);
    }
  }

  // One ZIP for every size — browsers block the N sequential downloads the old
  // per-size loop fired, and the server renders all sizes in one Chromium session.
  async function downloadAll() {
    setBusy('all');
    try {
      const res = await fetch('/api/ad-generator/render-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: template.id,
          sizeIds: selectedSizeIds,
          accountKey,
          data: renderData,
          name: creativeName.trim() || undefined,
          ...(docSnapshot ? { doc: docSnapshot } : {}),
        }),
      });
      if (!res.ok) {
        const msg = (await res.json().catch(() => null))?.error || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${creativeName.trim() || template.id}-all-sizes.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(`Couldn't render: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(null);
    }
  }

  // Promote this ad's design into the reusable template library. Uses the ad's
  // frozen doc snapshot (the design, not the filled-in values); always creates a
  // fresh AdTemplateDoc scoped to the active account.
  async function saveAsTemplate() {
    if (!docSnapshot) {
      toast.error('Open “Edit design” once so this ad has a saved design, then try again.');
      return;
    }
    const name = (
      await prompt({
        title: 'Save as template',
        message: 'Save this ad’s design as a reusable template. It will appear in the template picker for new ads.',
        defaultValue: `${creativeName.trim() || 'Untitled ad'} template`,
        placeholder: 'Template name',
        confirmLabel: 'Save template',
        required: true,
      })
    )?.trim();
    if (!name) return;
    setSavingTemplate(true);
    try {
      const res = await fetch('/api/ad-generator/templates-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, doc: { ...docSnapshot, name }, status: 'draft', accountKey: accountKey ?? null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      toast.success('Saved as a new template');
    } catch (err) {
      toast.error(`Couldn't save template: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setSavingTemplate(false);
    }
  }

  const scale = Math.min(PREVIEW_W / size.width, PREVIEW_H / size.height);

  const saveInfo =
    saveStatus === 'saving'
      ? { label: 'Saving…', cls: 'text-amber-500', Icon: ArrowPathIcon, spin: true }
      : saveStatus === 'error'
        ? { label: 'Save failed', cls: 'text-red-500', Icon: ExclamationTriangleIcon, spin: false }
        : saveStatus === 'saved'
          ? { label: 'Saved', cls: 'text-emerald-500', Icon: CheckIcon, spin: false }
          : { label: 'Autosave on', cls: 'text-[var(--muted-foreground)]', Icon: CloudIcon, spin: false };

  if (!loaded) {
    return <div className="mx-auto max-w-6xl px-6 py-20 text-center text-sm text-[var(--muted-foreground)]">Loading ad…</div>;
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {pageFontFaceCss && <style dangerouslySetInnerHTML={{ __html: pageFontFaceCss }} />}
      {/* Clients have no app chrome — carry their dealership's brand at the top
          of the page instead of in a sidebar. */}
      {!isManager && (
        <div className="mb-5 border-b border-[var(--border)] pb-4">
          <AccountLogo className="h-9 w-auto max-w-[180px] object-contain" />
        </div>
      )}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/ad-generator"
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
            title="Back to all ads"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Ads
          </Link>
          <input
            value={creativeName}
            onChange={(e) => setCreativeName(e.target.value)}
            placeholder="Untitled ad"
            title="Ad name"
            // Hug the text: width tracks the value (with a sensible min), capped
            // so a very long name scrolls inside the field rather than pushing
            // the layout.
            style={{ width: `${Math.min(48, Math.max(14, creativeName.length + 2))}ch` }}
            className="min-w-0 max-w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-lg font-bold text-[var(--foreground)] outline-none transition-colors hover:border-[var(--muted-foreground)] focus:border-[var(--primary)] focus:bg-[var(--background)]"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${saveInfo.cls}`}>
            <saveInfo.Icon className={`h-3.5 w-3.5 ${saveInfo.spin ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{saveInfo.label}</span>
          </span>
          {isManager && (
            <button
              onClick={saveAsTemplate}
              disabled={savingTemplate}
              title="Save this ad’s design as a reusable template"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:opacity-50"
            >
              <BookmarkSquareIcon className="h-4 w-4" />
              <span className="hidden sm:inline">{savingTemplate ? 'Saving…' : 'Save as template'}</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Form */}
        <div className="space-y-6">

          {showAutomotiveTools && (
            <OfferCard
              data={data}
              set={set}
              setData={setData}
              isDual={isDual}
              dualVehicleMode={dualVehicleMode}
              setDualVehicleMode={setDualVehicleMode}
              offerSource={offerSource}
              setOfferSource={setOfferSource}
              manualFields={manualOfferFields}
              vehicleSlots={vehicleSlots}
              oemMake={oemMake}
              defaultZip={accountData?.postalCode}
              accountKey={accountKey ?? undefined}
              allowVehiclePicker={showAutomotiveTools}
            />
          )}

          {/* Branding — admins & up only; clients inherit the account's defaults. */}
          {isManager && (
          <section className="glass-card rounded-2xl border border-[var(--border)] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Branding</h2>
              {accountData?.dealer && <span className="text-xs font-medium text-[var(--foreground)]">{accountData.dealer}</span>}
            </div>

            {!accountKey ? (
              <p className="text-xs text-[var(--muted-foreground)]">
                Select an account in the top bar to pull its logos and colors. Using template defaults for now.
              </p>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">Logo</label>
                  {logoVariants.length ? (
                    <div className="flex flex-wrap gap-2">
                      {logoVariants.map((v) => (
                        <button
                          key={v.key}
                          onClick={() => setLogoKey(v.key)}
                          title={v.label}
                          className={`flex h-14 w-20 items-center justify-center rounded-lg border bg-slate-500 p-1.5 transition-all ${
                            v.key === logoKey ? 'border-[var(--primary)] ring-2 ring-[var(--primary)]/40' : 'border-[var(--border)] hover:border-[var(--primary)]'
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={v.url} alt={v.label} className="max-h-full max-w-full object-contain" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--muted-foreground)]">No logos uploaded for this account.</p>
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">Color</label>
                  <div className="flex flex-wrap items-center gap-2">
                    {colorSwatches.map((c) => (
                      <button
                        key={c.key}
                        onClick={() => setColorKey(c.key)}
                        title={`${c.label} · ${c.value}`}
                        className={`h-9 w-9 rounded-full border transition-all ${
                          c.key === colorKey ? 'ring-2 ring-offset-2 ring-offset-[var(--card)] ring-[var(--primary)]' : 'border-[var(--border)]'
                        }`}
                        style={{ background: c.value }}
                      />
                    ))}
                    <button
                      onClick={() => setColorKey('custom')}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                        colorKey === 'custom' ? 'border-[var(--primary)] text-[var(--primary)]' : 'border-[var(--border)] text-[var(--muted-foreground)]'
                      }`}
                    >
                      Custom
                    </button>
                    {colorKey === 'custom' && (
                      <input
                        type="color"
                        value={customColor || '#4f46e5'}
                        onChange={(e) => setCustomColor(e.target.value)}
                        className="h-9 w-12 cursor-pointer rounded border border-[var(--border)] bg-transparent"
                      />
                    )}
                    {!colorSwatches.length && colorKey !== 'custom' && (
                      <span className="text-xs text-[var(--muted-foreground)]">No brand colors set — pick Custom.</span>
                    )}
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">Font</label>
                  <FontSelect value={fontKey} onChange={setFontKey} options={fontOptions} />
                </div>
              </div>
            )}
          </section>
          )}

          {groups
            // The automotive Offer + Vehicle groups are owned by the OfferCard
            // above (offer inputs, OEM recap, and the folded-in vehicle color) —
            // don't also render them as their own cards here.
            .filter(([group]) => !(showAutomotiveTools && (group.startsWith('Offer') || group === 'Vehicle')))
            .map(([group, fields]) => {
              // Same-model dual hides Offer 2's vehicle inputs (auto-synced from
              // Offer 1); everything else shows.
              let shown = fields.filter((f) => {
                if (isDual && dualVehicleMode === 'same' && (f.key === 'o2_vehicleName' || f.key === 'o2_vehicleImageUrl')) return false;
                return true;
              });
              // Client visibility is DESIGNER-SET per field (`audience`): a client
              // sees the fields marked "Client", not a hardcoded list. Managers
              // see everything. The automotive vehicle-offer flow keeps two
              // functional routing rules on top: the vehicle name is hidden
              // (the vehicle comes from the chosen offer), and the offer inputs
              // render inside the OEM/Manual panel rather than as their own card.
              if (!isManager) {
                shown = shown.filter((f) => {
                  if (!isClientField(f)) return false; // designer marked it internal
                  if (showAutomotiveTools) {
                    if (/vehiclename/i.test(f.key)) return false; // vehicle comes from the offer
                    if (group.startsWith('Offer') && !/vehicleimageurl/i.test(f.key)) return false; // in the OEM panel
                  }
                  return true;
                });
              }
              return [group, shown] as const;
            })
            // Drop groups that have nothing left to show (e.g. Legal for clients).
            .filter(([, shown]) => shown.length > 0)
            .map(([group, shown]) => {
              const sharesVehicle = isDual && dualVehicleMode === 'same' && /Offer\s*2/i.test(group);
              return (
              <section key={group} className="glass-card rounded-2xl border border-[var(--border)] p-5">
                <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{!isManager && group === 'Vehicle' ? 'Vehicle color' : group}</h2>
                {sharesVehicle && (
                  <p className="-mt-2 mb-3 text-[11px] text-[var(--muted-foreground)]">Same vehicle as Offer 1 — switch to “Two models” above to give it its own.</p>
                )}
                <div className="space-y-4">
                  {shown.map((f) => {
                    if (f.key === 'disclaimer') {
                      return (
                        <DisclaimerField
                          key={f.key}
                          field={f}
                          renderData={renderData}
                          make={oemMake}
                          value={data.disclaimer ?? ''}
                          onChange={(v) => set('disclaimer', v)}
                          readOnly={!isManager}
                          previewStyle={disclaimerPreviewStyle}
                        />
                      );
                    }
                    // Clients don't get the full image field (URL / library /
                    // vehicle search) — just the paint colors EVOX has for the
                    // vehicle the offer already picked. Managers keep the full
                    // field. `o2_vehicleImageUrl` pairs with `o2_vehicleName`.
                    if (!isManager && /vehicleimageurl/i.test(f.key)) {
                      const nameKey = f.key.replace(/vehicleImageUrl$/i, 'vehicleName');
                      const codeKey = f.key.replace(/vehicleImageUrl$/i, 'vehicleColorCode');
                      return (
                        <VehicleColorPicker
                          key={f.key}
                          vehicleName={data[nameKey] ?? data.vehicleName ?? ''}
                          selectedCode={data[codeKey] ?? ''}
                          onPick={(url, code) => setData((d) => ({ ...d, [f.key]: url, [codeKey]: code }))}
                        />
                      );
                    }
                    // Managers get the full field, seeded with the offer vehicle
                    // so its EVOX picker auto-searches the right jellybean (#246).
                    return <Field key={f.key} field={f} value={data[f.key] ?? ''} onChange={(v) => set(f.key, v)} allowVehiclePicker={showAutomotiveTools} evoxSeed={evoxSeedFor(f.key, data)} />;
                  })}
                </div>
              </section>
              );
            })}
        </div>

        {/* Preview + export */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="glass-card rounded-2xl border border-[var(--border)] p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Sizes for this ad</span>
              {/* The builder is a design tool — managers only. Clients never
                  leave the form + preview. */}
              {isManager && (
                <Link
                  href={`/ad-generator/builder?ad=${encodeURIComponent(creativeId)}${accountKey ? `&account=${encodeURIComponent(accountKey)}` : ''}`}
                  className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                  title="Open this ad's layout in the builder"
                >
                  <PencilIcon className="h-3.5 w-3.5" />
                  Edit design
                </Link>
              )}
            </div>

            {/* Which sizes this ad includes — a multi-select so it scales to
                dozens of presets. The preview below pages through the chosen
                set; the ZIP export renders exactly these. */}
            <div className="mb-4">
              <MultiSelect
                value={selectedSizeIds}
                onChange={setSizes}
                options={template.sizes.map((s) => ({ value: s.id, label: s.label }))}
                placeholder="Select sizes…"
                searchable
              />
            </div>

            <div className="flex justify-center rounded-xl bg-[var(--muted)]/40 p-4">
              <div
                className="overflow-hidden rounded-md shadow-lg ring-1 ring-black/5"
                style={{ width: size.width * scale, height: size.height * scale }}
              >
                <iframe
                  title="Ad preview"
                  srcDoc={previewHtml}
                  style={{ width: size.width, height: size.height, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left' }}
                />
              </div>
            </div>

            {/* Page through the included sizes. */}
            <div className="mt-2 flex items-center justify-center gap-3">
              <button
                onClick={() => stepSize(-1)}
                disabled={selectedSizeIds.length < 2}
                title="Previous size"
                aria-label="Previous size"
                className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ArrowLeftIcon className="h-4 w-4" />
              </button>
              <span className="text-[11px] text-[var(--muted-foreground)]">
                <span className="font-medium text-[var(--foreground)]">{size.label.split(' ')[0]}</span> · {size.width}×{size.height}px
                {selectedSizeIds.length > 1 && <span className="ml-1 tabular-nums opacity-70">({sizeIndex + 1}/{selectedSizeIds.length})</span>}
              </span>
              <button
                onClick={() => stepSize(1)}
                disabled={selectedSizeIds.length < 2}
                title="Next size"
                aria-label="Next size"
                className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ArrowRightIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {missing.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
                  <ExclamationTriangleIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <span>
                    Required before export{oemMake ? ` for ${oemMake}` : ''}:{' '}
                    <span className="font-medium">{missing.map((m) => m.label).join(', ')}</span>
                  </span>
                </div>
              )}
              <button
                onClick={() => download(size.id)}
                disabled={busy !== null || missing.length > 0}
                title={missing.length > 0 ? 'Fill the required fields before exporting' : undefined}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowDownTrayIcon className="h-4 w-4" />
                {busy === size.id ? 'Rendering…' : `Download ${size.label.split(' ')[0]}`}
              </button>
              <button
                onClick={downloadAll}
                disabled={busy !== null || missing.length > 0}
                title={missing.length > 0 ? 'Fill the required fields before exporting' : undefined}
                className="w-full rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'all' ? 'Rendering ZIP…' : busy ? 'Rendering…' : `Download all ${selectedSizeIds.length} size${selectedSizeIds.length !== 1 ? 's' : ''} (ZIP)`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
