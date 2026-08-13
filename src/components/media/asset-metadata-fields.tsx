'use client';

import { useMemo } from 'react';
import { Select } from '@/components/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { HelpTip } from '@/components/ui/help-tip';
import { MAJOR_US_OEMS, POWERSPORTS_BRANDS } from '@/lib/oems';
import { ASSET_CATEGORIES, ASSET_SOURCES } from '@/lib/media-metadata';
import { LICENSE_TYPES, USAGE_SCOPES } from '@/lib/media-rights';

/**
 * The DAM metadata a person edits on an asset — Phase 1 of
 * docs/asset-management.md.
 *
 * Extracted rather than inlined into the media page because the same panel is
 * wanted in two places (the edit modal now, the upload sheet next) and that page
 * is already ~3k lines.
 *
 * Every classification field is a controlled dropdown, never free text. The one
 * exception is `rightsHolder`, which is a legal entity name that no list can
 * enumerate ahead of time.
 *
 * `vehicleModel` is carried through the value type and the API but is NOT
 * rendered yet: its controlled vocabulary comes from MarketCheck, and offering a
 * free-text box in the meantime would seed exactly the inconsistent values the
 * vocabulary exists to prevent. It arrives with the Phase 2 facets.
 */

export interface AssetMetadataValue {
  oem: string;
  assetSource: string;
  assetCategory: string;
  modelYear: string[];
  vehicleModel: string[];
  rightsHolder: string;
  tags: string[];

  // ── Rights (Phase 3) ──
  licenseType: string;
  licenseRef: string;
  /** `yyyy-mm-dd`, the value an <input type="date"> holds. '' = unset. */
  licenseStartsAt: string;
  licenseExpiresAt: string;
  expiresAt: string;
  usageScope: string[];
  territoryScope: string[];
  /** Tri-state: '' = not recorded, which is not the same as 'no'. */
  derivativesPermitted: string;
  sublicensingPermitted: string;
}

export const EMPTY_ASSET_METADATA: AssetMetadataValue = {
  oem: '',
  assetSource: '',
  assetCategory: '',
  modelYear: [],
  vehicleModel: [],
  rightsHolder: '',
  tags: [],
  licenseType: '',
  licenseRef: '',
  licenseStartsAt: '',
  licenseExpiresAt: '',
  expiresAt: '',
  usageScope: [],
  territoryScope: [],
  derivativesPermitted: '',
  sublicensingPermitted: '',
};

/** ISO timestamp → the `yyyy-mm-dd` an <input type="date"> expects. */
function toDateInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** '' | 'true' | 'false' → null | true | false. */
function fromTriState(v: string): boolean | null {
  return v === '' ? null : v === 'true';
}

function toTriState(v?: boolean | null): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Build the editable value from an API asset payload. */
export function assetMetadataFrom(file: {
  oem?: string | null;
  assetSource?: string | null;
  assetCategory?: string | null;
  modelYear?: string[] | null;
  vehicleModel?: string[] | null;
  rightsHolder?: string | null;
  tags?: string[] | null;
  licenseType?: string | null;
  licenseRef?: string | null;
  licenseStartsAt?: string | null;
  licenseExpiresAt?: string | null;
  expiresAt?: string | null;
  usageScope?: string[] | null;
  territoryScope?: string[] | null;
  derivativesPermitted?: boolean | null;
  sublicensingPermitted?: boolean | null;
}): AssetMetadataValue {
  return {
    oem: file.oem ?? '',
    assetSource: file.assetSource ?? '',
    assetCategory: file.assetCategory ?? '',
    modelYear: file.modelYear ?? [],
    vehicleModel: file.vehicleModel ?? [],
    rightsHolder: file.rightsHolder ?? '',
    tags: file.tags ?? [],
    licenseType: file.licenseType ?? '',
    licenseRef: file.licenseRef ?? '',
    licenseStartsAt: toDateInput(file.licenseStartsAt),
    licenseExpiresAt: toDateInput(file.licenseExpiresAt),
    expiresAt: toDateInput(file.expiresAt),
    usageScope: file.usageScope ?? [],
    territoryScope: file.territoryScope ?? [],
    derivativesPermitted: toTriState(file.derivativesPermitted),
    sublicensingPermitted: toTriState(file.sublicensingPermitted),
  };
}

/**
 * The fields that actually changed, as a sparse PATCH body.
 *
 * Empty string and empty array both serialize to null — "cleared" — which is
 * what the API's `'' → null` handling expects. Returning only changed keys is
 * what stops an edit of the filename from also rewriting seven metadata columns.
 */
