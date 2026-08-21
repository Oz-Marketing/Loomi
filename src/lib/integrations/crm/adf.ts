/**
 * ADF (Auto-Lead Data Format) document builder.
 *
 * ADF is the automotive-industry XML standard for lead delivery; Tekion,
 * VinSolutions, and effectively every dealer CRM ingest it. We emit a v1.0
 * document with the prospect's contact info and vehicle mapped from the
 * form submission, the remaining fields dumped into <comments>, the dealer
 * as the <vendor>, and Loomi as the <provider>.
 *
 * Field mapping reuses the same identifier heuristics as the form
 * validator: typed email/phone blocks and name-like field names populate
 * the structured ADF contact; year/make/model-like field names populate
 * the structured <vehicle>; everything else lands in comments so no
 * captured data is lost.
 *
 * Structured beats comments: a CRM only shows a value in a real field
 * (customer name, vehicle of interest, trade-in) when it arrives in the
 * matching ADF element. Anything left in <comments> renders as a wall of
 * text on the lead's notes, which is why this builder maps as much as it
 * can out of the free-text block.
 */
import type { Contact, FormSubmission } from '@prisma/client';
import { asFileValues } from '@/lib/forms/types';
import { readSubmissionMetadata } from '@/lib/forms/embed-params';
import { FULL_NAME_KEYS, splitFullName } from '@/lib/forms/validate';

/**
 * What a form's vehicle fields describe. Set per form (Form.crmVehicleContext)
 * because the same year/make/model fields mean opposite things on a
 * "reserve this truck" form and a trade appraisal, and there's no reliable
 * way to tell them apart from the field names alone.
 */
export type VehicleContext = 'interest' | 'trade';

export const VEHICLE_CONTEXTS: readonly VehicleContext[] = ['interest', 'trade'];

/** Narrow the free-form `Form.crmVehicleContext` column to a known value.
 *  Anything unrecognized (including null) means "send no <vehicle>". */
export function parseVehicleContext(value: string | null | undefined): VehicleContext | null {
  return VEHICLE_CONTEXTS.includes(value as VehicleContext) ? (value as VehicleContext) : null;
}

export interface AdfLeadInput {
  dealerName: string;
  formName: string;
  submission: Pick<
    FormSubmission,
    | 'id'
    | 'data'
    | 'metadata'
    | 'createdAt'
    | 'utmSource'
    | 'utmMedium'
    | 'utmCampaign'
    | 'utmTerm'
    | 'utmContent'
  >;
  contact: Pick<Contact, 'email' | 'phone' | 'firstName' | 'lastName'> | null;
  /** Null (the default for every form that hasn't opted in) emits no
   *  <vehicle> element — see {@link VehicleContext}. */
  vehicleContext?: VehicleContext | null;
}

const PROVIDER_NAME = 'Loomi - Oz';

// Characters that are illegal in XML 1.0 even when numeric-escaped
// (everything below 0x20 except tab/LF/CR). A pasted textarea or hostile
// input can carry these; left in, they make the whole ADF document
// non-well-formed and the CRM silently rejects the lead.
const INVALID_XML_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

