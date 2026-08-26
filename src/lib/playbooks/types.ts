/**
 * Playbooks — shared types for the Phase 0 coverage audit.
 *
 * A playbook is the standard way a kind of account is run (see
 * docs/playbooks.md). Phase 0 is the read-only half: a registry of checks, a
 * handful of playbooks that bundle them, and a coverage matrix across every
 * account the viewer can see.
 *
 * Nothing here imports prisma or react. The audit context is built once per
 * account by `context.ts` (the only module that touches the database) and every
 * check is a pure function over it — which is what lets `checks.test.ts` build
 * contexts by hand and assert on them with no database.
 */

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'na';

/**
 * How much a failure costs, kept separate from whether it failed.
 *
 *   blocking — publishing/automation is impossible until it's fixed
 *   standard — the setup is incomplete, work happens anyway
 *   advisory — worth knowing, not a defect
 *
 * The UI sorts by severity within a playbook so a blocking red never renders
 * below an advisory one.
 */
export type CheckSeverity = 'blocking' | 'standard' | 'advisory';

/** Which host the fix link points at — App and Studio are separate origins. */
export type Surface = 'app' | 'studio';

export interface CheckOutcome {
  status: CheckStatus;
  /** One line describing the OBSERVED state, not the requirement. */
  detail: string;
}

export interface PlaybookCheck {
  id: string;
  label: string;
  /** Why this matters. Rendered as the check's tooltip. */
  why: string;
  severity: CheckSeverity;
  /**
   * Where a person goes to fix it. `{key}` and `{slug}` are substituted with
   * the account's key / slug (slug falls back to key when unset).
   */
  fix?: { surface: Surface; path: string; label: string };
  run(ctx: AccountAuditContext): CheckOutcome;
}

export interface PlaybookDefinition {
  key: string;
  name: string;
  description: string;
  /**
   * Phase 0 infers applicability from observable account facts. This is a
   * STAND-IN for the explicit PlaybookApplication link Phase 1 introduces —
   * inferring "this store should have a conversion action because it has a
   * customer id" is precisely the guesswork a real playbook removes. See
   * docs/playbooks.md §4.3.
   */
  appliesTo(ctx: AccountAuditContext): boolean;
  /** Check ids, in display order. Unknown ids are dropped at build time. */
  checkIds: string[];
}

// ── audit context ────────────────────────────────────────────────────────────

/** A brand kit resolved up the parent chain (the account's own value wins). */
export interface ResolvedBranding {
  logoLight: string | null;
  primaryColor: string | null;
  /** True when either value came from an ancestor rather than the account. */
  inherited: boolean;
}

export interface LaunchPresetFacts {
  platform: string;
  launchMode: string;
  targetAdSetId: string | null;
}

export interface PacerFacts {
  hasPlan: boolean;
  /** The period every budget figure below refers to, as YYYY-MM. */
  period: string;
  /** base + added for the current period, in client-gross dollars. */
  metaBudgetGoal: number;
  googleBudgetGoal: number;
  managedByBudget: boolean;
  googleManagedByBudget: boolean;
}

export interface AutomationFacts {
  exists: boolean;
  enabled: boolean;
  /** Distinct AdTemplateDoc ids referenced by `templateMap`. */
  templateIds: string[];
  notifyUserCount: number;

  // ── companion offer email ──
  /** Whether the run also drafts an email from the same offers. */
  emailEnabled: boolean;
  /** Configured shell template slug, and whether it actually resolves to a v2
   *  template carrying the `{{offers}}` marker. Null slug = compose from
   *  branding, which is a valid configuration rather than a gap. */
  emailTemplateSlug: string | null;
  emailTemplateOk: boolean;
  emailTemplateProblem: string | null;
  /** Configured audience, and whether it still exists on THIS account. */
  emailAudienceId: string | null;
  emailAudienceOk: boolean;
  /** Most recent draft the automation produced, for a heartbeat check. */
  lastOfferEmailAt: Date | null;
}

export interface FeedFacts {
  name: string;
  isActive: boolean;
  lastSyncedAt: Date | null;
  lastSyncStatus: string | null;
  vehicleCount: number;
}

/**
 * Co-op standing of one mapped template.
 *
 *   approved — a live approval whose docHash matches the current design
 *   stale    — an approval exists, but the design has moved since
 *   missing  — no live approval for any make this account runs
 */
export type CoopState = 'approved' | 'stale' | 'missing';

export interface CoopFacts {
  templateId: string;
  templateName: string;
  state: CoopState;
}

