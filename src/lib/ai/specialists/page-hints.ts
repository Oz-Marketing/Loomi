/**
 * Which specialist is relevant on a given page, and what to nudge with.
 *
 * Deterministic route matching rather than an LLM router: it's free, it's
 * debuggable, and it can never send a co-op question to the email assistant. The
 * user can always switch specialists by hand, so the cost of a wrong guess here is
 * one click, not a wrong answer.
 *
 * Pure — no React, no DOM — so the matching and the copy are testable on their own.
 */

import type { SpecialistKey } from './identity';

export interface PageHint {
  specialist: SpecialistKey;
  /** The line shown in the teaser beside the bubble. First person, short. */
  teaser: string;
  /**
   * Questions worth asking here. Shown as one-tap chips, and rotated through the
   * teaser. Written as things a person would actually type — a dealer asking about
   * stacking rebates, not "query the guideline corpus".
   */
  examples: string[];
}

/**
 * Route patterns, most specific first.
 *
 * These are EXACT. An early version matched all of `/settings`, which put "Ask me
 * about co-op" on Contact Field Blueprints and Ad Sizes — pages with nothing to do
 * with co-op. A specialist that volunteers itself where it isn't relevant teaches
 * people to dismiss it without reading, which costs more than the nudge ever earned.
 *
 * Each settings tab is its own route (`/settings/<tab>`, see `settings-registry`),
 * so precision here is just a matter of naming the tab rather than the section.
 *
 * A page with no entry gets NO teaser. Leaving a specialist's page therefore either
 * clears the nudge or replaces it with whatever agent owns the new page — both fall
 * out of the lookup, with no dismissal logic needed.
 */

/** Surfaces that can prefix a settings or tool route. */
const PREFIX = String.raw`(?:\/subaccount\/[^/]+|\/app|\/reporting)?`;

const HINTS: Array<{ match: RegExp; hint: PageHint }> = [
  {
    // The co-op team's own surface — this tab and no other.
    match: new RegExp(`^${PREFIX}\\/settings\\/coop-guidelines\\/?$`),
    hint: {
      specialist: 'coop',
      teaser: 'Ask me about co-op',
      examples: [
        'What are the rules for using a manufacturer brandmark?',
        'Which brands do we have guidelines on file for?',
        'Has anything changed in the guidelines recently?',
        'Is there a sales event running right now?',
        'What does the Ad Generator actually enforce automatically?',
      ],
    },
  },
  {
    // The ad builder and the generated-ad queue — same specialist, different
    // question. This is the "switch to that tool's agent" case: you leave the
    // guidelines page and the nudge follows only where it still makes sense.
    match: new RegExp(`^${PREFIX}\\/ad-generator(?:\\/.*)?$`),
    hint: {
      specialist: 'coop',
      teaser: 'Co-op question about this ad?',
      examples: [
        'Can I combine a manufacturer rebate with a dealer discount in one ad?',
        'What disclaimer is required on an APR offer?',
        'Is there a minimum font size for the disclaimer?',
        'Why did this template fail its co-op check?',
      ],
    },
  },
];

export function pageHint(pathname: string): PageHint | null {
  for (const { match, hint } of HINTS) {
    if (match.test(pathname)) return hint;
  }
  return null;
}

/**
 * The example to show this time.
 *
 * Index-based rather than random so a caller can rotate deliberately, and so the
 * same page never flickers between two questions on re-render.
 */
export function rotatingExample(hint: PageHint, index: number): string {
  return hint.examples[index % hint.examples.length];
}
