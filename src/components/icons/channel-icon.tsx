'use client';

import {
  BanknotesIcon,
  ChartBarIcon,
  ChatBubbleLeftRightIcon,
  CircleStackIcon,
  CodeBracketIcon,
  EnvelopeIcon,
  HashtagIcon,
  MagnifyingGlassIcon,
  MegaphoneIcon,
  PlayCircleIcon,
  PrinterIcon,
  QuestionMarkCircleIcon,
  RectangleGroupIcon,
  SignalIcon,
  SparklesIcon,
  StarIcon,
  TrophyIcon,
  TvIcon,
  UserPlusIcon,
  VideoCameraIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import { channelLineType } from '@/lib/budget/channels';
import { MetaBrandIcon, GoogleAdsBrandIcon, YouTubeBrandIcon } from './platform-logos';

/**
 * The mark shown beside a budget channel's name.
 *
 * Third-party ad platforms get their real brand mark — a rep scanning the grid
 * recognizes the Meta swirl faster than the word "Meta". Everything else is a
 * category rather than a vendor, so it gets a neutral glyph in the caller's
 * text color; there's no logo to be right about.
 *
 * FALLS BACK BY LINE TYPE rather than rendering nothing. The registry grew from
 * 11 channels to 44 to mirror Oz Reports, and hand-picking a glyph for every
 * fee and vendor service is tedious and low-value — but a grid where most rows
 * have no icon reads as broken. An unmapped channel shows its KIND of money
 * (banknote, wrench, camera), which is the more useful distinction anyway.
 */
export function ChannelIcon({
  channel,
  className = 'h-4 w-4',
}: {
  channel: string | null | undefined;
  className?: string;
}) {
  if (!channel) return null;

  switch (channel) {
    // ── Brand marks (full color, don't inherit currentColor) ──
    case 'meta':
      return <MetaBrandIcon className={className} />;
    case 'google':
      return <GoogleAdsBrandIcon className={className} />;
    case 'youtube':
      return <YouTubeBrandIcon className={className} />;

    // ── Media ──
    case 'ott':
      return <PlayCircleIcon className={className} />;
    case 'tv':
      return <TvIcon className={className} />;
    case 'radio':
      return <SignalIcon className={className} />;
    case 'billboard':
    case 'transit_billboard':
      return <RectangleGroupIcon className={className} />;
    case 'print':
    case 'edd':
      return <PrinterIcon className={className} />;

    // ── Services ──
    case 'email':
    case 'sms':
      return <EnvelopeIcon className={className} />;
    case 'seo':
      return <MagnifyingGlassIcon className={className} />;
    case 'organic_social':
      return <HashtagIcon className={className} />;
    case 'data_feed':
    case 'database':
      return <CircleStackIcon className={className} />;
    case 'lead_provider':
    case 'conversion_provider':
      return <UserPlusIcon className={className} />;
    case 'reputation':
      return <StarIcon className={className} />;
    case 'chat':
      return <ChatBubbleLeftRightIcon className={className} />;
    case 'development':
    case 'maintenance':
      return <CodeBracketIcon className={className} />;
    case 'marketing_analytics':
      return <ChartBarIcon className={className} />;

    // ── Production ──
    case 'production':
      return <VideoCameraIcon className={className} />;

    // ── Other ──
    case 'sponsorship':
      return <TrophyIcon className={className} />;
    case 'new_clients':
      return <SparklesIcon className={className} />;

    default:
      return <LineTypeIcon channel={channel} className={className} />;
  }
}

/** Kind-of-money fallback for a channel with no glyph of its own. */
function LineTypeIcon({ channel, className }: { channel: string; className?: string }) {
  switch (channelLineType(channel)) {
    case 'media':
      return <MegaphoneIcon className={className} />;
    case 'fee':
      return <BanknotesIcon className={className} />;
    case 'service':
      return <WrenchScrewdriverIcon className={className} />;
    case 'production':
      return <VideoCameraIcon className={className} />;
    default:
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
