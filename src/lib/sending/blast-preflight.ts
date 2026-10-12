// Deliverability + compliance preflight for email blasts.
//
// WHY THIS EXISTS
// ───────────────
// A blast sent from a half-configured account doesn't fail loudly — it
// delivers straight to the spam folder, and it takes the sending domain's
// reputation down with it. That already happened once: a full blast from a
// sub-account with no SendGrid key of its own fell through to the shared
// SMTP transport, so it went out From the shared transactional address, with
// no List-Unsubscribe header and no physical address in the body. Every one
// of those is an independent spam signal, and the shared address means the
// damage lands on transactional mail (password resets, notifications) too.
//
// So the gate is deliberately a BLOCK, not a warning. The failure mode of
// blocking is "someone fills in a settings field"; the failure mode of
// warning is a burnt sending domain that takes weeks to recover.
//
// Split into blockers and warnings: blockers refuse the send, warnings are
// surfaced in the UI but let it through.

import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/crypto/encryption';
import {
  analyzeMergetags,
  applyBlastMergetags,
  applyMergetagFilters,
  buildBlastMergetagContext,
  resolveMergetagValue,
  scanMergetags,
  suggestMergetag,
  type BlastMergetagContext,
  type MergetagProblem,
} from '@/lib/sending/blast-mergetags';
import {
  accountMergeValues,
  CUSTOM_VALUES_PREFIX,
  normalizeMergeKey,
} from '@/lib/sending/account-merge-values';
import {
  loadBlastAccountData,
  type LoadedBlastAccount,
} from '@/lib/sending/blast-account-data';
import { resolveAccountFooters, type ResolvedFooter } from '@/lib/sending/account-footer';
import { footerContrastProblems } from '@/lib/sending/unsubscribe-footer';
import { checkSenderDomainAuth, type DomainAuthResult } from '@/lib/sending/domain-auth';
import { decodeHtmlEntities } from '@/lib/sending/html-entities';
import { assessAudienceRisk, audienceRiskIssues } from '@/lib/sending/audience-risk';

export type PreflightSeverity = 'blocker' | 'warning';

export interface PreflightIssue {
  severity: PreflightSeverity;
  /** Stable identifier so the UI can deep-link to the right settings tab. */
  code: string;
  /** Sub-account this applies to; '' for campaign-wide issues. */
  accountKey: string;
  message: string;
  /** What the user should do about it. */
  remedy: string;
}

export interface PreflightResult {
  ok: boolean;
  issues: PreflightIssue[];
}

/** Codes the Schedule step maps to a "Fix in settings" link. */
export const PREFLIGHT_CODES = {
  NO_SENDGRID_KEY: 'no_sendgrid_key',
  BAD_SENDGRID_KEY: 'bad_sendgrid_key',
  NO_SENDER_EMAIL: 'no_sender_email',
  SENDER_DOMAIN_MISMATCH: 'sender_domain_mismatch',
  /** SendGrid itself says the From domain isn't (validly) authenticated. */
  SENDER_DOMAIN_UNAUTHENTICATED: 'sender_domain_unauthenticated',
  /** SendGrid couldn't be asked; the recorded domain was compared instead. */
  DOMAIN_AUTH_UNVERIFIED: 'domain_auth_unverified',
  NO_FROM_DOMAIN: 'no_from_domain',
  NO_PHYSICAL_ADDRESS: 'no_physical_address',
  UNKNOWN_MERGETAG: 'unknown_mergetag',
  /** A tag uses a filter Loomi can't apply, or a filter argument it can't read. */
  MERGETAG_FILTER: 'mergetag_filter',
  /** A {{custom_values.*}} tag nothing in the audience can fill. */
  UNRESOLVED_CUSTOM_VALUE: 'unresolved_custom_value',
  /** A {{custom_values.*}} tag only some contacts carry. */
  CUSTOM_VALUE_PARTIAL: 'custom_value_partial',
  /** A {{custom_values.*}} tag one account in the blast has no value for. */
  CUSTOM_VALUE_MISSING: 'custom_value_missing',
  /** A button or link with nowhere to go. */
  EMPTY_LINK: 'empty_link',
  GHL_HOSTED_IMAGE: 'ghl_hosted_image',
  GHL_HOSTED_LINK: 'ghl_hosted_link',
  PLACEHOLDER_IMAGE: 'placeholder_image',
  OFFERS_PLACEHOLDER: 'offers_placeholder',
  FOOTER_LOW_CONTRAST: 'footer_low_contrast',
  NO_SUBJECT: 'no_subject',
  NO_BODY: 'no_body',
  NO_TEXT_PART: 'no_text_part',
} as const;

function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1).toLowerCase().trim();
}

/**
 * Is `sender` inside `authenticated`? Accepts an exact match or a subdomain
 * (mail.example.com is covered by example.com). Only used when SendGrid
 * can't be asked; the live check in ./domain-auth.ts is the real answer.
 */
