// UTM link tagging for email blasts.
//
// The Schedule step has collected these settings into metadata.utm since the
// feature shipped, and saved them correctly — but nothing ever read them back
// out. parseCampaignMetadata() pulled only `sourceType` and dropped the rest,
// so every blast sent untagged and every click landed in analytics as direct
// traffic. This is the missing half.
//
// It APPENDS to the link exactly as written rather than round-tripping it
// through `new URL()`. The first version parsed the raw attribute and let
// URLSearchParams re-serialize the query, which corrupted real links:
// react-email writes `&` as `&amp;` inside an href, so
// `?make=Honda&amp;model=Accord` came back as `?make=Honda&amp%3Bmodel=Accord`
// (one parameter, named "amp;model"); `%20` became `+`, `,` became `%2C`, and
// any signed URL failed its signature check. Existing parameters are now
// carried byte-for-byte; only the new ones are encoded.

import { decodeHtmlEntities } from '@/lib/sending/html-entities';

export interface BlastUtmSettings {
  enabled: boolean;
  source: string;
  medium: string;
  campaign: string;
  term: string;
  content: string;
}

/** Matches the href of an anchor tag, capturing the quote style used. */
const HREF_PATTERN = /(<a\b[^>]*\bhref=)(["'])(.*?)\2/gi;

/**
 * Query parameters that mark a signed URL. Anything appended after signing
 * invalidates the signature (S3/GCS presigned links, CloudFront and Azure
 * SAS URLs), so those links are left exactly as they are.
 */
const SIGNED_URL_PARAM = /(?:^|[?&])(?:x-amz-signature|x-goog-signature|signature|sig)=/i;

/** Re-encode a URL for the attribute it came from. */
function encodeAttribute(value: string, quote: string): string {
  let out = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  out = quote === '"' ? out.replace(/"/g, '&quot;') : out.replace(/'/g, '&#39;');
  return out;
}

/** Parameter NAMES already on a query string, decoded leniently. */
function existingParamNames(query: string): Set<string> {
  const names = new Set<string>();
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const rawName = pair.split('=')[0].replace(/\+/g, ' ');
    try {
      names.add(decodeURIComponent(rawName));
    } catch {
      names.add(rawName);
    }
  }
  return names;
}

/**
 * Append UTM parameters to one decoded http(s) URL. Returns null when the
 * URL should be left alone.
 */
export function appendUtmParams(
  href: string,
  params: [string, string][],
): string | null {
  if (!/^https?:\/\//i.test(href)) return null;
  // A mergetag or a SendGrid substitution token resolves later — appending
  // to `[%unsubscribe_url%]` would corrupt the one link that legally has to
  // work, and to `{{location.website}}` would glue params onto a host we
  // can't see yet.
  if (href.includes('[%') || href.includes('{{')) return null;
  try {
    // Validation only. The URL object's serialization is never used.
    new URL(href);
  } catch {
    return null;
  }

  const hashAt = href.indexOf('#');
  const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt);
  const fragment = hashAt === -1 ? '' : href.slice(hashAt);
  const queryAt = beforeHash.indexOf('?');
  const base = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt === -1 ? '' : beforeHash.slice(queryAt + 1);

  if (SIGNED_URL_PARAM.test(`?${query}`)) return null;

  // A hand-tagged link in the template is a deliberate choice and outranks
  // the campaign default.
  const present = existingParamNames(query);
  const additions = params
    .filter(([key]) => !present.has(key))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
  if (additions.length === 0) return href;

  const joiner = query === '' || query.endsWith('&') ? '' : '&';
  return `${base}?${query}${joiner}${additions.join('&')}${fragment}`;
}

/**
 * Append UTM parameters to every http(s) link in `html`.
 *
 * Deliberate behaviors:
 *  - A parameter the link ALREADY carries is left alone.
 *  - The existing query string is preserved byte-for-byte and the fragment
 *    stays last.
 *  - Non-http schemes (mailto:, tel:, #anchor) and relative links are skipped.
 *  - URLs holding a mergetag or a SendGrid substitution token are skipped
 *    entirely, as are signed URLs.
 */
export function applyUtmTags(
  html: string,
  utm: BlastUtmSettings | null,
): string {
  if (!html || !utm?.enabled) return html;

  const params: [string, string][] = (
    [
      ['utm_source', utm.source],
      ['utm_medium', utm.medium],
      ['utm_campaign', utm.campaign],
      ['utm_term', utm.term],
      ['utm_content', utm.content],
    ] as [string, string | undefined][]
  )
    .filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()))
    .map(([key, value]) => [key, value.trim()]);

  if (params.length === 0) return html;

  return html.replace(
    HREF_PATTERN,
    (match, prefix: string, quote: string, rawHref: string) => {
      // The attribute is HTML: `&amp;` in it is a literal `&` in the URL.
      const href = decodeHtmlEntities(rawHref.trim());
      const tagged = appendUtmParams(href, params);
      if (tagged === null || tagged === href) return match;
      return `${prefix}${quote}${encodeAttribute(tagged, quote)}${quote}`;
    },
  );
}
