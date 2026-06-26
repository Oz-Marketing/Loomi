'use client';

import * as React from 'react';
import { LandingPageRenderer } from '@/lib/landing-pages/render';
import {
  isHtmlLandingPageTemplate,
  type LandingPageContent,
} from '@/lib/landing-pages/types';

interface LandingPagePreviewThumbnailProps {
  template: LandingPageContent;
  height?: number;
}

/**
 * Scaled-down preview of a landing page for cards. Same pattern as
 * FormPreviewThumbnail — render at natural width, CSS-scale to fit,
 * lazy via IntersectionObserver, pointer-events disabled.
 */
export function LandingPagePreviewThumbnail({
  template,
  height = 220,
}: LandingPagePreviewThumbnailProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState(0);
  const [isVisible, setIsVisible] = React.useState(false);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(el);
    setContainerWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // HTML-mode pages: render the real body HTML in a scaled, sandboxed
  // iframe (mirrors the block path's render-at-natural-width-then-scale
  // approach). `sandbox=""` keeps it purely visual — no scripts/forms run
  // for a thumbnail. Lazy-gated by `isVisible` so off-screen cards on the
  // list view don't all spin up iframes at once.
  if (isHtmlLandingPageTemplate(template)) {
    const naturalWidth = 1140;
    const htmlScale = containerWidth > 0 ? containerWidth / naturalWidth : 0;
    const bodyHtml = template.html?.trim();
    return (
      <div ref={containerRef} className="relative overflow-hidden bg-white" style={{ height }}>
        {!bodyHtml ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[11px] text-[var(--muted-foreground)] uppercase tracking-[0.16em]">
              Empty page
            </span>
          </div>
        ) : isVisible && htmlScale > 0 ? (
          <iframe
            aria-hidden="true"
            tabIndex={-1}
            title="Landing page preview"
            sandbox=""
            className="absolute top-0 left-0 border-0 bg-white pointer-events-none"
            style={{
              width: `${naturalWidth}px`,
              height: `${height / htmlScale}px`,
              transform: `scale(${htmlScale})`,
              transformOrigin: 'top left',
            }}
            srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}</style></head><body>${bodyHtml}</body></html>`}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    );
  }

  const naturalWidth = template.settings.contentWidth || 1140;
  const scale = containerWidth > 0 ? containerWidth / naturalWidth : 0;
  const isEmpty = template.blocks.length === 0;

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden"
      style={{
        height,
        backgroundColor: template.settings.bodyBg || 'var(--muted)',
      }}
    >
      {isEmpty ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[11px] text-[var(--muted-foreground)] uppercase tracking-[0.16em]">
            Empty page
          </span>
        </div>
      ) : isVisible && scale > 0 ? (
        <div
          className="absolute top-0 left-0 pointer-events-none"
          style={{
            width: `${naturalWidth}px`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
          aria-hidden="true"
        >
          <LandingPageRenderer template={template} />
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
