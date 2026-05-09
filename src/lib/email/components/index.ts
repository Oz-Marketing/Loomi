/**
 * Component registry — maps block type strings to their React components.
 * Used by the renderer and the visual editor.
 */

import type { BlockType } from '../types';
import { SectionBlock } from './Section';
import { ColumnsBlock } from './Columns';
import { HeadingBlock } from './Heading';
import { TextBlock } from './Text';
import { ImageBlock } from './Image';
import { ButtonBlock } from './Button';
import { SpacerBlock } from './Spacer';
import { DividerBlock } from './Divider';
import { LogoBlock } from './Logo';
import { SocialBlock } from './Social';

export const BLOCK_COMPONENTS = {
  section: SectionBlock,
  columns: ColumnsBlock,
  heading: HeadingBlock,
  text: TextBlock,
  image: ImageBlock,
  button: ButtonBlock,
  spacer: SpacerBlock,
  divider: DividerBlock,
  logo: LogoBlock,
  social: SocialBlock,
} as const satisfies Record<BlockType, React.ComponentType<any>>;

export {
  SectionBlock,
  ColumnsBlock,
  HeadingBlock,
  TextBlock,
  ImageBlock,
  ButtonBlock,
  SpacerBlock,
  DividerBlock,
  LogoBlock,
  SocialBlock,
};