/**
 * A check someone has deliberately marked "not a question here".
 *
 * Applicability in Phase 0 is INFERRED, so the audit is wrong in both directions
 * (docs/playbooks.md §4.3). A waiver is how that judgement gets recorded instead
 * of lost — and a waived check scores as `na`, excluded from coverage, because
 * "this does not apply to us" is precisely what the person is asserting.
 *
 * `reason` is never blank: a waiver without one is how a real red gets buried.
 */
export interface CheckWaiver {
  checkId: string;
  reason: string;
  waivedByUserId: string | null;
  waivedByName: string | null;
  at: Date;
}

export interface AccountAuditContext {
  accountKey: string;
  dealer: string;
  slug: string;
  category: string | null;
  /** Makes from `oems` (JSON array) falling back to the single `oem`. */
  makes: string[];
  timezone: string | null;
  accountRepId: string | null;
  markup: number | null;
  lifecyclePresetsSeededAt: Date | null;
  branding: ResolvedBranding;

  meta: {
    adAccountId: string | null;
    pageId: string | null;
    assetsConfirmedAt: Date | null;
    pixelId: string | null;
    defaultConversionEvent: string | null;
    /** Cached from the Marketing API on each sync — presence means it has run. */
    timezone: string | null;
  };
  google: {
    customerId: string | null;
    conversionAction: string | null;
  };
  email: { senderEmail: string | null; sendingDomain: string | null };
  sms: { messagingServiceSid: string | null; phoneNumber: string | null };

  launchPresets: LaunchPresetFacts[];
  pacer: PacerFacts;
  automation: AutomationFacts;
  feeds: FeedFacts[];
  coop: CoopFacts[];

  /**
   * Waivers on this account, keyed by check id. Applied by `audit.ts` AFTER the
   * check runs, so the observed state is still computed and still shown — a
   * waiver says "we accept this", not "don't look".
   */
  waivers: Record<string, CheckWaiver>;

  /**
   * Latest AdAutomationRun that covered this account — INCLUDING global sweeps,
   * whose `accountKey` is null. Filtering runs by accountKey alone reports every
   * rooftop as stale while the nightly sweep is running fine.
   */
  lastAutomationRunAt: Date | null;
  lastIngestRunAt: Date | null;

  /** Evaluation instant, injected so freshness checks are deterministic in tests. */
  now: Date;
}

// ── audit results ────────────────────────────────────────────────────────────

export interface CheckResult extends CheckOutcome {
  id: string;
  label: string;
  why: string;
  severity: CheckSeverity;
  fix?: { surface: Surface; path: string; label: string };
  /**
   * Present when this result is `na` BECAUSE someone waived it, rather than
   * because the playbook doesn't apply. `detail` still carries the observed
   * state, so the UI can show what was accepted and by whom.
   */
  waived?: CheckWaiver;
}

export interface PlaybookResult {
  key: string;
  name: string;
  description: string;
  applies: boolean;
  checks: CheckResult[];
  /** Scored counts — `na` is excluded from both halves of the ratio. */
  counts: { pass: number; warn: number; fail: number; na: number };
}

export interface AccountCoverage {
  accountKey: string;
  dealer: string;
  slug: string;
  category: string | null;
  makes: string[];
  playbooks: PlaybookResult[];
  counts: { pass: number; warn: number; fail: number; na: number };
  /** pass / (pass + warn + fail), 0–100. Null when nothing applies. */
  coveragePct: number | null;
  /** Failing checks whose severity is `blocking`. The triage number. */
  blockingFails: number;
}

/**
 * The last nightly sweep, so the page can say when the audit last ran on its
 * own rather than only when this request ran it.
 *
 * Null means no sweep has ever completed — which on a flag-gated feature is
 * ordinary, and is a different statement from "the sweep is behind". A
 * `finishedAt` of null on the newest row means it started and never finished.
 */
export interface SweepSummary {
  startedAt: string;
  finishedAt: string | null;
  accountsAudited: number;
  blockingFails: number;
  coveragePct: number | null;
  error: string | null;
}

export interface AuditPayload {
  generatedAt: string;
  period: string;
  /** Filled by the route, not by the pure builder — it is a database fact. */
  lastSweep?: SweepSummary | null;
  accounts: AccountCoverage[];
  /** Cross-account rollup per check — the view that scopes Phase 1. */
  byCheck: {
    id: string;
    label: string;
    why: string;
    severity: CheckSeverity;
    playbookKey: string;
    pass: number;
    warn: number;
    fail: number;
    na: number;
    failingAccounts: { accountKey: string; dealer: string; detail: string }[];
  }[];
}
