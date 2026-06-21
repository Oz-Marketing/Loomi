import type { AdTemplate } from './types';
import type { TemplateDoc } from './doc-types';
import { renderDoc } from './doc-renderer';
import { enrichOfferFields } from './offer-text';

/**
 * Adapt a data-driven TemplateDoc into the AdTemplate shape the generator
 * (form + preview + render) consumes. Pure — `renderDoc` has no Node/browser
 * imports — so this runs on the client (preview) and the server (Puppeteer)
 * identically. The DB row id becomes the template id.
 */
export function adTemplateFromDoc(id: string, doc: TemplateDoc): AdTemplate {
  return {
    id,
    name: doc.name,
    description: doc.description ?? '',
    sizes: doc.sizes,
    fields: doc.fields,
    defaults: doc.defaults,
    // Enrich offer fields (_offerMain, …) so the offer block renders for every
    // doc — not only the hand-wired code template.
    render: (data, size) => renderDoc(doc, enrichOfferFields(data), size),
  };
}