function domainCovers(authenticated: string, sender: string): boolean {
  const auth = authenticated.toLowerCase().trim().replace(/^\.+/, '');
  if (!auth || !sender) return false;
  return sender === auth || sender.endsWith(`.${auth}`);
}

export interface PreflightInput {
  subject: string;
  htmlContent: string;
  textContent?: string | null;
  /**
   * The inbox preview text. Checked with the same merge-tag rules as the
   * subject — a typo here ships to every inbox's snippet line just as
   * literally.
   */
  previewText?: string | null;
  /**
   * The follow-up ("resend to non-engaged") subject, when the follow-up is
   * turned on. Sent days later by the worker with no further check, so it
   * has to be checked now.
   */
  resendSubject?: string | null;
  /** Every sub-account this blast sends on behalf of. */
  accountKeys: string[];
  /**
   * The resolved audience, when the caller has one. Omitted by the advisory
   * GET preflight — a draft has no recipients until it is scheduled — and
   * passed by the schedule gate, which receives the full list. Without it the
   * audience-quality checks simply don't run; they never invent a verdict
   * from a missing audience.
   */
  recipients?: { accountKey: string; email: string }[];
}

/** One piece of copy a merge tag can appear in. */
interface ContentSource {
  label: string;
  text: string;
  html: boolean;
  /** Where in the builder it is edited. */
  where: string;
}

function contentSources(input: PreflightInput): ContentSource[] {
  const sources: ContentSource[] = [
    { label: 'subject', text: input.subject || '', html: false, where: 'the Message step' },
    { label: 'preview text', text: input.previewText || '', html: false, where: 'the Message step' },
    {
      label: 'follow-up subject',
      text: input.resendSubject || '',
      html: false,
      where: 'the follow-up settings on the Schedule step',
    },
    { label: 'body', text: input.htmlContent || '', html: true, where: 'the Message step' },
  ];
  return sources.filter((source) => source.text.trim());
}

function joinPlaces(places: string[]): string {
  if (places.length <= 1) return places[0] ?? 'the Message step';
  return `${places.slice(0, -1).join(', ')} and ${places[places.length - 1]}`;
}

function listSome(items: string[], max = 5): string {
  if (items.length <= max) return items.join(', ');
  return `${items.slice(0, max).join(', ')} and ${items.length - max} more`;
}

// ── Merge tags ──────────────────────────────────────────────────────────

const FILTER_HELP =
  'Supported filters: default: "fallback text", upper, lower, capitalize, title — '
  + 'for example {{contact.first_name | default: "there"}}. The fallback must be in quotes.';

function filterProblemNote(problem: MergetagProblem): string {
  if (problem.kind === 'unknown_filter') {
    return `"${problem.filter ?? ''}" is not a filter Loomi supports`;
  }
  if (problem.filter === 'default') return 'the default needs one fallback, in quotes';
  if (problem.filter) return `"${problem.filter}" takes no argument`;
  return 'a quote is never closed';
}

function checkTagSyntax(
  sources: ContentSource[],
  shapeCtx: BlastMergetagContext,
): PreflightIssue[] {
  const unknown: { display: string; key: string; label: string; where: string }[] = [];
  const filters: { problem: MergetagProblem; label: string; where: string }[] = [];

  for (const source of sources) {
    for (const problem of analyzeMergetags(source.text, shapeCtx)) {
      if (problem.kind === 'unknown_key') {
        // Custom values depend on the accounts and contacts in the audience;
        // checkCustomValues() decides whether anything can fill them.
        if (problem.key.startsWith(CUSTOM_VALUES_PREFIX)) continue;
        unknown.push({ display: problem.key, key: problem.key, label: source.label, where: source.where });
      } else if (problem.kind === 'malformed') {
        unknown.push({ display: problem.tag, key: '', label: source.label, where: source.where });
      } else {
        filters.push({ problem, label: source.label, where: source.where });
      }
    }
  }

  const issues: PreflightIssue[] = [];
  if (unknown.length > 0) {
    const listed = [...new Set(unknown.map((u) => `{{${u.display}}} (${u.label})`))];
    // Name the tag they probably meant. Without this the remedy is a
    // scavenger hunt through the picker for what is usually a one-word typo.
    const suggestions = [...new Set(
      unknown
        .filter((u) => u.key)
        .map((u) => {
          const guess = suggestMergetag(u.key, shapeCtx);
          return guess ? `{{${u.key}}} → {{${guess}}}` : null;
        })
        .filter((line): line is string => line !== null),
    )];
    const fix = `Fix the spelling on ${joinPlaces([...new Set(unknown.map((u) => u.where))])}, or remove the tag.`;
    issues.push({
      severity: 'blocker',
      code: PREFLIGHT_CODES.UNKNOWN_MERGETAG,
      accountKey: '',
      message: `Unrecognized merge tags would send as literal text: ${listed.join(', ')}.`,
      remedy: suggestions.length > 0
        ? `Did you mean ${suggestions.join(', ')}? ${fix}`
        : `${fix} Check the variable picker for the supported list.`,
    });
  }

  if (filters.length > 0) {
    const listed = [...new Set(
      filters.map((f) => `{{${f.problem.tag}}} (${f.label}: ${filterProblemNote(f.problem)})`),
    )];
    issues.push({
      severity: 'blocker',
      code: PREFLIGHT_CODES.MERGETAG_FILTER,
      accountKey: '',
      message: `Merge tags with a filter Loomi can't apply would send as literal text: ${listed.join(', ')}.`,
      remedy: `${FILTER_HELP} Fix it on ${joinPlaces([...new Set(filters.map((f) => f.where))])}.`,
    });
  }
  return issues;
}

