'use client';

import type { AdTemplate, AdData } from '@/lib/ad-generator/types';

/**
 * A scaled, non-interactive mini-preview of an ad template, rendered through
 * the same template function the editor + export use. Shared by the ad gallery
 * (/ad-generator) and the Ads tab on the unified /templates page.
 */
export function AdPreviewThumb({
  template,
  data,
  branding,
  height = 180,
  sizeId,
  boxW = 360,
}: {
  template?: AdTemplate;
  data: AdData;
  branding: AdData;
  height?: number;
  /** Render a specific size (by id); defaults to the template's first size. */
  sizeId?: string;
  /** Max width to fit the preview into (defaults to 360). */
  boxW?: number;
}) {
  if (!template) {
    return (
      <div className="flex items-center justify-center bg-[var(--muted)]/40 text-xs text-[var(--muted-foreground)]" style={{ height }}>
        Preview unavailable
      </div>
    );
  }
  const size = (sizeId && template.sizes.find((s) => s.id === sizeId)) || template.sizes[0];
  const html = template.render({ ...template.defaults, ...data, ...branding }, size);
  const scale = Math.min(boxW / size.width, height / size.height);
  return (
    <div className="flex items-center justify-center overflow-hidden bg-[var(--muted)]/40" style={{ height }}>
      <div className="overflow-hidden rounded shadow-sm ring-1 ring-black/5" style={{ width: size.width * scale, height: size.height * scale }}>
        <iframe
          title="Ad preview"
          srcDoc={html}
          style={{ width: size.width, height: size.height, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }}
        />
      </div>
    </div>
  );
}

/** Account branding merged into ad previews (dealer name, logo, brand color). */
export function brandingFromAccount(accountData: {
  dealer?: string;
  logos?: { light?: string } | null;
  branding?: { colors?: { primary?: string } | null } | null;
} | null | undefined): AdData {
  return {
    ...(accountData?.dealer ? { dealerName: accountData.dealer } : {}),
    ...(accountData?.logos?.light ? { logoUrl: accountData.logos.light } : {}),
    ...(accountData?.branding?.colors?.primary ? { brandColor: accountData.branding.colors.primary } : {}),
  };
}
