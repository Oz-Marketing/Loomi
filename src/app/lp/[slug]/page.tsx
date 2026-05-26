import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPublishedLandingPageBySlug } from '@/lib/services/landing-pages';
import { getPublishedFormById } from '@/lib/services/forms';
import { collectEmbeddedFormIds } from '@/lib/landing-pages/types';
import { LandingPageRenderer, type PreloadedForm } from '@/lib/landing-pages/render';
import { parseFormTemplate } from '@/lib/forms/types';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPublishedLandingPageBySlug(slug);
  if (!page) return { robots: 'noindex' };

  const title = page.seoTitle?.trim() || page.name || 'Loomi page';
  const description = page.seoDescription?.trim() || undefined;
  const ogImage = page.ogImageUrl?.trim();

  return {
    title,
    description,
    robots: 'index, follow',
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
 * Public landing-page route — served at /lp/<slug>.
 *
 * Unauthenticated. 404s when the page is missing or in draft.
 * Pre-fetches the schema of every `embedded_form` block on the page
 * so anonymous visitors don't need to round-trip through the
 * authenticated /api/forms/[id] endpoint just to see a form inline.
 * Forms that have been unpublished since the LP was edited are
 * silently dropped from the preload map; the EmbeddedForm block
 * renders its "form not found" placeholder in that case.
 */
export default async function PublicLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const page = await getPublishedLandingPageBySlug(slug);
  if (!page) notFound();

  // Walk the schema for embedded_form ids and fetch each in parallel.
  // We intentionally bypass account scoping (this is the public page)
  // and require the form to be published — a draft form embedded on
  // a published LP shouldn't leak.
  const formIds = collectEmbeddedFormIds(page.schema);
  const preloaded = new Map<string, PreloadedForm>();
  if (formIds.length > 0) {
    const forms = await Promise.all(formIds.map((id) => getPublishedFormById(id)));
    for (let i = 0; i < forms.length; i++) {
      const form = forms[i];
      if (!form) continue;
      // The Form service returns schema already parsed, but be
      // defensive — parseFormTemplate handles the raw JSON case too.
      const schema = parseFormTemplate(form.schema as unknown);
      if (schema) preloaded.set(formIds[i], { schema });
    }
  }

  return <LandingPageRenderer template={page.schema} preloadedForms={preloaded} />;
}