/** normalized custom key → its value, for one account. */
function accountCustomIndex(account: LoadedBlastAccount | undefined): Map<string, string> {
  const index = new Map<string, string>();
  for (const [key, value] of Object.entries(accountMergeValues(account ?? null))) {
    if (!key.startsWith(CUSTOM_VALUES_PREFIX)) continue;
    index.set(normalizeMergeKey(key.slice(CUSTOM_VALUES_PREFIX.length)), value);
  }
  return index;
}

/** Contact custom-field definitions (key and label, normalized) per account. */
async function loadFieldDefinitions(
  accountKeys: string[],
): Promise<Map<string, Set<string>> | null> {
  try {
    const rows = await prisma.contactCustomField.findMany({
      where: { accountKey: { in: accountKeys } },
      select: { accountKey: true, key: true, label: true },
    });
    const out = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!row.accountKey) continue;
      const set = out.get(row.accountKey) ?? new Set<string>();
      set.add(normalizeMergeKey(row.key));
      if (row.label) set.add(normalizeMergeKey(row.label));
      out.set(row.accountKey, set);
    }
    return out;
  } catch (err) {
    console.error('[blast-preflight] custom field definitions lookup failed:', err);
    return null;
  }
}

/**
 * Custom-field keys any contact in these accounts actually carries a value
 * for, per account. CSV imports keep raw column headers as keys, so this is
 * the only place a `Trade In Value` column with no field definition shows up.
 * One DISTINCT scan per check; only run when a tag isn't settled by account
 * values or field definitions.
 */
async function loadContactFieldKeys(
  accountKeys: string[],
): Promise<Map<string, Set<string>> | null> {
  try {
    const rows = await prisma.$queryRaw<{ accountKey: string; key: string }[]>`
      SELECT DISTINCT c."accountKey" AS "accountKey", f.key AS key
      FROM "Contact" c
      CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(c."customFields") = 'object' THEN c."customFields" ELSE '{}'::jsonb END
      ) AS f(key, value)
      WHERE c."accountKey" = ANY(${accountKeys}::text[])
        AND f.value NOT IN ('null'::jsonb, '""'::jsonb)
    `;
    const out = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = out.get(row.accountKey) ?? new Set<string>();
      set.add(normalizeMergeKey(row.key));
      out.set(row.accountKey, set);
    }
    return out;
  } catch (err) {
    console.error('[blast-preflight] contact custom field scan failed:', err);
    return null;
  }
}

/**
 * {{custom_values.*}} tags, against the accounts and contacts that will fill
 * them. At send a custom value resolves from the contact's own field, else
 * the account's custom value, else blank — so:
 *
 *  - nothing can fill it (no account value, no field definition, no contact
 *    carrying it) → BLOCKER: it's almost certainly a typo, and every
 *    recipient would get a blank where the copy expects a phone number or a
 *    link;
 *  - only some contacts carry it (a raw CSV column) → warning: the rest get a
 *    blank, which a `default:` fallback fixes;
 *  - some accounts have it and another doesn't → warning on that account.
 *
 * A tag whose every use carries a non-empty `default:` can never render
 * blank, so it is not checked. Returns the normalized keys it reported, so
 * the link check doesn't report the same gap twice.
 */
