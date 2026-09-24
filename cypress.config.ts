import { mkdirSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'cypress';

/**
 * End-to-end suite (`e2e`) and component suite (`component`).
 * Runbooks: docs/e2e-testing.md, docs/component-testing.md.
 *
 * `baseUrl` is env-driven on purpose. Many worktrees live under
 * `.claude/worktrees/` and all point `npm run dev` at port 3000, so whoever
 * started first owns it — localhost:3000 routinely serves a DIFFERENT branch
 * than the one you are editing (see CLAUDE.md). Name your own server rather
 * than trusting the default:
 *
 *   CYPRESS_BASE_URL=http://localhost:3010 npm run e2e
 *
 * Only the studio base host is exercised here. `app.localhost` and
 * `marketing.localhost` are separate origins as far as the browser is
 * concerned, and a dev session cookie does not cross them (src/lib/auth.ts
 * explains why `localhost` can't be widened) — testing those surfaces signed
 * in needs a registrable wildcard parent domain, not a second `cy.visit`.
 */
const baseUrl = process.env.CYPRESS_BASE_URL ?? 'http://localhost:3000';

/**
 * Where a component run leaves its summary. `.github/workflows/tests.yml`
 * reads it to say WHICH tests failed in the Slack alert, rather than just
 * that something did.
 */
const COMPONENT_SUMMARY = 'cypress/results/component-summary.json';

export default defineConfig({
  /**
   * The Cypress Cloud project this run reports to.
   *
   * This is an identifier, NOT a credential — Cypress's own convention is to
   * commit it, and `--record` refuses to run without it. The RECORD KEY is the
   * secret half, and it only ever arrives as CYPRESS_RECORD_KEY (a GitHub
   * Actions secret, or your own shell); it must never appear in this repo.
   *
   * Cypress honors a `CYPRESS_PROJECT_ID` env var as an override, so pointing
   * a run at a different Cloud project needs no edit here.
   */
  projectId: 'fp9rva',

  e2e: {
    baseUrl,
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    fixturesFolder: 'cypress/fixtures',
    screenshotsFolder: 'cypress/screenshots',
    videosFolder: 'cypress/videos',

    // `next dev` compiles each route on the first request, and on a cold
    // `.next` Loomi's heavier pages run well past Cypress's defaults — a
    // result decided by compile time is noise, not signal. CI tests the
    // production bundle (`next start`), where none of this applies, so these
    // ceilings only ever get spent locally.
    pageLoadTimeout: 180_000,
    // cy.visit's underlying request: a cold compile can exceed the 30s
    // default and surface as ESOCKETTIMEDOUT rather than a real failure.
    responseTimeout: 120_000,
    defaultCommandTimeout: 30_000,
    requestTimeout: 30_000,

    // Retries in `cypress run` only. Interactive runs stay honest, so a flake
    // is visible while you are sitting in front of it.
    retries: { runMode: 2, openMode: 0 },

    // Cypress Cloud replays failures from these, so CI records. Locally it is
    // pure overhead — the ffmpeg encode pegs a core per spec, and you already
    // have the browser in front of you.
    video: Boolean(process.env.CI),
    viewportWidth: 1440,
    viewportHeight: 900,

    env: {
      // The dev seed identity (prisma/seed.ts), same pair CLAUDE.md documents.
      // Override anywhere real with CYPRESS_LOGIN_EMAIL / CYPRESS_LOGIN_PASSWORD.
      LOGIN_EMAIL: 'connor@ozmktg.com',
      LOGIN_PASSWORD: 'admin123',

      // A CLIENT-tier identity, for the reporting leak spec. Also from the
      // seed, which sets this password on every run — including on existing
      // rows, so a re-seed always restores it.
      //
      // A long-lived dev database can still have drifted from the seed (mine
      // had this user on the staff password). If sign-in fails locally, either
      // re-seed or override: CYPRESS_CLIENT_PASSWORD=... npm run e2e
      CLIENT_EMAIL: 'alex.client@ozmktg.com',
      CLIENT_PASSWORD: 'client123',
    },
  },

  /**
   * Component suite: mounts one React component at a time in real Chrome —
   * no server, no database, no sign-in.
   *
   * `framework: 'next'` makes Cypress build specs with Next's own webpack
   * config, so the `@/` alias, `'use client'` modules and the Tailwind PostCSS
   * pipeline behave exactly as they do in the app.
   *
   * Specs live under cypress/component/, NOT beside the component. The root
   * tsconfig includes every `*.tsx` outside cypress/, so a co-located spec
   * would be typechecked by `npm run verify` without mocha/chai globals and
   * fail the deploy gate. `npm run verify:e2e` typechecks them here instead.
   */
  component: {
    devServer: { framework: 'next', bundler: 'webpack' },
    specPattern: 'cypress/component/**/*.cy.tsx',
    supportFile: 'cypress/support/component.tsx',
    indexHtmlFile: 'cypress/support/component-index.html',
    screenshotsFolder: 'cypress/screenshots',
    videosFolder: 'cypress/videos',
    // No compile-time ceilings needed here: the bundle is one component, not
    // a Next route, and it is built once before the first spec runs.
    retries: { runMode: 2, openMode: 0 },
    video: false,
    viewportWidth: 800,
    viewportHeight: 600,
    setupNodeEvents(on) {
      // `after:run` fires once per `cypress run` (never in `cypress open`).
      on('after:run', (results) => {
        // A run Cypress couldn't start has no per-test results. With no file,
        // the workflow falls back to "failed before any test ran".
        if (!results || !('runs' in results)) return;
        const tests = results.runs.flatMap((run) =>
          run.tests.map((test) => {
            // Specs name their suite after the component (`<Collapse>`);
            // the brackets are code, not prose, so Slack shows `Collapse`.
            const parts = test.title.map((t) => t.replace(/^<(.+)>$/, '$1'));
            return {
              state: test.state,
              attempts: test.attempts.length,
              spec: run.spec.relative.replace(/^cypress\/component\//, ''),
              suite: parts.slice(0, -1).join(' › '),
              test: parts[parts.length - 1] ?? '',
            };
          }),
        );
        const brief = ({ spec, suite, test }: (typeof tests)[number]) => ({ spec, suite, test });
        // Failed on every attempt: a real failure.
        const failures = tests.filter((t) => t.state === 'failed').map(brief);
        // Failed at least once, then passed on a retry. Green today, but the
        // test is unreliable, and the Slack alert flags it before it goes red.
        const flaky = tests
          .filter((t) => t.state === 'passed' && t.attempts > 1)
          .map((t) => ({ ...brief(t), attempts: t.attempts }));
        mkdirSync('cypress/results', { recursive: true });
        writeFileSync(
          COMPONENT_SUMMARY,
          JSON.stringify(
            {
              totalTests: results.totalTests,
              totalPassed: results.totalPassed,
              totalFailed: results.totalFailed,
              failures,
              flaky,
            },
            null,
            2,
          ),
        );
      });
    },
  },
});
