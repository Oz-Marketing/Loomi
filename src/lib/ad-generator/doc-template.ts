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
    industries: doc.industries,
    adType: doc.adType,
    sizes: doc.sizes,
    fields: doc.fields,
    defaults: doc.defaults,
    // Enrich offer fields (_offerMain, …) so the offer block renders for every
    // doc — not only the hand-wired code template.
    render: (data, size) => renderDoc(doc, enrichOfferFields(data), size),
  };
}

/** A minimal, empty TemplateDoc — one square size, no fields/elements/layers.
 *  Backs "New ad → From scratch" (and the builder's blank New). */
export function blankTemplateDoc(id: string, name = 'Untitled ad'): TemplateDoc {
  return {
    id,
    name,
    sizes: [{ id: 'square', label: 'Square 1080×1080', width: 1080, height: 1080 }],
    fields: [],
    background: { color: '#ffffff' },
    elements: [],
    layouts: { square: {} },
    defaults: {},
  };
}
