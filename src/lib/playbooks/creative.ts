/**
 * Creative playbooks — the ad template + sizes + offer-email shell that go
 * together, authored agency-wide and applied to many accounts.
 *
 * WHAT THIS MODULE IS FOR. A playbook PRESETS an account's creative rather
 * than replacing it: `AdAutomationConfig` stays the single source of truth for
 * what a run actually uses. So generation never resolves a playbook, nothing
 * breaks when one is deleted, and there is no second copy of the truth to drift.
 *
 * Which means override state is DERIVED, by comparing the config's columns to
 * the playbook's definition — never stored. `docs/playbooks.md` §5 Phase 2 spells
 * out why: a stored `synced | detached` state needs a backfill, and any row it
 * misses resolves to a lie. Comparison needs neither.
 *
 * Pure — no prisma, no react. Everything here is testable with plain objects.
 */
import { createHash } from 'crypto';

/** The bundle a creative playbook defines. */
export interface CreativeDefinition {
  /** `AdTemplateDoc.id` the run RECOMMENDS — the design a row leads with. */
  adTemplateId: string;
  /**
   * Every `AdTemplateDoc.id` the fan-out may build. Empty = no constraint, i.e.
   * every published template in scope for the account.
   *
   * Separate from `adTemplateId` because they answer different questions: that
   * one picks the design a dealer sees first, this one bounds the set they
   * choose among. `effectiveFanOut` unions the two, so a playbook can never
   * recommend a design it does not permit.
   */
  fanOutTemplateIds: string[];
  /** Which of that template's sizes to render. Empty = all of them. */
  sizeIds: string[];
  /** `Template.slug` of the v2 email shell. Empty = compose from the brand kit. */
  emailTemplateSlug: string;
  /** How many offers the email features. */
  emailMaxOffers: number;
}

/** Which parts of the bundle an account has diverged from. */
export type CreativeStep =
  | 'adTemplate'
  | 'fanOut'
  | 'sizes'
  | 'emailTemplate'
  | 'emailMaxOffers';

export const CREATIVE_STEPS: CreativeStep[] = [
  'adTemplate',
  'fanOut',
  'sizes',
  'emailTemplate',
  'emailMaxOffers',
];

/** Human labels, shared by the settings UI and the audit so they agree. */
export const STEP_LABEL: Record<CreativeStep, string> = {
  adTemplate: 'Recommended design',
  fanOut: 'Designs built',
  sizes: 'Sizes',
  emailTemplate: 'Email template',
  emailMaxOffers: 'Max offers',
};

const EMPTY: CreativeDefinition = {
  adTemplateId: '',
  fanOutTemplateIds: [],
  sizeIds: [],
  emailTemplateSlug: '',
  emailMaxOffers: 6,
};

/**
 * Parse a stored definition, tolerating anything.
 *
 * A malformed definition must not take a page down — it degrades to "this
 * playbook presets nothing", which the UI can show, rather than throwing inside
 * a render.
 */
export function parseDefinition(raw: string | null | undefined): CreativeDefinition {
  if (!raw) return { ...EMPTY };
  let obj: Partial<CreativeDefinition> | null = null;
  try {
    obj = JSON.parse(raw) as Partial<CreativeDefinition>;
  } catch {
    return { ...EMPTY };
  }
  if (!obj || typeof obj !== 'object') return { ...EMPTY };
  const max = Number(obj.emailMaxOffers);
  return {
    adTemplateId: typeof obj.adTemplateId === 'string' ? obj.adTemplateId : '',
    fanOutTemplateIds: Array.isArray(obj.fanOutTemplateIds)
      ? obj.fanOutTemplateIds.filter((s) => typeof s === 'string')
      : [],
    sizeIds: Array.isArray(obj.sizeIds) ? obj.sizeIds.filter((s) => typeof s === 'string') : [],
    emailTemplateSlug: typeof obj.emailTemplateSlug === 'string' ? obj.emailTemplateSlug : '',
    // 0 would mean "feature no offers", which reads as a limit but produces an
    // empty email — same fallback the settings form applies.
    emailMaxOffers: Number.isFinite(max) && max > 0 ? Math.floor(max) : 6,
  };
}

/**
 * Hash a definition for the staleness test.
 *
 * Key order and size order are normalized first, so re-saving an unchanged
 * playbook doesn't mark every rooftop as behind — the same trap
 * `formKey`/`sizeIds` sorting exists for in the settings form.
 */
