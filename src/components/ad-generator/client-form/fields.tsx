'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { PhotoIcon, TruckIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { MediaPickerModal } from '@/components/media-picker-modal';
import { Select, type SelectOption } from '@/components/select';
import { composeDisclaimer } from '@/lib/ad-generator/disclaimer';
import type { AdData, FieldSpec } from '@/lib/ad-generator/types';
import { EvoxPickerModal } from './evox-picker';

/**
 * Per-offer-type pill colours. Identity, not severity — one hue per type.
 *
 * The selected label's colour comes from `--offer-pill-ink`, set per theme in
 * globals.css, NOT from a `dark:` utility. Tailwind's `dark:` variant is not
 * wired to this app's `[data-theme]` switch — it still follows the OS — so on a
 * dark OS with the light theme chosen, `dark:text-emerald-300` won and the
 * selected pill washed out against its own tint. See the note by the
 * `.offer-pill-on` rule.
 */
const OFFER_TYPE_TONE: Record<string, { on: string; off: string }> = {
  lease: {
    on: 'offer-pill-on border-indigo-500 bg-indigo-500/15 [--offer-pill-ink:var(--pill-ink-indigo)]',
    off: 'hover:border-indigo-400/60 hover:text-indigo-600',
  },
  apr: {
    on: 'offer-pill-on border-emerald-500 bg-emerald-500/15 [--offer-pill-ink:var(--pill-ink-emerald)]',
    off: 'hover:border-emerald-400/60 hover:text-emerald-600',
  },
  discount: {
    on: 'offer-pill-on border-amber-500 bg-amber-500/15 [--offer-pill-ink:var(--pill-ink-amber)]',
    off: 'hover:border-amber-400/60 hover:text-amber-600',
  },
  sales_price: {
    on: 'offer-pill-on border-sky-500 bg-sky-500/15 [--offer-pill-ink:var(--pill-ink-sky)]',
    off: 'hover:border-sky-400/60 hover:text-sky-600',
  },
  custom: {
    on: 'border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--foreground)]',
    off: 'hover:border-[var(--primary)]/60 hover:text-[var(--foreground)]',
  },
};

