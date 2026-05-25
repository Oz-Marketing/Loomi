/**
 * Render a v1 LandingPageTemplate to a React tree. Used by the public
 * /lp/[slug] page (PR4) and the editor preview thumbnail (PR3).
 *
 * Like the FormRenderer, this walks the block tree and renders each
 * block's React component directly — no server-side HTML stringification
 * required (LPs live in the browser, not in email clients).
 *
 * PR1 ships a structural skeleton against the placeholder components.
 * PR2 fills in the real block implementations.
 */
import * as React from 'react';
import type { Block, LandingPageTemplate } from './types';
import { BLOCK_COMPONENTS } from './components';

export interface LandingPageRendererProps {
  template: LandingPageTemplate;
}

export function LandingPageRenderer({ template }: LandingPageRendererProps) {
  const s = template.settings;
  const margin = `${s.contentMarginTop ?? 0}px ${s.contentMarginRight ?? 0}px ${s.contentMarginBottom ?? 0}px ${s.contentMarginLeft ?? 0}px`;
  const padding = `${s.contentPaddingTop ?? 0}px ${s.contentPaddingRight ?? 0}px ${s.contentPaddingBottom ?? 0}px ${s.contentPaddingLeft ?? 0}px`;

  return (
    <div
      className="loomi-lp-root"
      style={{
        backgroundColor: s.bodyBg,
        fontFamily: s.fontFamily,
        color: s.textColor,
        minHeight: '100%',
        padding: margin,
        // Surface the brand color as a CSS variable so block components
        // (Hero CTAs, buttons, etc.) can opt into theming without
        // threading the value down through every prop bag.
        ['--loomi-lp-primary' as never]: s.primaryColor,
      }}
    >
      <div
        style={{
          maxWidth: `${s.contentWidth}px`,
          margin: '0 auto',
          backgroundColor: s.contentBg,
          borderRadius: s.contentBorderRadius ?? 0,
          padding,
        }}
      >
        {template.blocks.map((block) => (
          <RenderedBlock key={block.id} block={block} />
        ))}
      </div>
    </div>
  );
}

function RenderedBlock({ block }: { block: Block }) {
  const Component = BLOCK_COMPONENTS[block.type] as React.ComponentType<Record<string, unknown> & { children?: React.ReactNode }> | undefined;
  if (!Component) return null;

  if (block.type === 'section' || block.type === 'columns') {
    const children = block.children ?? [];
    return (
      <Component {...block.props}>
        {children.map((child) => (
          <RenderedBlock key={child.id} block={child} />
        ))}
      </Component>
    );
  }

  return <Component {...block.props} />;
}
