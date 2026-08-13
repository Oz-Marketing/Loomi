import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  getPublishedLandingPageById,
  getPublishedLandingPageBySlug,
  getPublishedLandingPageByAccountAndSlug,
  type LandingPageDetail,
} from '@/lib/services/landing-pages';
import { findVerifiedDomainByHostname } from '@/lib/services/account-domains';
import { getPublishedFormById } from '@/lib/services/forms';
import { getSnippetsByIds } from '@/lib/services/account-snippets';
import {
  collectFormIdsFromContent,
  collectSnippetIds,
  isHtmlLandingPageTemplate,
  isV1LandingPageTemplate,
} from '@/lib/landing-pages/types';
import {
  LandingPageRenderer,
  type PreloadedForm,
  type PreloadedSnippet,
} from '@/lib/landing-pages/render';
import { PublicHtmlLandingPage } from '@/lib/landing-pages/PublicHtmlLandingPage';
import { LpTracker } from '@/lib/landing-pages/LpTracker';
import { LpTrackingScripts } from '@/lib/landing-pages/LpTrackingScripts';
import { LpJsonLd } from '@/lib/landing-pages/LpJsonLd';
import { LpAttributionProvider } from '@/lib/landing-pages/lp-attribution-context';
import { collectFieldBlocks, getFieldName, parseFormTemplate } from '@/lib/forms/types';
import { parseEmbedParams, type RawSearchParams } from '@/lib/forms/embed-params';

// Sentinel slug used by middleware when a custom-domain visitor hits
// the root path — resolved here to the domain's `homeLandingPageId`.
const HOME_SENTINEL = '__home__';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<RawSearchParams>;
}

/**
 * Resolve which LandingPage to render for a given request.
 *
 * Three paths:
 *   1. Studio base host (`studio.loomilm.com`) — global slug lookup
 *      (the historical behavior; back-compat for direct links).
 *   2. Verified AccountDomain + slug — scope the lookup to the
 *      domain's owning account. Two accounts could in theory share
 *      a slug; we always pick the one tied to the requesting host.
 *   3. Verified AccountDomain + `__home__` sentinel — resolve to the
 *      domain's configured `homeLandingPageId`. Null/missing → 404.
 *
 * The host header survives `NextResponse.rewrite` from middleware so
 * we read it via `next/headers` rather than passing it as a prop.
 */
async function resolveLandingPage(slug: string): Promise<LandingPageDetail | null> {
  const host = await readHost();
  const onCustomDomain = host ? await findVerifiedDomainByHostname(host) : null;

  if (onCustomDomain) {
    if (slug === HOME_SENTINEL) {
      if (!onCustomDomain.homeLandingPageId) return null;
      return getPublishedLandingPageById(onCustomDomain.homeLandingPageId);
    }
    return getPublishedLandingPageByAccountAndSlug(onCustomDomain.accountKey, slug);
  }

  // Sentinel only makes sense on a custom domain — a direct hit to
  // /lp/__home__ on the studio host has nothing to resolve to.
  if (slug === HOME_SENTINEL) return null;
  return getPublishedLandingPageBySlug(slug);
}

