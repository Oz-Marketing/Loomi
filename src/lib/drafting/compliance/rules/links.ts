import { UTM_CAMPAIGN_PATTERN, UTM_MEDIUM, UTM_SOURCE } from '../../utm';
import { anchors } from '../html';
import type { DraftRule, Finding } from '../types';

function shortUrl(href: string): string {
  return href.length > 70 ? `${href.slice(0, 67)}…` : href;
}

export const utmRule: DraftRule = {
  id: 'links.utm',
  scope: {},
  summary: 'Every link carries utm_source=email, utm_medium=email, the campaign slug, and its own utm_content.',
  check(a) {
    const findings: Finding[] = [];
    if (!UTM_CAMPAIGN_PATTERN.test(a.utmCampaign)) {
      findings.push({
        severity: 'error',
        message: `utm_campaign "${a.utmCampaign}" isn't a slug ending in the month and year, e.g. cx-90-monthly-offer-october-2026.`,
        excerpt: a.utmCampaign,
      });
    }

    const contentFirstSeen = new Map<string, number>();
    for (const link of anchors(a.html)) {
      // Phone, mail and in-page links aren't tracked; a URL carrying a merge
      // token is filled per recipient, so tagging it would corrupt the token.
      if (!/^https?:\/\//i.test(link.href)) continue;
      if (link.href.includes('{{') || link.href.includes('[%')) continue;

      const where = `link ${link.index}`;
      let params: URLSearchParams;
      try {
        params = new URL(link.href).searchParams;
      } catch {
        findings.push({ severity: 'error', message: `${where} isn't a valid URL.`, where, excerpt: link.href });
        continue;
      }

      const problems: string[] = [];
      if (params.get('utm_source') !== UTM_SOURCE) problems.push(`utm_source=${UTM_SOURCE}`);
      if (params.get('utm_medium') !== UTM_MEDIUM) problems.push(`utm_medium=${UTM_MEDIUM}`);
      if (params.get('utm_campaign') !== a.utmCampaign) problems.push(`utm_campaign=${a.utmCampaign}`);
      const content = params.get('utm_content')?.trim() ?? '';
      if (!content) problems.push('a utm_content of its own');
      if (problems.length) {
        findings.push({
          severity: 'error',
          message: `${where} (${link.text || 'image'}) is missing ${problems.join(', ')}.`,
          where,
          excerpt: shortUrl(link.href),
        });
      }

      if (content) {
        const first = contentFirstSeen.get(content);
        if (first !== undefined) {
          findings.push({
            severity: 'error',
            message: `Links ${first} and ${link.index} share utm_content "${content}". Each link needs its own, or their clicks can't be told apart.`,
            where,
          });
        } else {
          contentFirstSeen.set(content, link.index);
        }
      }
    }
    return findings;
  },
};