async function checkCustomValues(
  sources: ContentSource[],
  accountKeys: string[],
  merge: Map<string, LoadedBlastAccount>,
  labels: Map<string, string>,
): Promise<{ issues: PreflightIssue[]; reported: Set<string> }> {
  const issues: PreflightIssue[] = [];
  const reported = new Set<string>();

  const uses = new Map<string, { key: string; defaulted: boolean }>();
  for (const source of sources) {
    for (const { parsed } of scanMergetags(source.text, { html: source.html })) {
      if (parsed.problem || !parsed.key.startsWith(CUSTOM_VALUES_PREFIX)) continue;
      const norm = normalizeMergeKey(parsed.key.slice(CUSTOM_VALUES_PREFIX.length));
      if (!norm) continue;
      const defaulted = parsed.filters.some((f) => f.name === 'default' && Boolean(f.args[0]?.trim()));
      const entry = uses.get(norm);
      if (!entry) uses.set(norm, { key: parsed.key, defaulted });
      else entry.defaulted = entry.defaulted && defaulted;
    }
  }
  const pending = [...uses.entries()].filter(([, use]) => !use.defaulted);
  if (pending.length === 0 || accountKeys.length === 0) return { issues, reported };

  const accountIndexes = new Map(accountKeys.map((key) => [key, accountCustomIndex(merge.get(key))]));
  const hasAccountValue = (account: string, norm: string) =>
    Boolean((accountIndexes.get(account)?.get(norm) ?? '').trim());

  const unsettled = pending.filter(([norm]) => accountKeys.some((a) => !hasAccountValue(a, norm)));
  if (unsettled.length === 0) return { issues, reported };

  const definitions = await loadFieldDefinitions(accountKeys);
  const needsScan = unsettled.some(([norm]) =>
    accountKeys.some((a) => !hasAccountValue(a, norm) && !definitions?.get(a)?.has(norm)),
  );
  const contactKeys = needsScan ? await loadContactFieldKeys(accountKeys) : new Map<string, Set<string>>();
  const lookupFailed = definitions === null || contactKeys === null;

  for (const [norm, use] of unsettled) {
    const tag = `{{${use.key}}}`;
    const definedBy = accountKeys.filter((a) => hasAccountValue(a, norm));
    const fieldKnown = accountKeys.some((a) => definitions?.get(a)?.has(norm));
    const contactsCarry = accountKeys.some((a) => contactKeys?.get(a)?.has(norm));

    if (definedBy.length === 0 && !fieldKnown && !contactsCarry) {
      reported.add(norm);
      issues.push({
        severity: lookupFailed ? 'warning' : 'blocker',
        code: PREFLIGHT_CODES.UNRESOLVED_CUSTOM_VALUE,
        accountKey: '',
        message: lookupFailed
          ? `${tag} couldn't be checked against this audience's contacts, and no account in the blast has a value for it.`
          : `${tag} has no value anywhere — no account in this blast defines it and no contact carries it — so it would send blank to everyone.`,
        remedy: `Check the spelling, add it under Settings → General for each account, or give it a fallback: {{${use.key} | default: "fallback text"}}.`,
      });
      continue;
    }

    if (definedBy.length === 0 && !fieldKnown) {
      reported.add(norm);
      issues.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.CUSTOM_VALUE_PARTIAL,
        accountKey: '',
        message: `Only some contacts have a value for ${tag}; everyone else gets a blank there.`,
        remedy: `Give it a fallback, e.g. {{${use.key} | default: "fallback text"}}, or narrow the audience to contacts who have it.`,
      });
      continue;
    }

    for (const account of accountKeys) {
      if (hasAccountValue(account, norm)) continue;
      if (definitions?.get(account)?.has(norm) || contactKeys?.get(account)?.has(norm)) continue;
      reported.add(norm);
      const label = labels.get(account) || account;
      issues.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.CUSTOM_VALUE_MISSING,
        accountKey: account,
        message: `${label} has no value for ${tag}, so its recipients get a blank there.`,
        remedy: `Add it under Settings → General for ${label}, or give the tag a fallback: {{${use.key} | default: "fallback text"}}.`,
      });
    }
  }
  return { issues, reported };
}

// ── Content hygiene ─────────────────────────────────────────────────────

/**
 * GoHighLevel's media and page hosts. Everything uploaded through GHL is
 * served from these, and every one of them stops resolving when GHL is shut
 * off — so an image or link pointing at them is a broken email waiting for a
 * date. Hosts as referenced across this repo's migrated templates and logos.
 */
const GHL_HOST_SUFFIXES = ['filesafe.space', 'msgsndr.com', 'leadconnectorhq.com', 'gohighlevel.com'];

