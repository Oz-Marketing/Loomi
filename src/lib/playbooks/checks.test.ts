import { describe, expect, it } from 'vitest';
import { CHECKS, CHECKS_BY_ID } from './checks';
import { PLAYBOOKS } from './definitions';
import { auditAccount, buildAuditPayload, coveragePct } from './audit';
import type { AccountAuditContext } from './types';

/**
 * A fully-configured automotive rooftop — every check green. Individual tests
 * break exactly one thing, so a failure names the check that regressed rather
 * than "the fixture drifted".
 */
const NOW = new Date('2026-08-12T17:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function ctx(overrides: Partial<AccountAuditContext> = {}): AccountAuditContext {
  return {
    accountKey: 'youngChevy',
    dealer: 'Young Chevrolet',
    slug: 'young-chevrolet',
    category: 'Automotive',
    makes: ['Chevrolet'],
    timezone: 'America/Denver',
    accountRepId: 'user_1',
    markup: 0.77,
    lifecyclePresetsSeededAt: daysAgo(90),
    branding: { logoLight: 'logo.png', primaryColor: '#0d5eaf', inherited: false },
    meta: {
      adAccountId: 'act_123',
      pageId: '456',
      assetsConfirmedAt: daysAgo(30),
      pixelId: '789',
      defaultConversionEvent: 'Lead',
      timezone: 'America/Denver',
    },
    google: { customerId: '1234567890', conversionAction: 'customers/1/conversionActions/2' },
    email: { senderEmail: 'ads@youngchevy.com', sendingDomain: 'youngchevy.com' },
    sms: { messagingServiceSid: 'MG123', phoneNumber: null },
    launchPresets: [{ platform: 'meta', launchMode: 'attach_existing', targetAdSetId: '999' }],
    pacer: {
      hasPlan: true,
      period: '2026-08',
      metaBudgetGoal: 12_000,
      googleBudgetGoal: 8_000,
      managedByBudget: true,
      googleManagedByBudget: true,
    },
    automation: {
      exists: true,
      enabled: true,
      templateIds: ['tpl_1'],
      notifyUserCount: 2,
      emailEnabled: true,
      emailTemplateSlug: 'youngchevy-offers',
      emailTemplateOk: true,
      emailTemplateProblem: null,
      emailAudienceId: 'aud_1',
      emailAudienceOk: true,
      lastOfferEmailAt: daysAgo(5),
    },
    feeds: [
      { name: 'VLA', isActive: true, lastSyncedAt: daysAgo(1), lastSyncStatus: 'ok', vehicleCount: 320 },
    ],
    coop: [{ templateId: 'tpl_1', templateName: 'Offer Headline', state: 'approved' }],
    lastAutomationRunAt: daysAgo(1),
    lastIngestRunAt: daysAgo(2),
    now: NOW,
    ...overrides,
  };
}

const run = (id: string, c: AccountAuditContext) => CHECKS_BY_ID.get(id)!.run(c);

describe('registry integrity', () => {
  it('has no duplicate check ids', () => {
    expect(new Set(CHECKS.map((c) => c.id)).size).toBe(CHECKS.length);
  });

  it('every id a playbook names actually exists', () => {
    for (const playbook of PLAYBOOKS) {
      for (const id of playbook.checkIds) {
        expect(CHECKS_BY_ID.has(id), `${playbook.key} names unknown check ${id}`).toBe(true);
      }
    }
  });

  it('every check belongs to at least one playbook', () => {
    const claimed = new Set(PLAYBOOKS.flatMap((p) => p.checkIds));
    for (const check of CHECKS) {
      expect(claimed.has(check.id), `${check.id} is in no playbook`).toBe(true);
    }
  });
});

describe('the fully-configured baseline', () => {
  it('passes every check that applies to it', () => {
    const result = auditAccount(ctx());
    const notPassing = result.playbooks
      .flatMap((p) => p.checks)
      .filter((c) => c.status !== 'pass' && c.status !== 'na');
    expect(notPassing.map((c) => `${c.id}: ${c.detail}`)).toEqual([]);
    expect(result.coveragePct).toBe(100);
    expect(result.blockingFails).toBe(0);
  });
});

describe('publishing readiness', () => {
  it('fails when no Page is set — launches are blocked outright', () => {
    const out = run('meta.page_confirmed', ctx({ meta: { ...ctx().meta, pageId: null } }));
    expect(out.status).toBe('fail');
  });

  it('warns when a Page is set but nobody confirmed it', () => {
    // The id being present is not the same fact as a person having verified it,
    // and an unattributed id is what makes a cross-brand publish invisible.
    const out = run('meta.page_confirmed', ctx({ meta: { ...ctx().meta, assetsConfirmedAt: null } }));
    expect(out.status).toBe('warn');
  });

  it('fails a preset set to attach to an ad set it never names', () => {
    const out = run(
      'ads.launch_preset',
      ctx({ launchPresets: [{ platform: 'meta', launchMode: 'attach_existing', targetAdSetId: null }] }),
    );
    expect(out.status).toBe('fail');
  });

  it('ignores a Google-only preset when judging Meta readiness', () => {
    const out = run(
      'ads.launch_preset',
      ctx({ launchPresets: [{ platform: 'google', launchMode: 'create_new', targetAdSetId: null }] }),
    );
    expect(out.status).toBe('fail');
  });
});

