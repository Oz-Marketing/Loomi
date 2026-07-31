import Papa from 'papaparse';

/**
 * Dealer inventory ingestion — Vehicle Listing Ads (VLA) feeds.
 *
 * Despite being described (and URL'd) as XML, the Young feeds serve
 * `text/csv` in the Google/Meta VLA product schema. So this parses CSV, and
 * everything schema-specific is expressed as a MAPPING rather than as code —
 * the variance across inventory providers is entirely in field naming, and the
 * second and third feed formats are where the real cost lands. Adding a
 * provider should be config, not a code change.
 *
 * Feeds are a weaker contract than an API: the file can change shape, arrive
 * truncated, or go stale for a week without ever erroring. Nothing here throws
 * on a bad ROW — malformed rows are collected as issues and the rest of the
 * file still lands, so one broken vehicle can't cost a dealer a whole sync.
 */

/** Source column names for each normalized field. */
export interface VlaFieldMapping {
  vin: string;
  stockNumber: string;
  year: string;
  make: string;
  model: string;
  trim: string;
  condition: string;
  certified: string;
  price: string;
  msrp: string;
  color: string;
  mileage: string;
  title: string;
  description: string;
  detailUrl: string;
  storeCode: string;
  bodyStyle: string;
  /** Columns holding image URLs, in preference order. */
  images: string[];
}

/** The Google/Meta VLA product schema, as served by the Young feeds. */
export const DEFAULT_VLA_MAPPING: VlaFieldMapping = {
  vin: 'VIN',
  stockNumber: 'id',
  year: 'year',
  make: 'brand',
  model: 'model',
  trim: 'trim',
  condition: 'condition',
  certified: 'certified_pre_owned',
  price: 'price',
  msrp: 'vehicle_msrp',
  color: 'color',
  mileage: 'mileage',
  title: 'title',
  description: 'description',
  detailUrl: 'link',
  storeCode: 'store_code',
  bodyStyle: 'body_style',
  images: ['image_link', 'image_link1', 'image_link2', 'image_link3', 'image_link4', 'image_link5'],
};

export type VehicleCondition = 'new' | 'used' | 'certified';

export interface NormalizedVehicle {
  vin: string;
  stockNumber: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  condition: VehicleCondition;
  /** Dealer asking price, USD. Null when absent. */
  price: number | null;
  /** MSRP, USD. Present on ~100% of NEW rows; absent on used. */
  msrp: number | null;
  /** The feed's short colour name, e.g. "Jet Black". */
  color: string;
  /** Fuller OEM colour recovered from the description ("Jet Black Mica") when
   *  the dealer's description contains it; otherwise same as `color`. */
  colorDetail: string;
  mileage: number | null;
  bodyStyle: string;
  title: string;
  detailUrl: string;
  storeCode: string;
  imageUrls: string[];
}

export interface FeedIssue {
  /** 1-based row number in the data (excluding the header). */
  row: number;
  reason: string;
}

export interface ParsedFeed {
  vehicles: NormalizedVehicle[];
  issues: FeedIssue[];
  /** Rows the parser saw, including ones that became issues. */
  totalRows: number;
  /** Header columns present in the file — for diagnosing a changed feed shape. */
  columns: string[];
  /** Mapped columns that the file did NOT contain. A non-empty list here is the
   *  earliest signal that a provider changed their schema. */
  missingColumns: string[];
}

/** Strip a trailing unit and any thousands separators: `"31807 USD"` → 31807. */
export function parseAmount(raw: string | undefined): number | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const cleaned = s.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** `"56299 Miles"` → 56299. `"15 Miles"` on a new unit is delivery mileage. */
export function parseMileage(raw: string | undefined): number | null {
  return parseAmount(raw);
}

/** Map the feed's condition (+ CPO flag) onto our three states. */
export function parseCondition(condition: string | undefined, certified: string | undefined): VehicleCondition {
  const c = (condition ?? '').trim().toLowerCase();
  const cpo = (certified ?? '').trim().toLowerCase() === 'true';
  if (c === 'new') return 'new';
  if (cpo) return 'certified';
  return 'used';
}

const COLOR_QUALIFIERS = 'Mica|Pearl|Metallic|Clearcoat|Tricoat|Crystal|Coat';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Recover the fuller OEM colour name from the description.
 *
 * The `color` column carries a generic name ("Gray Metallic") while the
 * description often has the real marketing name ("Polymetal Gray Metallic").
 * The fuller string matches EVOX's palette far better, and that's what decides
 * whether a generated ad shows the right paint.
 *
 * The parse leans on the description's actual structure, which is
 * `"<title> <colour> <specs>"` — e.g.
 * `"2026 Mazda CX-5 2.5 S Premium Plus | Polymetal Gray Metallic | AWD 6-Speed…"`.
 * So we strip the title prefix and then require the colour to sit at the START
 * of what remains. Searching the whole string instead would swallow trim words
 * ("S Preferred Jet Black"), since trims are capitalized too.
 *
 * Best-effort and dealer-dependent — Young Mazda embeds the colour, Young
 * Chevrolet's descriptions are pure boilerplate. Always falls back to `color`.
 */
