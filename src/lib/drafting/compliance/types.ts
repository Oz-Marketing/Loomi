import type { CoopRulePack } from '@/lib/ad-generator/coop-rules';
import type { EmailTemplate } from '@/lib/email/types';

/**
 * The shapes the drafting compliance rules share.
 *
 * Every rule is a pure function of ONE `DraftArtifact`: the assembled email,
 * the rendered HTML that goes into Draft Files, and everything the rules need
 * to judge it, resolved by the caller beforehand. No rule touches the database,
 * the network or the clock, so each one is testable on a fixture in isolation.
 */

/** `error` stops the draft before it reaches Draft Files; `warning` rides along for the proofer. */
export type Severity = 'error' | 'warning';

export interface DraftAccount {
  key: string;
  /** `Account.dealer` — the full name, which copy must never shorten. */
  dealer: string;
  /** Canonical makes, from `getAccountOems()`. OEM rules key off these. */
  oems: string[];
  /** Every ancestor group key, nearest first — e.g. `youngAutomotiveGroup`. */
  groupKeys: string[];
  /** The site exactly as the footer prints it: "YoungCDJRRiverdale.com". */
  siteDisplay: string | null;
  /** `Account.website`, to sanity-check that `siteDisplay` is the dealer's own site. */
  website: string | null;
  /** Short forms this dealer is known by, e.g. "Young CDJR of Riverdale". */
  abbreviations?: string[];
}

export interface CopyOption {
  text: string;
  /** The first send, or the "last chance" follow-up. */
  kind: 'initial' | 'urgent';
}

/** A legitimate source of a claim: the confirmed extraction, or the written request. */
export interface FactSource {
  /** e.g. `extraction.offer`, `request.details` — shown when a claim is traced. */
  label: string;
  text: string;
}

export interface DraftArtifact {
  account: DraftAccount;
  /** The request is co-op-claimed advertising (monday Co-op = Yes / Compliance Check). */
  coop: boolean;
  /** lease | finance | cash | …, from the extraction, when it says. */
  offerType: string | null;
  subjects: CopyOption[];
  previews: CopyOption[];
  template: EmailTemplate;
  /** The rendered HTML — exactly the file that goes into Draft Files. */
  html: string;
  /** The disclaimer carried verbatim from the creative, and the block holding it. */
  disclaimer: { text: string; blockId: string } | null;
  /** The footer section the assembler built. */
  footerBlockId: string;
  /** The only places a number, date or make in the copy may come from. */
  facts: FactSource[];
  /** The utm_campaign every link must carry. */
  utmCampaign: string;
  /** The advertised make's co-op pack, accepted rules only — or null. */
  coopPack: CoopRulePack | null;
}

/** What a rule reports. The registry stamps the rule id on. */
export interface Finding {
  severity: Severity;
  /** Plain language for the person fixing the draft. */
  message: string;
  /** "subject 2 (urgent)", "block:hero-copy", "link 3", "footer". */
  where?: string;
  /** The offending text, trimmed. */
  excerpt?: string;
}

export interface Violation extends Finding {
  ruleId: string;
}

/**
 * Which drafts a rule applies to. Empty = every draft.
 *
 * `oems` / `exceptOems` match the ACCOUNT's makes, not makes the copy happens to
 * mention: a Honda brand rule binds a Honda store's email, and Young Honda
 * Powerhouse (`Honda Powersports`) is a different brand on purpose.
 */
export interface RuleScope {
  oems?: string[];
  exceptOems?: string[];
  /** Account group keys; matches the account itself or any ancestor. */
  groups?: string[];
}

export interface DraftRule {
  /** Stable — appears in violations, logs and the spec. */
  id: string;
  scope: RuleScope;
  /** One line, for the rule list. */
  summary: string;
  check(artifact: DraftArtifact): Finding[];
}