export function isGhlHostedUrl(raw: string): boolean {
  const value = raw.trim().replace(/^\/\//, 'https://');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (GHL_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return true;
  // GHL's Google Cloud Storage bucket, in both URL styles.
  const path = url.pathname.toLowerCase();
  if (host === 'storage.googleapis.com' && /^\/msgsndr(?:-private)?\//.test(path)) return true;
  if (/^msgsndr(?:-private)?\.storage\.googleapis\.com$/.test(host)) return true;
  if (host === 'firebasestorage.googleapis.com' && path.includes('highlevel-backend')) return true;
  return false;
}

/** Placeholder-image services, plus the editor's own empty-image graphic. */
const PLACEHOLDER_HOSTS = [
  'via.placeholder.com',
  'placeholder.com',
  'placehold.co',
  'placehold.it',
  'dummyimage.com',
  'placekitten.com',
  'picsum.photos',
];

export function isPlaceholderImageUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim().replace(/^\/\//, 'https://'));
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (PLACEHOLDER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep the raw path
  }
  path = path.toLowerCase();
  // What an Image block renders when no picture was chosen
  // (lib/email/components/Image.tsx).
  return path.includes('/media/_admin/') && path.endsWith('/image placeholder.png');
}

/** Every image URL in a rendered email: <img src>, background="", CSS url(). */
function imageUrls(html: string): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(/<(?:img|v:image|v:fill)\b[^>]*?\ssrc\s*=\s*(["'])(.*?)\1/gi)) {
    urls.add(decodeHtmlEntities(match[2]).trim());
  }
  for (const match of html.matchAll(/\sbackground\s*=\s*(["'])(.*?)\1/gi)) {
    urls.add(decodeHtmlEntities(match[2]).trim());
  }
  for (const match of decodeHtmlEntities(html).matchAll(/url\(\s*["']?([^"')]+?)["']?\s*\)/gi)) {
    urls.add(match[1].trim());
  }
  return [...urls].filter((url) => url && !url.includes('{{'));
}

function linkUrls(html: string): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*?\shref\s*=\s*(["'])(.*?)\1/gi)) {
    urls.add(decodeHtmlEntities(match[2]).trim());
  }
  return [...urls].filter((url) => url && !url.includes('{{'));
}

/** The Offers block's placeholder copy (lib/email/components/Offers.tsx). */
const OFFERS_PLACEHOLDER = /One card per offer\s*\S\s*vehicle, payment, program terms and disclosure/i;

function checkContentHygiene(
  html: string,
  accountKeys: string[],
  merge: Map<string, LoadedBlastAccount>,
  labels: Map<string, string>,
  alreadyReported: Set<string>,
): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  if (!html.trim()) return issues;

  const templateImages = imageUrls(html);
  const templateLinks = linkUrls(html);

  const ghlImages = templateImages.filter(isGhlHostedUrl);
  if (ghlImages.length > 0) {
    issues.push({
      severity: 'warning',
      code: PREFLIGHT_CODES.GHL_HOSTED_IMAGE,
      accountKey: '',
      message: `${ghlImages.length} image${ghlImages.length === 1 ? ' is' : 's are'} hosted on GoHighLevel and will break when GoHighLevel is shut off: ${listSome(ghlImages, 3)}.`,
      remedy: 'Re-upload each image to the Loomi media library and swap it in on the Message step.',
    });
  }
  const ghlLinks = templateLinks.filter(isGhlHostedUrl);
  if (ghlLinks.length > 0) {
    issues.push({
      severity: 'warning',
      code: PREFLIGHT_CODES.GHL_HOSTED_LINK,
      accountKey: '',
      message: `${ghlLinks.length} link${ghlLinks.length === 1 ? ' points' : 's point'} at a GoHighLevel page or form that stops working when GoHighLevel is shut off: ${listSome(ghlLinks, 3)}.`,
      remedy: 'Point each link at the dealership website or a Loomi form on the Message step.',
    });
  }

  const placeholders = templateImages.filter(isPlaceholderImageUrl);
  if (placeholders.length > 0) {
    issues.push({
      severity: 'warning',
      code: PREFLIGHT_CODES.PLACEHOLDER_IMAGE,
      accountKey: '',
      message: `${placeholders.length === 1 ? 'An image still shows' : `${placeholders.length} images still show`} the gray placeholder graphic.`,
      remedy: 'Choose a picture for each image block on the Message step, or remove the block.',
    });
  }

  const deadLinks = [...html.matchAll(/<a\b[^>]*?\shref\s*=\s*(["'])\s*#?\s*\1/gi)].length;
  if (deadLinks > 0) {
    issues.push({
      severity: 'warning',
      code: PREFLIGHT_CODES.EMPTY_LINK,
      accountKey: '',
      message: `${deadLinks === 1 ? 'A button or link goes' : `${deadLinks} buttons or links go`} nowhere (its link is empty or "#").`,
      remedy: 'Set where each button links to on the Message step, or remove it.',
    });
  }

  if (OFFERS_PLACEHOLDER.test(decodeHtmlEntities(html))) {
    issues.push({
      severity: 'warning',
      code: PREFLIGHT_CODES.OFFERS_PLACEHOLDER,
      accountKey: '',
      message: 'The email still contains the "This month\'s offers appear here" placeholder box.',
      remedy: 'Offers are only filled in by an offer run. For a blast, replace the Offers block with real content on the Message step.',
    });
  }

  // Per account: what the account's own data puts into links and images.
  if (!html.includes('{{')) return issues;
  const templateImageSet = new Set(templateImages);
  const templateLinkSet = new Set(templateLinks);
  const linkTags = scanMergetags(html, { html: true }).filter(
    (o) => o.attribute === 'href' && o.wholeAttribute && !o.parsed.problem,
  );

  for (const account of accountKeys) {
    const label = labels.get(account) || account;
    const ctx = buildBlastMergetagContext({
      contact: null,
      account: merge.get(account) ?? null,
      unsubscribeToken: '[%unsubscribe_url%]',
    });
    const rendered = applyBlastMergetags(html, ctx, { escape: true });

    const accountGhl = [
      ...imageUrls(rendered).filter((url) => !templateImageSet.has(url)),
      ...linkUrls(rendered).filter((url) => !templateLinkSet.has(url)),
    ].filter(isGhlHostedUrl);
    if (accountGhl.length > 0) {
      issues.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.GHL_HOSTED_IMAGE,
        accountKey: account,
        message: `${label}'s logo or links point at GoHighLevel and will break when GoHighLevel is shut off: ${listSome(accountGhl, 3)}.`,
        remedy: `Re-upload to the Loomi media library and update ${label}'s logo and links under Settings → General.`,
      });
    }

    // A whole-href tag that this account leaves blank renders href="" —
    // a button that goes nowhere. Contact-level tags can't be judged here,
    // and custom values were already judged above.
    const blank = new Set<string>();
    for (const { parsed } of linkTags) {
      const key = parsed.key;
      if (key.startsWith('contact.') || key === 'unsubscribe_link' || key === 'unsubscribe_url') continue;
      if (key.startsWith(CUSTOM_VALUES_PREFIX)
        && alreadyReported.has(normalizeMergeKey(key.slice(CUSTOM_VALUES_PREFIX.length)))) continue;
      const raw = resolveMergetagValue(ctx, key);
      if (raw === undefined) continue;
      if (!applyMergetagFilters(raw, parsed.filters).trim()) blank.add(`{{${key}}}`);
    }
    if (blank.size > 0) {
      issues.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.EMPTY_LINK,
        accountKey: account,
        message: `For ${label}, ${[...blank].join(', ')} ${blank.size === 1 ? 'is' : 'are'} empty, so the button linking to ${blank.size === 1 ? 'it goes' : 'them goes'} nowhere.`,
        remedy: `Fill it in under Settings → General for ${label}, or link the button somewhere else.`,
      });
    }
  }
  return issues;
}

// ── The check ───────────────────────────────────────────────────────────

/**
 * Check a blast for anything that would land it in spam, breach CAN-SPAM, or
 * reach the inbox broken.
 *
 * Mostly database reads. The one network call — asking SendGrid whether the
 * From domain is authenticated — is cached for ten minutes per account and
 * bounded to a few seconds, so this stays cheap enough to run on every
 * Schedule-step render as well as inside the send gate.
 */
export async function preflightEmailBlast(
  input: PreflightInput,
): Promise<PreflightResult> {
  const issues: PreflightIssue[] = [];

  // ── Content-level checks (account-independent) ──
  if (!input.subject.trim()) {
    issues.push({
      severity: 'blocker',
      code: PREFLIGHT_CODES.NO_SUBJECT,
      accountKey: '',
      message: 'This blast has no subject line.',
      remedy: 'Add a subject on the Message step.',
    });
  }
  if (!input.htmlContent.trim()) {
    issues.push({
      severity: 'blocker',
      code: PREFLIGHT_CODES.NO_BODY,
      accountKey: '',
      message: 'This blast has no message body.',
      remedy: 'Build or pick a template on the Message step.',
    });
  }

  const accountKeys = [...new Set(input.accountKeys.filter(Boolean))];

  const accounts = accountKeys.length > 0
    ? await prisma.account.findMany({
        where: { key: { in: accountKeys } },
        select: {
          key: true,
          dealer: true,
          senderEmail: true,
          sendgridApiKey: true,
          sendgridFromDomain: true,
          address: true,
          city: true,
          state: true,
          postalCode: true,
        },
      })
    : [];
  const liveKeys = accounts.map((a) => a.key);
  const labels = new Map(accounts.map((a) => [a.key, a.dealer || a.key]));

  // The same account data the send loads, so a tag is judged against exactly
  // what will fill it.
  const merge = liveKeys.length > 0
    ? await loadBlastAccountData(liveKeys)
    : new Map<string, LoadedBlastAccount>();

  // Tag validation needs a context whose SHAPE matches send time. An empty
  // contact is exactly right: which keys exist is all that matters here.
  const shapeCtx = buildBlastMergetagContext({
    contact: null,
    account: liveKeys.length > 0 ? merge.get(liveKeys[0]) ?? null : null,
    unsubscribeToken: '#',
  });

  const sources = contentSources(input);
  issues.push(...checkTagSyntax(sources, shapeCtx));
  const customValues = await checkCustomValues(sources, liveKeys, merge, labels);
  issues.push(...customValues.issues);
  issues.push(
    ...checkContentHygiene(input.htmlContent, liveKeys, merge, labels, customValues.reported),
  );

  // Ask SendGrid about every account's From domain at once.
  const domainChecks = await Promise.all(
    accounts.map(async (account): Promise<[string, DomainAuthResult | null]> => {
      const senderEmail = (account.senderEmail || '').trim();
      if (!account.sendgridApiKey || !senderEmail) return [account.key, null];
      let apiKey: string;
      try {
        apiKey = decryptToken(account.sendgridApiKey);
      } catch {
        return [account.key, null];
      }
      return [account.key, await checkSenderDomainAuth({ apiKey, fromEmail: senderEmail })];
    }),
  );
  const domainAuth = new Map(domainChecks);

  // ── Per-account sender identity + compliance ──
  const found = new Map(accounts.map((a) => [a.key, a]));
  for (const key of accountKeys) {
    const account = found.get(key);
    if (!account) {
      issues.push({
        severity: 'blocker',
        code: PREFLIGHT_CODES.NO_SENDER_EMAIL,
        accountKey: key,
        message: `Account "${key}" no longer exists.`,
        remedy: 'Reselect recipients on the Recipients step.',
      });
      continue;
    }

    const label = account.dealer || key;

    // 1. A per-account SendGrid key. Without one the send would fall back
    //    to the shared SMTP transport, which is the exact path that landed
    //    a blast in spam before. Blasts are no longer allowed on it.
    if (!account.sendgridApiKey) {
      issues.push({
        severity: 'blocker',
        code: PREFLIGHT_CODES.NO_SENDGRID_KEY,
        accountKey: key,
        message: `${label} has no SendGrid API key, so this blast has no compliant way to send.`,
        remedy: `Add a SendGrid API key under Settings → Email & Texts → Sending Config for ${label}.`,
      });
    } else {
      // Ciphertext that won't decrypt is as good as absent — the worker
      // treats it as "no SendGrid", so catch it here instead of at send.
      try {
        decryptToken(account.sendgridApiKey);
      } catch {
        issues.push({
          severity: 'blocker',
          code: PREFLIGHT_CODES.BAD_SENDGRID_KEY,
          accountKey: key,
          message: `${label}'s stored SendGrid key can't be decrypted.`,
          remedy: `Re-enter the API key under Settings → Email & Texts → Sending Config for ${label}.`,
        });
      }
    }

    // 2. A From address on a domain SendGrid will actually sign for.
    const senderEmail = (account.senderEmail || '').trim();
    const auth = domainAuth.get(key) ?? null;
    if (!senderEmail) {
      issues.push({
        severity: 'blocker',
        code: PREFLIGHT_CODES.NO_SENDER_EMAIL,
        accountKey: key,
        message: `${label} has no From address, so the blast would send from the shared Loomi address.`,
        remedy: `Set the From address under Settings → Email & Texts → Sending Config for ${label}.`,
      });
    } else if (auth && (auth.status === 'not_authenticated' || auth.status === 'invalid')) {
      // Unaligned DKIM is a near-guaranteed spam placement, and under Gmail's
      // and Yahoo's bulk-sender rules often an outright rejection.
      issues.push({
        severity: 'blocker',
        code: PREFLIGHT_CODES.SENDER_DOMAIN_UNAUTHENTICATED,
        accountKey: key,
        message: `${label} sends from ${senderEmail}, but ${auth.detail} Its mail would fail DMARC alignment and land in spam or be rejected.`,
        remedy: auth.status === 'invalid'
          ? `Publish the DNS records shown for ${auth.fromDomain} in SendGrid → Settings → Sender Authentication, click Verify there, then run Verify Connection under Settings → Email & Texts → Sending Config.`
          : `Authenticate ${auth.fromDomain} in SendGrid → Settings → Sender Authentication${auth.availableDomains.length > 0 ? `, or send from an address on ${auth.availableDomains.join(' or ')}` : ''}, then run Verify Connection under Settings → Email & Texts → Sending Config.`,
      });
    } else if (auth && auth.status === 'key_rejected') {
      issues.push({
        severity: 'blocker',
        code: PREFLIGHT_CODES.BAD_SENDGRID_KEY,
        accountKey: key,
        message: `SendGrid rejected ${label}'s API key, so nothing would send.`,
        remedy: `Create a new key in SendGrid and enter it under Settings → Email & Texts → Sending Config for ${label}.`,
      });
    } else if (!auth || auth.status !== 'authenticated') {
      // SendGrid couldn't be asked (or the key can't read Sender
      // Authentication). Don't block on our network blip — say so, and fall
      // back to the domain the account recorded.
      if (auth) {
        issues.push({
          severity: 'warning',
          code: PREFLIGHT_CODES.DOMAIN_AUTH_UNVERIFIED,
          accountKey: key,
          message: `Couldn't confirm with SendGrid that ${domainOf(senderEmail)} is authenticated for ${label}: ${auth.detail}`,
          remedy: auth.status === 'no_permission'
            ? `Give ${label}'s SendGrid key read access to Sender Authentication, or run Verify Connection under Settings → Email & Texts → Sending Config.`
            : 'Try again in a minute, or run Verify Connection under Settings → Email & Texts → Sending Config.',
        });
      }
      if (!account.sendgridFromDomain) {
        issues.push({
          severity: 'warning',
          code: PREFLIGHT_CODES.NO_FROM_DOMAIN,
          accountKey: key,
          message: `${label} has no authenticated sending domain recorded, so SPF/DKIM alignment can't be confirmed.`,
          remedy: 'Add the authenticated domain under Settings → Email & Texts → Sending Config, then run Verify Connection.',
        });
      } else if (!domainCovers(account.sendgridFromDomain, domainOf(senderEmail))) {
        issues.push({
          severity: 'blocker',
          code: PREFLIGHT_CODES.SENDER_DOMAIN_MISMATCH,
          accountKey: key,
          message: `${label} sends from ${senderEmail} but only ${account.sendgridFromDomain} is authenticated — DKIM won't align.`,
          remedy: `Either send from an address on ${account.sendgridFromDomain}, or authenticate ${domainOf(senderEmail)} in SendGrid and record it under Settings → Email & Texts → Sending Config.`,
        });
      }
    }

    // 3. CAN-SPAM requires the sender's physical postal address in every
    //    commercial message. buildUnsubscribeFooter drops missing pieces
    //    silently, so without this check the footer just quietly ships
    //    non-compliant.
    const hasAddress = Boolean(
      (account.address || '').trim()
      && (account.city || '').trim()
      && (account.state || '').trim()
      && (account.postalCode || '').trim(),
    );
    if (!hasAddress) {
      issues.push({
        severity: 'blocker',
        code: PREFLIGHT_CODES.NO_PHYSICAL_ADDRESS,
        accountKey: key,
        message: `${label} has no complete mailing address, which CAN-SPAM requires in the footer of every commercial email.`,
        remedy: `Add street, city, state, and ZIP under Settings → Email & Texts → Sending Config for ${label}.`,
      });
    }
  }

  // ── Footer legibility ──
  //
  // A footer colored the same as its background hides the postal address
  // and the unsubscribe link. The renderer falls back to readable colors, so
  // this is a warning: the send is safe, the setting is still wrong.
  if (liveKeys.length > 0) {
    let footers: Map<string, ResolvedFooter> | null = null;
    try {
      footers = await resolveAccountFooters(liveKeys);
    } catch (err) {
      console.error('[blast-preflight] footer lookup failed:', err);
    }
    for (const key of liveKeys) {
      const problems = footerContrastProblems(footers?.get(key)?.config);
      if (problems.length === 0) continue;
      const label = labels.get(key) || key;
      const which = problems.map((p) => (p.field === 'textColor' ? 'text' : 'link')).join(' and ');
      issues.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.FOOTER_LOW_CONTRAST,
        accountKey: key,
        message: `${label}'s email footer ${which} color is too close to its background to read, so the postal address and unsubscribe link would be invisible. Loomi will send the footer in the default colors instead.`,
        remedy: `Pick a footer ${which} color that stands out from the background under Settings → Email & Texts → Email Footer for ${label}.`,
      });
    }
  }

  // ── Audience quality, per sending account ──
  //
  // Runs last because it is the only part that needs the recipient list, and
  // the only part that reads history rather than configuration.
  const recipients = input.recipients ?? [];
  if (recipients.length > 0) {
    for (const key of accountKeys) {
      const emails = recipients
        .filter((r) => r.accountKey === key && r.email)
        .map((r) => r.email);
      if (emails.length === 0) continue;
      const risk = await assessAudienceRisk(key, emails);
      issues.push(...audienceRiskIssues(risk, key));
    }
  }

  return {
    ok: !issues.some((i) => i.severity === 'blocker'),
    issues,
  };
}

/**
 * One-line summary of the blockers, for an API error body or a toast.
 */
export function formatPreflightBlockers(result: PreflightResult): string {
  const blockers = result.issues.filter((i) => i.severity === 'blocker');
  if (blockers.length === 0) return '';
  return blockers.map((b) => `${b.message} ${b.remedy}`).join(' ');
}

/**
 * Formerly a warning on every blast without a hand-written text/plain part.
 *
 * It fired on essentially every send and told people to write one on the
 * Message step, which has no field for it. The worker now generates a proper
 * text part (lib/sending/html-to-text.ts) — links, alt text and the
 * unsubscribe URL included — so there is nothing left to warn about.
 *
 * @deprecated Always returns null; kept so existing callers compile. Remove
 * the call.
 */
export function checkTextPart(
  _htmlContent: string,
  _textContent: string | null | undefined,
): PreflightIssue | null {
  return null;
}

/** Re-exported so callers can render a preview through the same code path. */
export { applyBlastMergetags };
