import type { AdTemplate, AdData, AdSize } from '../types';
import { cssSafeFamily } from '../fonts';
import { assembleOffer, OFFER_TYPES } from '../offer-text';

/** Escape user data before it goes into HTML (preview + render are real HTML). */
function esc(v: string | undefined): string {
  return (v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Vehicle Offer — a dealer offer ad (vehicle + price + terms + disclaimer).
 *
 * One layout that adapts by aspect ratio: text-left/vehicle-right for landscape,
 * stacked for square/story. All sizing is derived from the output dimensions so
 * a 1080² and a 1200×628 stay visually consistent.
 */
function render(data: AdData, size: AdSize): string {
  const { width, height } = size;
  const ratio = width / height;
  const layout = ratio > 1.3 ? 'row' : 'stack';
  // Base unit so typography scales with the canvas (≈ short edge / 26).
  const u = Math.min(width, height) / 26;

  const brand = esc(data.brandColor) || '#4f46e5';
  const dealerName = esc(data.dealerName) || 'Your Dealership';
  const vehicleName = esc(data.vehicleName) || '2024 Model';
  const vehicleImageUrl = esc(data.vehicleImageUrl);
  const logoUrl = esc(data.logoUrl);
  // Typed offers (lease/apr/discount/sales_price) assemble their block
  // deterministically from structured fields; `custom` falls back to the
  // free-text price/terms fields.
  const offer = assembleOffer(data);
  const offerLabel = esc(offer ? offer.label : data.offerLabel || 'LEASE FOR');
  const price = esc(offer ? offer.main : data.price || '$299/mo');
  const terms = esc(offer ? offer.terms : data.terms || '36 months · $2,999 due at signing');
  const expiration = esc(data.expiration) || 'Offer ends soon';
  const disclaimer = esc(data.disclaimer);
  const tagline = esc(data.tagline);

  // Branding font (from the account's uploaded custom fonts). fontFaceCss is raw
  // CSS built upstream (page = url src for preview; render route = base64 src).
  const fontFamily = cssSafeFamily(data.fontFamily ?? '');
  const fontFaceCss = data.fontFaceCss ?? '';
  const fontStack = `${fontFamily ? `"${fontFamily}", ` : ''}-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

  const vehicle = vehicleImageUrl
    ? `<img src="${vehicleImageUrl}" alt="${vehicleName}" style="max-width:100%;max-height:100%;object-fit:contain;filter:drop-shadow(0 ${u * 0.4}px ${u * 0.6}px rgba(0,0,0,.25));" />`
    : `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#cbd5e1;font-size:${u * 0.7}px;border:${Math.max(1, u * 0.06)}px dashed #cbd5e1;border-radius:${u}px;">Vehicle image</div>`;

  const offerBlock = `
    <div style="display:flex;flex-direction:column;gap:${u * 0.25}px;">
      <div style="font-size:${u * 0.62}px;font-weight:700;letter-spacing:${u * 0.06}px;color:${brand};text-transform:uppercase;">${offerLabel}</div>
      <div style="font-size:${u * 2.6}px;font-weight:800;line-height:.95;color:#0f172a;letter-spacing:-${u * 0.04}px;">${price}</div>
      <div style="font-size:${u * 0.66}px;font-weight:500;color:#475569;">${terms}</div>
    </div>`;

  const taglineBlock = tagline
    ? `<div style="font-size:${u * 0.95}px;font-weight:800;line-height:1.04;color:#0f172a;letter-spacing:-${u * 0.03}px;">${tagline}</div>`
    : '';

  const expirationPill = `
    <span style="display:inline-block;align-self:flex-start;background:${brand};color:#fff;font-size:${u * 0.52}px;font-weight:700;padding:${u * 0.28}px ${u * 0.6}px;border-radius:${u * 2}px;letter-spacing:${u * 0.02}px;">${expiration}</span>`;

  const header = `
    <div style="display:flex;align-items:center;gap:${u * 0.5}px;">
      ${logoUrl ? `<img src="${logoUrl}" alt="${dealerName}" style="height:${u * 1.6}px;width:auto;object-fit:contain;" />` : ''}
      <div style="font-size:${u * 0.72}px;font-weight:700;color:#0f172a;">${dealerName}</div>
    </div>`;

  const footer = disclaimer
    ? `<div style="font-size:${u * 0.4}px;line-height:1.3;color:#94a3b8;">${disclaimer}</div>`
    : '';

  const body =
    layout === 'row'
      ? `
      <div style="display:flex;height:100%;gap:${u}px;">
        <div style="flex:0 0 46%;display:flex;flex-direction:column;justify-content:space-between;">
          <div style="display:flex;flex-direction:column;gap:${u * 0.55}px;">
            ${header}
            ${taglineBlock}
          </div>
          ${offerBlock}
          ${expirationPill}
        </div>
        <div style="flex:1;display:flex;align-items:center;justify-content:center;min-width:0;">${vehicle}</div>
      </div>`
      : `
      <div style="display:flex;flex-direction:column;height:100%;gap:${u * 0.6}px;">
        ${header}
        ${taglineBlock}
        <div style="flex:1;display:flex;align-items:center;justify-content:center;min-height:0;">${vehicle}</div>
        ${offerBlock}
        ${expirationPill}
      </div>`;

  return `<!doctype html>
<html>
<head><meta charset="utf-8" />
<style>
  ${fontFaceCss}
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${width}px; height:${height}px; }
  .ad {
    width:${width}px; height:${height}px; overflow:hidden; position:relative;
    background:linear-gradient(135deg,#ffffff 0%,#f1f5f9 100%);
    font-family:${fontStack};
    padding:${u * 1.1}px; display:flex; flex-direction:column;
  }
  .ad::before { content:''; position:absolute; top:0; left:0; right:0; height:${u * 0.32}px; background:${brand}; }
  .body { flex:1; display:flex; flex-direction:column; min-height:0; }
</style></head>
<body>
  <div class="ad">
    <div class="body">${body}</div>
    ${footer ? `<div style="margin-top:${u * 0.6}px;">${footer}</div>` : ''}
  </div>
</body>
</html>`;
}

export const vehicleOffer: AdTemplate = {
  id: 'vehicle-offer',
  name: 'Vehicle Offer',
  description: 'Vehicle offer ad — price, terms, expiration, and disclaimer over a clean branded layout.',
  sizes: [
    { id: 'square', label: 'Square 1:1 (1080×1080)', width: 1080, height: 1080 },
    { id: 'landscape', label: 'Landscape (1200×628)', width: 1200, height: 628 },
    { id: 'story', label: 'Story 9:16 (1080×1920)', width: 1080, height: 1920 },
  ],
  // Brand fields (dealerName, brandColor, logoUrl) are NOT here — they come from
  // the active account's branding settings, injected by the page.
  fields: [
    { key: 'vehicleName', label: 'Vehicle', type: 'text', group: 'Vehicle', placeholder: '2024 Toyota Camry SE' },
    { key: 'vehicleImageUrl', label: 'Vehicle image URL', type: 'image', group: 'Vehicle', placeholder: 'https://…/camry.png', help: 'Transparent PNG (e.g. from EVOX) looks best.' },
    { key: 'tagline', label: 'Tagline', type: 'text', group: 'Copy', placeholder: 'Drive home today', help: 'Short on-image hook — the AI can write this.', copy: true, maxLength: 28 },
    { key: 'offerType', label: 'Offer type', type: 'select', group: 'Offer', options: OFFER_TYPES, help: 'Drives the offer block + which fields show below.' },
    { key: 'offerLabel', label: 'Offer label', type: 'text', group: 'Offer', placeholder: 'auto (e.g. LEASE FOR)', help: 'Optional — overrides the default label. AI can write this.', copy: true, maxLength: 18 },
    // Lease
    { key: 'monthlyPayment', label: 'Monthly payment ($)', type: 'text', group: 'Offer', placeholder: '299', visibleWhen: { field: 'offerType', in: ['lease'] } },
    { key: 'leaseTerm', label: 'Lease term (months)', type: 'text', group: 'Offer', placeholder: '36', visibleWhen: { field: 'offerType', in: ['lease'] } },
    { key: 'dueAtSigning', label: 'Due at signing ($)', type: 'text', group: 'Offer', placeholder: '2999', visibleWhen: { field: 'offerType', in: ['lease'] } },
    // APR
    { key: 'aprRate', label: 'APR rate (%)', type: 'text', group: 'Offer', placeholder: '1.9', visibleWhen: { field: 'offerType', in: ['apr'] } },
    { key: 'aprTerm', label: 'APR term (months)', type: 'text', group: 'Offer', placeholder: '60', visibleWhen: { field: 'offerType', in: ['apr'] } },
    { key: 'financialInstitution', label: 'Financial institution', type: 'text', group: 'Offer', placeholder: 'Toyota Financial', visibleWhen: { field: 'offerType', in: ['apr'] } },
    // Discount
    { key: 'discountAmount', label: 'Discount amount ($)', type: 'text', group: 'Offer', placeholder: '3000', visibleWhen: { field: 'offerType', in: ['discount'] } },
    { key: 'discountLabelStyle', label: 'Discount style', type: 'select', group: 'Offer', options: [{ value: 'off_msrp', label: 'Off MSRP' }, { value: 'cash_back', label: 'Cash Back' }], visibleWhen: { field: 'offerType', in: ['discount'] } },
    { key: 'discountSource', label: 'Discount source', type: 'text', group: 'Offer', placeholder: 'Dealer discount', visibleWhen: { field: 'offerType', in: ['discount'] } },
    // Sales price
    { key: 'salePrice', label: 'Sale price ($)', type: 'text', group: 'Offer', placeholder: '28995', visibleWhen: { field: 'offerType', in: ['sales_price'] } },
    // Shared across the typed offers
    { key: 'msrp', label: 'MSRP ($)', type: 'text', group: 'Offer', placeholder: '34000', visibleWhen: { field: 'offerType', in: ['lease', 'apr', 'discount', 'sales_price'] } },
    // Custom (free text)
    { key: 'price', label: 'Price', type: 'text', group: 'Offer', placeholder: '$299/mo', visibleWhen: { field: 'offerType', in: ['custom'] } },
    { key: 'terms', label: 'Terms', type: 'text', group: 'Offer', placeholder: '36 months · $2,999 due at signing', visibleWhen: { field: 'offerType', in: ['custom'] } },
    { key: 'expiration', label: 'Expiration', type: 'text', group: 'Offer', placeholder: 'Offer ends March 31' },
    { key: 'vin', label: 'VIN', type: 'text', group: 'Legal', placeholder: '1HGCM82633A004352', help: 'Optional — appended to the disclaimer.' },
    { key: 'stockNumber', label: 'Stock #', type: 'text', group: 'Legal', placeholder: 'H4421A', help: 'Optional — appended to the disclaimer.' },
    { key: 'disclaimer', label: 'Disclaimer', type: 'textarea', group: 'Legal', placeholder: 'Plus tax, title, license…', help: 'Auto-fills from the template + offer; edit to override.' },
  ],
  defaults: {
    dealerName: 'Oz Toyota',
    brandColor: '#4f46e5',
    logoUrl: '',
    vehicleName: '2024 Toyota Camry SE',
    vehicleImageUrl: '',
    tagline: 'Drive Home Today',
    offerType: 'lease',
    offerLabel: '',
    monthlyPayment: '299',
    leaseTerm: '36',
    dueAtSigning: '2999',
    aprRate: '1.9',
    aprTerm: '60',
    financialInstitution: 'Toyota Financial',
    discountAmount: '3000',
    discountLabelStyle: 'off_msrp',
    discountSource: 'Dealer discount',
    salePrice: '28995',
    msrp: '34000',
    price: '$299/mo',
    terms: '36 months · $2,999 due at signing',
    expiration: 'Offer ends March 31',
    vin: '',
    stockNumber: '',
    disclaimer: 'Closed-end lease. $2,999 due at signing plus tax, title, and license. With approved credit. See dealer for details.',
  },
  render,
};
