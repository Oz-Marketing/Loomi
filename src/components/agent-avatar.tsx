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

/**
 * Rendered box per size.
 *
 * Sized for a PORTRAIT rather than for the geometric mark these started as. A
 * face needs more pixels than a glyph to read as a particular person: at 24px
 * Vera was a lilac smudge beside her own name. `lg` is the empty-state hero and
 * is deliberately much larger — it is the one place the character is the subject
 * rather than a label on something else.
 */
const SIZES = {
  sm: { box: 30, stroke: 1.6 },
  md: { box: 38, stroke: 1.5 },
  lg: { box: 76, stroke: 1.4 },
} as const;

export function AgentAvatar({
  identity,
  size = 'md',
  /** Adds a soft pulse — used while the agent is thinking. */
  active = false,
  /**
   * Fill the parent instead of using a fixed box — for a container that already
   * has a size and a shape of its own, like the floating bubble.
   */
  fill = false,
  /**
   * Drop the tinted disc and ring.
   *
   * Those exist to give a face something to sit on when it floats on a flat
   * panel. Inside the bubble it already has one — the bubble's own gradient — so
   * the ring reads as a second border drawn inside the first.
   */
  bare = false,
  className = '',
}: {
  identity: AgentIdentity;
  size?: keyof typeof SIZES;
  active?: boolean;
  fill?: boolean;
  bare?: boolean;
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
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full ${
        fill ? 'h-full w-full' : ''
      } ${className}`}
      style={{
        ...(fill ? {} : { width: box, height: box }),
        ...(bare
          ? {}
          : {
              // A tint of the agent's accent rather than the accent itself: a
              // saturated disc at 44px reads as a status dot, not a face.
              background: `color-mix(in srgb, ${accent} 18%, transparent)`,
              boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent} 45%, transparent)`,
            }),
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
          width={fill ? '58%' : box * 0.58}
          height={fill ? '58%' : box * 0.58}
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