async function readHost(): Promise<string | null> {
  try {
    const headerStore = await headers();
    const raw = headerStore.get('host');
    return raw ? raw.toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = await resolveLandingPage(slug);
  if (!page) return { robots: 'noindex' };

  const title = page.seoTitle?.trim() || page.name || 'Loomi page';
  const description = page.seoDescription?.trim() || undefined;
  const ogImage = page.ogImageUrl?.trim();
  const favicon = page.faviconUrl?.trim();

  return {
    title,
    description,
    // `noindex` LPs ship `noindex, nofollow` — used for drafts that
    // happen to be public (preview links), seasonal pages we don't
    // want lingering in search, or internal-only campaigns. Default is
    // index, follow so published LPs are crawlable out of the box.
    robots: page.noindex ? 'noindex, nofollow' : 'index, follow',
    // Per-LP favicon if configured. Next merges this into the head as
    // <link rel="icon" href=...>; falls back to the studio default
    // when null.
    icons: favicon ? { icon: favicon } : undefined,
    openGraph: {
      title,
      description,
      url: page.publicUrl,
      type: 'website',
      images: ogImage ? [{ url: ogImage }] : undefined,
    },
    twitter: {
      card: ogImage ? 'summary_large_image' : 'summary',
      title,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

/**
 * Public landing-page route — served at /lp/<slug> on the studio host
 * AND on any verified custom-domain host (middleware rewrites those
 * to /lp/<slug> so this single route handles every visitor).
 *
 * Unauthenticated. 404s when the page is missing or in draft.
 * Pre-fetches the schema of every `embedded_form` block on the page
 * so anonymous visitors don't need to round-trip through the
 * authenticated /api/forms/[id] endpoint just to see a form inline.
 * Forms that have been unpublished since the LP was edited are
 * silently dropped from the preload map; the EmbeddedForm block
 * renders its "form not found" placeholder in that case.
 */
export default async function PublicLandingPage({ params, searchParams }: PageProps) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const page = await resolveLandingPage(slug);
  if (!page) notFound();

  // Walk the schema for embedded form ids (blocks-mode embedded_form
  // blocks OR html-mode data-loomi-form placeholders) and fetch each
  // in parallel. We intentionally bypass account scoping (this is the
  // public page) and require the form to be published — a draft form
  // embedded on a published LP shouldn't leak.
  const formIds = collectFormIdsFromContent(page.schema);
  const preloaded = new Map<string, PreloadedForm>();
  if (formIds.length > 0) {
    const forms = await Promise.all(formIds.map((id) => getPublishedFormById(id)));
    for (let i = 0; i < forms.length; i++) {
      const form = forms[i];
      if (!form) continue;
      // The Form service returns schema already parsed, but be
      // defensive — parseFormTemplate handles the raw JSON case too.
      const schema = parseFormTemplate(form.schema as unknown);
      if (!schema) continue;
      // `note_`/`meta_` params on the LP's own URL, resolved per form:
      // an LP can host two forms, and a note may only address fields
      // the form in hand actually declares. Done here on the server so
      // the override is in the form's first render, not swapped in
      // after a client effect.
      const { noteOverrides, metadata } = parseEmbedParams(
        sp,
        new Set(collectFieldBlocks(schema).map(getFieldName)),
      );
      preloaded.set(formIds[i], { slug: form.slug, schema, noteOverrides, metadata });
    }
  }

  // Resolve referenced snippets in one round-trip. Snippets are
  // account-scoped — a snippet ref to another account's snippet won't
  // resolve, and the renderer shows a "missing" placeholder for any
  // id that doesn't come back. Skipped for HTML-mode pages (no block
  // tree to walk).
  const preloadedSnippets = new Map<string, PreloadedSnippet>();
  if (isV1LandingPageTemplate(page.schema)) {
    const snippetIds = collectSnippetIds(page.schema);
    if (snippetIds.length > 0) {
      const resolved = await getSnippetsByIds(snippetIds, page.accountKey);
      for (const [id, snippet] of resolved) {
        preloadedSnippets.set(id, {
          id: snippet.id,
          name: snippet.name,
          blocks: snippet.schema.blocks,
        });
      }
    }
  }

  // Tracker is a sibling of the rendered page tree — same mount
  // point for both blocks and html-mode pages. It's a no-op outside
  // the browser, so server render isn't affected.
  const tracker = <LpTracker pageId={page.id} slug={page.slug} />;

  // Vendor pixels + custom HTML the user configured in the settings
  // modal. Returns null when nothing is configured, so empty pages
  // skip the extra render work.
  const trackingScripts = (
    <LpTrackingScripts
      metaPixelId={page.metaPixelId}
      ga4MeasurementId={page.ga4MeasurementId}
      gtmContainerId={page.gtmContainerId}
      customHeadHtml={page.customHeadHtml}
      customBodyEndHtml={page.customBodyEndHtml}
    />
  );

  // Attribution provider wraps every render path so embedded forms
  // can stamp this LP's id + slug onto their submissions.
  const attribution = { pageId: page.id, pageSlug: page.slug };

  // Structured data for search engines — only emit when the page is
  // crawlable. No point feeding Schema.org markup for a page we've
  // told them to noindex.
  const jsonLd = page.noindex ? null : (
    <LpJsonLd
      url={page.publicUrl}
      name={page.seoTitle?.trim() || page.name}
      description={page.seoDescription}
      imageUrl={page.ogImageUrl}
      publishedAt={page.publishedAt || null}
      updatedAt={page.updatedAt}
    />
  );

  if (isHtmlLandingPageTemplate(page.schema)) {
    return (
      <LpAttributionProvider value={attribution}>
        <PublicHtmlLandingPage
          html={page.schema.html}
          preloadedForms={preloaded}
          attribution={attribution}
        />
        {tracker}
        {trackingScripts}
        {jsonLd}
      </LpAttributionProvider>
    );
  }

  return (
    <LpAttributionProvider value={attribution}>
      <LandingPageRenderer
        template={page.schema}
        preloadedForms={preloaded}
        preloadedSnippets={preloadedSnippets}
      />
      {tracker}
      {trackingScripts}
      {jsonLd}
    </LpAttributionProvider>
  );
}