export function assetMetadataDiff(
  next: AssetMetadataValue,
  prev: AssetMetadataValue,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const sameList = (a: string[], b: string[]) =>
    a.length === b.length && a.every((v, i) => v === b[i]);

  if (next.oem !== prev.oem) body.oem = next.oem || null;
  if (next.assetSource !== prev.assetSource) body.assetSource = next.assetSource || null;
  if (next.assetCategory !== prev.assetCategory) body.assetCategory = next.assetCategory || null;
  if (next.rightsHolder.trim() !== prev.rightsHolder.trim()) {
    body.rightsHolder = next.rightsHolder.trim() || null;
  }
  if (!sameList(next.modelYear, prev.modelYear)) body.modelYear = next.modelYear;
  if (!sameList(next.vehicleModel, prev.vehicleModel)) body.vehicleModel = next.vehicleModel;
  if (!sameList(next.tags, prev.tags)) body.tags = next.tags;

  // ── Rights ──
  if (next.licenseType !== prev.licenseType) body.licenseType = next.licenseType || null;
  if (next.licenseRef.trim() !== prev.licenseRef.trim()) body.licenseRef = next.licenseRef.trim() || null;
  if (!sameList(next.usageScope, prev.usageScope)) body.usageScope = next.usageScope;
  if (!sameList(next.territoryScope, prev.territoryScope)) body.territoryScope = next.territoryScope;
  if (next.derivativesPermitted !== prev.derivativesPermitted) {
    body.derivativesPermitted = fromTriState(next.derivativesPermitted);
  }
  if (next.sublicensingPermitted !== prev.sublicensingPermitted) {
    body.sublicensingPermitted = fromTriState(next.sublicensingPermitted);
  }
  // Dates go up as ISO at UTC midnight. A date input has no timezone, and
  // sending the browser's local midnight would shift the day for anyone west of
  // UTC — an asset expiring "on the 31st" must not lapse on the 30th.
  for (const key of ['licenseStartsAt', 'licenseExpiresAt', 'expiresAt'] as const) {
    if (next[key] === prev[key]) continue;
    body[key] = next[key] ? new Date(`${next[key]}T00:00:00.000Z`).toISOString() : null;
  }

  return body;
}

/**
 * The whole value as `FormData` fields, for the upload path.
 *
 * Distinct from `assetMetadataDiff`, which is sparse because PATCH must not
 * touch what the user didn't change. On upload there is nothing to preserve, so
 * every non-empty field goes up.
 *
 * This exists because the upload modal previously forwarded a hand-written list
 * of six fields while rendering fifteen — so everything the Rights section
 * collected was silently dropped. Deriving the payload from the value type means
 * a field added to the form cannot go missing from the request.
 */
export function assetMetadataToFormFields(v: AssetMetadataValue): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: string, val: string) => { if (val) out[k] = val; };

  put('oem', v.oem);
  put('assetSource', v.assetSource);
  put('assetCategory', v.assetCategory);
  put('rightsHolder', v.rightsHolder);
  put('modelYear', v.modelYear.join(','));
  put('vehicleModel', v.vehicleModel.join(','));
  put('tags', v.tags.join(','));

  put('licenseType', v.licenseType);
  put('licenseRef', v.licenseRef);
  put('usageScope', v.usageScope.join(','));
  put('territoryScope', v.territoryScope.join(','));
  put('derivativesPermitted', v.derivativesPermitted);
  put('sublicensingPermitted', v.sublicensingPermitted);

  // UTC midnight, matching assetMetadataDiff — a date input carries no timezone,
  // and local midnight would shift the day for anyone west of UTC.
  for (const key of ['licenseStartsAt', 'licenseExpiresAt', 'expiresAt'] as const) {
    if (v[key]) out[key] = new Date(`${v[key]}T00:00:00.000Z`).toISOString();
  }

  return out;
}

/** Model years offered: this year back four, forward two. */
function modelYearOptions(): { value: string; label: string }[] {
  const current = new Date().getFullYear();
  const years: string[] = [];
  for (let y = current + 2; y >= current - 4; y--) years.push(String(y));
  return years.map((y) => ({ value: y, label: y }));
}

/**
 * Not-recorded / yes / no. Three options, not a checkbox: a permission nobody
 * has confirmed is different from one that was checked and refused, and a
 * two-state control silently asserts the second.
 */
const TRI_STATE_OPTIONS = [
  { value: '', label: 'Not recorded' },
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];

const FIELD_LABEL = 'flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] mb-2';
const TEXT_INPUT =
  'w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)]';

