'use client';

import {
  BanknotesIcon,
  MegaphoneIcon,
  QuestionMarkCircleIcon,
  VideoCameraIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import { LucideIcon, isIconName } from '@/components/lucide-icon';
import { useBudgetChannels } from '@/contexts/budget-channels-context';
import { MetaBrandIcon, GoogleAdsBrandIcon, YouTubeBrandIcon } from './platform-logos';

/**
 * Brand marks, by channel key.
 *
 * The one part of a channel's appearance that stays in code: these are licensed
 * assets shipped as components, not a name someone can type into a settings
 * field. A rep scanning the grid recognizes the Meta swirl faster than the word
 * "Meta", which is why they're worth the exception.
 *
 * Keyed by the SEED keys. An agency that renames its Meta channel keeps the
 * mark (the key doesn't change); one that creates its own "meta" channel gets
 * it too, which is the right answer either way.
 */
const BRAND_MARKS: Record<string, (p: { className?: string }) => React.ReactElement> = {
  meta: MetaBrandIcon,
  google: GoogleAdsBrandIcon,
  youtube: YouTubeBrandIcon,
};

/**
 * The mark shown beside a budget channel's name.
 *
 * Three tiers, in order:
 *   1. a brand mark, for the ad platforms (full colour, ignores currentColor)
 *   2. the channel's own lucide icon, picked in Agency Settings
 *   3. its KIND of money — banknote, wrench, camera
 *
 * Tier 3 exists because a grid where most rows have no icon reads as broken,
 * and hand-picking a glyph for all 44 fees and vendor services is tedious and
 * low-value. It used to be a 30-case switch on the channel key; that switch was
 * the last place a channel's appearance was hardcoded, so it's gone — the glyph
 * is a field on the channel now.
 */
export function ChannelIcon({
  channel,
  className = 'h-4 w-4',
}: {
  channel: string | null | undefined;
  className?: string;
}) {
  const { channels } = useBudgetChannels();
  if (!channel) return null;

  const Brand = BRAND_MARKS[channel];
  if (Brand) return <Brand className={className} />;

  const record = channels.get(channel);
  if (isIconName(record?.icon)) {
    return <LucideIcon name={record.icon} className={className} />;
  }

  switch (channels.lineType(channel)) {
    case 'media':
      return <MegaphoneIcon className={className} />;
    case 'fee':
      return <BanknotesIcon className={className} />;
    case 'service':
      return <WrenchScrewdriverIcon className={className} />;
    case 'production':
      return <VideoCameraIcon className={className} />;
    default:
      // Also the "list hasn't loaded yet" case, which is correct: an unknown
      // channel and an unloaded one are equally unknown at this moment.
      return <QuestionMarkCircleIcon className={className} />;
  }
}

/** Icon + label, the pairing most callers actually want. */
export function ChannelTag({
  channel,
  label,
  className = '',
  iconClassName = 'h-4 w-4 flex-shrink-0',
}: {
  channel: string | null | undefined;
  label: string;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`.trim()}>
      <ChannelIcon channel={channel} className={iconClassName} />
      <span className="truncate">{label}</span>
    </span>
  );
}
