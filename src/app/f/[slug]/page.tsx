import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPublishedFormBySlug } from '@/lib/services/forms';
import { FormPublic } from '@/components/forms/form-public';
import { getTurnstileSiteKey } from '@/lib/forms/turnstile';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ embed?: string }>;
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

  return (
    <FormPublic
      slug={form.slug}
      template={form.schema}
      embed={embed}
      turnstileSiteKey={turnstileSiteKey}
    />
  );
}
