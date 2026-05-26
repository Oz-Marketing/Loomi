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
import {
  effectiveProps,
  hasMobileOverrides,
  type Block,
  type LandingPageDevice,
  type LandingPageTemplate,
} from './types';
import { BLOCK_COMPONENTS } from './components';
import { blockSpacingStyle } from './block-spacing';
import {
  PreloadedFormsProvider,
  type PreloadedForm,
} from './preloaded-forms-context';

export type { PreloadedForm };

/** Breakpoint shared by the editor's mobile preview and the public
 *  page's responsive CSS. Anything narrower than this is "mobile". */
const MOBILE_BREAKPOINT_PX = 600;

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
      {/* Responsive show/hide CSS for blocks that have mobile
          overrides. We dual-render those (a .lp-desktop-render copy
          + a .lp-mobile-render copy) and let the breakpoint pick
          which one is visible. Blocks without overrides render once
          and don't take either class. */}
      <style
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: `
            @media (max-width: ${MOBILE_BREAKPOINT_PX}px) {
              .loomi-lp-desktop-render { display: none !important; }
            }
            @media (min-width: ${MOBILE_BREAKPOINT_PX + 1}px) {
              .loomi-lp-mobile-render { display: none !important; }
            }
          `,
        }}
      />
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
      <PreloadedFormsProvider value={preloadedForms}>
        {inner}
      </PreloadedFormsProvider>
    );
  }
  return inner;
}

function RenderedBlock({ block }: { block: Block }) {
  const Component = BLOCK_COMPONENTS[block.type] as React.ComponentType<Record<string, unknown> & { children?: React.ReactNode }> | undefined;
  if (!Component) return null;

  // EmbeddedForm is special: it can't be dual-rendered because two
  // FormRenderers would mount with duplicate ids + fight for focus.
  // Always render once with desktop props (or merged props — same
  // form regardless of viewport). Most form responsiveness is the
  // FormRenderer's own CSS anyway.
  if (block.type === 'embedded_form') {
    return (
      <div style={blockSpacingStyle(block, 'desktop')}>
        <Component {...effectiveProps(block, 'desktop')} />
      </div>
    );
  }

  // Anything below the subtree has overrides? Dual-render. The
  // breakpoint CSS at the LP root will show exactly one of the two
  // copies based on viewport width.
  if (hasMobileOverrides(block)) {
    return (
      <>
        <RenderedBlockForDevice block={block} device="desktop" wrapClass="loomi-lp-desktop-render" />
        <RenderedBlockForDevice block={block} device="mobile" wrapClass="loomi-lp-mobile-render" />
      </>
    );
  }

  // No overrides anywhere in this subtree — render once normally
  // (no dual-DOM cost). Desktop values are the canonical layer.
  return <RenderedBlockForDevice block={block} device="desktop" />;
}

/**
 * Render one device-flavored copy of a block. Children recurse
 * through RenderedBlock so EACH child gets its own dual-render
 * decision (a Section without overrides won't double-render its
 * own DOM even when nested under a Section that does).
 */
function RenderedBlockForDevice({
  block,
  device,
  wrapClass,
}: {
  block: Block;
  device: LandingPageDevice;
  wrapClass?: string;
}) {
  const Component = BLOCK_COMPONENTS[block.type] as React.ComponentType<
    Record<string, unknown> & { children?: React.ReactNode }
  >;
  const wrapperStyle = blockSpacingStyle(block, device);
  const renderProps = effectiveProps(block, device);

  if (block.type === 'section' || block.type === 'columns') {
    const children = block.children ?? [];
    return (
      <div className={wrapClass} style={wrapperStyle}>
        <Component {...renderProps}>
          {children.map((child) => (
            <RenderedBlock key={child.id} block={child} />
          ))}
        </Component>
      </div>
    );
  }
  return (
    <div className={wrapClass} style={wrapperStyle}>
      <Component {...renderProps} />
    </div>
  );
}