describe('co-op approval', () => {
  it('warns rather than fails when the design moved after approval', () => {
    // The approval was real; it just no longer covers this design. That is a
    // different fact from never having been approved, and it reads differently
    // to whoever has to fix it.
    const out = run(
      'coop.template_approved',
      ctx({ coop: [{ templateId: 'tpl_1', templateName: 'Offer Headline', state: 'stale' }] }),
    );
    expect(out.status).toBe('warn');
    expect(out.detail).toContain('Offer Headline');
  });

  it('fails when a mapped template has no live approval', () => {
    const out = run(
      'coop.template_approved',
      ctx({ coop: [{ templateId: 'tpl_1', templateName: 'Offer Headline', state: 'missing' }] }),
    );
    expect(out.status).toBe('fail');
  });

  it('fails when there is no mapped template to approve at all', () => {
    expect(run('coop.template_approved', ctx({ coop: [] })).status).toBe('fail');
  });
});

describe('freshness', () => {
  it('warns on a feed that has gone stale but still fails one never synced', () => {
    const stale = ctx({
      feeds: [{ name: 'VLA', isActive: true, lastSyncedAt: daysAgo(9), lastSyncStatus: 'ok', vehicleCount: 10 }],
    });
    expect(run('adgen.inventory_feed', stale).status).toBe('warn');

    const never = ctx({
      feeds: [{ name: 'VLA', isActive: true, lastSyncedAt: null, lastSyncStatus: null, vehicleCount: 0 }],
    });
    expect(run('adgen.inventory_feed', never).status).toBe('fail');
  });

  it('fails a dead automation heartbeat', () => {
    expect(run('adgen.recent_run', ctx({ lastAutomationRunAt: daysAgo(21) })).status).toBe('fail');
    expect(run('adgen.recent_run', ctx({ lastAutomationRunAt: null })).status).toBe('fail');
  });

  it('reports ingest age in the detail so a stale sync is legible', () => {
    const out = run('contacts.ingest_recent', ctx({ lastIngestRunAt: daysAgo(30) }));
    expect(out.status).toBe('fail');
    expect(out.detail).toContain('30 days ago');
  });
});

describe('inherited brand kits', () => {
  it('passes an inherited kit but says so', () => {
    const out = run(
      'account.branding',
      ctx({ branding: { logoLight: 'group.png', primaryColor: '#000', inherited: true } }),
    );
    expect(out.status).toBe('pass');
    expect(out.detail).toContain('inherited');
  });

  it('fails and names what is actually missing', () => {
    const out = run(
      'account.branding',
      ctx({ branding: { logoLight: null, primaryColor: '#000', inherited: false } }),
    );
    expect(out.status).toBe('fail');
    expect(out.detail).toContain('light logo');
  });
});

describe('companion offer email', () => {
  const offEmail = (over: Partial<AccountAuditContext['automation']> = {}) =>
    ctx({ automation: { ...ctx().automation, emailEnabled: false, ...over } });

  it('passes the whole set on a configured rooftop', () => {
    const c = ctx();
    for (const id of ['adgen.email_enabled', 'adgen.email_template', 'adgen.email_audience', 'adgen.email_recent']) {
      expect(run(id, c).status, id).toBe('pass');
    }
  });

  it('reports the email as off without failing the rest of the setup', () => {
    // Off is the default, so this must be a fail on ONE advisory check and n/a
    // on the others — not four reds on every automated rooftop.
    const c = offEmail();
    expect(run('adgen.email_enabled', c).status).toBe('fail');
    expect(run('adgen.email_template', c).status).toBe('na');
    expect(run('adgen.email_audience', c).status).toBe('na');
    expect(run('adgen.email_recent', c).status).toBe('na');
  });

  it('treats no shell template as valid — the email composes from the brand kit', () => {
    expect(
      run('adgen.email_template', ctx({ automation: { ...ctx().automation, emailTemplateSlug: null } }))
        .status,
    ).toBe('pass');
  });

  it('blocks on a shell template that cannot be used', () => {
    const c = ctx({
      automation: {
        ...ctx().automation,
        emailTemplateOk: false,
        emailTemplateProblem: 'the template has no {{offers}} block',
      },
    });
    const out = run('adgen.email_template', c);
    expect(out.status).toBe('fail');
    expect(out.detail).toContain('{{offers}}');
  });

  it('fails an audience belonging to another account', () => {
    // Worse than none: the generator refuses it, so the draft goes out
    // untargeted while the setting still reads as configured.
    const c = ctx({ automation: { ...ctx().automation, emailAudienceOk: false } });
    expect(run('adgen.email_audience', c).status).toBe('fail');
  });

  it('fails when no audience is set at all', () => {
    const c = ctx({ automation: { ...ctx().automation, emailAudienceId: null, emailAudienceOk: false } });
    expect(run('adgen.email_audience', c).detail).toContain('untargeted');
  });

  it('does not call a quiet OEM month a stale pipeline', () => {
    // An email is only drafted when the offer SET changes, so a month-old draft
    // is normal. The ad run's 3-day staleness rule would misreport this.
    const c = ctx({ automation: { ...ctx().automation, lastOfferEmailAt: daysAgo(20) } });
    expect(run('adgen.email_recent', c).status).toBe('pass');
  });

  it('warns once the last draft is older than a full cycle', () => {
    const c = ctx({ automation: { ...ctx().automation, lastOfferEmailAt: daysAgo(60) } });
    expect(run('adgen.email_recent', c).status).toBe('warn');
  });

  it('fails when the email is on but has never produced a draft', () => {
    const c = ctx({ automation: { ...ctx().automation, lastOfferEmailAt: null } });
    expect(run('adgen.email_recent', c).status).toBe('fail');
  });
});

