'use client';

/**
 * Ad Generator — pick a template, fill a guided form, see a live preview, and
 * download rendered PNGs per size. The preview uses the same pure template
 * function the server renders with, so what you see is what you get.
 *
 * Branding (dealer name, logo variant, brand color) is pulled from the ACTIVE
 * account's settings via useAccount() — never re-entered by hand.
 *
 * Reimagined replacement for the legacy Oz offer builder. Phase 1: code-defined
 * templates + on-demand render/download. Next: save creatives (a Campaign
 * channel), AI copy, and EVOX vehicle imagery.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowDownTrayIcon, SparklesIcon, ClipboardDocumentIcon, ExclamationTriangleIcon, Squares2X2Icon, TruckIcon, XMarkIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { AD_TEMPLATES } from '@/lib/ad-generator/templates';
import { adTemplateFromDoc } from '@/lib/ad-generator/doc-template';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import { buildFontFaceCssFromUrls } from '@/lib/ad-generator/fonts';
import { FontSelect, type FontSelectOption } from '@/components/font-select';
import { isFieldVisible, type AdData, type AdTemplate, type FieldSpec } from '@/lib/ad-generator/types';
import type { AdCopyVariation } from '@/lib/ad-generator/copy-types';
import { composeDisclaimer } from '@/lib/ad-generator/disclaimer';
import { missingRequired, type OemOfferRule } from '@/lib/ad-generator/compliance';
import type { EvoxVehicle, EvoxColor } from '@/lib/integrations/evox';

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
  const { accountKey, accountData } = useAccount();

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
  const templates = useMemo(() => [...AD_TEMPLATES, ...dbTemplates], [dbTemplates]);

  const [templateId, setTemplateId] = useState(AD_TEMPLATES[0].id);
  const template = useMemo(() => templates.find((t) => t.id === templateId) ?? templates[0], [templates, templateId]);

  const [data, setData] = useState<AdData>(() => ({ ...AD_TEMPLATES[0].defaults }));
  const [sizeId, setSizeId] = useState(AD_TEMPLATES[0].sizes[0].id);
  const [busy, setBusy] = useState<string | null>(null);
  const [oemRule, setOemRule] = useState<OemOfferRule | null>(null);

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
  // Page-level @font-face so the dropdown can preview the custom families.
  const pageFontFaceCss = useMemo(() => buildFontFaceCssFromUrls(customFonts), [customFonts]);

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
  const previewFontFaceCss = useMemo(
    () =>
      fontKey && customFonts.some((f) => f.family === fontKey)
        ? buildFontFaceCssFromUrls(customFonts.filter((f) => f.family === fontKey))
        : '',
    [customFonts, fontKey],
  );

  const brandingData: AdData = useMemo(
    () => ({
      ...(accountData?.dealer ? { dealerName: accountData.dealer } : {}),
      ...(logoUrl ? { logoUrl } : {}),
      ...(brandColor ? { brandColor } : {}),
      ...(selectedFontFamily ? { fontFamily: selectedFontFamily, fontFaceCss: previewFontFaceCss } : {}),
    }),
    [accountData?.dealer, logoUrl, brandColor, selectedFontFamily, previewFontFaceCss],
  );

  const size = useMemo(() => template.sizes.find((s) => s.id === sizeId) ?? template.sizes[0], [template, sizeId]);
  const renderData = useMemo(() => ({ ...data, ...brandingData }), [data, brandingData]);

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

  function switchTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setTemplateId(id);
    setData({ ...t.defaults });
    setSizeId(t.sizes[0].id);
  }

  const set = (key: string, value: string) => setData((d) => ({ ...d, [key]: value }));

  async function download(targetSizeId: string) {
    setBusy(targetSizeId);
    try {
      const res = await fetch('/api/ad-generator/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: template.id, sizeId: targetSizeId, accountKey, data: renderData }),
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

  async function downloadAll() {
    for (const s of template.sizes) {
      // eslint-disable-next-line no-await-in-loop
      await download(s.id);
    }
  }

  const scale = Math.min(PREVIEW_W / size.width, PREVIEW_H / size.height);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {pageFontFaceCss && <style dangerouslySetInnerHTML={{ __html: pageFontFaceCss }} />}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--primary)]/10 text-[var(--primary)]">
            <SparklesIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Ad Generator</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Generate on-brand ad creative from a template — preview live, export every size.
            </p>
          </div>
        </div>
        <Link
          href="/tools/ad-generator/builder"
          className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)]"
        >
          <Squares2X2Icon className="h-3.5 w-3.5" />
          Template Builder
        </Link>
      </div>

      {templates.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => switchTemplate(t.id)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                t.id === templateId
                  ? 'border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--primary)]'
                  : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Form */}
        <div className="space-y-6">
          <AiCopyPanel
            template={template}
            renderData={renderData}
            dealerName={accountData?.dealer}
            onApply={(fields) => setData((d) => ({ ...d, ...fields }))}
          />

          {/* Branding — from the active account */}
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

          {groups.map(([group, fields]) => (
            <section key={group} className="glass-card rounded-2xl border border-[var(--border)] p-5">
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{group}</h2>
              <div className="space-y-4">
                {fields.map((f) =>
                  f.key === 'disclaimer' ? (
                    <DisclaimerField
                      key={f.key}
                      field={f}
                      renderData={renderData}
                      value={data.disclaimer ?? ''}
                      onChange={(v) => set('disclaimer', v)}
                    />
                  ) : (
                    <Field key={f.key} field={f} value={data[f.key] ?? ''} onChange={(v) => set(f.key, v)} />
                  ),
                )}
              </div>
            </section>
          ))}
        </div>

        {/* Preview + export */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="glass-card rounded-2xl border border-[var(--border)] p-5">
            <div className="mb-4 flex flex-wrap gap-1.5">
              {template.sizes.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSizeId(s.id)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    s.id === sizeId ? 'bg-[var(--primary)] text-white' : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)]'
                  }`}
                >
                  {s.label.split(' ')[0]}
                </button>
              ))}
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

            <p className="mt-2 text-center text-[11px] text-[var(--muted-foreground)]">
              {size.width}×{size.height}px
            </p>

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
                {busy ? 'Rendering…' : `Download all ${template.sizes.length} sizes`}
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

const TONES = [
  { value: '', label: 'On-brand (default)' },
  { value: 'bold', label: 'Bold' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'luxury', label: 'Luxury' },
];

/**
 * "Write with AI" — generates marketing copy for the template's `copy` fields
 * plus Meta/Google captions. Renders nothing if the template declares no copy
 * fields, so it lights up automatically for any (incl. future data-driven)
 * template that marks fields as copy.
 */
function AiCopyPanel({
  template,
  renderData,
  dealerName,
  onApply,
}: {
  template: AdTemplate;
  renderData: AdData;
  dealerName?: string;
  onApply: (fields: Record<string, string>) => void;
}) {
  const copyFields = useMemo(() => template.fields.filter((f) => f.copy), [template]);
  const [brief, setBrief] = useState('');
  const [tone, setTone] = useState('');
  const [busy, setBusy] = useState(false);
  const [variations, setVariations] = useState<AdCopyVariation[] | null>(null);

  async function generate() {
    setBusy(true);
    try {
      const res = await fetch('/api/ad-generator/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: template.id, data: renderData, dealerName, tone, brief }),
      });
      if (!res.ok) {
        const msg = (await res.json().catch(() => null))?.error || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const json = (await res.json()) as { variations: AdCopyVariation[] };
      setVariations(json.variations);
      if (!json.variations.length) toast.error('No copy came back — try again.');
    } catch (err) {
      toast.error(`Couldn't write copy: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  if (copyFields.length === 0) return null;

  return (
    <section className="glass-card rounded-2xl border border-[var(--border)] p-5">
      <div className="mb-2 flex items-center gap-2">
        <SparklesIcon className="h-4 w-4 text-[var(--primary)]" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Write with AI</h2>
      </div>
      <p className="mb-3 text-xs text-[var(--muted-foreground)]">
        Writes the marketing copy + Meta/Google captions from your offer details. Prices, terms, and the disclaimer stay exactly as you set them.
      </p>
      <textarea
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        rows={2}
        placeholder="Optional brief — e.g. “year-end clearance, emphasize the low payment”"
        className="mb-2 w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
      />
      <div className="flex items-center gap-2">
        <FontSelect
          value={tone}
          onChange={setTone}
          options={TONES}
          previewFont={false}
          className="w-44 flex-shrink-0"
        />
        <button
          onClick={generate}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <SparklesIcon className="h-4 w-4" />
          {busy ? 'Writing…' : variations ? 'Regenerate' : 'Write with AI'}
        </button>
      </div>

      {variations && variations.length > 0 && (
        <div className="mt-4 space-y-3">
          {variations.map((v, i) => (
            <AiVariationCard
              key={i}
              index={i}
              variation={v}
              copyFields={copyFields}
              onApply={() => {
                onApply(v.fields);
                toast.success(`Applied option ${i + 1}`);
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function AiVariationCard({
  index,
  variation,
  copyFields,
  onApply,
}: {
  index: number;
  variation: AdCopyVariation;
  copyFields: FieldSpec[];
  onApply: () => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Option {index + 1}</span>
        <button
          onClick={onApply}
          className="rounded-md bg-[var(--primary)]/10 px-2 py-1 text-[11px] font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/20"
        >
          Apply to ad
        </button>
      </div>
      <div className="space-y-1">
        {copyFields.map((f) => (
          <div key={f.key} className="flex gap-2 text-xs">
            <span className="w-20 flex-shrink-0 text-[var(--muted-foreground)]">{f.label}</span>
            <span className="font-medium text-[var(--foreground)]">{variation.fields[f.key] || '—'}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 border-t border-[var(--border)] pt-2 sm:grid-cols-2">
        <CaptionBlock
          label="Meta"
          lines={[
            ['Primary', variation.meta.primaryText],
            ['Headline', variation.meta.headline],
            ['Desc', variation.meta.description],
          ]}
        />
        <CaptionBlock
          label="Google"
          lines={[
            ...variation.google.headlines.map((h, i) => [`H${i + 1}`, h] as [string, string]),
            ...variation.google.descriptions.map((d, i) => [`D${i + 1}`, d] as [string, string]),
          ]}
        />
      </div>
    </div>
  );
}

function CaptionBlock({ label, lines }: { label: string; lines: [string, string][] }) {
  const visible = lines.filter(([, v]) => v);
  if (!visible.length) return null;
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{label}</div>
      <div className="space-y-0.5">
        {visible.map(([k, v], i) => (
          <button
            key={i}
            type="button"
            title="Click to copy"
            onClick={() => {
              navigator.clipboard?.writeText(v);
              toast.success('Copied');
            }}
            className="group flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left text-[11px] text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/50"
          >
            <span className="w-10 flex-shrink-0 text-[var(--muted-foreground)]">{k}</span>
            <span className="flex-1 break-words">{v}</span>
            <ClipboardDocumentIcon className="h-3 w-3 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
          </button>
        ))}
      </div>
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
}: {
  field: FieldSpec;
  renderData: AdData;
  value: string;
  onChange: (v: string) => void;
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

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <label className="block text-xs font-medium text-[var(--foreground)]">
            Disclaimer template
            <span className="ml-1 font-normal text-[var(--muted-foreground)]">— auto-fills the text below</span>
          </label>
          <Link href="/tools/ad-generator/templates" className="flex-shrink-0 text-[11px] font-medium text-[var(--primary)] hover:underline">
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

function Field({ field, value, onChange }: { field: FieldSpec; value: string; onChange: (v: string) => void }) {
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
    return <ImageField field={field} value={value} onChange={onChange} />;
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
 * Image field with a URL input + a "Pick a vehicle" button that opens the EVOX
 * picker. Picking a vehicle/color re-hosts the transparent PNG on our S3 and
 * drops the stable URL into the field.
 */
function ImageField({ field, value, onChange }: { field: FieldSpec; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
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
          onClick={() => setOpen(true)}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)]"
        >
          <TruckIcon className="h-4 w-4" />
          Vehicle
        </button>
      </div>
      {value && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="mt-2 h-20 rounded-md border border-[var(--border)] bg-[var(--muted)]/40 object-contain p-1" />
      )}
      {open && <EvoxPickerModal onClose={() => setOpen(false)} onPick={(url) => { onChange(url); setOpen(false); }} />}
    </div>
  );
}

/** EVOX vehicle picker: search Year/Make/Model → pick a trim + color → image. */
function EvoxPickerModal({ onClose, onPick }: { onClose: () => void; onPick: (url: string) => void }) {
  const { accountKey } = useAccount();
  const [year, setYear] = useState(String(EVOX_CURRENT_YEAR));
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [trim, setTrim] = useState('');
  const [busy, setBusy] = useState(false);
  const [vehicles, setVehicles] = useState<EvoxVehicle[] | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);

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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
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
                        {c.thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.thumbUrl} alt={c.name} className="max-h-full max-w-full object-contain" />
                        ) : (
                          <span className="h-6 w-6 rounded-full border border-[var(--border)]" style={{ background: c.rgb ? `#${c.rgb.replace('#', '')}` : '#cbd5e1' }} />
                        )}
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
    </div>
  );
}
