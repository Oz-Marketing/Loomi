/**
 * Block component registry for landing pages.
 *
 * Each entry maps a LandingPageBlockType to its React implementation.
 * The renderer + editor walk the block tree and look up components
 * by type — adding a new block is: schema entry (schemas.ts) + type
 * union (types.ts) + entry here.
 */

import * as React from 'react';
import type { LandingPageBlockType } from '../types';

import { SectionBlock } from './Section';
import { ColumnsBlock } from './Columns';
import { SpacerBlock } from './Spacer';
import { DividerBlock } from './Divider';
import { HeadingBlock } from './Heading';
import { TextBlock } from './Text';
import { ImageBlock } from './Image';
import { HeroBlock } from './Hero';
import { FeatureRowBlock } from './FeatureRow';
import { FeatureGridBlock } from './FeatureGrid';
import { CtaBlock } from './Cta';
import { TestimonialBlock } from './Testimonial';
import { FaqBlock } from './Faq';
import { VideoBlock } from './Video';
import { LogoStripBlock } from './LogoStrip';
import { EmbeddedFormBlock } from './EmbeddedForm';
import { HtmlBlock } from './Html';

// Common prop bag — every block component accepts an arbitrary
// props record (the schema validates shape downstream) and an
// optional children slot for container blocks.
type AnyBlockComponent = React.ComponentType<Record<string, unknown> & { children?: React.ReactNode }>;

export const BLOCK_COMPONENTS: Record<LandingPageBlockType, AnyBlockComponent> = {
  section: SectionBlock as AnyBlockComponent,
  columns: ColumnsBlock as AnyBlockComponent,
  spacer: SpacerBlock as AnyBlockComponent,
  divider: DividerBlock as AnyBlockComponent,
  heading: HeadingBlock as AnyBlockComponent,
  text: TextBlock as AnyBlockComponent,
  image: ImageBlock as AnyBlockComponent,
  hero: HeroBlock as AnyBlockComponent,
  feature_row: FeatureRowBlock as AnyBlockComponent,
  feature_grid: FeatureGridBlock as AnyBlockComponent,
  cta: CtaBlock as AnyBlockComponent,
  testimonial: TestimonialBlock as AnyBlockComponent,
  faq: FaqBlock as AnyBlockComponent,
  video: VideoBlock as AnyBlockComponent,
  logo_strip: LogoStripBlock as AnyBlockComponent,
  embedded_form: EmbeddedFormBlock as AnyBlockComponent,
  html: HtmlBlock as AnyBlockComponent,
};

// Re-export each block component by name so templates + thumbnails
// can import them directly without round-tripping through the
// registry's loose typing.
export {
  SectionBlock,
  ColumnsBlock,
  SpacerBlock,
  DividerBlock,
  HeadingBlock,
  TextBlock,
  ImageBlock,
  HeroBlock,
  FeatureRowBlock,
  FeatureGridBlock,
  CtaBlock,
  TestimonialBlock,
  FaqBlock,
  VideoBlock,
  LogoStripBlock,
  EmbeddedFormBlock,
  HtmlBlock,
};
