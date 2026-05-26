import type { CSSProperties } from 'react';
import { effectiveProps, type Block, type LandingPageDevice } from './types';

/**
 * Pull padding + margin off a block's props and convert to a CSS
 * style object. Skips Section blocks for padding — Section applies
 * its own paddingTop/Right/Bottom/Left internally (so the section's
 * background color extends into the padded area), and we don't want
 * to double-pad.
 *
 * Takes a `device` so per-device mobile overrides apply: the editor
 * passes its activeDevice; the public renderer passes 'desktop' for
 * the desktop-only copy and 'mobile' for the mobile-only copy when
 * dual-rendering blocks with overrides.
 *
 * Used by both the public LandingPageRenderer wrapper and the editor
 * canvas's EditableBlock wrapper so the box-model spacing controls
 * behave identically in both surfaces.
 */
export function blockSpacingStyle(
  block: Block,
  device: LandingPageDevice = 'desktop',
): CSSProperties {
  const p = effectiveProps(block, device);
  const num = (key: string): number => {
    const v = p[key];
    return typeof v === 'number' ? v : 0;
  };

  const marginTop = num('marginTop');
  const marginRight = num('marginRight');
  const marginBottom = num('marginBottom');
  const marginLeft = num('marginLeft');

  const style: CSSProperties = {
    marginTop: marginTop ? `${marginTop}px` : undefined,
    marginRight: marginRight ? `${marginRight}px` : undefined,
    marginBottom: marginBottom ? `${marginBottom}px` : undefined,
    marginLeft: marginLeft ? `${marginLeft}px` : undefined,
  };

  if (block.type !== 'section') {
    const paddingTop = num('paddingTop');
    const paddingRight = num('paddingRight');
    const paddingBottom = num('paddingBottom');
    const paddingLeft = num('paddingLeft');
    if (paddingTop) style.paddingTop = `${paddingTop}px`;
    if (paddingRight) style.paddingRight = `${paddingRight}px`;
    if (paddingBottom) style.paddingBottom = `${paddingBottom}px`;
    if (paddingLeft) style.paddingLeft = `${paddingLeft}px`;
  }

  return style;
}
