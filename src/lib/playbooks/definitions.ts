/**
 * Playbooks — Phase 0 definitions.
 *
 * Code constants, not database rows. Phase 0 has nothing to author and nothing
 * to version: a playbook here is just a named bundle of check ids plus the
 * predicate that decides whether it applies. Phase 1 moves these into the
 * `Playbook` table with a definition JSON and a version (docs/playbooks.md §5).
 *
 * An account is audited against EVERY playbook whose `appliesTo` it satisfies,
 * which is deliberately how the eventual model should work too — a Chevrolet
 * service rooftop holds several playbooks, it does not pick one.
 */

import type { AccountAuditContext, PlaybookDefinition } from './types';

/** Categories that get the automotive playbooks. Everything else is out of scope. */
const AUTOMOTIVE_CATEGORIES = new Set(['automotive', 'powersports']);

function isAutomotive(c: AccountAuditContext): boolean {
  return AUTOMOTIVE_CATEGORIES.has((c.category ?? '').trim().toLowerCase());
}

export const PLAYBOOKS: PlaybookDefinition[] = [
  {
    key: 'automotive-foundation',
    name: 'Foundation',
    description: 'The identity every other playbook reads from — make, brand kit, timezone, owner.',
    appliesTo: isAutomotive,
    checkIds: ['account.oem', 'account.branding', 'account.timezone', 'account.rep'],
  },
  {
    key: 'automotive-paid-social',
    name: 'Paid social',
    description: 'What Meta needs before a generated ad can actually be published.',
    // A rooftop counts as running Meta once it has an ad account OR a pacer plan.
    // Neither on its own is conclusive, but requiring both would hide exactly the
    // half-configured accounts this playbook exists to find.
    appliesTo: (c) => !!c.meta.adAccountId || c.pacer.hasPlan,
    checkIds: [
      'meta.ad_account',
      'meta.page_confirmed',
      'ads.launch_preset',
      'meta.pixel',
      'meta.timezone_synced',
    ],
  },
  {
    key: 'automotive-paid-search',
    name: 'Paid search',
    description: 'Google Ads linkage and conversion tracking.',
    appliesTo: (c) => !!c.google.customerId || c.pacer.googleBudgetGoal > 0,
    checkIds: ['google.customer_id', 'google.conversion_action'],
  },
  {
    key: 'automotive-pacing',
    name: 'Pacing & budget',
    description: 'Whether this month is actually being paced against a real number.',
    appliesTo: (c) => c.pacer.hasPlan || !!c.meta.adAccountId || !!c.google.customerId,
    checkIds: ['pacer.plan', 'pacer.period_budget', 'pacer.markup', 'budget.managed'],
  },
  {
    key: 'automotive-ad-automation',
    name: 'Ad automation',
    description: 'The unattended OEM-offer pipeline: config, feed, heartbeat, co-op approval.',
    // Only rooftops that have been onboarded onto automation. Auditing a store
    // that was never meant to run it would report a fleet-wide failure that is
    // really "we haven't turned this on yet".
    appliesTo: (c) => c.automation.exists,
    checkIds: [
      'adgen.template_map',
      'coop.template_approved',
      'adgen.email_template',
      'adgen.config_enabled',
      'adgen.notify',
      'adgen.inventory_feed',
      'adgen.recent_run',
      'adgen.email_audience',
      'adgen.email_recent',
      'adgen.email_enabled',
    ],
  },
  {
    key: 'automotive-lifecycle',
    name: 'Lifecycle & messaging',
    description: 'Retention segments, contact freshness, and the identity sends go out under.',
    appliesTo: isAutomotive,
    checkIds: [
      'audiences.lifecycle_seeded',
      'contacts.ingest_recent',
      'email.sender_identity',
      'sms.twilio',
    ],
  },
];

/** Which playbook a check belongs to, for the by-check rollup. */
export const PLAYBOOK_KEY_BY_CHECK: ReadonlyMap<string, string> = new Map(
  PLAYBOOKS.flatMap((p) => p.checkIds.map((id) => [id, p.key] as const)),
);
