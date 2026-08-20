/**
 * Client-safe docs types, labels, and the visibility rule.
 *
 * Imported by both the server routes and the `/docs` UI, so nothing in here may
 * reach for prisma or for `process.env` — see `src/lib/changelog.ts` for the
 * same split.
 */
import type { Sector } from '@/lib/permissions/registry';

/**
 * A doc's home. Four of these are the permission registry's sectors; `platform`
 * is the fifth, for the cross-cutting articles — accounts and scope, roles,
 * notifications, integrations — that belong to every sector and therefore to
 * none of them.
 */
export type DocSector = Sector | 'platform';

export const DOC_SECTORS: DocSector[] = [
  'platform',
  'studio',
  'reporting',
  'projects',
  'agency',
];

export const DOC_SECTOR_META: Record<
  DocSector,
  { label: string; blurb: string }
> = {
  platform: {
    label: 'Getting started',
    blurb: 'How Loomi is put together — accounts, roles, notifications, and the systems it talks to.',
  },
  studio: {
    label: 'Studio',
    blurb: 'Audiences, campaigns, templates, flows, forms and landing pages, ad creative, and assets.',
  },
  reporting: {
    label: 'Reporting',
    blurb: 'The client-facing dashboards: ads, websites, local presence, sales and service.',
  },
  projects: {
    label: 'Projects & Pacing',
    blurb: 'Internal delivery — initiatives, tasks, budgets, and the Meta and Google pacing tools.',
  },
  agency: {
    label: 'Agency admin',
    blurb: 'Platform configuration: accounts, users, industries, markup, alerts, and co-op rules.',
  },
};

/** Who the article is written for. Same contract as `ChangelogEntry.audience`. */
export type DocAudience = 'everyone' | 'staff';

export const DOC_AUDIENCES: DocAudience[] = ['everyone', 'staff'];

export const DOC_AUDIENCE_META: Record<
  DocAudience,
  { label: string; description: string }
> = {
  everyone: {
    label: 'Everyone',
    description:
      'Visible to clients as well as staff. Write it for the person doing the job, not for the person who built it.',
  },
  staff: {
    label: 'Staff only',
    description:
      'Internal. Runbooks, ops procedures, and anything that names infrastructure or another client.',
  },
};

export type DocStatus = 'draft' | 'published';

export interface DocArticle {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  sector: DocSector;
  category: string;
  audience: DocAudience;
  status: DocStatus;
  order: number;
  covers: string[];
  needsReview: boolean;
  reviewNote: string | null;
  reviewedAt: string | null;
  sourceKey: string | null;
  editedInApp: boolean;
  updatedBy: string | null;
  updatedAt: string;
}

/** The list shape — everything but the body, which is only fetched per article. */
export type DocArticleSummary = Omit<DocArticle, 'body'>;

// ── Visibility ─────────────────────────────────────────────────────────────

/**
 * Whether a reader may see an article.
 *
 * Two independent gates, and they fail in opposite directions on purpose:
 *
 * - **Audience** is the hard boundary. A `staff` article is never shown to a
 *   client tier, whatever their sector roles say. This one closes by default.
 * - **Sector** is organization, and it only ever NARROWS a client. Staff see
 *   every sector, because `sectorRoles` is empty on a token minted before the
 *   permission migration and on any staff user nobody has assigned yet — and
 *   hiding the whole library from an admin because their roles are unset is a
 *   far worse failure than showing them a Projects article they don't need.
 *
 * So: clients get published `everyone` articles in the sectors they can enter;
 * staff get everything published. Drafts are staff-only regardless.
 */
export function canReadDoc(
  article: Pick<DocArticleSummary, 'audience' | 'sector' | 'status'>,
  reader: { isClient: boolean; sectors: DocSector[] },
): boolean {
  if (!reader.isClient) return true;

  if (article.status !== 'published') return false;
  if (article.audience !== 'everyone') return false;
  // `platform` is the shared preamble — how accounts and logging in work. A
  // client with any sector at all is entitled to that much.
  if (article.sector === 'platform') return reader.sectors.length > 0;
  return reader.sectors.includes(article.sector);
}

// ── Grouping ───────────────────────────────────────────────────────────────

export interface DocCategoryGroup {
  category: string;
  articles: DocArticleSummary[];
}

export interface DocSectorGroup {
  sector: DocSector;
  label: string;
  blurb: string;
  categories: DocCategoryGroup[];
}

/**
 * Group a flat list into sector → category → articles, in registry order rather
 * than alphabetically. A table of contents that reorders itself when an article
 * is renamed is not a table of contents.
 */
export function groupDocs(articles: DocArticleSummary[]): DocSectorGroup[] {
  return DOC_SECTORS.map((sector) => {
    const mine = articles
      .filter((a) => a.sector === sector)
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

    const categories: DocCategoryGroup[] = [];
    for (const article of mine) {
      const existing = categories.find((c) => c.category === article.category);
      if (existing) existing.articles.push(article);
      else categories.push({ category: article.category, articles: [article] });
    }

    return {
      sector,
      label: DOC_SECTOR_META[sector].label,
      blurb: DOC_SECTOR_META[sector].blurb,
      categories,
    };
  }).filter((group) => group.categories.length > 0);
}

// ── Search ─────────────────────────────────────────────────────────────────

/**
 * Rank articles against a query. Title matches outrank summary matches, which
 * outrank category matches — so typing "segment" surfaces the Segments article
 * above the six that mention segments in passing.
 *
 * Deliberately in-memory: the whole library is a few hundred rows and already
 * loaded on the index page, so a round trip per keystroke buys nothing.
 */
export function searchDocs(
  articles: DocArticleSummary[],
  query: string,
): DocArticleSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return articles;
  const terms = q.split(/\s+/);

  const scored = articles
    .map((article) => {
      const title = article.title.toLowerCase();
      const summary = article.summary.toLowerCase();
      const category = article.category.toLowerCase();

      let score = 0;
      for (const term of terms) {
        if (title.startsWith(term)) score += 12;
        else if (title.includes(term)) score += 8;
        else if (summary.includes(term)) score += 3;
        else if (category.includes(term)) score += 2;
        else return null; // every term must land somewhere
      }
      return { article, score };
    })
    .filter((x): x is { article: DocArticleSummary; score: number } => x !== null);

  return scored
    .sort((a, b) => b.score - a.score || a.article.title.localeCompare(b.article.title))
    .map((x) => x.article);
}
