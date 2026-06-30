'use client';

/**
 * Landing-page settings form — used both as the Settings tab on the
 * LP detail page AND as the body of LandingPageSettingsModal (which
 * the builder pages still surface via a cog icon). All shared state
 * + PATCH-on-blur logic lives here so the two surfaces stay in sync
 * by construction.
 *
 * Sections:
 *   - Basics (name, slug, publish status)
 *   - SEO & sharing (title, description, OG image)
 *   - Tracking & analytics (Meta / GA4 / GTM + advanced custom HTML)
 *   - Danger zone (delete)
 *
 * Save shape: blur on each field → PATCH /api/landing-pages/[id]
 * with just the changed field. Server validation errors revert the
 * draft so a broken value doesn't sit in the input.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArchiveBoxArrowDownIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import type { LandingPageDetail } from '@/lib/services/landing-pages';

const SETTINGS_TABS = ['Basics', 'SEO', 'Tracking'] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

export interface LandingPageSettingsProps {
  page: LandingPageDetail;
  /** Called after every successful PATCH with the server's fresh
   *  copy of the LP. The settings modal forwards this to SWR.mutate;
   *  the detail page does the same. */
  onUpdated?: (page: LandingPageDetail) => void;
}

export function LandingPageSettings({ page, onUpdated }: LandingPageSettingsProps) {
  const router = useRouter();
  const subHref = useSubaccountHref();
  const [draft, setDraft] = React.useState({
    name: page.name,
    slug: page.slug,
    status: page.status,
    seoTitle: page.seoTitle ?? '',
    seoDescription: page.seoDescription ?? '',
    ogImageUrl: page.ogImageUrl ?? '',
    faviconUrl: page.faviconUrl ?? '',
    noindex: page.noindex,
    metaPixelId: page.metaPixelId ?? '',
    ga4MeasurementId: page.ga4MeasurementId ?? '',
    gtmContainerId: page.gtmContainerId ?? '',
    customHeadHtml: page.customHeadHtml ?? '',
    customBodyEndHtml: page.customBodyEndHtml ?? '',
  });
  const [activeTab, setActiveTab] = React.useState<SettingsTab>('Basics');
  const [saving, setSaving] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [savingAsTemplate, setSavingAsTemplate] = React.useState(false);

  // Re-seed when the page prop changes (e.g. parent SWR refetch
  // brings new server-side values).
  React.useEffect(() => {
    setDraft({
      name: page.name,
      slug: page.slug,
      status: page.status,
      seoTitle: page.seoTitle ?? '',
      seoDescription: page.seoDescription ?? '',
      ogImageUrl: page.ogImageUrl ?? '',
      faviconUrl: page.faviconUrl ?? '',
      noindex: page.noindex,
      metaPixelId: page.metaPixelId ?? '',
      ga4MeasurementId: page.ga4MeasurementId ?? '',
      gtmContainerId: page.gtmContainerId ?? '',
      customHeadHtml: page.customHeadHtml ?? '',
      customBodyEndHtml: page.customBodyEndHtml ?? '',
    });
  }, [page]);

  async function patch(key: string, value: unknown) {
    setSaving(key);
    try {
      const res = await fetch(`/api/landing-pages/${page.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Update failed');
        // Revert local draft so the broken value doesn't sit in the
        // input (e.g. user typed an invalid pixel ID, server 400'd).
        setDraft((d) => ({
          ...d,
          name: page.name,
          slug: page.slug,
          status: page.status,
          seoTitle: page.seoTitle ?? '',
          seoDescription: page.seoDescription ?? '',
          ogImageUrl: page.ogImageUrl ?? '',
          faviconUrl: page.faviconUrl ?? '',
          noindex: page.noindex,
          metaPixelId: page.metaPixelId ?? '',
          ga4MeasurementId: page.ga4MeasurementId ?? '',
          gtmContainerId: page.gtmContainerId ?? '',
          customHeadHtml: page.customHeadHtml ?? '',
          customBodyEndHtml: page.customBodyEndHtml ?? '',
        }));
        return;
      }
      onUpdated?.(payload.page);
      if (key === 'slug' && payload.page.slug !== value) {
        toast.success(`Slug adjusted to ${payload.page.slug} to keep it unique.`);
      } else {
        toast.success('Saved.');
      }
    } finally {
      setSaving(null);
    }
  }

  async function saveAsTemplate() {
    const defaultName = page.name ? `${page.name} template` : 'My template';
    const name = window.prompt(
      'Save this landing page as a reusable template for the account?\n\nGive it a name (e.g. "Spring promo"). It will appear in the New Landing Page modal next to the built-in presets.',
      defaultName,
    );
    if (name === null) return; // cancelled
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Template name is required.');
      return;
    }
    setSavingAsTemplate(true);
    try {
      const res = await fetch(`/api/landing-pages/${page.id}/save-as-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Could not save template.');
        return;
      }
      toast.success(`Saved "${trimmed}" as a template.`);
    } finally {
      setSavingAsTemplate(false);
    }
  }

  async function deleteCurrent() {
    const ok = window.confirm(
      `Delete "${page.name || 'Untitled'}"? This is permanent.`,
    );
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/landing-pages/${page.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Delete failed');
        return;
      }
      toast.success('Page deleted.');
      router.push(subHref('/websites/landing-pages'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl bg-[var(--muted)] p-1">
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            {tab === 'SEO' ? 'SEO & Sharing' : tab === 'Tracking' ? 'Tracking & Analytics' : tab}
          </button>
        ))}
      </div>

      {/* Basics */}
      {activeTab === 'Basics' && (
        <section className="glass-card rounded-2xl p-5 space-y-4">
          <Field label="Name">
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              onBlur={() => {
                if (draft.name.trim() && draft.name !== page.name) void patch('name', draft.name);
              }}
              className={inputClass}
            />
          </Field>
          <Field label="Slug">
            <input
              value={draft.slug}
              onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value }))}
              onBlur={() => {
                if (draft.slug.trim() && draft.slug !== page.slug) void patch('slug', draft.slug);
              }}
              className={inputClass}
            />
            <p className="mt-1 text-[11px] text-[var(--muted-foreground)] font-mono">
              {page.publicUrl}
            </p>
          </Field>
          <div className="border-t border-[var(--border)] pt-4">
            <p className="text-xs text-[var(--muted-foreground)] mb-3">
              Snapshot this page&apos;s content + settings so you can spin up new pages from it later.
              Saved templates appear in the New Landing Page modal.
            </p>
            <button
              type="button"
              onClick={() => void saveAsTemplate()}
              disabled={savingAsTemplate}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-sm rounded-lg border border-[var(--border)] hover:border-[var(--primary)] hover:bg-[var(--muted)] disabled:opacity-50 transition-colors"
            >
              <ArchiveBoxArrowDownIcon className="w-4 h-4" />
              {savingAsTemplate ? 'Saving…' : 'Save as template'}
            </button>
          </div>
        </section>
      )}

      {/* SEO & Sharing */}
      {activeTab === 'SEO' && (
        <section className="glass-card rounded-2xl p-5 space-y-4">
          <Field label="Page title" hint="Appears in the browser tab and on search-engine results.">
            <input
              value={draft.seoTitle}
              onChange={(e) => setDraft((d) => ({ ...d, seoTitle: e.target.value }))}
              onBlur={() => {
                if (draft.seoTitle !== (page.seoTitle ?? '')) void patch('seoTitle', draft.seoTitle);
              }}
              placeholder="Falls back to the first heading on the page"
              className={inputClass}
            />
          </Field>
          <Field label="Meta description" hint="The blurb shown under the title in search results and link previews.">
            <textarea
              rows={2}
              value={draft.seoDescription}
              onChange={(e) => setDraft((d) => ({ ...d, seoDescription: e.target.value }))}
              onBlur={() => {
                if (draft.seoDescription !== (page.seoDescription ?? '')) void patch('seoDescription', draft.seoDescription);
              }}
              className={inputClass}
            />
          </Field>
          <Field label="Social share image (OG)" hint="1200×630 image used by Slack, Twitter, iMessage previews.">
            <input
              type="url"
              value={draft.ogImageUrl}
              onChange={(e) => setDraft((d) => ({ ...d, ogImageUrl: e.target.value }))}
              onBlur={() => {
                if (draft.ogImageUrl !== (page.ogImageUrl ?? '')) void patch('ogImageUrl', draft.ogImageUrl);
              }}
              placeholder="https://…/og.png"
              className={inputClass}
            />
          </Field>
          <Field label="Browser tab icon (favicon)" hint="Square PNG/ICO, 32×32 or 64×64. Leave blank to use the default.">
            <input
              type="url"
              value={draft.faviconUrl}
              onChange={(e) => setDraft((d) => ({ ...d, faviconUrl: e.target.value }))}
              onBlur={() => {
                if (draft.faviconUrl !== (page.faviconUrl ?? '')) void patch('faviconUrl', draft.faviconUrl);
              }}
              placeholder="https://…/favicon.png"
              className={inputClass}
            />
          </Field>
          <Field label="Hide from search engines" hint="When on, this page won't be indexed by Google and won't appear in /lp-sitemap.xml.">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.noindex}
                onChange={(e) => {
                  const next = e.target.checked;
                  setDraft((d) => ({ ...d, noindex: next }));
                  if (next !== page.noindex) void patch('noindex', next);
                }}
                className="w-4 h-4 rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)]"
              />
              <span className="text-sm text-[var(--foreground)]">
                {draft.noindex ? 'Hidden from search engines' : 'Visible to search engines'}
              </span>
            </label>
          </Field>
        </section>
      )}

      {/* Tracking & Analytics */}
      {activeTab === 'Tracking' && (
        <section className="glass-card rounded-2xl p-5 space-y-3">
          <p className="text-xs text-[var(--muted-foreground)]">
            Pixel snippets render server-side using each vendor&rsquo;s standard install code.
            Page views, scroll, CTA clicks, and form submissions are already captured by Loomi
            analytics — these fields are for additional vendor pixels.
          </p>
          <Field
            label="Meta Pixel ID"
            hint={<>Find this in Meta Events Manager. Numeric, usually 15–16 digits. <code className="font-mono">fbq(&apos;init&apos;, &lt;id&gt;)</code> fires automatically on page view.</>}
          >
            <input
              type="text"
              value={draft.metaPixelId}
              onChange={(e) => setDraft((d) => ({ ...d, metaPixelId: e.target.value }))}
              onBlur={() => {
                if (draft.metaPixelId !== (page.metaPixelId ?? '')) void patch('metaPixelId', draft.metaPixelId);
              }}
              placeholder="123456789012345"
              className={`${inputClass} font-mono`}
              inputMode="numeric"
            />
          </Field>
          <Field
            label="GA4 Measurement ID"
            hint={<>From Google Analytics &gt; Admin &gt; Data Streams. Format: <code className="font-mono">G-XXXXXXXXXX</code>.</>}
          >
            <input
              type="text"
              value={draft.ga4MeasurementId}
              onChange={(e) => setDraft((d) => ({ ...d, ga4MeasurementId: e.target.value }))}
              onBlur={() => {
                if (draft.ga4MeasurementId !== (page.ga4MeasurementId ?? '')) void patch('ga4MeasurementId', draft.ga4MeasurementId);
              }}
              placeholder="G-XXXXXXXXXX"
              className={`${inputClass} font-mono`}
            />
          </Field>
          <Field
            label="Google Tag Manager Container ID"
            hint={<>From GTM &gt; Admin &gt; Container Settings. Format: <code className="font-mono">GTM-XXXXXX</code>. Once set, any tag you configure inside GTM loads here too.</>}
          >
            <input
              type="text"
              value={draft.gtmContainerId}
              onChange={(e) => setDraft((d) => ({ ...d, gtmContainerId: e.target.value }))}
              onBlur={() => {
                if (draft.gtmContainerId !== (page.gtmContainerId ?? '')) void patch('gtmContainerId', draft.gtmContainerId);
              }}
              placeholder="GTM-XXXXXX"
              className={`${inputClass} font-mono`}
            />
          </Field>
          <details className="rounded-lg border border-[var(--border)] px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
              Advanced: custom HTML / scripts
            </summary>
            <div className="mt-3 space-y-3">
              <Field
                label={<>Custom <code className="font-mono text-[11px]">&lt;head&gt;</code> HTML</>}
                hint="Pasted verbatim into the page's head. For tracking pixels not covered above (TikTok, LinkedIn, etc.) or custom font links."
              >
                <textarea
                  value={draft.customHeadHtml}
                  onChange={(e) => setDraft((d) => ({ ...d, customHeadHtml: e.target.value }))}
                  onBlur={() => {
                    if (draft.customHeadHtml !== (page.customHeadHtml ?? '')) void patch('customHeadHtml', draft.customHeadHtml);
                  }}
                  placeholder={'<script>\n  // your tracking code here\n</script>'}
                  rows={6}
                  className={`${inputClass} font-mono text-xs resize-y`}
                  spellCheck={false}
                />
              </Field>
              <Field
                label={<>Custom pre-<code className="font-mono text-[11px]">&lt;/body&gt;</code> HTML</>}
                hint="Pasted right before the closing body tag. For scripts that need to run late (chat widgets, slow trackers)."
              >
                <textarea
                  value={draft.customBodyEndHtml}
                  onChange={(e) => setDraft((d) => ({ ...d, customBodyEndHtml: e.target.value }))}
                  onBlur={() => {
                    if (draft.customBodyEndHtml !== (page.customBodyEndHtml ?? '')) void patch('customBodyEndHtml', draft.customBodyEndHtml);
                  }}
                  placeholder={'<script src="https://example.com/widget.js" defer></script>'}
                  rows={4}
                  className={`${inputClass} font-mono text-xs resize-y`}
                  spellCheck={false}
                />
              </Field>
              <p className="text-[10px] text-[var(--muted-foreground)] leading-relaxed">
                Each field is capped at 10KB. We don&apos;t sanitize — these inject as written. Bad markup can break the page; test in a draft first.
              </p>
            </div>
          </details>
        </section>
      )}

      {/* Danger zone — always visible */}
      <section className="rounded-2xl p-5 border border-rose-500/30 bg-rose-500/5">
        <div className="flex items-start gap-2 mb-3">
          <ExclamationTriangleIcon className="mt-0.5 w-5 h-5 text-rose-400 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-rose-300 text-sm leading-tight">Danger zone</h3>
            <p className="mt-0.5 text-xs text-rose-200/80">
              Deleting a page removes it permanently. The public URL will 404.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={deleteCurrent}
          disabled={deleting}
          className="w-full rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
        >
          {deleting ? 'Deleting…' : 'Delete page'}
        </button>
      </section>

      {saving && (
        <p className="text-center text-xs text-[var(--muted-foreground)]">
          Saving {saving}…
        </p>
      )}
    </div>
  );
}

// ── Local subcomponents ────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium mb-1">{label}</span>
      {children}
      {hint ? (
        <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{hint}</p>
      ) : null}
    </label>
  );
}

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/30';
