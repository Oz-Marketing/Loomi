import type { GroupableAd, VariantGroup } from './variant-groups';

/**
 * Where an offer stands between "the machine made it" and "it's on Meta".
 *
 * The list used to answer this with `status` alone — draft or ready — which was
 * enough when a person built every ad by hand and "draft" meant "I'm not
 * finished". It stopped being enough the moment generation started producing ads
 * unattended: now most of the list is machine-made, and the only question that
 * matters is which ones are WAITING ON A HUMAN versus which are already out
 * there earning.
 *
 * Four stages, and the order below is the precedence when more than one could
 * apply. It runs most-settled to least, so the stage always names the thing
 * standing between the ad and being live:
 *
 *   running        — in a published launch. A fact about the world, not a state
 *                    of ours, so it outranks everything.
 *   approved       — marked ready, nobody has launched it yet.
 *   needs_pick     — several designs exist for the offer and nobody has chosen.
 *                    Ahead of needs_approval because picking is the FIRST action;
 *                    approving a design that may be discarded is wasted effort.
 *   needs_approval — a single design, still a draft. The default resting state
 *                    for anything the generator produced.
 *
 * Pure and client-safe — the list computes this locally from rows it already has.
 */

export type AdStage = 'needs_pick' | 'needs_approval' | 'approved' | 'running';

export interface StageMeta {
  label: string;
  /** What a person does next, or what is true. Used for the chip's tooltip. */
  hint: string;
}

export const AD_STAGE: Record<AdStage, StageMeta> = {
  needs_pick: {
    label: 'Needs a pick',
    hint: 'Several designs were built for this offer — choose the one to use.',
  },
  needs_approval: {
    label: 'Needs approval',
    hint: 'Generated and waiting on a person. It will not run until it is approved.',
  },
  approved: {
    label: 'Approved',
    hint: 'Approved and ready to launch. Not running yet.',
  },
  running: {
    label: 'Running',
    hint: 'Live in a published campaign.',
  },
};

/** Ads carrying enough to place them. `running` comes from the launch tables. */
export interface StageableAd extends GroupableAd {
  running?: boolean;
}

/**
 * Stage for one offer group.
 *
 * Judged from the group's LEAD — the chosen design, else the recommended one —
 * because the row shows one card and a row can only be in one state. The
 * exception is `needs_pick`, which is a property of the group rather than of any
 * single design in it.
 */
export function stageOf<T extends StageableAd>(group: VariantGroup<T>): AdStage {
  const lead = group.selected ?? group.lead;
  if (lead.running) return 'running';
  if (group.isChoice && !group.selected) return 'needs_pick';
  if (lead.status === 'ready') return 'approved';
  return 'needs_approval';
}

/**
 * The two halves the list separates on: work outstanding, versus work done.
 *
 * Kept as one function so the split is defined once. "Waiting on you" is the
 * headline the surface is organized around — a dealer opening the page wants the
 * count of things needing a decision, not a count of ads.
 */
export function isWaitingOnSomeone(stage: AdStage): boolean {
  return stage === 'needs_pick' || stage === 'needs_approval';
}

/**
 * Where a generated EMAIL sits in the same four stages.
 *
 * The monthly run produces a companion offer email alongside the ads, and from
 * the client's side it is the same kind of thing: something the machine made
 * that they need to look at. Mapping it onto the ad stages means the list can
 * show both without inventing a second vocabulary for "is this waiting on me".
 *
 * `EmailBlast.status` is queued | scheduled | processing | completed | partial |
 * failed | canceled. A queued blast is the draft state the generator leaves it
 * in — nothing has been sent — so it reads as needing approval.
 */
export function stageOfEmail(status: string, scheduledFor: Date | string | null): AdStage {
  if (status === 'processing' || status === 'completed' || status === 'partial') return 'running';
  if (status === 'scheduled' || scheduledFor) return 'approved';
  // failed / canceled land here too: both are back in a person's hands.
  return 'needs_approval';
}

/**
 * Tally a list of stages. Always returns every key.
 *
 * Split out from `countByStage` because the client's folders tally a MIXED list
 * — the run's ads and its email — and only the stage is common to both. Two
 * separate tallies would let the folder header and the filter chips disagree
 * about what "approved" counts.
 */
export function tallyStages(stages: AdStage[]): Record<AdStage, number> {
  const counts: Record<AdStage, number> = {
    needs_pick: 0,
    needs_approval: 0,
    approved: 0,
    running: 0,
  };
  for (const s of stages) counts[s]++;
  return counts;
}

/** Tally by stage, for the filter chips. Always returns every key. */
export function countByStage<T extends StageableAd>(
  groups: VariantGroup<T>[],
): Record<AdStage, number> {
  return tallyStages(groups.map(stageOf));
}
