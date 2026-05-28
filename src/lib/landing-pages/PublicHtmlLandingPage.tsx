/**
 * Public renderer for an HTML-mode landing page.
 *
 * The user owns the body innerHTML — we inject it via
 * `dangerouslySetInnerHTML` so their CSS, fonts, scripts, and layout
 * stand alone. Form embeds via the `<div data-loomi-form="<id>"></div>`
 * tag are hydrated client-side by `FormPortalsHydrator`; each
 * placeholder gets a `createRoot` mounted into it on the client.
 *
 * Forms are NOT server-rendered into the HTML. We tried `renderToString`
 * here originally to avoid a brief empty-placeholder flash on first
 * paint, but Next.js 16 hard-rejects component files whose import
 * graph reaches `react-dom/server` ("render or return the content
 * directly as a Server Component instead"). The hydrator handles the
 * full form rendering on the client in <100ms, so the visible flash is
 * negligible; the perf/security boundary Next is enforcing is worth it.
 */
import type { PreloadedForm } from './preloaded-forms-context';
import type { LpAttribution } from './lp-attribution-context';
import { FormPortalsHydrator } from './FormPortalsHydrator';

export interface PublicHtmlLandingPageProps {
  html: string;
  preloadedForms: Map<string, PreloadedForm>;
  /** LP attribution surfaced to embedded forms so submissions can
   *  be stamped with the source page id + slug. Threaded into each
   *  hydrateRoot in the client hydrator since independent React
   *  roots don't share context with the surrounding tree. */
  attribution: LpAttribution;
}

export function PublicHtmlLandingPage({
  html,
  preloadedForms,
  attribution,
}: PublicHtmlLandingPageProps) {
  // Map isn't structurally cloneable across the server/client
  // boundary — serialize it into a plain object the client can
  // re-Map on the other side.
  const preloadedRecord: Record<string, PreloadedForm> = {};
  for (const [id, val] of preloadedForms) preloadedRecord[id] = val;

  return (
    <>
      <div
        className="loomi-lp-html-root"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <FormPortalsHydrator
        preloadedForms={preloadedRecord}
        attribution={attribution}
      />
    </>
  );
}

