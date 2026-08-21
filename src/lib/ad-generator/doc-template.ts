import type { AdTemplate } from './types';
import type { TemplateDoc } from './doc-types';
import { renderDoc } from './doc-renderer';
import { enrichOfferFields } from './offer-text';
import { offerKind, DEFAULT_OFFER_KIND } from './offer-kinds';

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

/** A minimal, empty TemplateDoc — no elements/layers. Backs "New ad → From
 *  scratch" (and the builder's blank New). Pass one or more `sizes` to start at
 *  chosen dimensions; defaults to a single 1080×1080 square. `kind` selects the
 *  offer kind whose field schema is stamped in — `vehicle` unless told otherwise. */
export function blankTemplateDoc(
  id: string,
  name = 'Untitled ad',
  sizes: { id: string; label: string; width: number; height: number }[] = [DEFAULT_BLANK_SIZE],
  kind: string = DEFAULT_OFFER_KIND,
): TemplateDoc {
  const list = sizes.length ? sizes : [DEFAULT_BLANK_SIZE];
  const layouts: TemplateDoc['layouts'] = {};
  for (const s of list) layouts[s.id] = {};
  const k = offerKind(kind);
  return {
    id,
    name,
    sizes: list,
    // Recorded explicitly rather than left to the `vehicle` compatibility
    // default: the doc's `fields` are frozen at creation and read back by
    // `adTemplateFromDoc`, so the kind and the schema stamped from it have to
    // stay in agreement for the life of the template.
    offerKind: k.id,
    // A doc carries its kind's field schema — designers bind elements to these
    // rather than authoring their own. Canonical defaults make the canvas read
    // real immediately.
    fields: k.fields,
    // New templates are CUSTOM until someone says otherwise. The permissive
    // default (`usage` undefined ⇒ 'both') exists only so the pre-existing
    // library keeps working; a template created from now on has to be marked
    // deliberately before unattended generation can render an offer through it.
    usage: 'custom',
    background: { color: '#ffffff' },
    elements: [],
    layouts,
    defaults: { ...k.defaults },
  };
}
