// UTM link tagging for email blasts.
//
// The Schedule step has collected these settings into metadata.utm since the
// feature shipped, and saved them correctly — but nothing ever read them back
// out. parseCampaignMetadata() pulled only `sourceType` and dropped the rest,
// so every blast sent untagged and every click landed in analytics as direct
// traffic. This is the missing half.

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
 * Append UTM parameters to every http(s) link in `html`.
 *
 * Deliberate behaviours:
 *  - A parameter the link ALREADY carries is left alone. A hand-tagged link in
 *    the template is a deliberate choice and outranks the campaign default.
 *  - Existing query strings and fragments survive (URL handles both).
 *  - Non-http schemes (mailto:, tel:, #anchor) are skipped.
 *  - URLs holding a mergetag or a SendGrid substitution token are skipped
 *    entirely: appending query params to `[%unsubscribe_url%]` would corrupt
 *    the one link that legally has to work.
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
      const href = rawHref.trim();
      if (!/^https?:\/\//i.test(href)) return match;
      if (href.includes('[%') || href.includes('{{')) return match;

      let url: URL;
      try {
        url = new URL(href);
      } catch {
        return match;
      }
      for (const [key, value] of params) {
        if (!url.searchParams.has(key)) url.searchParams.set(key, value);
      }
      return `${prefix}${quote}${url.toString()}${quote}`;
    },
  );
}
