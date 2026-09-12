# End-to-end testing

Cypress drives a real browser against a running Loomi. It is the layer above
`npm run test` (vitest, pure units with no browser and no database) and it
answers a different question: *does the app still come up and let a person in?*

Types are not evidence the app works — [`CLAUDE.md`](../CLAUDE.md) makes that
point about `npm run verify`, and this suite is the part that actually checks.

---

## Running it

The suite needs a server already running. It does not start one.

```bash
npm run dev                                   # terminal 1
CYPRESS_BASE_URL=http://localhost:3000 npm run e2e   # terminal 2
```

`npm run e2e:open` opens the interactive runner instead — use it while writing
a spec, since `cypress run` retries failures twice and hides the flake you are
trying to look at.

**Always pass `CYPRESS_BASE_URL`.** Many worktrees live under
`.claude/worktrees/` and all point `npm run dev` at port 3000, so whoever
started first owns it — `localhost:3000` routinely serves a *different branch
than the one you are editing*. Confirm whose server you are testing:

```bash
lsof -a -p $(pgrep -f "next-server" | head -1) -d cwd -Fn
```

### Scripts

| Script | What it does |
|---|---|
| `npm run e2e` | Run the suite headlessly against `CYPRESS_BASE_URL`. |
| `npm run e2e:open` | Interactive runner, no retries. |
| `npm run e2e:record` | As `e2e`, uploading results to Cypress Cloud. |
| `npm run e2e:dev` | Starts `next dev`, waits for it, runs the suite, stops it. |
| `npm run verify:e2e` | Typechecks the Cypress program (see below). |

---

## Signing in

`cy.login()` posts to NextAuth's credentials endpoint rather than typing into
the form, and caches the session with `cy.session()` — so the handshake runs
once per run, not once per test.

```ts
beforeEach(() => {
  cy.login();               // the seed identity
  cy.login('someone@else'); // or an explicit one
});
```

It defaults to `connor@ozmktg.com` / `admin123`, the pair `prisma/seed.ts`
writes. Override per environment with `CYPRESS_LOGIN_EMAIL` and
`CYPRESS_LOGIN_PASSWORD`.

`auth.cy.ts` is the only spec that types into the login form. Everything else
uses the command — a spec about contacts should not spend its budget
re-testing sign-in.

---

## What the suite covers

- **`auth.cy.ts`** — the gate. Signed-out redirect, a 401 (not an HTML login
  page) for an unauthenticated API call, a rejected password, a successful
  form sign-in, and the role-branching `/` redirect.
- **`surfaces.cy.ts`** — a signed-in smoke pass over the main surfaces.

`surfaces.cy.ts` is deliberately shallow. It does not assert what any page
*contains*, because that copy changes weekly and a smoke suite that fails on a
reworded heading teaches people to ignore it. It asserts the ways a page dies
unnoticed: a non-2xx response, the error boundary, the 404 page, and a bounce
to `/login`.

---

## Cypress Cloud

Recording needs **two** values, and they are not the same kind of thing:

| Value | Secret? | Where it goes |
|---|---|---|
| `projectId` | No | `CYPRESS_PROJECT_ID`, set in CI as a repo **variable** |
| record key | **Yes** | `CYPRESS_RECORD_KEY`, a GitHub **secret** / your shell |

`--record` without a `projectId` fails before it reaches the network — the key
alone is not enough. Find the id in Cypress Cloud → Project Settings.

**The record key never goes in this repo.** It is a write credential for the
org's Cypress Cloud; anyone holding it can post runs. Rotate it in Project
Settings if it is ever pasted somewhere it shouldn't be.

```bash
export CYPRESS_PROJECT_ID=<from Cypress Cloud>
export CYPRESS_RECORD_KEY=<from Cypress Cloud>
CYPRESS_BASE_URL=http://localhost:3000 npm run e2e:record
```

---

## CI

[`.github/workflows/e2e.yml`](../.github/workflows/e2e.yml) runs on every pull
request: a throwaway Postgres, `prisma db push`, `npm run db:seed`,
`build:assets`, `next start`, then the suite against the production bundle.

It is **not a deploy gate.** Branch protection requires a check named exactly
`verify` (`typecheck.yml`) and nothing else, and the deploy workflows declare
`needs: [build, verify]`. A browser suite is too young to be handed the power
to stop a production deploy. Promote it by adding it to that `needs:` list once
it has a track record.

Recording is conditional on the secret existing (`record: ${{ secrets.CYPRESS_RECORD_KEY != '' }}`),
so the suite still runs and still reports before the secret is added.

---

## Traps

- **Cypress 16 removed the synchronous `Cypress.env()`.** Env vars now arrive
  through the `cy.env(['A', 'B'])` chainable, so they cannot be read at module
  scope or in a default parameter — resolve them in a hook or inside the
  command. Most Cypress answers you will find online predate this.
- **Cypress is outside the root tsconfig program.** Its globals are mocha and
  chai, which have no business in the Next.js/vitest program that
  `npm run verify` — the deploy gate — typechecks. `tsconfig.json` excludes
  `cypress/` and `cypress.config.ts`; `npm run verify:e2e` checks them against
  [`cypress/tsconfig.json`](../cypress/tsconfig.json), and the e2e workflow
  runs it. **A type error in a spec will not show up in `npm run verify`.**
- **Every other workflow sets `CYPRESS_INSTALL_BINARY=0`.** Cypress is a
  devDep, and the droplet's `npm ci` installs devDeps (the worker needs `tsx`),
  so without it each deploy would pull a ~200MB browser binary onto a
  2GB/1vCPU box that can never run it. Only `e2e.yml` wants the binary.
- **`/messaging` and `/email` are directories with no index page.** Their
  landing routes are `/messaging/campaigns` and `/email/templates`; the bare
  parent 404s. `cy.visit` fails on non-2xx, so this shows up as a confusing
  visit error rather than an assertion failure.
- **Only the studio base host is exercised.** `app.localhost` and
  `marketing.localhost` are separate origins to the browser, and a dev session
  cookie does not cross them — [`src/lib/auth.ts`](../src/lib/auth.ts) explains
  why `localhost` cannot be widened. Testing those surfaces signed in needs a
  registrable wildcard parent domain, not a second `cy.visit`.
- **A stale `.next` makes every `/api/auth/*` route 404, and the whole suite
  hangs.** `/login` still answers 200, so the app looks fine — but `cy.login()`
  gets a 404 from `/api/auth/csrf` and each test burns its retries. If sign-in
  suddenly fails everywhere, `rm -rf .next` and restart before reading any
  test code.
- **The suite runs in Chrome, not Electron.** Electron is deprecated as a test
  browser in Cypress 16, and under load it drops its debugger connection
  ("Timed out waiting for the browser to connect"). The `e2e` scripts and the
  workflow both pass `--browser chrome`.
- **Timeouts here are sized for `next dev`, not for the app being slow.** A
  first hit on a heavy route compiles it, which can take a minute on a cold
  `.next` — so the surface assertions carry a long budget. CI exercises the
  production bundle through `next start`, where there is no compile step and
  these ceilings are never approached. Do not read a local cold-start timeout
  as a performance regression; warm the route and run it again.
- **No blanket `uncaught:exception` handler.** A React error escaping to the
  window is a real defect, and swallowing all of them is how a suite ends up
  green on a broken page. [`cypress/support/e2e.ts`](../cypress/support/e2e.ts)
  carries one narrow, justified exception — React's dev-only performance track
  calling `performance.measure()` with a negative timestamp, which `next build`
  strips and which therefore never fires in CI. Add to that list the same way:
  one specific pattern, with the reason.
