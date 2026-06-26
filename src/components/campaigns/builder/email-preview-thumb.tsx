'use client';

/**
 * Email preview for the campaign overview. Renders already-compiled email HTML
 * in a fixed-logical-width iframe (600px desktop / 390px mobile), and shows the
 * FULL email up to `maxHeight` (scroll past that) — not a crop. Desktop scales
 * to fill the container width; mobile renders ~1:1 and centers.
 *
 * It measures the email's natural height via the iframe document, which needs
 * `sandbox="allow-same-origin"`. Scripts still never run (no `allow-scripts`),
 * so the trim-only-sanitized HTML stays safe — mirrors the existing email
 * previews (sent-campaign-drawer, /preview/[design]).
 */
import { useEffect, useRef, useState } from 'react';

export function EmailPreviewThumb({
  html,
  device = 'desktop',
  maxHeight = 460,
}: {
  html: string;
  device?: 'desktop' | 'mobile';
  maxHeight?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [availWidth, setAvailWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const [contentH, setContentH] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setAvailWidth(w);
    });
    ro.observe(el);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  const measure = () => {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return;
      const h = Math.max(doc.body?.scrollHeight ?? 0, doc.documentElement?.scrollHeight ?? 0);
      if (h > 0) setContentH(h);
    } catch {
      /* cross-origin guard — shouldn't happen with allow-same-origin */
    }
  };

  const handleLoad = () => {
    measure();
    // Remote images load after onLoad and can grow the document — re-measure.
    setTimeout(measure, 400);
    setTimeout(measure, 1200);
  };

  // Logical render width of the email; mobile shows the responsive layout.
  const renderWidth = device === 'mobile' ? 390 : 600;
  const displayWidth =
    device === 'mobile'
      ? Math.min(renderWidth, availWidth || renderWidth)
      : availWidth;
  const scale = displayWidth > 0 ? displayWidth / renderWidth : 0;
  const scaledH = contentH != null ? contentH * scale : 0;
  const boxHeight = scaledH > 0 ? Math.min(scaledH, maxHeight) : 300;
  const doc = `<style>html,body{margin:0;padding:0;overflow-x:hidden!important;}</style>${html}`;

  return (
    <div ref={wrapRef} className="w-full">
      <div
        className={`relative overflow-y-auto overflow-x-hidden rounded-md border border-[var(--border)] bg-white ${
          device === 'mobile' ? 'mx-auto shadow-sm' : ''
        }`}
        style={{ width: device === 'mobile' ? displayWidth : '100%', height: boxHeight }}
      >
        {visible && scale > 0 && (
          <div style={{ position: 'relative', height: scaledH || boxHeight }}>
            <iframe
              ref={iframeRef}
              title="Email preview"
              srcDoc={doc}
              sandbox="allow-same-origin"
              scrolling="no"
              tabIndex={-1}
              aria-hidden
              onLoad={handleLoad}
              className="pointer-events-none absolute left-0 top-0 border-0"
              style={{
                width: renderWidth,
                height: contentH ?? Math.round((boxHeight || 300) / (scale || 1)),
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
