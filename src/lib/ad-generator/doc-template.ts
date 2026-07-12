import type { AdTemplate } from './types';
import type { TemplateDoc } from './doc-types';
import { renderDoc } from './doc-renderer';
import { enrichOfferFields } from './offer-text';
import { SYSTEM_FIELDS, SYSTEM_FIELD_DEFAULTS } from './system-fields';

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
    category: doc.category,
    tags: doc.tags,
    sizes: doc.sizes,
    fields: doc.fields,
    defaults: doc.defaults,
    // Enrich offer fields (_offerMain, …) so the offer block renders for every
    // doc — not only the hand-wired code template.
    render: (data, size) => renderDoc(doc, enrichOfferFields(data), size),
  };
}

/** The blank-doc fallback size when no starting sizes are chosen. */
const DEFAULT_BLANK_SIZE = { id: 'square', label: 'Square 1080×1080', width: 1080, height: 1080 };

/** A minimal, empty TemplateDoc — no fields/elements/layers. Backs "New ad →
 *  From scratch" (and the builder's blank New). Pass one or more `sizes` to start
 *  at chosen dimensions; defaults to a single 1080×1080 square. */
export function blankTemplateDoc(
  id: string,
  name = 'Untitled ad',
  sizes: { id: string; label: string; width: number; height: number }[] = [DEFAULT_BLANK_SIZE],
): TemplateDoc {
  const list = sizes.length ? sizes : [DEFAULT_BLANK_SIZE];
  const layouts: TemplateDoc['layouts'] = {};
  for (const s of list) layouts[s.id] = {};
  return {
    id,
    name,
    sizes: list,
    // Every doc carries the fixed system-field schema — designers bind elements
    // to these rather than authoring their own. Canonical defaults make the
    // canvas read real immediately.
    fields: SYSTEM_FIELDS,
    background: { color: '#ffffff' },
    elements: [],
    layouts,
    defaults: { ...SYSTEM_FIELD_DEFAULTS },
  };
}
