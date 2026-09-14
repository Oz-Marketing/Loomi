import { defineConfig } from 'cypress';

/**
 * End-to-end suite. Runbook: docs/e2e-testing.md.
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
});
