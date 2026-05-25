/**
 * Render a v1 LandingPageTemplate to a React tree. Used by:
 *   - the editor canvas + preview thumbnails (client, no preload)
 *   - the public /lp/[slug] page (server, with preloaded form schemas)
 *
 * Like the FormRenderer, this walks the block tree and renders each
 * block's React component directly. The optional `preloadedForms` map
 * is consumed by the EmbeddedForm block via context — when a form's
 * schema is already in the map, the block renders inline server-side
 * with no client fetch (which matters for anonymous LP visitors who
 * don't have auth to hit /api/forms/[id]).
 */
import * as React from 'react';
import type { Block, LandingPageTemplate } from './types';
import { BLOCK_COMPONENTS } from './components';
import { blockSpacingStyle } from './block-spacing';
import type { FormTemplate } from '@/lib/forms/types';

export interface PreloadedForm {
  schema: FormTemplate;
}

/** Map of form id → its parsed schema, supplied by the public LP
 *  renderer. EmbeddedForm reads this first; missing entries fall
 *  through to the client SWR fetch (editor mode). */
const PreloadedFormsContext = React.createContext<Map<string, PreloadedForm> | null>(null);

export function usePreloadedForm(formId: string | undefined): PreloadedForm | null {
  const map = React.useContext(PreloadedFormsContext);
  if (!map || !formId) return null;
  return map.get(formId) ?? null;
}

export interface LandingPageRendererProps {
  template: LandingPageTemplate;
  preloadedForms?: Map<string, PreloadedForm>;
}

export function LandingPageRenderer({ template, preloadedForms }: LandingPageRendererProps) {
  const s = template.settings;
  const margin = `${s.contentMarginTop ?? 0}px ${s.contentMarginRight ?? 0}px ${s.contentMarginBottom ?? 0}px ${s.contentMarginLeft ?? 0}px`;
  const padding = `${s.contentPaddingTop ?? 0}px ${s.contentPaddingRight ?? 0}px ${s.contentPaddingBottom ?? 0}px ${s.contentPaddingLeft ?? 0}px`;

  const inner = (
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

  if (preloadedForms) {
    return (
      <PreloadedFormsContext.Provider value={preloadedForms}>
        {inner}
      </PreloadedFormsContext.Provider>
    );
  }
  return inner;
}

function RenderedBlock({ block }: { block: Block }) {
  const Component = BLOCK_COMPONENTS[block.type] as React.ComponentType<Record<string, unknown> & { children?: React.ReactNode }> | undefined;
  if (!Component) return null;

  // Every block sits inside a thin wrapper that carries its
  // margin / padding from the block's spacing props. Section skips
  // padding here — Section's own component applies it internally so
  // the background colors the padded area.
  const wrapperStyle = blockSpacingStyle(block);

  if (block.type === 'section' || block.type === 'columns') {
    const children = block.children ?? [];
    return (
      <div style={wrapperStyle}>
        <Component {...block.props}>
          {children.map((child) => (
            <RenderedBlock key={child.id} block={child} />
          ))}
        </Component>
      </div>
    );
  }

  return (
    <div style={wrapperStyle}>
      <Component {...block.props} />
    </div>
  );
}
