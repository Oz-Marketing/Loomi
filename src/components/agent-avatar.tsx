'use client';

/**
 * An agent's face.
 *
 * One component so a portrait can replace a mark everywhere at once: set
 * `portraitUrl` on the identity and every avatar in the product changes, with no
 * call site touched. See the header of `lib/ai/specialists/identity.ts` for why
 * marks come first.
 */

import { useState } from 'react';
import { MARK_PATHS, type AgentIdentity } from '@/lib/ai/specialists/identity';

const SIZES = {
  sm: { box: 24, stroke: 1.6 },
  md: { box: 32, stroke: 1.5 },
  lg: { box: 44, stroke: 1.4 },
} as const;

export function AgentAvatar({
  identity,
  size = 'md',
  /** Adds a soft pulse — used while the agent is thinking. */
  active = false,
  className = '',
}: {
  identity: AgentIdentity;
  size?: keyof typeof SIZES;
  active?: boolean;
  className?: string;
}) {
  const { box, stroke } = SIZES[size];
  const { accent, mark, portraitUrl, name } = identity;
  // A portrait that 404s must not leave a broken-image glyph in the panel header.
  // Falling back to the mark means a missing file degrades to the generated face
  // rather than to nothing, which also lets an identity name its portrait before
  // the artwork exists.
  const [portraitFailed, setPortraitFailed] = useState(false);
  const showPortrait = Boolean(portraitUrl) && !portraitFailed;

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full ${className}`}
      style={{
        width: box,
        height: box,
        // A tint of the agent's accent rather than the accent itself: a saturated
        // disc at 44px reads as a status dot, not a face.
        background: `color-mix(in srgb, ${accent} 18%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent} 45%, transparent)`,
      }}
      aria-hidden="true"
    >
      {showPortrait ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={portraitUrl}
          alt=""
          onError={() => setPortraitFailed(true)}
          // The portrait's own background is transparent, so the accent tint
          // behind it shows through around the head — which is what gives the
          // paler characters something to sit against in light mode.
          className="h-full w-full rounded-full object-cover"
        />
      ) : (
        <svg
          viewBox="0 0 24 24"
          width={box * 0.58}
          height={box * 0.58}
          fill="none"
          stroke={accent}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {MARK_PATHS[mark].map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
      )}
      {active && (
        <span
          className="absolute inset-0 rounded-full motion-safe:animate-ping"
          style={{ boxShadow: `0 0 0 1px color-mix(in srgb, ${accent} 40%, transparent)` }}
        />
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}
