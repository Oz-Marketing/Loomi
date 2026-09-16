/**
 * Reporting is client-facing, and margin must not cross into it.
 *
 * `requireReportingAccess` admits the client tier, so anything a
 * `/api/reporting/*` route returns reaches a dealer. The hub's own data carries
 * Oz's cost and margin; Reporting is supposed to be a projection with all of it
 * removed (src/lib/reporting/budget-view.ts, and CLAUDE.md's "Reporting is
 * client-facing").
 *
 * `budget-view.test.ts` already guards that projection — given a synthetic
 * summary stuffed with margin sentinels, nothing survives, by key AND by value.
 * That is the stronger test of the FUNCTION, and this file does not duplicate
 * it. What it cannot prove is the thing that would actually happen in a leak:
 * a real client session, against real routes, receiving a real response that
 * carries a field nobody projected away. That is what this file is for.
 *
 * ── Why the ban list is narrow ─────────────────────────────────────────────
 *
 * The unit test bans the substrings `cost` and `revenue` outright. That is
 * correct THERE, where the input is synthetic and the output is one budget DTO.
 * It is wrong here, and sweeping every report with it would fail on day one:
 *
 *   direct-mail   → cost, costPerRo, revenue, revenuePerPiece, revenuePerRo
 *   sales-trend   → newRevenue, usedRevenue, leaseRevenue, totalRevenue
 *   acquisition   → revenue
 *
 * Those are the DEALER'S own figures — what they spent on a mail drop, what
 * their service lane earned. Showing them is the entire point of the report.
 * They are categorically different from Oz's cost of buying media and the
 * markup on it, which is what must never appear.
 *
 * So the sweep below carries only markers with no legitimate dealer-facing
 * meaning. Every one was checked against the live responses of twelve client
 * reports and hit nothing. **Do not add `cost` or `revenue` here** — it will
 * cry wolf, and a suite that cries wolf gets switched off.
 *
 * The margin-bearing report is Budget, and the boundary that protects it is
 * that a client cannot open it at all. That is asserted directly.
 */

/**
 * Key fragments that may never appear in anything a client receives.
 *
 * `spendTarget` is the subtle one and the reason this file exists: it is
 * `amount × markupSnapshot`, so beside `amount` it lets anyone divide one by
 * the other and read the markup straight off. It is a margin figure wearing an
 * innocent name.
 */
const MARGIN_MARKERS = [
  'spendtarget',
  'markup',
  'margin',
  'costknown',
  'bylinetype',
  'knownrevenue',
  'uncostedamount',
] as const;

/** Reports whose data is Oz's commercials, not the dealer's. */
const STAFF_ONLY_REPORTS = ['budget', 'executive'] as const;

/** Every key appearing anywhere in a nested structure. Mirrors budget-view.test.ts. */
function allKeys(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, acc);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      acc.push(k);
      allKeys(v, acc);
    }
  }
  return acc;
}

function offendingKeys(body: unknown): string[] {
  return allKeys(body).filter((k) => MARGIN_MARKERS.some((m) => k.toLowerCase().includes(m)));
}

describe('Reporting never shows a client Oz margin', () => {
  let email = '';
  let password = '';
  let accountKey = '';

  before(() => {
    cy.env<{ CLIENT_EMAIL: string; CLIENT_PASSWORD: string }>([
      'CLIENT_EMAIL',
      'CLIENT_PASSWORD',
    ]).then((vars) => {
      email = vars.CLIENT_EMAIL;
      password = vars.CLIENT_PASSWORD;
    });
  });

  beforeEach(() => {
    cy.login(email, password);
  });

  it('is actually signed in as the client tier', () => {
    // Without this the whole file is theater. If the seed drifted, or
    // cy.login() quietly fell back to the staff identity, every assertion
    // below would pass while proving nothing about what a dealer can see.
    cy.request('/api/auth/session').then((res) => {
      expect(res.body.user.role, 'role under test').to.eq('client');
      expect(res.body.user.accountKeys, 'client is scoped to one account').to.have.length(1);
      accountKey = res.body.user.accountKeys[0];
    });
  });

  it('does not offer a client the reports built from Oz commercials', () => {
    cy.request(`/api/reporting/my-reports?accountKey=${accountKey}`)
      .its('body.reports')
      .then((reports: string[]) => {
        for (const staffOnly of STAFF_ONLY_REPORTS) {
          expect(reports, `${staffOnly} must not be offered to a client`).not.to.include(staffOnly);
        }
      });
  });

  it('refuses a client the budget route itself, not just the link to it', () => {
    // The nav hiding a report is presentation. This is the boundary: a client
    // who types the URL, or whose token is replayed, still gets nothing.
    cy.request({
      url: `/api/reporting/budget?accountKey=${accountKey}&year=${new Date().getFullYear()}`,
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.status, 'budget must not answer a client with data').to.be.oneOf([401, 403, 404]);
      expect(offendingKeys(res.body), 'even the refusal must not carry margin').to.deep.eq([]);
    });
  });

  it('leaks no margin marker through any report the client can open', () => {
    const urls = new Set<string>();

    // Record which reporting endpoints the app calls, and with which params —
    // then read them back below. Deliberately NOT `req.continue(res => ...)`:
    // supplying a response callback makes Cypress buffer the upstream body,
    // and a request the browser cancels mid-navigation (routine when you visit
    // pages in a loop) then fails the test with a CDP error that looks nothing
    // like a leak. Capturing the URL costs nothing and cannot be canceled.
    cy.intercept({ url: '**/api/reporting/**' }, (req) => {
      urls.add(req.url);
    });

    cy.visit('/reporting');
    cy.get('h1, h2', { timeout: 90_000 }).should('exist');

    // Walk the sidebar the app renders FOR THIS CLIENT — the doors a dealer is
    // actually shown, so a report added later is covered the day it ships.
    // Settings is staff configuration, not a report.
    cy.get('a[href^="/reporting/"]')
      .then(($links) => {
        const paths = Array.from(
          new Set(
            $links
              .toArray()
              .map((a) => a.getAttribute('href') ?? '')
              .filter((href) => href.startsWith('/reporting/') && !href.includes('/settings'))
          )
        );
        expect(paths.length, 'client should be shown some reports').to.be.greaterThan(3);
        return cy.wrap(paths, { log: false });
      })
      .each((path: string) => {
        cy.visit(path);
        cy.get('h1, h2', { timeout: 90_000 }).should('exist');
      });

    cy.then(() => {
      // A sweep that observed nothing would pass silently. This is what makes
      // the result mean something.
      expect(urls.size, 'reporting endpoints actually exercised').to.be.greaterThan(3);
    });

    // Re-request each endpoint the app asked for, as the client, and inspect
    // what comes back. The params are the app's own, and the session cookie is
    // the dealer's — so this is what that dealer can read.
    cy.then(() => cy.wrap(Array.from(urls), { log: false })).each((url: string) => {
      cy.request({ url, failOnStatusCode: false }).then((res) => {
        expect(offendingKeys(res.body), `margin markers returned by ${url}`).to.deep.eq([]);
      });
    });
  });
});