export function enrichColor(color: string, description: string, title = ''): string {
  const base = (color ?? '').trim();
  const desc = (description ?? '').trim();
  if (!base || !desc) return base;

  // Drop the leading title (plus any separator) so the colour is at the front.
  let rest = desc;
  const t = (title ?? '').trim();
  if (t && desc.toLowerCase().startsWith(t.toLowerCase())) {
    rest = desc.slice(t.length).replace(/^[\s.,|–—-]+/, '');
  }

  // Lazily take the fewest leading capitalized words needed to reach the feed's
  // colour, plus one optional trailing qualifier.
  const re = new RegExp(
    `^((?:[A-Z][\\w-]*\\s+)*?${escapeRe(base)}(?:\\s+(?:${COLOR_QUALIFIERS}))?)`,
    'i',
  );
  const m = rest.match(re);
  if (!m) return base;
  const found = m[1].trim().replace(/\s+/g, ' ');
  return found.length > base.length ? found : base;
}

/** Parse + normalize a VLA feed body. Never throws on row-level problems. */
export function parseVlaFeed(
  body: string,
  mapping: VlaFieldMapping = DEFAULT_VLA_MAPPING,
): ParsedFeed {
  const { data, meta } = Papa.parse<Record<string, string>>(body, {
    header: true,
    skipEmptyLines: true,
  });
  const columns = meta.fields ?? [];
  const present = new Set(columns);

  const required = [mapping.vin, mapping.year, mapping.make, mapping.model, mapping.condition];
  const missingColumns = [
    ...required,
    mapping.stockNumber,
    mapping.price,
    mapping.msrp,
    mapping.color,
  ].filter((c) => !present.has(c));

  const vehicles: NormalizedVehicle[] = [];
  const issues: FeedIssue[] = [];
  const seenVins = new Set<string>();

  data.forEach((raw, i) => {
    const row = i + 1;
    const get = (col: string) => (raw[col] ?? '').trim();

    const vin = get(mapping.vin).toUpperCase();
    if (!vin) {
      issues.push({ row, reason: 'missing VIN' });
      return;
    }
    // A feed listing the same VIN twice is a provider bug, not two cars.
    if (seenVins.has(vin)) {
      issues.push({ row, reason: `duplicate VIN ${vin}` });
      return;
    }

    const year = Number(get(mapping.year));
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      issues.push({ row, reason: `unusable year "${get(mapping.year)}" (VIN ${vin})` });
      return;
    }
    const make = get(mapping.make);
    const model = get(mapping.model);
    if (!make || !model) {
      issues.push({ row, reason: `missing make/model (VIN ${vin})` });
      return;
    }

    seenVins.add(vin);
    const color = get(mapping.color);
    const description = get(mapping.description);
    const title = get(mapping.title);
    const imageUrls = [
      ...new Set(mapping.images.map((c) => get(c)).filter((u) => /^https?:\/\//i.test(u))),
    ];

    vehicles.push({
      vin,
      stockNumber: get(mapping.stockNumber),
      year,
      make,
      model,
      trim: get(mapping.trim),
      condition: parseCondition(get(mapping.condition), get(mapping.certified)),
      price: parseAmount(get(mapping.price)),
      msrp: parseAmount(get(mapping.msrp)),
      color,
      colorDetail: enrichColor(color, description, title),
      mileage: parseMileage(get(mapping.mileage)),
      bodyStyle: get(mapping.bodyStyle),
      title,
      detailUrl: get(mapping.detailUrl),
      storeCode: get(mapping.storeCode),
      imageUrls,
    });
  });

  return { vehicles, issues, totalRows: data.length, columns, missingColumns };
}

/** New (incl. certified? no — strictly new) units only. OEM incentives are a
 *  new-vehicle programme, so used rows are noise for ad generation. */
export function newVehicles(feed: ParsedFeed): NormalizedVehicle[] {
  return feed.vehicles.filter((v) => v.condition === 'new');
}

export interface StockGroup {
  year: number;
  make: string;
  model: string;
  count: number;
  vehicles: NormalizedVehicle[];
}

/**
 * Group new stock by year/make/model — the granularity an OEM programme is
 * advertised at, and therefore the unit the offer poll watches.
 */
export function groupNewStock(feed: ParsedFeed): StockGroup[] {
  const groups = new Map<string, StockGroup>();
  for (const v of newVehicles(feed)) {
    const key = `${v.year}|${v.make.toLowerCase()}|${v.model.toLowerCase()}`;
    const g = groups.get(key);
    if (g) {
      g.count++;
      g.vehicles.push(v);
    } else {
      groups.set(key, { year: v.year, make: v.make, model: v.model, count: 1, vehicles: [v] });
    }
  }
  return [...groups.values()].sort(
    (a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model) || a.year - b.year,
  );
}
