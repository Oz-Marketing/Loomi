import * as React from 'react';
import {
  RectangleStackIcon,
  ViewColumnsIcon,
  ArrowsUpDownIcon,
  MinusIcon,
  Bars3BottomLeftIcon,
  PhotoIcon,
  SparklesIcon,
  Square3Stack3DIcon,
  Squares2X2Icon,
  MegaphoneIcon,
  ChatBubbleLeftRightIcon,
  QuestionMarkCircleIcon,
  PlayCircleIcon,
  BuildingStorefrontIcon,
  DocumentTextIcon,
  CodeBracketIcon,
} from '@heroicons/react/24/outline';

/**
 * Maps the kebab-case icon names in block schemas to heroicons. Keeps
 * schema files declarative (no React imports needed) and gives us a
 * single place to swap iconography.
 */
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  'rectangle-stack': RectangleStackIcon,
  'view-columns': ViewColumnsIcon,
  'arrows-up-down': ArrowsUpDownIcon,
  minus: MinusIcon,
  h1: Bars3BottomLeftIcon,
  'bars-3-bottom-left': Bars3BottomLeftIcon,
  photo: PhotoIcon,
  sparkles: SparklesIcon,
  'square-3-stack-3d': Square3Stack3DIcon,
  'squares-2x2': Squares2X2Icon,
  megaphone: MegaphoneIcon,
  'chat-bubble-left-right': ChatBubbleLeftRightIcon,
  'question-mark-circle': QuestionMarkCircleIcon,
  'play-circle': PlayCircleIcon,
  'building-storefront': BuildingStorefrontIcon,
  'document-text': DocumentTextIcon,
  'code-bracket': CodeBracketIcon,
};

export function PaletteIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Icon = ICON_MAP[name] ?? Squares2X2Icon;
  return <Icon className={className} />;
}
