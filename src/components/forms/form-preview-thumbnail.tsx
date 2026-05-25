'use client';

import * as React from 'react';
import { FormRenderer } from '@/lib/forms/render';
import type { FormTemplate } from '@/lib/forms/types';

interface FormPreviewThumbnailProps {
  template: FormTemplate;
  /** Height of the visible thumbnail area in pixels. */
  height?: number;
}

/**
 * Scaled-down render of a form for use in card grids. Mirrors the
 * email TemplatePreview pattern — a fixed-height window with an
 * inner full-width render scaled to fit, pointer-events disabled so
 * the form fields inside aren't accidentally interactive.
 *
 * Uses ResizeObserver + IntersectionObserver so the render only kicks
 * in when the card scrolls into view, keeping a long forms list cheap.
 */
export function FormPreviewThumbnail({
  template,
  height = 200,
}: FormPreviewThumbnailProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState(0);
  const [isVisible, setIsVisible] = React.useState(false);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
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

  // Scale the form to fit the card width. The form template carries
  // its own contentWidth (defaults to 640); we render at that natural
  // width and CSS-scale down to fit.
  const formWidth = template.settings.contentWidth || 640;
  const scale = containerWidth > 0 ? containerWidth / formWidth : 0;
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
            Empty form
          </span>
        </div>
      ) : isVisible && scale > 0 ? (
        <div
          // Scaled inner — full natural width, transformed down to fit.
          // pointer-events disabled so clicks/keypresses on inputs
          // inside the preview don't fire form interactions.
          className="absolute top-0 left-0 pointer-events-none"
          style={{
            width: `${formWidth}px`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
          aria-hidden="true"
        >
          <FormRenderer template={template} />
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
