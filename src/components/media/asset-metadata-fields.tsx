'use client';

import { useMemo } from 'react';
import { Select } from '@/components/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { HelpTip } from '@/components/ui/help-tip';
import { MAJOR_US_OEMS, POWERSPORTS_BRANDS } from '@/lib/oems';
import { ASSET_CATEGORIES, ASSET_SOURCES } from '@/lib/media-metadata';

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
}

export const EMPTY_ASSET_METADATA: AssetMetadataValue = {
  oem: '',
  assetSource: '',
  assetCategory: '',
  modelYear: [],
  vehicleModel: [],
  rightsHolder: '',
  tags: [],
};

/** Build the editable value from an API asset payload. */
export function assetMetadataFrom(file: {
  oem?: string | null;
  assetSource?: string | null;
  assetCategory?: string | null;
  modelYear?: string[] | null;
  vehicleModel?: string[] | null;
  rightsHolder?: string | null;
  tags?: string[] | null;
}): AssetMetadataValue {
  return {
    oem: file.oem ?? '',
    assetSource: file.assetSource ?? '',
    assetCategory: file.assetCategory ?? '',
    modelYear: file.modelYear ?? [],
    vehicleModel: file.vehicleModel ?? [],
    rightsHolder: file.rightsHolder ?? '',
    tags: file.tags ?? [],
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

  return body;
}

/** Model years offered: this year back four, forward two. */
function modelYearOptions(): { value: string; label: string }[] {
  const current = new Date().getFullYear();
  const years: string[] = [];
  for (let y = current + 2; y >= current - 4; y--) years.push(String(y));
  return years.map((y) => ({ value: y, label: y }));
}

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
    </div>
  );
}
