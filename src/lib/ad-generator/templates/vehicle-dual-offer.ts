import type { AdTemplate, AdData, AdSize, FieldSpec } from '../types';
import { cssSafeFamily } from '../fonts';
import { assembleOffer, OFFER_TYPES } from '../offer-text';

/** Escape user data before it goes into HTML. */
function esc(v: string | undefined): string {
  return (v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Dual Offer — one ad, TWO offers side-by-side (e.g. two vehicles, or a lease
 * vs. an APR special). Each offer has its own vehicle + structured offer; the
 * second offer's fields are prefixed `o2_` and assembled by the same engine
 * (`assembleOffer(data, 'o2_')`). Dealer branding + expiration + disclaimer are
 * shared. Side-by-side for square/landscape; stacked for tall story.
 */

/** The per-offer field set for a given prefix + form group. */
function offerFields(prefix: string, group: string): FieldSpec[] {
  const t = `${prefix}offerType`;
  return [
    { key: `${prefix}vehicleName`, label: 'Vehicle', type: 'text', group, placeholder: '2024 Toyota Camry SE' },
    { key: `${prefix}vehicleImageUrl`, label: 'Vehicle image URL', type: 'image', group, placeholder: 'https://…/camry.png', help: 'Transparent PNG (EVOX) looks best.' },
    { key: t, label: 'Offer type', type: 'select', group, options: OFFER_TYPES, help: 'Drives this offer block + which fields show.' },
    { key: `${prefix}offerLabel`, label: 'Offer label', type: 'text', group, placeholder: 'auto (e.g. LEASE FOR)', copy: true, maxLength: 18 },
    { key: `${prefix}monthlyPayment`, label: 'Monthly payment ($)', type: 'text', group, placeholder: '299', visibleWhen: { field: t, in: ['lease'] } },
    { key: `${prefix}leaseTerm`, label: 'Lease term (months)', type: 'text', group, placeholder: '36', visibleWhen: { field: t, in: ['lease'] } },
    { key: `${prefix}dueAtSigning`, label: 'Due at signing ($)', type: 'text', group, placeholder: '2999', visibleWhen: { field: t, in: ['lease'] } },
    { key: `${prefix}aprRate`, label: 'APR rate (%)', type: 'text', group, placeholder: '1.9', visibleWhen: { field: t, in: ['apr'] } },
    { key: `${prefix}aprTerm`, label: 'APR term (months)', type: 'text', group, placeholder: '60', visibleWhen: { field: t, in: ['apr'] } },
    { key: `${prefix}financialInstitution`, label: 'Financial institution', type: 'text', group, placeholder: 'Toyota Financial', visibleWhen: { field: t, in: ['apr'] } },
    { key: `${prefix}discountAmount`, label: 'Discount amount ($)', type: 'text', group, placeholder: '3000', visibleWhen: { field: t, in: ['discount'] } },
    { key: `${prefix}discountLabelStyle`, label: 'Discount style', type: 'select', group, options: [{ value: 'off_msrp', label: 'Off MSRP' }, { value: 'cash_back', label: 'Cash Back' }], visibleWhen: { field: t, in: ['discount'] } },
    { key: `${prefix}discountSource`, label: 'Discount source', type: 'text', group, placeholder: 'Dealer discount', visibleWhen: { field: t, in: ['discount'] } },
    { key: `${prefix}salePrice`, label: 'Sale price ($)', type: 'text', group, placeholder: '28995', visibleWhen: { field: t, in: ['sales_price'] } },
    { key: `${prefix}msrp`, label: 'MSRP ($)', type: 'text', group, placeholder: '34000', visibleWhen: { field: t, in: ['lease', 'apr', 'discount', 'sales_price'] } },
    { key: `${prefix}price`, label: 'Price', type: 'text', group, placeholder: '$299/mo', visibleWhen: { field: t, in: ['custom'] } },
    { key: `${prefix}terms`, label: 'Terms', type: 'text', group, placeholder: '36 months · $2,999 due at signing', visibleWhen: { field: t, in: ['custom'] } },
  ];
}

function render(data: AdData, size: AdSize): string {
  const { width, height } = size;
  const stacked = width / height < 0.9; // tall story → stack the two offers
  const u = Math.min(width, height) / 30;

  const brand = esc(data.brandColor) || '#4f46e5';
  const dealerName = esc(data.dealerName) || 'Your Dealership';
  const logoUrl = esc(data.logoUrl);
  const tagline = esc(data.tagline);
  const expiration = esc(data.expiration) || 'Offer ends soon';
  const disclaimer = esc(data.disclaimer);

  const fontFamily = cssSafeFamily(data.fontFamily ?? '');
  const fontFaceCss = data.fontFaceCss ?? '';
  const fontStack = `${fontFamily ? `"${fontFamily}", ` : ''}-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

  const column = (prefix: string): string => {
    const name = esc(data[`${prefix}vehicleName`]) || '';
    const img = esc(data[`${prefix}vehicleImageUrl`]);
    const offer = assembleOffer(data, prefix);
    const label = esc(offer ? offer.label : data[`${prefix}offerLabel`] || 'LEASE FOR');
    const main = esc(offer ? offer.main : data[`${prefix}price`] || '$299/mo');
    const terms = esc(offer ? offer.terms : data[`${prefix}terms`] || '');
    const vehicle = img
      ? `<img src="${img}" alt="${name}" style="max-width:100%;max-height:100%;object-fit:contain;filter:drop-shadow(0 ${u * 0.3}px ${u * 0.5}px rgba(0,0,0,.22));" />`
      : `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#cbd5e1;font-size:${u * 0.6}px;border:${Math.max(1, u * 0.05)}px dashed #cbd5e1;border-radius:${u * 0.8}px;">Vehicle</div>`;
    return `
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:${u * 0.35}px;">
        <div style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;">${vehicle}</div>
        ${name ? `<div style="font-size:${u * 0.66}px;font-weight:700;color:#0f172a;text-align:center;">${name}</div>` : ''}
        <div style="display:flex;flex-direction:column;align-items:center;gap:${u * 0.12}px;">
          <div style="font-size:${u * 0.52}px;font-weight:700;letter-spacing:${u * 0.05}px;color:${brand};text-transform:uppercase;">${label}</div>
          <div style="font-size:${u * 1.75}px;font-weight:800;line-height:.95;color:#0f172a;letter-spacing:-${u * 0.03}px;">${main}</div>
          ${terms ? `<div style="font-size:${u * 0.5}px;font-weight:500;color:#475569;text-align:center;">${terms}</div>` : ''}
        </div>
      </div>`;
  };

  const divider = stacked
    ? `<div style="height:${Math.max(1, u * 0.05)}px;background:#e2e8f0;"></div>`
    : `<div style="width:${Math.max(1, u * 0.05)}px;background:#e2e8f0;align-self:stretch;"></div>`;

  const header = `
    <div style="display:flex;align-items:center;justify-content:center;gap:${u * 0.5}px;">
      ${logoUrl ? `<img src="${logoUrl}" alt="${dealerName}" style="height:${u * 1.4}px;width:auto;object-fit:contain;" />` : ''}
      <div style="font-size:${u * 0.7}px;font-weight:700;color:#0f172a;">${dealerName}</div>
    </div>`;
  const taglineBlock = tagline ? `<div style="text-align:center;font-size:${u * 1.0}px;font-weight:800;line-height:1.04;color:#0f172a;">${tagline}</div>` : '';
  const expirationPill = `<div style="text-align:center;"><span style="display:inline-block;background:${brand};color:#fff;font-size:${u * 0.5}px;font-weight:700;padding:${u * 0.25}px ${u * 0.6}px;border-radius:${u * 2}px;">${expiration}</span></div>`;
  const footer = disclaimer ? `<div style="font-size:${u * 0.38}px;line-height:1.3;color:#94a3b8;text-align:center;">${disclaimer}</div>` : '';

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
    padding:${u}px; display:flex; flex-direction:column; gap:${u * 0.5}px;
  }
  .ad::before { content:''; position:absolute; top:0; left:0; right:0; height:${u * 0.3}px; background:${brand}; }
</style></head>
<body>
  <div class="ad">
    ${header}
    ${taglineBlock}
    <div style="flex:1;min-height:0;display:flex;flex-direction:${stacked ? 'column' : 'row'};gap:${u * 0.7}px;">
      ${column('')}
      ${divider}
      ${column('o2_')}
    </div>
    ${expirationPill}
    ${footer}
  </div>
</body>
</html>`;
}

export const vehicleDualOffer: AdTemplate = {
  id: 'vehicle-dual-offer',
  name: 'Dual Offer',
  description: 'Two offers in one ad — two vehicles side-by-side, each with its own image, offer, and terms.',
  industries: ['Automotive', 'Powersports'],
  adType: 'Vehicle Offer',
  sizes: [
    { id: 'square', label: 'Square 1:1 (1080×1080)', width: 1080, height: 1080 },
    { id: 'landscape', label: 'Landscape (1200×628)', width: 1200, height: 628 },
    { id: 'story', label: 'Story 9:16 (1080×1920)', width: 1080, height: 1920 },
  ],
  fields: [
    { key: 'tagline', label: 'Tagline', type: 'text', group: 'Headline', placeholder: 'Two ways to drive home today', copy: true, maxLength: 40 },
    ...offerFields('', 'Offer 1'),
    ...offerFields('o2_', 'Offer 2'),
    { key: 'expiration', label: 'Expiration', type: 'text', group: 'Shared', placeholder: 'Offer ends March 31' },
    { key: 'vin', label: 'VIN', type: 'text', group: 'Legal', placeholder: '1HGCM82633A004352', help: 'Optional — appended to the disclaimer.' },
    { key: 'stockNumber', label: 'Stock #', type: 'text', group: 'Legal', placeholder: 'H4421A', help: 'Optional — appended to the disclaimer.' },
    { key: 'disclaimer', label: 'Disclaimer', type: 'textarea', group: 'Legal', placeholder: 'Plus tax, title, license…', help: 'Auto-fills from the template + offer; edit to override.' },
  ],
  defaults: {
    dealerName: 'Oz Toyota',
    brandColor: '#4f46e5',
    logoUrl: '',
    tagline: 'Two Ways to Drive Home Today',
    expiration: 'Offer ends March 31',
    // Offer 1 — lease
    vehicleName: '2024 Camry SE',
    vehicleImageUrl: '',
    offerType: 'lease',
    monthlyPayment: '299',
    leaseTerm: '36',
    dueAtSigning: '2999',
    msrp: '34000',
    // Offer 2 — APR
    o2_vehicleName: '2024 RAV4 XLE',
    o2_vehicleImageUrl: '',
    o2_offerType: 'apr',
    o2_aprRate: '1.9',
    o2_aprTerm: '60',
    o2_financialInstitution: 'Toyota Financial',
    o2_msrp: '36000',
    disclaimer: 'Plus tax, title, and license. With approved credit. See dealer for details.',
  },
  render,
};
