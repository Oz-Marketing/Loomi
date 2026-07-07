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

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowDownTrayIcon, ExclamationTriangleIcon, Squares2X2Icon, TruckIcon, XMarkIcon, MagnifyingGlassIcon, ArrowLeftIcon, ArrowRightIcon, ArrowPathIcon, CheckIcon, CloudIcon, PhotoIcon, BookmarkSquareIcon } from '@heroicons/react/24/outline';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { useAccount } from '@/contexts/account-context';
import { MANAGEMENT_ROLES } from '@/lib/roles';
import { MediaPickerModal } from '@/components/media-picker-modal';
import { AccountLogo } from '@/components/account-logo';
import { MultiSelect } from '@/components/ui/multi-select';
import { AD_TEMPLATES, ALL_TEMPLATES } from '@/lib/ad-generator/templates';
import { adTemplateFromDoc } from '@/lib/ad-generator/doc-template';
import { isVehicleIndustry } from '@/lib/ad-generator/industry';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import { buildFontFaceCssFromUrls } from '@/lib/ad-generator/fonts';
import { googleFontsCssUrl, usedGoogleFontFamilies } from '@/lib/ad-generator/google-fonts';
import { FontSelect, type FontSelectOption } from '@/components/font-select';
import { isFieldVisible, type AdData, type AdTemplate, type FieldSpec } from '@/lib/ad-generator/types';
import { composeDisclaimer } from '@/lib/ad-generator/disclaimer';
import { missingRequired, type OemOfferRule } from '@/lib/ad-generator/compliance';
import type { EvoxVehicle, EvoxColor } from '@/lib/integrations/evox';
import type { MarketCheckIncentive } from '@/lib/integrations/marketcheck';

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
  const { accountKey, accountData, userRole } = useAccount();
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

  const customFonts = useMemo(() => accountData?.customFonts ?? [], [accountData?.customFonts]);
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
  // Base64-embedded @font-face for the account's fonts. The URL-based css below
  // is instant but cross-origin/CORS can silently drop the font in a preview
  // iframe; we fetch an embedded version and prefer it once loaded so brand
  // fonts actually render (WYSIWYG with the export, which embeds the same way).
  // Mirrors the builder (see ad-generator/builder/page.tsx).
  const [embeddedFontCss, setEmbeddedFontCss] = useState('');
  useEffect(() => {
    if (!accountKey || customFonts.length === 0) {
      setEmbeddedFontCss('');
      return;
    }
    let cancelled = false;
    fetch(`/api/ad-generator/fonts?accountKey=${encodeURIComponent(accountKey)}`)
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
  }, [accountKey, customFonts.length]);
  // Page-level @font-face so the dropdown can preview the custom families.
  const pageFontFaceCss = useMemo(
    () => embeddedFontCss || buildFontFaceCssFromUrls(customFonts),
    [embeddedFontCss, customFonts],
  );

  const [logoKey, setLogoKey] = useState<string>('light');
  const [colorKey, setColorKey] = useState<string>('primary');
  const [customColor, setCustomColor] = useState('');
  const [fontKey, setFontKey] = useState<string>('');

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

  const selectedFontFamily = fontKey;
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
  // data-driven templates; the automotive-only helpers (OEM incentive lookup,
  // EVOX vehicle picker) appear only for an Automotive account on a vehicle-
  // offer template. Everything else (AI copy, branding, the template's own
  // fields) is generic, so events, grand openings, etc. get a clean form.
  const isVehicleAccount = isVehicleIndustry(accountData?.category);
  const isVehicleOffer = useMemo(
    () => template.fields.some((f) => f.key === 'offerType' || f.key === 'vehicleImageUrl'),
    [template],
  );
  const showAutomotiveTools = isVehicleAccount && isVehicleOffer;

  // Dual-offer templates carry o2_ fields. Reps choose whether the two offers
  // are on the SAME model (Offer 2 reuses Offer 1's vehicle) or TWO models.
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

  // OEM compliance: pull the active account's make-keyed required-field rule
  // (resilient — null when none/unmigrated → baseline applies), then compute
  // which required fields are still empty. Export is gated on this.
  const oemMake = accountData?.oem || accountData?.oems?.[0] || '';
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
    return [...m.entries()];
  }, [template, data]);

  const set = (key: string, value: string) => setData((d) => ({ ...d, [key]: value }));

  // In the client automotive flow the offer inputs live INSIDE the source panel
  // (under "Manual entry"), not as a separate card — so pull the offer-group
  // fields out here (minus the vehicle name/image, which the color picker owns).
  const offerFieldsForPanel = useMemo(
    () =>
      groups
        .filter(([g]) => g.startsWith('Offer'))
        .flatMap(([, fs]) => fs)
        .filter((f) => !/vehiclename|vehicleimageurl/i.test(f.key)),
    [groups],
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
            className="min-w-0 max-w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-bold text-[var(--foreground)] outline-none transition-colors hover:border-[var(--border)] focus:border-[var(--primary)] focus:bg-[var(--background)]"
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
            <section className="glass-card rounded-2xl border border-[var(--border)] p-5">
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Offer</h2>
              {/* Source tabs — where the vehicle + offer come from. */}
              <div className="mb-4 flex items-center gap-5 border-b border-[var(--border)]">
                {(['oem', 'manual'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setOfferSource(s)}
                    className={`-mb-px border-b-2 pb-2.5 text-sm font-semibold transition-colors ${
                      offerSource === s ? 'border-[var(--primary)] text-[var(--foreground)]' : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    {s === 'oem' ? 'OEM Incentive' : 'Manual entry'}
                  </button>
                ))}
              </div>

              {/* Dual-offer structure — a distinct config row (not another pill pair). */}
              {isDual && (
                <div className="mb-4 flex items-center justify-between gap-2 rounded-lg bg-[var(--muted)]/40 px-3 py-2">
                  <span className="text-xs font-medium text-[var(--foreground)]">The two offers are on</span>
                  <div className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5">
                    {([['same', 'One model'], ['two', 'Two models']] as const).map(([val, label]) => (
                      <button
                        key={val}
                        onClick={() => setDualVehicleMode(val)}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          dualVehicleMode === val ? 'bg-[var(--primary)] text-white' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {offerSource === 'oem' ? (
                <OemIncentivesPanel
                  defaultMake={oemMake}
                  defaultZip={accountData?.postalCode}
                  dual={isDual}
                  dualVehicleMode={dualVehicleMode}
                  accountKey={accountKey ?? undefined}
                  onApply={(patch) => setData((d) => ({ ...d, ...patch }))}
                />
              ) : !isManager ? (
                // Clients enter the offer right here under "Manual entry" — no
                // separate Offer card. (Managers keep the standalone Offer card
                // below, so this is just a pointer for them.)
                <div className="space-y-4">
                  {offerFieldsForPanel.map((f) => (
                    <Field key={f.key} field={f} value={data[f.key] ?? ''} onChange={(v) => set(f.key, v)} allowVehiclePicker={showAutomotiveTools} />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[var(--muted-foreground)]">Enter the vehicle and offer details by hand in the cards below.</p>
              )}
            </section>
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
            .map(([group, fields]) => {
              // Same-model dual: Offer 2 rides Offer 1's vehicle, so hide its
              // vehicle inputs (they're auto-synced).
              let shown = fields.filter(
                (f) => !(isDual && dualVehicleMode === 'same' && (f.key === 'o2_vehicleName' || f.key === 'o2_vehicleImageUrl')),
              );
              // Clients can touch the OFFER(S), the VEHICLE COLOR, and the
              // Legal fields they're responsible for (VIN / stock — the
              // disclaimer stays read-only + auto-composed). The color is
              // chosen through the vehicle image field (…ImageUrl → a
              // client-only color picker). Everything else — vehicle name,
              // Copy, branding — is hidden from the form but still rendered in
              // the live preview; clients see it, they just can't edit it.
              if (!isManager) {
                shown = shown.filter((f) => {
                  if (/vehiclename/i.test(f.key)) return false; // don't let clients switch the vehicle
                  if (/vehicleimageurl/i.test(f.key)) return true; // vehicle color picker
                  if (group === 'Legal') return true; // VIN / stock (+ read-only disclaimer)
                  // Offer inputs move INTO the OEM/Manual panel on the
                  // automotive flow; only keep them as their own card when
                  // there's no such panel (non-vehicle template).
                  if (group.startsWith('Offer')) return !showAutomotiveTools;
                  return false;
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
                          value={data.disclaimer ?? ''}
                          onChange={(v) => set('disclaimer', v)}
                          readOnly={!isManager}
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
                  <Squares2X2Icon className="h-3.5 w-3.5" />
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

// EVOX vehicle picker — years EVOX covers (newest first) + the major makes.
// If EVOX's make spelling differs for any brand, fix it here (1-line change).
const EVOX_CURRENT_YEAR = new Date().getFullYear();
const EVOX_YEARS = Array.from({ length: EVOX_CURRENT_YEAR + 1 - 2007 + 1 }, (_, i) => EVOX_CURRENT_YEAR + 1 - i);
const EVOX_MAKES = [
  'Acura', 'Alfa Romeo', 'Audi', 'BMW', 'Buick', 'Cadillac', 'Chevrolet', 'Chrysler', 'Dodge', 'Fiat',
  'Ford', 'Genesis', 'GMC', 'Honda', 'Hyundai', 'Infiniti', 'Jaguar', 'Jeep', 'Kia', 'Land Rover',
  'Lexus', 'Lincoln', 'Maserati', 'Mazda', 'Mercedes-Benz', 'MINI', 'Mitsubishi', 'Nissan', 'Polestar',
  'Porsche', 'Ram', 'Rivian', 'Subaru', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo',
];

/**
 * OEM Incentives (MarketCheck) — look up the live lease / APR / cash programs
 * for a vehicle and apply one to auto-fill the structured offer fields. Manual
 * entry below still works; this is just a faster, accurate source. Renders a
 * "not configured" hint when MARKETCHECK_API_KEY is unset.
 */
function OemIncentivesPanel({ defaultMake, defaultZip, dual, dualVehicleMode, accountKey, onApply }: { defaultMake?: string; defaultZip?: string; dual?: boolean; dualVehicleMode?: 'same' | 'two'; accountKey?: string; onApply: (patch: Record<string, string>) => void }) {
  const [year, setYear] = useState(String(EVOX_CURRENT_YEAR));
  const [make, setMake] = useState(defaultMake || '');
  const [model, setModel] = useState('');
  // Seed from the account profile's postal code — the designer can still change it.
  const [zip, setZip] = useState(defaultZip ?? '');
  // Account data loads async; fill the ZIP once it arrives unless already typed.
  useEffect(() => {
    if (defaultZip) setZip((z) => z || defaultZip);
  }, [defaultZip]);
  const [busy, setBusy] = useState(false);
  const [incentives, setIncentives] = useState<MarketCheckIncentive[] | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  // When the feed fell back (previous model year / national search), tell the designer.
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);
  // True while fetching the EVOX jellybean for an applied incentive.
  const [resolvingImg, setResolvingImg] = useState(false);

  const yearOptions: FontSelectOption[] = EVOX_YEARS.filter((y) => y >= 2020).map((y) => ({ value: String(y), label: String(y) }));
  const makeOptions: FontSelectOption[] = [{ value: '', label: 'Select make…' }, ...EVOX_MAKES.map((m) => ({ value: m, label: m }))];

  async function find() {
    if (!make) {
      toast.error('Pick a make');
      return;
    }
    setBusy(true);
    setIncentives(null);
    setNotConfigured(false);
    setFallbackNote(null);
    try {
      const res = await fetch('/api/ad-generator/marketcheck/incentives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ make, model: model.trim(), year: Number(year), zip: zip.trim() }),
      });
      const json = await res.json();
      if (json.configured === false) {
        setNotConfigured(true);
        setIncentives([]);
        return;
      }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setIncentives(json.incentives ?? []);
      const notes: string[] = [];
      if (json.usedYear && json.usedYear !== Number(year)) notes.push(`no ${year} programs yet — showing ${json.usedYear}`);
      if (json.usedNational) notes.push('none near that ZIP — showing national programs');
      setFallbackNote(notes.length ? notes.join('; ') : null);
    } catch (err) {
      toast.error(`MarketCheck lookup failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      setIncentives([]);
    } finally {
      setBusy(false);
    }
  }

  function apply(inc: MarketCheckIncentive, which: '' | 'o2_' = '') {
    const p = dual ? which : ''; // field prefix for the chosen offer slot
    const patch: Record<string, string> = {};
    if (inc.type === 'lease') {
      patch[`${p}offerType`] = 'lease';
      if (inc.payment) patch[`${p}monthlyPayment`] = String(Math.round(inc.payment));
      if (inc.term) patch[`${p}leaseTerm`] = String(inc.term);
      if (inc.downPayment) patch[`${p}dueAtSigning`] = String(Math.round(inc.downPayment));
    } else if (inc.type === 'apr') {
      patch[`${p}offerType`] = 'apr';
      patch[`${p}aprRate`] = String(inc.rate);
      if (inc.term) patch[`${p}aprTerm`] = String(inc.term);
    } else if (inc.type === 'cash') {
      patch[`${p}offerType`] = 'discount';
      if (inc.amount) patch[`${p}discountAmount`] = String(Math.round(inc.amount));
    }
    if (inc.msrp) patch[`${p}msrp`] = String(Math.round(inc.msrp));
    if (inc.endDate) {
      const d = new Date(inc.endDate);
      if (!Number.isNaN(d.getTime())) patch.expiration = d.toISOString().slice(0, 10); // shared
    }
    // We already know the vehicle from the search — fill it too (name now, EVOX
    // jellybean async). For a same-model dual, Offer 2 rides Offer 1's vehicle,
    // so don't overwrite it here.
    const setVehicle = !(dual && which === 'o2_' && dualVehicleMode === 'same');
    if (setVehicle && (make || model)) {
      patch[`${p}vehicleName`] = [year, make, model].filter(Boolean).join(' ');
      // Stash the structured vehicle so the EVOX color picker can seed + auto-search
      // it (no re-typing) — see evoxSeedFor().
      patch[`${p}_vehYear`] = String(year || '');
      patch[`${p}_vehMake`] = make || '';
      patch[`${p}_vehModel`] = model || '';
    }
    onApply(patch);
    toast.success(dual ? `Filled ${which === 'o2_' ? 'Offer 2' : 'Offer 1'} from the incentive` : 'Offer filled from the incentive');
    if (setVehicle && make) {
      setResolvingImg(true);
      resolveJellybean(make, model, Number(year))
        .then((url) => { if (url) onApply({ [`${p}vehicleImageUrl`]: url }); })
        .finally(() => setResolvingImg(false));
    }
  }

  // Auto-pull the EVOX jellybean for the searched vehicle: first matching trim +
  // its first color → resolve (which re-hosts to our S3, so it's cached).
  async function resolveJellybean(mk: string, mdl: string, yr: number): Promise<string | null> {
    try {
      const s = await fetch('/api/ad-generator/evox/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year: yr, make: mk, model: mdl }) });
      const sj = await s.json().catch(() => ({}));
      const v = (sj.vehicles ?? [])[0] as EvoxVehicle | undefined;
      const color = v?.colors?.[0];
      if (!v || !color) return null;
      const r = await fetch('/api/ad-generator/evox/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vifnum: v.vifnum, colorCode: color.code, accountKey, hint: `${yr}-${mk}-${mdl}` }) });
      const rj = await r.json().catch(() => ({}));
      return typeof rj.url === 'string' ? rj.url : null;
    } catch {
      return null;
    }
  }

  const typeBadge: Record<string, string> = {
    lease: 'bg-blue-500/15 text-blue-500',
    apr: 'bg-emerald-500/15 text-emerald-500',
    cash: 'bg-amber-500/15 text-amber-500',
    other: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
  };

  return (
    <div>
      <p className="mb-3 text-xs text-[var(--muted-foreground)]">
        Pull a current lease / APR / cash offer — applying one fills in the offer <span className="text-[var(--foreground)]">and</span> the vehicle for you.
      </p>
      {/* Two per row so the fields aren't scrunched in the narrow form column. */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">Year</label>
          <FontSelect value={year} onChange={setYear} options={yearOptions} previewFont={false} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">Make</label>
          <FontSelect value={make} onChange={setMake} options={makeOptions} previewFont={false} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">Model</label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && find()}
            placeholder="e.g. Accord"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">ZIP</label>
          <input
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && find()}
            placeholder="Optional"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
        </div>
      </div>
      <button
        onClick={find}
        disabled={busy}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] disabled:opacity-50"
      >
        {busy ? 'Searching…' : 'Find incentives'}
      </button>

      {resolvingImg && (
        <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
          <ArrowPathIcon className="h-3 w-3 animate-spin" /> Fetching vehicle image…
        </p>
      )}

      {notConfigured && (
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          MarketCheck isn’t configured here. Set <span className="font-mono">MARKETCHECK_API_KEY</span> to enable the incentive feed.
        </div>
      )}
      {incentives && incentives.length === 0 && !notConfigured && (
        <p className="mt-3 text-center text-xs text-[var(--muted-foreground)]">No incentives found for that vehicle.</p>
      )}
      {fallbackNote && incentives && incentives.length > 0 && (
        <p className="mt-3 text-center text-[11px] text-[var(--muted-foreground)]">{fallbackNote}</p>
      )}
      {incentives && incentives.length > 0 && (
        <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
          {incentives.map((inc, i) => (
            <div key={inc.id || i} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${typeBadge[inc.type]}`}>{inc.type}</span>
                {/* Fill directly into the target offer — no separate "Apply to" toggle. */}
                <div className="flex items-center gap-1">
                  {dual ? (
                    <>
                      <button onClick={() => apply(inc, '')} className="rounded-md bg-[var(--primary)]/10 px-2 py-1 text-[11px] font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/20">
                        Fill Offer 1
                      </button>
                      <button onClick={() => apply(inc, 'o2_')} className="rounded-md bg-[var(--primary)]/10 px-2 py-1 text-[11px] font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/20">
                        Fill Offer 2
                      </button>
                    </>
                  ) : (
                    <button onClick={() => apply(inc, '')} className="rounded-md bg-[var(--primary)]/10 px-2 py-1 text-[11px] font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/20">
                      Fill offer
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs font-medium text-[var(--foreground)]">{inc.offerDetails || inc.description}</p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--muted-foreground)]">
                {inc.payment > 0 && <span>${Math.round(inc.payment).toLocaleString()}/mo</span>}
                {inc.rate > 0 && <span>{inc.rate}% APR</span>}
                {inc.amount > 0 && <span>${Math.round(inc.amount).toLocaleString()} cash</span>}
                {inc.term > 0 && <span>{inc.term} mo</span>}
                {inc.downPayment > 0 && <span>${Math.round(inc.downPayment).toLocaleString()} DAS</span>}
                {inc.trim && <span>{inc.trim}</span>}
                {inc.endDate && <span>ends {inc.endDate.slice(0, 10)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


type DisclaimerTemplateOption = {
  id: string;
  name: string;
  make: string | null;
  body: string;
  isDefault: boolean;
};

/**
 * The disclaimer area (rendered in place of the generic `disclaimer` field):
 * a template selector + the disclaimer textarea. The legal text AUTO-FILLS
 * from the selected template + the structured offer (token substitution +
 * dealer-fee boilerplate + VIN/Stock#) and re-composes whenever the offer /
 * VIN / Stock# / template changes — no button. Manually editing the text
 * opts out of auto-fill (until a template is re-selected). Never AI-written.
 */
function DisclaimerField({
  field,
  renderData,
  value,
  onChange,
  readOnly = false,
}: {
  field: FieldSpec;
  renderData: AdData;
  value: string;
  onChange: (v: string) => void;
  /** Clients can't override the disclaimer — it still auto-fills, but shows
   *  read-only (only admins & up can edit/override). */
  readOnly?: boolean;
}) {
  const offerType = renderData.offerType || 'custom';
  const [templates, setTemplates] = useState<DisclaimerTemplateOption[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const editedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/ad-generator/disclaimer-templates?offerType=${encodeURIComponent(offerType)}`)
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d: { templates?: DisclaimerTemplateOption[] }) => {
        if (!cancelled) setTemplates(d.templates ?? []);
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [offerType]);

  const tmpl = templates.find((t) => t.id === selectedId);
  const composed = composeDisclaimer(renderData, tmpl?.body);

  // Auto-fill the disclaimer whenever the composed result changes (offer / VIN
  // / Stock# / template edits) — unless the user has typed their own text.
  useEffect(() => {
    if (!editedRef.current && composed !== value) onChange(composed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composed]);

  const templateOptions: FontSelectOption[] = [
    { value: '', label: `Default (${offerType})` },
    ...templates.map((t) => ({
      value: t.id,
      label: `${t.name}${t.make ? ` — ${t.make}` : ' — global'}`,
    })),
  ];

  // Read-only (clients): show the auto-filled disclaimer, no template picker, no
  // editing. It still auto-fills from the offer via the effect above.
  if (readOnly) {
    return (
      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">{field.label}</label>
        <div className="w-full whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-xs leading-snug text-[var(--muted-foreground)]">
          {value || '—'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <label className="block text-xs font-medium text-[var(--foreground)]">
            Disclaimer template
            <span className="ml-1 font-normal text-[var(--muted-foreground)]">— auto-fills the text below</span>
          </label>
          <Link href="/ad-generator/templates" className="flex-shrink-0 text-[11px] font-medium text-[var(--primary)] hover:underline">
            Manage
          </Link>
        </div>
        <FontSelect
          value={selectedId}
          onChange={(v) => {
            editedRef.current = false; // re-selecting a template re-binds auto-fill
            setSelectedId(v);
          }}
          options={templateOptions}
          previewFont={false}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">
          {field.label}
          {field.help && <span className="ml-1 font-normal text-[var(--muted-foreground)]">— {field.help}</span>}
        </label>
        <textarea
          rows={3}
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => {
            editedRef.current = true; // manual edit opts out of auto-fill
            onChange(e.target.value);
          }}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
        />
      </div>
    </div>
  );
}

/** Seed values (year/make/model) for the EVOX picker on a VEHICLE image field —
 *  from the structured vehicle stashed when a MarketCheck offer was applied, else
 *  parsed from the composed vehicleName. Empty for non-vehicle image fields. */
function evoxSeedFor(key: string, data: AdData): { year?: string; make?: string; model?: string } {
  if (!key.toLowerCase().includes('vehicleimage')) return {};
  const prefix = key.startsWith('o2_') ? 'o2_' : '';
  const make = data[`${prefix}_vehMake`];
  const model = data[`${prefix}_vehModel`];
  const year = data[`${prefix}_vehYear`];
  if (make || model) return { year: year || undefined, make: make || undefined, model: model || undefined };
  const name = (data[`${prefix}vehicleName`] || '').trim();
  if (!name) return {};
  const parts = name.split(/\s+/);
  const y = /^\d{4}$/.test(parts[0]) ? parts[0] : undefined;
  const rest = y ? parts.slice(1) : parts;
  return { year: y, make: rest[0], model: rest[1] };
}

function Field({ field, value, onChange, allowVehiclePicker, evoxSeed }: { field: FieldSpec; value: string; onChange: (v: string) => void; allowVehiclePicker?: boolean; evoxSeed?: { year?: string; make?: string; model?: string } }) {
  const label = (
    <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">
      {field.label}
      {field.help && <span className="ml-1 font-normal text-[var(--muted-foreground)]">— {field.help}</span>}
    </label>
  );
  const inputClass =
    'w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]';

  if (field.type === 'textarea') {
    return (
      <div>
        {label}
        <textarea rows={3} value={value} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} className={inputClass} />
      </div>
    );
  }
  if (field.type === 'select') {
    return (
      <div>
        {label}
        <FontSelect value={value} onChange={onChange} options={field.options ?? []} previewFont={false} />
      </div>
    );
  }
  if (field.type === 'image') {
    return <ImageField field={field} value={value} onChange={onChange} allowVehiclePicker={allowVehiclePicker} evoxSeed={evoxSeed} />;
  }
  return (
    <div>
      {label}
      <input
        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
        value={value}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </div>
  );
}

/**
 * Image field with a URL input, a media-library picker (browse/upload the
 * account's library — where template backgrounds live), and, for automotive
 * templates, a "Vehicle" button that opens the EVOX picker. Picking a
 * vehicle/color re-hosts the transparent PNG on our S3 and drops the stable
 * URL into the field.
 */
function ImageField({ field, value, onChange, allowVehiclePicker, evoxSeed }: { field: FieldSpec; value: string; onChange: (v: string) => void; allowVehiclePicker?: boolean; evoxSeed?: { year?: string; make?: string; model?: string } }) {
  const { accountKey } = useAccount();
  const [open, setOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">
        {field.label}
        {field.help && <span className="ml-1 font-normal text-[var(--muted-foreground)]">— {field.help}</span>}
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          placeholder={field.placeholder || 'Image URL'}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
        />
        <button
          type="button"
          onClick={() => setLibraryOpen(true)}
          title="Pick from the media library"
          className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)]"
        >
          <PhotoIcon className="h-4 w-4" />
          Library
        </button>
        {/* EVOX vehicle photography — automotive vehicle offers only. */}
        {allowVehiclePicker && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)]"
          >
            <TruckIcon className="h-4 w-4" />
            Vehicle
          </button>
        )}
      </div>
      {value && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="mt-2 h-20 rounded-md border border-[var(--border)] bg-[var(--muted)]/40 object-contain p-1" />
      )}
      {libraryOpen && (
        <MediaPickerModal
          accountKey={accountKey || undefined}
          onSelect={(url) => {
            onChange(url);
            setLibraryOpen(false);
          }}
          onClose={() => setLibraryOpen(false)}
        />
      )}
      {open && <EvoxPickerModal initial={evoxSeed} onClose={() => setOpen(false)} onPick={(url) => { onChange(url); setOpen(false); }} />}
    </div>
  );
}

/** A color swatch that shows the ACTUAL jellybean via the thumbnail proxy (EVOX
 *  search returns no swatch image/hex), falling back to a hex/grey chip on 404. */
function EvoxColorSwatch({ vifnum, color }: { vifnum: number; color: EvoxColor }) {
  const [ok, setOk] = useState(true);
  if (ok) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/ad-generator/evox/thumb?vifnum=${vifnum}&color=${encodeURIComponent(color.code)}`}
        alt={color.name || color.code}
        loading="lazy"
        onError={() => setOk(false)}
        className="max-h-full max-w-full object-contain"
      />
    );
  }
  return <span className="h-6 w-6 rounded-full border border-[var(--border)]" style={{ background: color.rgb ? `#${color.rgb.replace('#', '')}` : '#cbd5e1' }} />;
}

/** EVOX vehicle picker: search Year/Make/Model → pick a trim + color → image.
 *  `initial` seeds Year/Make/Model from the already-selected vehicle (e.g. a
 *  MarketCheck offer) so you don't re-enter it — it auto-searches on open. */
function EvoxPickerModal({ onClose, onPick, initial }: { onClose: () => void; onPick: (url: string) => void; initial?: { year?: string; make?: string; model?: string } }) {
  const { accountKey } = useAccount();
  const [year, setYear] = useState(initial?.year || String(EVOX_CURRENT_YEAR));
  const [make, setMake] = useState(initial?.make || '');
  const [model, setModel] = useState(initial?.model || '');
  const [trim, setTrim] = useState('');
  const [busy, setBusy] = useState(false);
  const [vehicles, setVehicles] = useState<EvoxVehicle[] | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);

  // Seeded from a selected vehicle → run the search immediately so the color
  // options appear without the user re-typing the vehicle.
  useEffect(() => {
    if (initial?.make && initial?.model) void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const yearOptions: FontSelectOption[] = EVOX_YEARS.map((y) => ({ value: String(y), label: String(y) }));
  const makeOptions: FontSelectOption[] = [{ value: '', label: 'Select make…' }, ...EVOX_MAKES.map((m) => ({ value: m, label: m }))];

  async function search() {
    if (!make || !model.trim()) {
      toast.error('Pick a make and enter a model');
      return;
    }
    setBusy(true);
    setVehicles(null);
    setNotConfigured(false);
    try {
      const res = await fetch('/api/ad-generator/evox/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: Number(year), make, model: model.trim(), trim: trim.trim() }),
      });
      const json = await res.json();
      if (json.configured === false) {
        setNotConfigured(true);
        setVehicles([]);
        return;
      }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setVehicles(json.vehicles ?? []);
    } catch (err) {
      toast.error(`EVOX search failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      setVehicles([]);
    } finally {
      setBusy(false);
    }
  }

  async function pick(v: EvoxVehicle, color: EvoxColor) {
    const id = `${v.vifnum}-${color.code}`;
    setPicking(id);
    try {
      const res = await fetch('/api/ad-generator/evox/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vifnum: v.vifnum,
          colorCode: color.code,
          accountKey,
          hint: `${v.year}-${v.make}-${v.model}-${color.simple || color.name || color.code}`,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onPick(json.url);
      toast.success('Vehicle image added');
    } catch (err) {
      toast.error(`Couldn't add image: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setPicking(null);
    }
  }

  // Portal to body so the overlay covers the viewport — a backdrop-blur
  // ancestor (the form cards) otherwise becomes the containing block for
  // `fixed` and traps the modal inside the card.
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-12" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-5 shadow-xl backdrop-blur-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]">
              <TruckIcon className="h-4 w-4 text-[var(--primary)]" />
              Find a vehicle
            </h2>
            <p className="text-xs text-[var(--muted-foreground)]">EVOX transparent-PNG photography. Pick a trim + color to drop it into the ad.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <FontSelect value={year} onChange={setYear} options={yearOptions} previewFont={false} />
          <FontSelect value={make} onChange={setMake} options={makeOptions} previewFont={false} />
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="Model (e.g. F-150)"
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
          <input
            value={trim}
            onChange={(e) => setTrim(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="Trim (optional)"
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
        </div>
        <button
          onClick={search}
          disabled={busy}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <MagnifyingGlassIcon className="h-4 w-4" />
          {busy ? 'Searching…' : 'Search'}
        </button>

        <div className="mt-4 max-h-[50vh] space-y-4 overflow-y-auto">
          {notConfigured && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-xs text-amber-600 dark:text-amber-400">
              EVOX isn’t configured in this environment. Set <span className="font-mono">EVOX_API_KEY</span> to enable the vehicle picker.
            </div>
          )}
          {vehicles && vehicles.length === 0 && !notConfigured && (
            <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">
              No matches — double-check the make/model spelling (EVOX is exact).
            </p>
          )}
          {vehicles?.map((v) => (
            <div key={v.vifnum}>
              <div className="mb-2 text-xs font-semibold text-[var(--foreground)]">
                {v.year} {v.make} {v.model} <span className="font-normal text-[var(--muted-foreground)]">· {v.trim}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {v.colors.map((c) => {
                  const id = `${v.vifnum}-${c.code}`;
                  const isPicking = picking === id;
                  return (
                    <button
                      key={c.code}
                      onClick={() => pick(v, c)}
                      disabled={picking !== null}
                      title={c.name || c.code}
                      className="group relative overflow-hidden rounded-lg border border-[var(--border)] p-1.5 text-left transition-colors hover:border-[var(--primary)] disabled:opacity-60"
                    >
                      <div className="flex h-16 items-center justify-center rounded bg-[var(--muted)]/40">
                        <EvoxColorSwatch vifnum={v.vifnum} color={c} />
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="h-3 w-3 flex-shrink-0 rounded-full border border-[var(--border)]" style={{ background: c.rgb ? `#${c.rgb.replace('#', '')}` : 'transparent' }} />
                        <span className="truncate text-[10px] text-[var(--muted-foreground)]">{c.simple || c.name || c.code}</span>
                      </div>
                      {isPicking && (
                        <div className="absolute inset-0 flex items-center justify-center bg-[var(--card)]/70 text-[10px] font-medium text-[var(--primary)]">Adding…</div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Approximate a display swatch color from an EVOX color's NAME — this product
 *  returns names ("Ice Silver Metallic") but no RGB, so we map keywords to a
 *  representative hex. Falls back to RGB when present, then a neutral chip. */
const COLOR_NAME_HEX: [RegExp, string][] = [
  [/white|ivory|frost/i, '#eceef0'],
  [/black|ebony|obsidian|midnight/i, '#1b1b1e'],
  [/silver|platinum|aluminum|titanium/i, '#c3c8cc'],
  [/gr[ae]y|graphite|magnetite|slate|charcoal|gunmetal|steel/i, '#8b9095'],
  [/red|crimson|scarlet|cardinal|garnet|ruby/i, '#c1201f'],
  [/blue|navy|azure|cobalt|indigo|teal/i, '#1e50a8'],
  [/green|emerald|olive|forest|lime/i, '#2f7d4f'],
  [/yellow|gold|amber/i, '#e3b23c'],
  [/orange|copper|sunset/i, '#d9682a'],
  [/brown|bronze|tan|beige|mocha|espresso|sand/i, '#7c6242'],
  [/purple|violet|plum|magenta/i, '#6a3d9a'],
  [/pink|rose/i, '#dd6a8f'],
];
function colorNameToHex(c: EvoxColor): string {
  if (c.rgb) return `#${c.rgb.replace('#', '')}`;
  const hay = `${c.simple} ${c.name}`;
  for (const [re, hex] of COLOR_NAME_HEX) if (re.test(hay)) return hex;
  return '#cbd5e1';
}

/**
 * Client-facing vehicle color picker. The vehicle itself is already decided by
 * the chosen offer / OEM incentive (it lives in `vehicleName`), so clients
 * never search — they pick from the paint colors EVOX stocks for that vehicle.
 * Picking one resolves the transparent PNG (re-hosted server side) into the ad.
 * We DON'T show the car image here — the live ad preview already reflects it.
 * Until an offer names a vehicle, it shows a gentle hint instead of an empty grid.
 */
function VehicleColorPicker({ vehicleName, selectedCode, onPick }: { vehicleName: string; selectedCode: string; onPick: (url: string, colorCode: string) => void }) {
  const { accountKey } = useAccount();
  // One entry per distinct color NAME, carrying every (vifnum, code) that offers
  // it — the same paint can appear under multiple trims/codes and only some
  // have a rendered image, so we try them in order when the user picks.
  const [swatches, setSwatches] = useState<{ color: EvoxColor; candidates: { vifnum: number; code: string }[] }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);

  // Parse "2026 Honda Accord" → year / make / model (the shape the incentive
  // apply writes). Anything that doesn't match → no vehicle yet.
  const ymm = useMemo(() => {
    const m = vehicleName.trim().match(/^(\d{4})\s+(\S+)\s+(.+)$/);
    return m ? { year: Number(m[1]), make: m[2], model: m[3] } : null;
  }, [vehicleName]);

  useEffect(() => {
    if (!ymm) {
      setSwatches(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setNotConfigured(false);
    fetch('/api/ad-generator/evox/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: ymm.year, make: ymm.make, model: ymm.model }),
    })
      .then((r) => r.json())
      .then((j: { configured?: boolean; vehicles?: EvoxVehicle[] }) => {
        if (cancelled) return;
        if (j.configured === false) {
          setNotConfigured(true);
          setSwatches([]);
          return;
        }
        // Group colors across every returned trim by full color NAME (EVOX
        // repeats a color across trims, and different codes can share a simple
        // label like "Silver"). Keep ALL (vifnum, code) pairs per name so a
        // pick can fall through to a trim that actually has the image.
        const byName = new Map<string, { color: EvoxColor; candidates: { vifnum: number; code: string }[] }>();
        for (const v of j.vehicles ?? []) {
          for (const color of v.colors ?? []) {
            const key = (color.name || color.simple || color.code || '').toLowerCase();
            if (!key) continue;
            const entry = byName.get(key);
            if (entry) entry.candidates.push({ vifnum: v.vifnum, code: color.code });
            else byName.set(key, { color, candidates: [{ vifnum: v.vifnum, code: color.code }] });
          }
        }
        setSwatches([...byName.values()]);
      })
      .catch(() => {
        if (!cancelled) setSwatches([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ymm]);

  async function pickColor(s: { color: EvoxColor; candidates: { vifnum: number; code: string }[] }) {
    const c = s.color;
    setPicking(c.code);
    try {
      // Try each trim/code offering this color until one actually has an image
      // (some EVOX codes for the same paint return no rendered product).
      let picked: { url: string; code: string } | null = null;
      for (const cand of s.candidates) {
        const r = await fetch('/api/ad-generator/evox/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vifnum: cand.vifnum, colorCode: cand.code, accountKey, hint: `${vehicleName}-${c.simple || c.name || c.code}` }),
        });
        if (r.ok) {
          const j = await r.json();
          if (j.url) {
            picked = { url: j.url, code: cand.code };
            break;
          }
        }
      }
      if (!picked) throw new Error('No image available for that color');
      onPick(picked.url, picked.code);
      toast.success('Color updated');
    } catch (err) {
      toast.error(`Couldn't switch color: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setPicking(null);
    }
  }

  return (
    <div>
      {!ymm ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">
          Choose an offer above to load your vehicle, then pick a color.
        </p>
      ) : loading ? (
        <p className="text-xs text-[var(--muted-foreground)]">Loading colors for {vehicleName}…</p>
      ) : notConfigured ? (
        <p className="text-xs text-[var(--muted-foreground)]">Vehicle imagery isn’t available in this environment.</p>
      ) : swatches && swatches.length ? (
        <div className="flex flex-wrap gap-2">
          {swatches.map((s) => {
            const c = s.color;
            const selected = !!selectedCode && s.candidates.some((cand) => cand.code === selectedCode);
            return (
              <button
                key={c.name || c.simple || c.code}
                type="button"
                onClick={() => pickColor(s)}
                disabled={picking !== null}
                title={c.name || c.simple || c.code}
                className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 transition-colors disabled:opacity-60 ${
                  selected ? 'border-[var(--primary)] ring-1 ring-[var(--primary)]' : 'border-[var(--border)] hover:border-[var(--primary)]'
                }`}
              >
                <span
                  className="relative flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-black/10 shadow-inner"
                  style={{ background: colorNameToHex(c) }}
                >
                  {picking === c.code && <span className="text-[9px] font-bold text-white mix-blend-difference">…</span>}
                </span>
                <span className="truncate text-[11px] font-medium text-[var(--foreground)]">{c.name || c.simple || c.code}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-[var(--muted-foreground)]">No stock colors found for {vehicleName}.</p>
      )}
    </div>
  );
}

