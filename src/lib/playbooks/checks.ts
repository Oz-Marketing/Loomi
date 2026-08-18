/**
 * Playbooks — the Phase 0 check registry.
 *
 * Every check is a pure function over an AccountAuditContext. No prisma, no
 * fetch, no clock: `ctx.now` is injected so a freshness check is deterministic
 * under test.
 *
 * A check's `detail` describes the OBSERVED state ("no Page confirmed"), never
 * the requirement ("a Page must be confirmed"). The label already carries the
 * requirement, and a row that repeats it twice tells a reader nothing about
 * their account.
 */

import type { AccountAuditContext, CheckOutcome, PlaybookCheck } from './types';

/** Non-empty after trimming. Blank strings are how "unset" reaches us from forms. */
function set(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

function daysSince(then: Date | null, now: Date): number | null {
  if (!then) return null;
  return (now.getTime() - then.getTime()) / 86_400_000;
}

/** "3 days ago" / "today", for detail strings. */
function ago(then: Date | null, now: Date): string {
  const d = daysSince(then, now);
  if (d == null) return 'never';
  if (d < 1) return 'today';
  const whole = Math.floor(d);
  return whole === 1 ? '1 day ago' : `${whole} days ago`;
}

const pass = (detail: string): CheckOutcome => ({ status: 'pass', detail });
const warn = (detail: string): CheckOutcome => ({ status: 'warn', detail });
const fail = (detail: string): CheckOutcome => ({ status: 'fail', detail });

/** Feed and automation-run freshness. A feed is a daily contract, not a live API. */
const FEED_STALE_DAYS = 3;
const RUN_STALE_DAYS = 3;
/** Contact ingest runs weekly at worst — see docs/oz-reports-contact-sync.md. */
const INGEST_STALE_DAYS = 7;
/** An offer email is only drafted when the offer SET changes, and an OEM
 *  programme routinely holds for a full cycle — so this is a month, not days. */
const OFFER_EMAIL_STALE_DAYS = 35;

const SUBACCOUNT_SETTINGS = {
  surface: 'app' as const,
  path: '/settings/subaccounts/{key}',
  label: 'Account settings',
};

export const CHECKS: PlaybookCheck[] = [
  // ── foundation ─────────────────────────────────────────────────────────────
  {
    id: 'account.oem',
    label: 'OEM assigned',
    why: 'The make drives co-op rules, disclaimer templates and offer polling. Without it the Ad Generator has no programme to watch.',
    severity: 'standard',
    fix: SUBACCOUNT_SETTINGS,
    run: (c) =>
      c.makes.length > 0
        ? pass(c.makes.join(', '))
        : fail('no make set on the account'),
  },
  {
    id: 'account.branding',
    label: 'Brand kit resolves',
    why: 'Generated creative reads the logo and primary colour straight off the account. A missing kit renders a plate with a hole in it.',
    severity: 'standard',
    fix: SUBACCOUNT_SETTINGS,
    run: (c) => {
      const missing: string[] = [];
      if (!set(c.branding.logoLight)) missing.push('light logo');
      if (!set(c.branding.primaryColor)) missing.push('primary colour');
      if (missing.length) return fail(`missing ${missing.join(' and ')}`);
      return pass(c.branding.inherited ? 'inherited from the parent account' : 'set on the account');
    },
  },
  {
    id: 'account.timezone',
    label: 'Timezone set',
    why: 'Sends, flights and daily budget resets are all resolved against it.',
    severity: 'standard',
    fix: SUBACCOUNT_SETTINGS,
    run: (c) => (set(c.timezone) ? pass(c.timezone!) : fail('unset')),
  },
  {
    id: 'account.rep',
    label: 'Account rep assigned',
    why: 'The rep is who alerts and budget questions route to. An unowned rooftop is one nobody notices going quiet.',
    severity: 'advisory',
    fix: SUBACCOUNT_SETTINGS,
    run: (c) => (set(c.accountRepId) ? pass('assigned') : fail('no rep assigned')),
  },

  // ── paid social ────────────────────────────────────────────────────────────
  {
    id: 'meta.ad_account',
    label: 'Meta ad account linked',
    why: 'Nothing syncs spend or publishes without it.',
    severity: 'blocking',
    fix: SUBACCOUNT_SETTINGS,
    run: (c) => (set(c.meta.adAccountId) ? pass(c.meta.adAccountId!) : fail('not linked')),
  },
  {
    id: 'meta.page_confirmed',
    label: 'Publishing Page confirmed',
    why: 'A creative cannot be created without a Page id, and the WRONG Page publishes one store’s ad from another store’s brand. Confirmation is per account, never bulk-matched.',
    severity: 'blocking',
    fix: SUBACCOUNT_SETTINGS,
    run: (c) => {
      if (!set(c.meta.pageId)) return fail('no Page set — launches are blocked');
      if (!c.meta.assetsConfirmedAt) return warn('Page set but never confirmed by a person');
      return pass(`confirmed ${ago(c.meta.assetsConfirmedAt, c.now)}`);
    },
  },
  {
    id: 'meta.pixel',
    label: 'Pixel + conversion event',
    why: 'Anything past a traffic campaign optimises toward a pixel event. Without one the objective silently degrades.',
    severity: 'standard',
    fix: SUBACCOUNT_SETTINGS,
    run: (c) => {
      const hasPixel = set(c.meta.pixelId);
      const hasEvent = set(c.meta.defaultConversionEvent);
      if (hasPixel && hasEvent) return pass(c.meta.defaultConversionEvent!);
      if (hasPixel) return warn('pixel set, no default conversion event');
      return fail('no pixel configured');
    },
  },
  {
    id: 'meta.timezone_synced',
    label: 'Ad-account timezone cached',
    why: 'Meta resets the daily budget at midnight in the AD ACCOUNT’s zone. Until the sync caches it, pacing maths runs against a fallback.',
    severity: 'advisory',
    run: (c) =>
      set(c.meta.timezone)
        ? pass(c.meta.timezone!)
        : warn('not cached yet — pacing falls back to the business timezone'),
  },
  {
    id: 'ads.launch_preset',
    label: 'Meta launch preset',
    why: 'Objective, budget, geo and destination for published ads. Without it every launch is hand-configured.',
    severity: 'blocking',
    fix: { surface: 'studio', path: '/ad-generator/automation', label: 'Ad Generator automation' },
    run: (c) => {
      const preset = c.launchPresets.find((p) => p.platform === 'meta');
      if (!preset) return fail('no preset — launches must be configured by hand');
      if (preset.launchMode === 'attach_existing' && !set(preset.targetAdSetId)) {
        return fail('set to attach to an existing ad set, but no ad set chosen');
      }
      return pass(
        preset.launchMode === 'attach_existing' ? 'attaches to an existing ad set' : 'creates a new campaign',
      );
    },
  },

  // ── paid search ────────────────────────────────────────────────────────────
  {
    id: 'google.customer_id',
    label: 'Google Ads customer linked',
    why: 'The Google pacer and Ads reporting both key off it.',
    severity: 'blocking',
    fix: SUBACCOUNT_SETTINGS,
    run: (c) => (set(c.google.customerId) ? pass(c.google.customerId!) : fail('not linked')),
  },
  {
    id: 'google.conversion_action',
    label: 'Google conversion action',
    why: 'The Google equivalent of the Meta pixel event — without it, conversion bidding has nothing to bid toward.',
    severity: 'standard',
    fix: SUBACCOUNT_SETTINGS,
    run: (c) => (set(c.google.conversionAction) ? pass('set') : fail('unset')),
  },

  // ── pacing + budget ────────────────────────────────────────────────────────
  {
    id: 'pacer.plan',
    label: 'Pacer plan exists',
    why: 'The plan is the container every budget, ad row and spend sync hangs off.',
    severity: 'blocking',
    fix: { surface: 'app', path: '/tools/meta/ad-pacer', label: 'Meta Ad Pacer' },
    run: (c) => (c.pacer.hasPlan ? pass('present') : fail('no plan — this rooftop is not being paced')),
  },
  {
    id: 'pacer.period_budget',
    label: 'Budget set for this month',
    why: 'A month with no goal paces against zero, so every pacing signal for it is meaningless.',
    severity: 'standard',
    fix: { surface: 'app', path: '/tools/meta/ad-pacer', label: 'Meta Ad Pacer' },
    run: (c) => {
      const { metaBudgetGoal, googleBudgetGoal, period } = c.pacer;
      if (metaBudgetGoal > 0 || googleBudgetGoal > 0) {
        const parts: string[] = [];
        if (metaBudgetGoal > 0) parts.push(`Meta $${metaBudgetGoal.toLocaleString()}`);
        if (googleBudgetGoal > 0) parts.push(`Google $${googleBudgetGoal.toLocaleString()}`);
        return pass(`${period}: ${parts.join(', ')}`);
      }
      return fail(`no budget goal for ${period}`);
    },
  },
  {
    id: 'pacer.markup',
    label: 'Markup set',
    why: 'Actual spend = client gross × markup. A rooftop on a non-standard deal that inherits the default is paced to the wrong number.',
    severity: 'advisory',
    fix: SUBACCOUNT_SETTINGS,
    run: (c) =>
      c.markup == null
        ? pass('using the agency default')
        : pass(`${c.markup} (set on the account)`),
  },
  {
    id: 'budget.managed',
    label: 'Budget-managed month',
    why: 'Until this is on, the pacer number is hand-typed and the budget ledger is decorative. Expected red nearly everywhere — this counts the migration.',
    severity: 'advisory',
    fix: { surface: 'app', path: '/projects/budget', label: 'Budget hub' },
    run: (c) => {
      const { managedByBudget, googleManagedByBudget, period } = c.pacer;
      if (managedByBudget && googleManagedByBudget) return pass(`${period}: both platforms`);
      if (managedByBudget) return warn(`${period}: Meta only`);
      if (googleManagedByBudget) return warn(`${period}: Google only`);
      return fail(`${period}: hand-typed on both platforms`);
    },
  },

  // ── ad automation ──────────────────────────────────────────────────────────
  {
    id: 'adgen.config_enabled',
    label: 'Offer automation on',
    why: 'The config is what makes the poller watch this rooftop at all.',
    severity: 'standard',
    fix: { surface: 'studio', path: '/ad-generator/automation', label: 'Ad Generator automation' },
    run: (c) => {
      if (!c.automation.exists) return fail('never configured');
      return c.automation.enabled ? pass('enabled') : fail('configured but switched off');
    },
  },
  {
    id: 'adgen.template_map',
    label: 'Template mapped',
    why: 'The generate step has nothing to render an offer into without one.',
    severity: 'blocking',
    fix: { surface: 'studio', path: '/ad-generator/automation', label: 'Ad Generator automation' },
    run: (c) => {
      const n = c.automation.templateIds.length;
      if (n === 0) return fail('no template mapped — nothing can generate');
      return pass(n === 1 ? '1 template' : `${n} templates`);
    },
  },
  {
    id: 'adgen.notify',
    label: 'Run notifications routed',
    why: 'With no recipients a run that generates nothing, or generates something wrong, reaches nobody.',
    severity: 'standard',
    fix: { surface: 'studio', path: '/ad-generator/automation', label: 'Ad Generator automation' },
    run: (c) =>
      c.automation.notifyUserCount > 0
        ? pass(`${c.automation.notifyUserCount} recipient${c.automation.notifyUserCount === 1 ? '' : 's'}`)
        : fail('no recipients'),
  },
  {
    id: 'adgen.inventory_feed',
    label: 'Inventory feed healthy',
    why: 'Stock gates which offers are worth advertising, and the feed supplies the vehicle photos.',
    severity: 'standard',
    fix: { surface: 'studio', path: '/ad-generator/automation', label: 'Ad Generator automation' },
    run: (c) => {
      const active = c.feeds.filter((f) => f.isActive);
      if (active.length === 0) return fail('no active feed');
      const errored = active.filter((f) => f.lastSyncStatus === 'error');
      if (errored.length === active.length) return fail(`every feed last synced with an error`);
      const freshest = active.reduce<Date | null>(
        (best, f) => (f.lastSyncedAt && (!best || f.lastSyncedAt > best) ? f.lastSyncedAt : best),
        null,
      );
      const age = daysSince(freshest, c.now);
      if (age == null) return fail('feed configured but never synced');
      if (age > FEED_STALE_DAYS) return warn(`last synced ${ago(freshest, c.now)}`);
      const vehicles = active.reduce((n, f) => n + f.vehicleCount, 0);
      if (errored.length) return warn(`${errored.length} of ${active.length} feeds erroring`);
      return pass(`${vehicles.toLocaleString()} vehicles, synced ${ago(freshest, c.now)}`);
    },
  },
  {
    id: 'adgen.recent_run',
    label: 'Automation running',
    why: 'A job that quietly stops looks exactly like a quiet month. Only a heartbeat tells them apart.',
    severity: 'standard',
    run: (c) => {
      const age = daysSince(c.lastAutomationRunAt, c.now);
      if (age == null) return fail('no run on record');
      if (age > RUN_STALE_DAYS) return fail(`last run ${ago(c.lastAutomationRunAt, c.now)}`);
      return pass(`last run ${ago(c.lastAutomationRunAt, c.now)}`);
    },
  },
  // ── companion offer email ────────────────────────────────────────────────
  //
  // These are `na` unless the account has opted in. The email is off by
  // default, and reporting every automated rooftop as failing a feature nobody
  // switched on is exactly the "red everywhere" noise that makes an audit
  // ignorable.
  {
    id: 'adgen.email_enabled',
    label: 'Offer email on',
    why: 'The same OEM programme that produces ads can produce the email that announces it. Left off, the offers reach paid audiences only.',
    severity: 'advisory',
    fix: { surface: 'studio', path: '/ad-generator/automation', label: 'Ad Generator automation' },
    run: (c) =>
      c.automation.emailEnabled ? pass('enabled') : fail('offers generate ads but no email'),
  },
  {
    id: 'adgen.email_template',
    label: 'Offer email template valid',
    why: 'A shell template without an {{offers}} block renders an email with no offers in it — valid HTML that says nothing, and nobody notices until a client does.',
    severity: 'blocking',
    fix: { surface: 'studio', path: '/email/templates', label: 'Email templates' },
    run: (c) => {
      if (!c.automation.emailEnabled) return { status: 'na', detail: 'offer email is off' };
      if (!c.automation.emailTemplateSlug) {
        return pass('composed from the brand kit — no shell configured');
      }
      return c.automation.emailTemplateOk
        ? pass(`shell "${c.automation.emailTemplateSlug}" resolves`)
        : fail(c.automation.emailTemplateProblem ?? 'the configured template cannot be used');
    },
  },
  {
    id: 'adgen.email_audience',
    label: 'Offer email audience set',
    why: 'Without a segment the draft lands with no recipients, so it can never send and the run looks successful.',
    severity: 'standard',
    fix: { surface: 'studio', path: '/ad-generator/automation', label: 'Ad Generator automation' },
    run: (c) => {
      if (!c.automation.emailEnabled) return { status: 'na', detail: 'offer email is off' };
      if (!c.automation.emailAudienceId) return fail('no audience — drafts land untargeted');
      // A wrong-account audience is worse than none: the generator refuses it,
      // so the draft goes out untargeted while the setting reads as configured.
      return c.automation.emailAudienceOk
        ? pass('audience set')
        : fail('the audience is missing or belongs to another account');
    },
  },
  {
    id: 'adgen.email_recent',
    label: 'Offer email being produced',
    why: 'The email step fails independently of the ads, so a run can keep making creative for weeks while the email half is quietly broken.',
    severity: 'standard',
    run: (c) => {
      if (!c.automation.emailEnabled) return { status: 'na', detail: 'offer email is off' };
      const at = c.automation.lastOfferEmailAt;
      if (!at) return fail('never produced one');
      const age = daysSince(at, c.now);
      // A month, not the three days the ad run uses: an email is only drafted
      // when the offer SET changes, and an OEM programme routinely holds for a
      // full cycle. Flagging that as stale would report a working pipeline as
      // broken every time an OEM had a quiet month.
      if (age != null && age > OFFER_EMAIL_STALE_DAYS) return warn(`last one ${ago(at, c.now)}`);
      return pass(`last one ${ago(at, c.now)}`);
    },
  },
  {
    id: 'coop.template_approved',
    label: 'Co-op approval current',
    why: 'Unattended launching is defensible because a person got the TEMPLATE approved. Approval is scoped to the design, so a redesign silently voids it.',
    severity: 'blocking',
    fix: { surface: 'studio', path: '/ad-generator/templates', label: 'Ad templates' },
    run: (c) => {
      if (c.coop.length === 0) return fail('no mapped template to approve');
      const stale = c.coop.filter((t) => t.state === 'stale');
      const missing = c.coop.filter((t) => t.state === 'missing');
      if (missing.length) {
        return fail(
          `no live approval for ${missing.map((t) => t.templateName).join(', ')}`,
        );
      }
      if (stale.length) {
        return warn(
          `design changed since approval: ${stale.map((t) => t.templateName).join(', ')}`,
        );
      }
      return pass(c.coop.length === 1 ? 'approved' : `${c.coop.length} templates approved`);
    },
  },

  // ── lifecycle + messaging ──────────────────────────────────────────────────
  {
    id: 'audiences.lifecycle_seeded',
    label: 'Lifecycle audiences seeded',
    why: 'Service overdue, lease ending, warranty expiring — the six segments every automotive retention motion is built on.',
    severity: 'standard',
    fix: { surface: 'studio', path: '/contacts/segments', label: 'Segments' },
    run: (c) =>
      c.lifecyclePresetsSeededAt
        ? pass(`seeded ${ago(c.lifecyclePresetsSeededAt, c.now)}`)
        : fail('never seeded'),
  },
  {
    id: 'contacts.ingest_recent',
    label: 'Contacts syncing',
    why: 'Every lifecycle audience is only as current as the last ingest.',
    severity: 'standard',
    fix: { surface: 'studio', path: '/contacts', label: 'Contacts' },
    run: (c) => {
      const age = daysSince(c.lastIngestRunAt, c.now);
      if (age == null) return fail('no ingest on record');
      if (age > INGEST_STALE_DAYS) return fail(`last ingest ${ago(c.lastIngestRunAt, c.now)}`);
      return pass(`last ingest ${ago(c.lastIngestRunAt, c.now)}`);
    },
  },
  {
    id: 'email.sender_identity',
    label: 'Sending identity set',
    why: 'Without a verified from-address and domain, sends fall back to the agency default and authenticate against the wrong DNS.',
    severity: 'standard',
    fix: SUBACCOUNT_SETTINGS,
    run: (c) => {
      const hasFrom = set(c.email.senderEmail);
      const hasDomain = set(c.email.sendingDomain);
      if (hasFrom && hasDomain) return pass(c.email.senderEmail!);
      if (hasFrom) return warn('from-address set, no sending domain');
      return fail('falling back to the agency default');
    },
  },
  {
    id: 'sms.twilio',
    label: 'SMS configured',
    why: 'A messaging service handles 10DLC registration and sender failover; a bare phone number does not.',
    severity: 'advisory',
    fix: SUBACCOUNT_SETTINGS,
    run: (c) => {
      if (set(c.sms.messagingServiceSid)) return pass('messaging service');
      if (set(c.sms.phoneNumber)) return warn('single phone number, no messaging service');
      return fail('not configured');
    },
  },
];

export const CHECKS_BY_ID: ReadonlyMap<string, PlaybookCheck> = new Map(
  CHECKS.map((c) => [c.id, c]),
);

/** Severity order for display — worst first within a playbook. */
export const SEVERITY_RANK: Record<PlaybookCheck['severity'], number> = {
  blocking: 0,
  standard: 1,
  advisory: 2,
};

export type { AccountAuditContext };