export function AssetMetadataFields({
  value,
  onChange,
  /** Brands to offer first — usually the account's own. */
  accountBrands = [],
  disabled = false,
}: {
  value: AssetMetadataValue;
  onChange: (next: AssetMetadataValue) => void;
  accountBrands?: string[];
  disabled?: boolean;
}) {
  const set = <K extends keyof AssetMetadataValue>(key: K, v: AssetMetadataValue[K]) =>
    onChange({ ...value, [key]: v });

  // The account's own brands float to the top: a Ford rooftop's uploader should
  // not scroll past forty marques to reach Ford.
  const oemOptions = useMemo(() => {
    const all = [...MAJOR_US_OEMS, ...POWERSPORTS_BRANDS];
    const preferred = accountBrands.filter((b) => all.includes(b as never));
    const rest = all.filter((b) => !preferred.includes(b));
    return [
      { value: '', label: 'None' },
      ...preferred.map((b) => ({ value: b, label: b })),
      ...rest.map((b) => ({ value: b, label: b })),
    ];
  }, [accountBrands]);

  const years = useMemo(modelYearOptions, []);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={FIELD_LABEL}>
            Brand
            <HelpTip title="Brand">
              <p>
                The manufacturer this asset belongs to. Setting it on an asset in the
                Loomi library makes it available to every sub-account that carries the
                brand, instead of being uploaded once per rooftop.
              </p>
            </HelpTip>
          </label>
          <Select
            value={value.oem}
            onChange={(v) => set('oem', v)}
            options={oemOptions}
            previewFont={false}
            placeholder="None"
          />
        </div>

        <div>
          <label className={FIELD_LABEL}>
            Asset type
            <HelpTip title="Asset type">
              <p>
                What kind of asset this is. Used to filter the library — a designer
                looking for email templates shouldn&apos;t have to scroll past display
                banners.
              </p>
            </HelpTip>
          </label>
          <Select
            value={value.assetCategory}
            onChange={(v) => set('assetCategory', v)}
            options={[{ value: '', label: 'Unset' }, ...ASSET_CATEGORIES.map((c) => ({ ...c }))]}
            previewFont={false}
            placeholder="Unset"
          />
        </div>

        <div>
          <label className={FIELD_LABEL}>
            Source
            <HelpTip title="Source">
              <p>Where this asset came from. Drives the badge on the asset card.</p>
              <p className="mt-2">
                OEM-supplied assets usually carry the manufacturer&apos;s licence terms
                — record the rights holder alongside it.
              </p>
            </HelpTip>
          </label>
          <Select
            value={value.assetSource}
            onChange={(v) => set('assetSource', v)}
            options={[{ value: '', label: 'Unset' }, ...ASSET_SOURCES.map((s) => ({ ...s }))]}
            previewFont={false}
            placeholder="Unset"
          />
        </div>

        <div>
          <label className={FIELD_LABEL}>
            Rights holder
            <HelpTip title="Rights holder">
              <p>
                Who owns the rights, e.g. &ldquo;Audi of America&rdquo;. Free text —
                licence windows and expiry tracking come later.
              </p>
            </HelpTip>
          </label>
          <input
            type="text"
            value={value.rightsHolder}
            onChange={(e) => set('rightsHolder', e.target.value)}
            placeholder="e.g. Audi of America"
            disabled={disabled}
            className={TEXT_INPUT}
          />
        </div>
      </div>

      <div>
        <label className={FIELD_LABEL}>
          Model year
          <HelpTip title="Model year">
            <p>
              Pick every year this asset covers. An OEM package built for
              &ldquo;MY25/MY26&rdquo; is valid for both — selecting only one loses that.
            </p>
          </HelpTip>
        </label>
        <MultiSelect
          value={value.modelYear}
          onChange={(v) => set('modelYear', v)}
          options={years}
          placeholder="Any model year"
          menuZIndex={200}
        />
      </div>

      <div>
        <label className={FIELD_LABEL}>
          Keywords
          <HelpTip title="Keywords">
            <p>
              Free-form tags for search. Prefer an existing keyword over a new
              near-duplicate — &ldquo;summer-event&rdquo; and &ldquo;summer event&rdquo;
              are two different tags and neither will find the other.
            </p>
          </HelpTip>
        </label>
        <input
          type="text"
          value={value.tags.join(', ')}
          onChange={(e) =>
            set(
              'tags',
              e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
            )
          }
          placeholder="Comma-separated, e.g. lease, q3, launch"
          disabled={disabled}
          className={TEXT_INPUT}
        />
      </div>

      {/* ── Rights ── */}
      <div className="pt-3 border-t border-[var(--border)]">
        <h4 className="text-sm font-semibold mb-3">Rights</h4>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={FIELD_LABEL}>
              Licence type
              <HelpTip title="Licence type">
                <p>
                  How this asset is licensed. Leave unset if you genuinely
                  don&apos;t know — that reads as an open question, which is more
                  useful than a guess.
                </p>
              </HelpTip>
            </label>
            <Select
              value={value.licenseType}
              onChange={(v) => set('licenseType', v)}
              options={[{ value: '', label: 'Not recorded' }, ...LICENSE_TYPES.map((t) => ({ ...t }))]}
              previewFont={false}
              placeholder="Not recorded"
            />
          </div>

          <div>
            <label className={FIELD_LABEL}>
              Agreement reference
              <HelpTip title="Agreement reference">
                <p>
                  Whatever the counterparty calls it, e.g.
                  &ldquo;Ford-2026-lifestyle-Q3&rdquo;. Free text — it&apos;s how
                  you&apos;d find the paperwork.
                </p>
              </HelpTip>
            </label>
            <input
              type="text"
              value={value.licenseRef}
              onChange={(e) => set('licenseRef', e.target.value)}
              placeholder="e.g. Ford-2026-lifestyle-Q3"
              disabled={disabled}
              className={TEXT_INPUT}
            />
          </div>

          <div>
            <label className={FIELD_LABEL}>Licence starts</label>
            <input
              type="date"
              value={value.licenseStartsAt}
              onChange={(e) => set('licenseStartsAt', e.target.value)}
              disabled={disabled}
              className={TEXT_INPUT}
            />
          </div>

          <div>
            <label className={FIELD_LABEL}>
              Licence expires
              <HelpTip title="Licence expiry">
                <p>
                  When the right to use this asset ends. A daily sweep warns 30
                  days out, again at 7, and marks it out of licence when it passes.
                </p>
              </HelpTip>
            </label>
            <input
              type="date"
              value={value.licenseExpiresAt}
              onChange={(e) => set('licenseExpiresAt', e.target.value)}
              disabled={disabled}
              className={TEXT_INPUT}
            />
          </div>
        </div>

        <div className="mt-4">
          <label className={FIELD_LABEL}>
            Campaign/offer ends
            <HelpTip title="Campaign end">
              <p>
                When the offer or campaign this asset supports finishes. Separate
                from the licence: an asset routinely outlives the deal it
                advertised, and the reverse.
              </p>
              <p className="mt-2">Whichever date comes first is the one that retires it.</p>
            </HelpTip>
          </label>
          <input
            type="date"
            value={value.expiresAt}
            onChange={(e) => set('expiresAt', e.target.value)}
            disabled={disabled}
            className={TEXT_INPUT}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <label className={FIELD_LABEL}>
              Usage
              <HelpTip title="Usage scope">
                <p>Which channels the licence covers.</p>
              </HelpTip>
            </label>
            <MultiSelect
              value={value.usageScope}
              onChange={(v) => set('usageScope', v)}
              options={USAGE_SCOPES.map((u) => ({ value: u.value, label: u.label }))}
              placeholder="Any"
              menuZIndex={200}
            />
          </div>

          <div>
            <label className={FIELD_LABEL}>
              Territory
              <HelpTip title="Territory">
                <p>
                  Where it&apos;s cleared for use, e.g. Utah, Idaho, National.
                  Free text for now — OEM territory assignments don&apos;t fit a
                  fixed list.
                </p>
              </HelpTip>
            </label>
            <input
              type="text"
              value={value.territoryScope.join(', ')}
              onChange={(e) =>
                set('territoryScope', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))
              }
              placeholder="e.g. Utah, Idaho"
              disabled={disabled}
              className={TEXT_INPUT}
            />
          </div>

          <div>
            <label className={FIELD_LABEL}>
              Derivatives allowed
              <HelpTip title="Derivative works">
                <p>
                  Whether the licence permits resizing, cropping or compositing
                  this asset.
                </p>
                <p className="mt-2">
                  The one rights field automated generation has to respect —
                  compositing an asset that forbids it is a breach nobody catches
                  by eye.
                </p>
              </HelpTip>
            </label>
            <Select
              value={value.derivativesPermitted}
              onChange={(v) => set('derivativesPermitted', v)}
              options={TRI_STATE_OPTIONS}
              previewFont={false}
              placeholder="Not recorded"
            />
          </div>

          <div>
            <label className={FIELD_LABEL}>
              Sublicensing allowed
              <HelpTip title="Sublicensing">
                <p>Whether Oz can extend usage rights to a client or third party.</p>
              </HelpTip>
            </label>
            <Select
              value={value.sublicensingPermitted}
              onChange={(v) => set('sublicensingPermitted', v)}
              options={TRI_STATE_OPTIONS}
              previewFont={false}
              placeholder="Not recorded"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