/** Strip XML-illegal control chars, then escape the five special chars. */
function xmlEscape(value: string): string {
  return value
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Lowercase + strip separators so "First Name", "firstName" and
 *  "first_name" all normalize to the same token. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** True when the submission carries at least one usable contact
 *  identifier — ADF requires a populated <contact>, so a lead with none
 *  shouldn't be emailed to the CRM. */
export function hasUsableProspect(input: AdfLeadInput): boolean {
  const p = resolveProspect(input);
  return Boolean(p.first || p.last || p.email || p.phone);
}

/** Best-effort first/last/email/phone, preferring the resolved Contact and
 *  falling back to name-keyed submission fields for anonymous leads. */
function resolveProspect(input: AdfLeadInput): {
  first: string | null;
  last: string | null;
  email: string | null;
  phone: string | null;
} {
  const data = (input.submission.data as Record<string, unknown>) ?? {};
  const pick = (...keys: string[]): string | null => {
    for (const k of Object.keys(data)) {
      const norm = normalizeKey(k).replace(/[^a-z]/g, '');
      if (keys.includes(norm) && typeof data[k] === 'string' && (data[k] as string).trim()) {
        return (data[k] as string).trim();
      }
    }
    return null;
  };

  let first = input.contact?.firstName ?? pick('firstname', 'fname');
  let last = input.contact?.lastName ?? pick('lastname', 'lname');

  // A single "Name" field is the common case on short lead forms. Split it
  // so the CRM gets a real customer name instead of an email-only record.
  // Only when we found neither half explicitly — mixing an explicit
  // first name with a last name parsed out of a different field would
  // invent a name nobody typed.
  if (!first && !last) {
    const full = pick(...FULL_NAME_KEYS);
    if (full) {
      const split = splitFullName(full);
      first = split.first || null;
      last = split.last;
    }
  }

  return {
    first,
    last,
    email: input.contact?.email ?? pick('email', 'emailaddress'),
    phone: input.contact?.phone ?? pick('phone', 'phonenumber', 'mobile', 'cell'),
  };
}

interface AdfVehicle {
  year: string | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
  stock: string | null;
  odometer: string | null;
}

const EMPTY_VEHICLE: AdfVehicle = {
  year: null,
  make: null,
  model: null,
  trim: null,
  vin: null,
  stock: null,
  odometer: null,
};

/** Which vehicle slot a field name feeds, or null when it feeds none.
 *  Checked in priority order so a "Model Year" field lands in <year>
 *  rather than <model>. */
function vehicleSlot(normalized: string): keyof AdfVehicle | null {
  if (normalized === 'vin' || normalized.endsWith('vin')) return 'vin';
  if (normalized.includes('stock')) return 'stock';
  if (normalized.includes('odometer') || normalized.includes('mileage')) return 'odometer';
  if (normalized.includes('year')) return 'year';
  if (normalized.includes('trim')) return 'trim';
  if (normalized.includes('make')) return 'make';
  if (normalized.includes('model')) return 'model';
  return null;
}

/** Slot-specific sanity check. Field names are matched loosely, so this is
 *  what stops "How many years have you owned it? → 3" from being sent to
 *  the CRM as a model year. */
function acceptVehicleValue(slot: keyof AdfVehicle, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (slot === 'year') {
    const year = trimmed.match(/\b(19|20)\d{2}\b/)?.[0];
    return year ?? null;
  }
  if (slot === 'odometer') {
    const digits = trimmed.replace(/[^0-9]/g, '');
    return digits || null;
  }
  return trimmed;
}

/**
 * Map the submission's vehicle fields into a structured ADF vehicle.
 *
 * On an `interest` form we also fall back to the `meta_*` params the host
 * VDP passed in (VIN, stock, year/make/model) — that's the whole vehicle
 * for a "get e-price on this truck" embed. We deliberately DON'T do that
 * for a `trade` form: the VDP's vehicle is the dealer's car, not the
 * customer's trade, and merging them would put the wrong VIN on the
 * appraisal.
 */
function resolveVehicle(input: AdfLeadInput, context: VehicleContext): AdfVehicle {
  const vehicle: AdfVehicle = { ...EMPTY_VEHICLE };
  const data = (input.submission.data as Record<string, unknown>) ?? {};

  for (const [key, raw] of Object.entries(data)) {
    if (typeof raw !== 'string') continue;
    const slot = vehicleSlot(normalizeKey(key));
    if (!slot || vehicle[slot]) continue;
    vehicle[slot] = acceptVehicleValue(slot, raw);
  }

  if (context === 'interest') {
    const meta = readSubmissionMetadata(input.submission.metadata);
    for (const [key, raw] of Object.entries(meta)) {
      const slot = vehicleSlot(normalizeKey(key));
      if (!slot || vehicle[slot]) continue;
      vehicle[slot] = acceptVehicleValue(slot, raw);
    }
  }

  return vehicle;
}

/** Render the <vehicle> element, or '' when we found nothing worth
 *  sending. Child order follows the ADF 1.0 sequence. */
function buildVehicleXml(input: AdfLeadInput): string {
  const context = input.vehicleContext;
  if (!context) return '';

  const v = resolveVehicle(input, context);
  // A year alone is noise on a CRM lead — require at least a make or model
  // (or a VIN, which identifies the car by itself).
  if (!v.make && !v.model && !v.vin) return '';

  const parts: string[] = [];
  if (v.year) parts.push(`      <year>${xmlEscape(v.year)}</year>`);
  if (v.make) parts.push(`      <make>${xmlEscape(v.make)}</make>`);
  if (v.model) parts.push(`      <model>${xmlEscape(v.model)}</model>`);
  if (v.vin) parts.push(`      <vin>${xmlEscape(v.vin)}</vin>`);
  if (v.stock) parts.push(`      <stock>${xmlEscape(v.stock)}</stock>`);
  if (v.trim) parts.push(`      <trim>${xmlEscape(v.trim)}</trim>`);
  if (v.odometer) {
    parts.push(`      <odometer units="mi">${xmlEscape(v.odometer)}</odometer>`);
  }

  // `interest` is the attribute the CRM keys on to decide whether this is
  // the car they want or the car they're trading in.
  const interest = context === 'trade' ? 'trade-in' : 'buy';
  return `    <vehicle interest="${interest}">
${parts.join('\n')}
    </vehicle>
`;
}

/** Human-readable dump of every submitted field for the <comments> block.
 *  Intentionally forwards ALL submitted fields (no allow-list) so the
 *  salesperson sees the full lead context — including the ones already
 *  mapped into <vehicle>, since a duplicated line is harmless and a
 *  missing one isn't. If a form ever collects data that shouldn't leave
 *  Loomi, gate it with a per-field allow-list here. */
function buildComments(input: AdfLeadInput): string {
  const data = (input.submission.data as Record<string, unknown>) ?? {};
  const lines = [`Form: ${input.formName}`];
  for (const [key, value] of Object.entries(data)) {
    // Uploaded files are stored as FileValue objects, which would
    // stringify to "[object Object]" and lose the URL the salesperson
    // needs. Render them as "name (url)" pairs instead.
    const files = asFileValues(value);
    const rendered = files.length
      ? files.map((f) => `${f.name} (${f.url})`).join(', ')
      : Array.isArray(value)
        ? value.join(', ')
        : String(value ?? '');
    lines.push(`${key}: ${rendered}`);
  }
  // Embed metadata (`meta_*` from the host VDP): VIN, stock number and
  // page URL are exactly what a salesperson wants on the lead, so they
  // go in ahead of the attribution line. `xmlEscape` on the joined
  // comments block covers these — they're third-party strings.
  const meta = Object.entries(readSubmissionMetadata(input.submission.metadata)).sort(
    ([a], [b]) => a.localeCompare(b),
  );
  if (meta.length) {
    lines.push('', 'Page context:');
    for (const [key, value] of meta) lines.push(`${key}: ${value}`);
  }

  const utm = [
    ['source', input.submission.utmSource],
    ['medium', input.submission.utmMedium],
    ['campaign', input.submission.utmCampaign],
    ['term', input.submission.utmTerm],
    ['content', input.submission.utmContent],
  ].filter(([, v]) => v) as [string, string][];
  if (utm.length) {
    lines.push(`Attribution: ${utm.map(([k, v]) => `utm_${k}=${v}`).join(', ')}`);
  }
  return lines.join('\n');
}

export function buildAdfXml(input: AdfLeadInput): string {
  const p = resolveProspect(input);
  const requestDate = input.submission.createdAt.toISOString();

  const contactParts: string[] = [];
  if (p.first) contactParts.push(`        <name part="first" type="individual">${xmlEscape(p.first)}</name>`);
  if (p.last) contactParts.push(`        <name part="last" type="individual">${xmlEscape(p.last)}</name>`);
  if (p.email) contactParts.push(`        <email>${xmlEscape(p.email)}</email>`);
  if (p.phone) contactParts.push(`        <phone type="voice">${xmlEscape(p.phone)}</phone>`);

  // ADF documents lead with the <?ADF?> processing instruction. We omit a
  // separate <?xml?> declaration on purpose: an XML declaration is only
  // valid as the very first thing in a document, and placing it after the
  // ADF PI makes strict parsers reject the lead. UTF-8 is the default
  // encoding, which is what we emit.
  //
  // Child order inside <prospect> follows the ADF 1.0 sequence
  // (id, requestdate, vehicle, customer, vendor, provider) — strict
  // parsers reject an out-of-order document.
  //
  // <id> carries the Loomi submission id so the CRM can dedupe: delivery
  // is at-least-once (see deliver.ts), so the same lead can legitimately
  // arrive twice. Omitted rather than emitted empty if a caller ever hands
  // us a submission without one — an empty <id> is worse than no <id>.
  const submissionId = input.submission.id?.trim();
  const idLine = submissionId
    ? `    <id sequence="1" source="${PROVIDER_NAME}">${xmlEscape(submissionId)}</id>\n`
    : '';

  return `<?ADF version="1.0"?>
<adf>
  <prospect status="new">
${idLine}    <requestdate>${requestDate}</requestdate>
${buildVehicleXml(input)}    <customer>
      <contact>
${contactParts.join('\n')}
      </contact>
      <comments>${xmlEscape(buildComments(input))}</comments>
    </customer>
    <vendor>
      <vendorname>${xmlEscape(input.dealerName)}</vendorname>
    </vendor>
    <provider>
      <name part="full">${PROVIDER_NAME}</name>
      <service>${xmlEscape(input.formName)}</service>
    </provider>
  </prospect>
</adf>`;
}

/** Subject line for the ADF email — CRMs key on the recipient address, but
 *  a descriptive subject helps humans triage the lead inbox. */
export function buildAdfSubject(input: AdfLeadInput): string {
  const p = resolveProspect(input);
  const who = [p.first, p.last].filter(Boolean).join(' ') || p.email || 'New lead';
  return `ADF Lead — ${input.formName} — ${who}`;
}
