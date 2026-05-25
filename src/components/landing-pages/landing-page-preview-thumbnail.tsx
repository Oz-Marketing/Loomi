'use client';

import * as React from 'react';
import { LandingPageRenderer } from '@/lib/landing-pages/render';
import type { LandingPageTemplate } from '@/lib/landing-pages/types';

interface LandingPagePreviewThumbnailProps {
  template: LandingPageTemplate;
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
