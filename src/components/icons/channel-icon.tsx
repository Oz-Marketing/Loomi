'use client';

import {
  EnvelopeIcon,
  MegaphoneIcon,
  PlayCircleIcon,
  PrinterIcon,
  RectangleGroupIcon,
  SignalIcon,
  TvIcon,
  VideoCameraIcon,
} from '@heroicons/react/24/outline';
import { MetaBrandIcon, GoogleAdsBrandIcon, YouTubeBrandIcon } from './platform-logos';

/**
 * The mark shown beside a budget channel's name.
 *
 * Third-party ad platforms get their real brand mark — a rep scanning the grid
 * recognizes the Meta swirl faster than the word "Meta". Everything else (mail,
 * broadcast, production, PR) is a category rather than a vendor, so it gets a
 * neutral glyph in the caller's text color; there's no logo to be right about.
 *
 * Channel keys come from `@/lib/budget/channels` — keep the two in step. An
 * unmapped key renders nothing rather than a placeholder, so adding a channel
 * degrades to a plain label instead of a wrong icon.
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

    // ── Category glyphs (monochrome, inherit the caller's color) ──
    case 'ott':
      return <PlayCircleIcon className={className} />;
    case 'email_sms':
      return <EnvelopeIcon className={className} />;
    case 'radio':
      return <SignalIcon className={className} />;
    case 'tv':
      return <TvIcon className={className} />;
    case 'billboard':
      return <RectangleGroupIcon className={className} />;
    case 'print':
      return <PrinterIcon className={className} />;
    case 'video':
      return <VideoCameraIcon className={className} />;
    case 'pr':
      return <MegaphoneIcon className={className} />;
    default:
      return null;
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