export function Field({ field, value, onChange, allowVehiclePicker, evoxSeed }: { field: FieldSpec; value: string; onChange: (v: string) => void; allowVehiclePicker?: boolean; evoxSeed?: { year?: string; make?: string; model?: string } }) {
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
  // Offer type decides what every other field on the form MEANS, so it reads as
  // a set of choices rather than one more dropdown that looks like an input. The
  // colours are just identity — each type keeps the same hue everywhere — not a
  // severity scale.
  if (field.type === 'select' && field.key === 'offerType') {
    return (
      <div>
        {label}
        <div role="radiogroup" aria-label={field.label} className="flex flex-wrap gap-1.5">
          {(field.options ?? []).map((o) => {
            const on = value === o.value;
            const tone = OFFER_TYPE_TONE[o.value] ?? OFFER_TYPE_TONE.custom;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange(o.value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  on ? tone.on : `border-[var(--border)] text-[var(--muted-foreground)] ${tone.off}`
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (field.type === 'select') {
    return (
      <div>
        {label}
        <Select value={value} onChange={onChange} options={field.options ?? []} previewFont={false} />
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
export function ImageField({ field, value, onChange, allowVehiclePicker, evoxSeed }: { field: FieldSpec; value: string; onChange: (v: string) => void; allowVehiclePicker?: boolean; evoxSeed?: { year?: string; make?: string; model?: string } }) {
  const { accountKey } = useAccount();
  const [open, setOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  // Source is designer-declared per field. `evox` shows only the vehicle
  // picker; `both` shows manual inputs + the picker; `manual` (default) shows
  // just the manual inputs. Legacy automotive templates still get EVOX via
  // `allowVehiclePicker` even when the field predates the `imageSource` flag.
  const src = field.imageSource ?? 'manual';
  const evoxAllowed = allowVehiclePicker || src === 'evox' || src === 'both';
  const manualAllowed = src !== 'evox';
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">
        {field.label}
        {field.help && <span className="ml-1 font-normal text-[var(--muted-foreground)]">— {field.help}</span>}
      </label>
      <div className="flex gap-2">
        {manualAllowed && (
          <input
            type="text"
            value={value}
            placeholder={field.placeholder || 'Image URL'}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
        )}
        {manualAllowed && (
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            title="Pick from the media library"
            className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)]"
          >
            <PhotoIcon className="h-4 w-4" />
            Library
          </button>
        )}
        {/* EVOX vehicle photography — designer-enabled per field (or legacy
            automotive templates). Full-width when it's the only picker. */}
        {evoxAllowed && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`flex flex-shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)] ${manualAllowed ? '' : 'w-full flex-shrink'}`}
          >
            <TruckIcon className="h-4 w-4" />
            {manualAllowed ? 'Vehicle' : 'Choose vehicle image'}
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
export function DisclaimerField({
  field,
  renderData,
  offerKind,
  make,
  value,
  onChange,
  readOnly = false,
  previewStyle,
}: {
  field: FieldSpec;
  renderData: AdData;
  /** The doc's offer kind — decides the fee boilerplate and the fallback body
   *  while `renderData.offerType` is still empty. See `TokenOptions.offerKind`. */
  offerKind?: string;
  /** OEM/make (vehicle make → account OEM) so make-specific disclaimer
   *  templates (e.g. Subaru, Kia) surface in the picker alongside the globals. */
  make?: string;
  value: string;
  onChange: (v: string) => void;
  /** Clients can't override the disclaimer — it still auto-fills, but shows
   *  read-only (only admins & up can edit/override). */
  readOnly?: boolean;
  /** Inline styles derived from the disclaimer element so the read-only preview
   *  reflects the ad's actual look (font / color / alignment) instead of chrome. */
  previewStyle?: CSSProperties;
}) {
  const offerType = renderData.offerType || 'custom';
  const [templates, setTemplates] = useState<DisclaimerTemplateOption[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const editedRef = useRef(false);
  // Set when the user picks a template to override an OEM offer's disclaimer.
  const [override, setOverride] = useState(false);

  const makeParam = (make || renderData._vehMake || '').trim();
  useEffect(() => {
    let cancelled = false;
    const q = `offerType=${encodeURIComponent(offerType)}${makeParam ? `&make=${encodeURIComponent(makeParam)}` : ''}`;
    fetch(`/api/ad-generator/disclaimer-templates?${q}`)
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
  }, [offerType, makeParam]);

  const tmpl = templates.find((t) => t.id === selectedId);
  // A selected MarketCheck OEM offer stashes its authoritative fine print in
  // `_oemDisclaimerText` — used verbatim (boilerplate + VIN/Stock still appended)
  // unless the user overrides by picking a template.
  const oemRaw = renderData._oemDisclaimer && !override ? renderData._oemDisclaimerText || undefined : undefined;
  const composed = composeDisclaimer(renderData, tmpl?.body, oemRaw, { offerKind });

  // When a new OEM offer is applied (`_oemDisclaimer` changes), let its disclaimer
  // take over again — drop any prior template override / manual-edit opt-out.
  useEffect(() => {
    setOverride(false);
    editedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderData._oemDisclaimer]);

  // Auto-fill the disclaimer whenever the composed result changes (offer / VIN
  // / Stock# / template edits) — unless the user has typed their own text.
  useEffect(() => {
    if (!editedRef.current && composed !== value) onChange(composed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composed]);

  const templateOptions: SelectOption[] = [
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
        <div
          className={`w-full whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2${previewStyle ? '' : ' text-xs leading-snug text-[var(--muted-foreground)]'}`}
          style={previewStyle}
        >
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
          <Link href="/settings/ad-disclaimers" className="flex-shrink-0 text-[11px] font-medium text-[var(--primary)] hover:underline">
            Manage
          </Link>
        </div>
        <Select
          value={selectedId}
          onChange={(v) => {
            editedRef.current = false; // re-selecting a template re-binds auto-fill
            setOverride(true); // ...and overrides an OEM-supplied disclaimer
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
export function evoxSeedFor(key: string, data: AdData): { year?: string; make?: string; model?: string } {
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
