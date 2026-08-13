import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPublishedFormBySlug } from '@/lib/services/forms';
import { FormPublic } from '@/components/forms/form-public';
import { getTurnstileSiteKey } from '@/lib/forms/turnstile';
import { collectFieldBlocks, getFieldName } from '@/lib/forms/types';
import { parseEmbedParams, type RawSearchParams } from '@/lib/forms/embed-params';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<RawSearchParams>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const form = await getPublishedFormBySlug(slug);
  return {
    title: form?.name || 'Form',
    // Indexable by default; admin can change later via per-form SEO settings.
    robots: form ? 'index, follow' : 'noindex',
  };
}

/**
 * Public form page — served at /f/[slug].
 *
 * Unauthenticated. Returns 404 when the form doesn't exist or isn't
 * published. Detects `?embed=1` to know the page is being iframed so
 * the client component can post height messages to the parent window
 * for the auto-resize embed.
 *
 * Also parses the embed's `note_*` / `meta_*` params here, on the
 * server, rather than in a client effect — the overridden help text has
 * to be in the first paint or the visitor sees the builder's default
 * flash before the vehicle-specific note replaces it.
 */
export default async function PublicFormPage({ params, searchParams }: PageProps) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);

  const form = await getPublishedFormBySlug(slug);
  if (!form) notFound();

  const embed = sp.embed === '1' || sp.embed === 'true';
  // Public site key — when null, FormPublic skips rendering the
  // widget entirely. The server-side verifier in submit.ts is the
  // source of truth for whether a token is actually required, so a
  // misconfigured deploy (secret set but no public site key) fails
  // closed with a helpful error rather than silently accepting bots.
  const turnstileSiteKey = getTurnstileSiteKey();

  // `note_` params may only address fields this form declares, so the
  // parser needs the form's field names. Submit buttons carry a name
  // too but have no help text — harmless to include.
  const fieldNames = new Set(collectFieldBlocks(form.schema).map(getFieldName));
  const { noteOverrides, metadata } = parseEmbedParams(sp, fieldNames);

  return (
    <FormPublic
      slug={form.slug}
      template={form.schema}
      embed={embed}
      turnstileSiteKey={turnstileSiteKey}
      helpTextOverrides={noteOverrides}
      metadata={metadata}
    />
  );
}