describe('applicability', () => {
  it('marks Google checks n/a for a rooftop that runs no Google', () => {
    const result = auditAccount(
      ctx({
        google: { customerId: null, conversionAction: null },
        pacer: { ...ctx().pacer, googleBudgetGoal: 0 },
      }),
    );
    const search = result.playbooks.find((p) => p.key === 'automotive-paid-search')!;
    expect(search.applies).toBe(false);
    expect(search.checks.every((c) => c.status === 'na')).toBe(true);
  });

  it('does not let n/a checks move coverage in either direction', () => {
    // Coverage is about what was asked of this rooftop. A playbook that doesn't
    // apply is not a pass and not a failure — it's not a question.
    const withGoogle = auditAccount(ctx()).coveragePct;
    const withoutGoogle = auditAccount(
      ctx({
        google: { customerId: null, conversionAction: null },
        pacer: { ...ctx().pacer, googleBudgetGoal: 0 },
      }),
    ).coveragePct;
    expect(withGoogle).toBe(100);
    expect(withoutGoogle).toBe(100);
  });

  it('skips the automation playbook for a rooftop never onboarded onto it', () => {
    const result = auditAccount(
      ctx({
        automation: {
          ...ctx().automation,
          exists: false,
          enabled: false,
          templateIds: [],
          notifyUserCount: 0,
        },
      }),
    );
    const automation = result.playbooks.find((p) => p.key === 'automotive-ad-automation')!;
    expect(automation.applies).toBe(false);
    expect(result.blockingFails).toBe(0);
  });

  it('skips every automotive playbook for a non-automotive account', () => {
    const result = auditAccount(ctx({ category: 'Healthcare' }));
    const foundation = result.playbooks.find((p) => p.key === 'automotive-foundation')!;
    expect(foundation.applies).toBe(false);
  });
});

describe('scoring', () => {
  it('excludes n/a from both halves of the ratio', () => {
    expect(coveragePct({ pass: 3, warn: 0, fail: 1 })).toBe(75);
    expect(coveragePct({ pass: 0, warn: 0, fail: 0 })).toBeNull();
  });

  it('counts only BLOCKING failures toward the triage number', () => {
    // An advisory red is real, but it is not what stops an ad going out.
    const advisoryOnly = auditAccount(ctx({ accountRepId: null }));
    expect(advisoryOnly.blockingFails).toBe(0);

    const blocking = auditAccount(ctx({ meta: { ...ctx().meta, pageId: null } }));
    expect(blocking.blockingFails).toBe(1);
  });

  it('sorts a blocking failure above an advisory pass within a playbook', () => {
    const result = auditAccount(ctx({ meta: { ...ctx().meta, pageId: null } }));
    const social = result.playbooks.find((p) => p.key === 'automotive-paid-social')!;
    expect(social.checks[0]!.id).toBe('meta.page_confirmed');
  });
});

describe('the payload', () => {
  it('ranks the worst rooftops first', () => {
    const healthy = ctx({ accountKey: 'healthy', dealer: 'Healthy Motors' });
    const broken = ctx({
      accountKey: 'broken',
      dealer: 'Broken Motors',
      meta: { ...ctx().meta, adAccountId: null, pageId: null },
    });
    const payload = buildAuditPayload([healthy, broken], { period: '2026-08', generatedAt: NOW });
    expect(payload.accounts.map((a) => a.accountKey)).toEqual(['broken', 'healthy']);
  });

  it('rolls up per check, listing the accounts that need work', () => {
    const healthy = ctx({ accountKey: 'healthy', dealer: 'Healthy Motors' });
    const broken = ctx({
      accountKey: 'broken',
      dealer: 'Broken Motors',
      meta: { ...ctx().meta, pageId: null },
    });
    const payload = buildAuditPayload([healthy, broken], { period: '2026-08', generatedAt: NOW });
    const row = payload.byCheck.find((r) => r.id === 'meta.page_confirmed')!;
    expect(row.pass).toBe(1);
    expect(row.fail).toBe(1);
    expect(row.failingAccounts).toEqual([
      { accountKey: 'broken', dealer: 'Broken Motors', detail: expect.any(String) },
    ]);
  });
});