export function definitionHash(def: CreativeDefinition): string {
  const canonical = JSON.stringify({
    adTemplateId: def.adTemplateId,
    fanOutTemplateIds: [...def.fanOutTemplateIds].sort(),
    sizeIds: [...def.sizeIds].sort(),
    emailTemplateSlug: def.emailTemplateSlug,
    emailMaxOffers: def.emailMaxOffers,
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

/**
 * What a save does to the version number.
 *
 * ONLY a real content change bumps it. Renaming a playbook, changing its scope,
 * re-publishing it, or pressing Save on an untouched form must not move the
 * version — every rooftop on the old number would read as behind, and a "behind"
 * signal that fires on a rename is a signal people learn to ignore.
 *
 * `nextDefinition` is undefined on a save that didn't touch the bundle (a
 * rename), which keeps the caller from having to re-derive the current hash
 * just to prove nothing changed.
 *
 * Pure, and separate from `library.ts`, because this is the rule the staleness
 * story rests on and it should be provable without a database.
 */
export function resolveVersionBump(input: {
  currentVersion: number;
  currentHash: string;
  nextDefinition?: CreativeDefinition;
}): { version: number; hash: string; bumped: boolean } {
  const hash = input.nextDefinition ? definitionHash(input.nextDefinition) : input.currentHash;
  const bumped = hash !== input.currentHash;
  return {
    version: bumped ? input.currentVersion + 1 : input.currentVersion,
    hash,
    bumped,
  };
}

/** The subset of an account's config a creative playbook presets. */
export interface ConfigCreative {
  adTemplateId: string;
  fanOutTemplateIds: string[];
  sizeIds: string[];
  emailTemplateSlug: string;
  emailMaxOffers: number;
}

// The separator is an escaped NUL rather than a literal one: a raw \0 byte in
// the source makes the whole FILE binary to grep, so nothing in it can be
// found by search. `meta-ads-pacer.ts` has the same trap.
const SIZE_JOIN = '\u0000';
/** Order-insensitive set equality, used for both id lists. */
const sameIds = (a: string[], b: string[]) =>
  a.length === b.length &&
  [...a].sort().join(SIZE_JOIN) === [...b].sort().join(SIZE_JOIN);

/**
 * Which steps the account has overridden.
 *
 * Order-insensitive on sizes, so re-picking the same sizes in a different order
 * is not an override.
 */
export function detachedSteps(
  config: ConfigCreative,
  def: CreativeDefinition,
): CreativeStep[] {
  const out: CreativeStep[] = [];
  if (config.adTemplateId !== def.adTemplateId) out.push('adTemplate');
  if (!sameIds(config.fanOutTemplateIds, def.fanOutTemplateIds)) out.push('fanOut');
  if (!sameIds(config.sizeIds, def.sizeIds)) out.push('sizes');
  if (config.emailTemplateSlug !== def.emailTemplateSlug) out.push('emailTemplate');
  if (config.emailMaxOffers !== def.emailMaxOffers) out.push('emailMaxOffers');
  return out;
}

/** True when the account matches its playbook exactly. */
export function isFullySynced(config: ConfigCreative, def: CreativeDefinition): boolean {
  return detachedSteps(config, def).length === 0;
}

/**
 * Apply a playbook to a config — what "pick a playbook" writes.
 *
 * Returns the whole creative bundle rather than a patch, because `save_config`
 * is a full replace and a partial object there is how fields get silently reset.
 */
export function applyDefinition(def: CreativeDefinition): ConfigCreative {
  return {
    adTemplateId: def.adTemplateId,
    fanOutTemplateIds: [...def.fanOutTemplateIds],
    sizeIds: [...def.sizeIds],
    emailTemplateSlug: def.emailTemplateSlug,
    emailMaxOffers: def.emailMaxOffers,
  };
}

/**
 * Reset ONE overridden step back to the playbook, leaving the others alone.
 *
 * The per-step undo behind each "Overridden" badge. Whole-bundle re-apply would
 * throw away deliberate overrides the person wasn't looking at.
 */
export function resetStep(
  config: ConfigCreative,
  def: CreativeDefinition,
  step: CreativeStep,
): ConfigCreative {
  switch (step) {
    case 'adTemplate':
      // Sizes belong to the ad template's own list, so a size selection made
      // against a different design is meaningless — clear it rather than carry
      // it across and render nothing.
      return { ...config, adTemplateId: def.adTemplateId, sizeIds: [...def.sizeIds] };
    case 'fanOut':
      return { ...config, fanOutTemplateIds: [...def.fanOutTemplateIds] };
    case 'sizes':
      return { ...config, sizeIds: [...def.sizeIds] };
    case 'emailTemplate':
      return { ...config, emailTemplateSlug: def.emailTemplateSlug };
    case 'emailMaxOffers':
      return { ...config, emailMaxOffers: def.emailMaxOffers };
  }
}

/**
 * The designs a run may actually build, from a config's own columns.
 *
 * Unions the recommended design into the permitted set: a config that names a
 * lead outside its own fan-out list would recommend a design the run then
 * refuses to build, and the dealer's row would lead with nothing. Empty result
 * means UNCONSTRAINED — every published template in scope — which is what an
 * account following no playbook has always done.
 */
export function effectiveFanOut(config: {
  adTemplateId?: string | null;
  fanOutTemplateIds?: string[] | null;
}): string[] {
  const set = (config.fanOutTemplateIds ?? []).filter(Boolean);
  if (set.length === 0) return [];
  const lead = (config.adTemplateId ?? '').trim();
  return lead && !set.includes(lead) ? [...set, lead] : [...set];
}
