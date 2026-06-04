/**
 * ADF (Auto-Lead Data Format) document builder.
 *
 * ADF is the automotive-industry XML standard for lead delivery; Tekion,
 * VinSolutions, and effectively every dealer CRM ingest it. We emit a v1.0
 * document with the prospect's contact info mapped from the form
 * submission, the remaining fields dumped into <comments>, the dealer as
 * the <vendor>, and Loomi as the <provider>.
 *
 * Field mapping reuses the same identifier heuristics as the form
 * validator: typed email/phone blocks and name-like field names populate
 * the structured ADF contact; everything else lands in comments so no
 * captured data is lost.
 */
import type { Contact, FormSubmission } from '@prisma/client';

export interface AdfLeadInput {
  dealerName: string;
  formName: string;
  submission: Pick<
    FormSubmission,
    'data' | 'createdAt' | 'utmSource' | 'utmMedium' | 'utmCampaign' | 'utmTerm' | 'utmContent'
  >;
  contact: Pick<Contact, 'email' | 'phone' | 'firstName' | 'lastName'> | null;
}

const PROVIDER_NAME = 'Loomi';

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
      const norm = k.toLowerCase().replace(/[^a-z]/g, '');
      if (keys.includes(norm) && typeof data[k] === 'string' && (data[k] as string).trim()) {
        return (data[k] as string).trim();
      }
    }
    return null;
  };
  return {
    first: input.contact?.firstName ?? pick('firstname', 'fname'),
    last: input.contact?.lastName ?? pick('lastname', 'lname'),
    email: input.contact?.email ?? pick('email', 'emailaddress'),
    phone: input.contact?.phone ?? pick('phone', 'phonenumber', 'mobile', 'cell'),
  };
}

/** Human-readable dump of every submitted field for the <comments> block.
 *  Intentionally forwards ALL submitted fields (no allow-list) so the
 *  salesperson sees the full lead context; if a form ever collects data
 *  that shouldn't leave Loomi, gate it with a per-field allow-list here. */
function buildComments(input: AdfLeadInput): string {
  const data = (input.submission.data as Record<string, unknown>) ?? {};
  const lines = [`Form: ${input.formName}`];
  for (const [key, value] of Object.entries(data)) {
    const rendered = Array.isArray(value) ? value.join(', ') : String(value ?? '');
    lines.push(`${key}: ${rendered}`);
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
  return `<?ADF version="1.0"?>
<adf>
  <prospect status="new">
    <requestdate>${requestDate}</requestdate>
    <customer>
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
