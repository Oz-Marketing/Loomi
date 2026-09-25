# End-to-end testing

Cypress drives a real browser against a running Loomi. It is the layer above
`npm run test` (vitest, pure units with no browser and no database) and it
answers a different question: *does the app still come up and let a person in?*
For testing one component in isolation, see
[component-testing.md](component-testing.md).

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
- **`surfaces.cy.ts`** — a signed-in smoke pass over **every** static page on
  the studio host (about 70), plus the Reporting pages it also serves.
- **`client-access.cy.ts`** — what a client can and can't reach in Studio.

`surfaces.cy.ts` is deliberately shallow. It does not assert what any page
*contains*, because that copy changes weekly and a smoke suite that fails on a
reworded heading teaches people to ignore it. It asserts the ways a page dies
unnoticed: a non-2xx response, the error boundary, the 404 page, a bounce to
`/login`, and, for redirects, landing somewhere other than the listed target.

**It keeps its own coverage honest.** Its first test lists every `page.tsx`
under `src/app` (the `listStaticPages` task in `cypress/tasks.ts`) and fails
unless each one is either in `PAGES` or in `SKIPPED` with a reason. It also
fails on entries for pages that no longer exist. Adding a page means adding one
line to that file. Pages under a `[dynamic]` segment aren't listed, since they
need real ids. Known-broken pages sit in `SKIPPED` marked **KNOWN BUG**; move
each into `PAGES` once it's fixed.

### `client-access.cy.ts` — the client's Studio bound

A client enters Studio only to review the OEM offer campaigns built for their
account (CLAUDE.md, "Permissions and scope"). Signed in as the seeded client, it
checks that:

1. the session really is the client tier
2. `/ad-generator` sends them to `/campaign-builder`
3. they see automation campaigns and never manual ones, in the API and the page
4. a manual campaign is "not found" to them, not forbidden
5. an ad opens from its campaign at the bare `/ad-generator/<id>`
6. there is no Projects switch and no Agency Settings cog
7. `/app/projects` sends them back to `/campaign-builder`

The seed has no campaigns, so the spec creates its own through `cy.task`: one
automation campaign with one ad, and one manual campaign, on the client's
account, with fixed `e2e-…` ids. They're removed at the end. A staff check
first confirms both exist, so "the client can't see it" can't pass just because
creating it failed. The tasks write with plain SQL through `pg` to whatever
`DATABASE_URL` is set (falling back to `.env`), which must be the database the
server under test is using.

### `reporting-leakage.cy.ts` — the margin guard

Reporting admits the client tier, so anything `/api/reporting/*` returns reaches
a dealer. This spec signs in as a **client** user and checks four things:

1. the session really is the client tier (without this the file is theater —
   a fallback to the staff identity would pass everything while proving nothing)
2. `my-reports` never offers a client Budget or Executive
3. `/api/reporting/budget` refuses a client *itself*, not just the link to it
4. nothing the client's browser fetches carries a margin marker

For (4) it walks the sidebar the app renders for that client, visits each
report, records which endpoints were called with which params, then re-requests
them as the client and inspects the bodies. New reports are covered the day
they ship, because the nav is the source of truth.

**Why the ban list is narrower than the unit test's.** `budget-view.test.ts`
bans the substrings `cost` and `revenue` outright. That is right there — the
input is synthetic and the output is one budget DTO. It is wrong across the
whole reporting surface, and would fail immediately on legitimate data:

| Report | Legitimate keys |
|---|---|
| `direct-mail` | `cost`, `costPerRo`, `revenue`, `revenuePerPiece` |
| `sales-trend` | `newRevenue`, `usedRevenue`, `leaseRevenue`, `totalRevenue` |
| `acquisition-cost` | `revenue` |

Those are the **dealer's own** figures — what they spent on a mail drop, what
their service lane earned. Showing them is the point of the report. They are a
different thing from Oz's cost of buying media and the markup on it.

So the sweep carries only markers with no legitimate dealer-facing meaning:
`spendTarget`, `markup`, `margin`, `costKnown`, `byLineType`, `knownRevenue`,
`uncostedAmount`. Each was checked against the live responses of twelve client
reports and hit nothing. **Don't add `cost` or `revenue`** — it will cry wolf,
and a suite that cries wolf gets switched off.

`spendTarget` is the one to understand: it is `amount × markupSnapshot`, so
printed beside `amount` it lets anyone divide one by the other and read the
markup. It is a margin figure wearing an innocent name.

**The spec was verified by breaking it.** Injecting `spendTarget: 1234` into
`/api/reporting/leads` made it fail, naming the endpoint and the key; reverting
made it pass. A leak test nobody has seen fail is not evidence of anything.

That exercise also caught a flaw worth remembering: the first version used
`req.continue(res => ...)`, which makes Cypress buffer the upstream body, and
any request the browser cancels mid-navigation then fails the test with an
opaque CDP error. Capture the URL in the intercept and read the body back with
`cy.request` instead.

### A note on client credentials

The spec uses the seeded client (`alex.client@ozmktg.com`). `prisma/seed.ts`
sets that password on every run, including on rows that already exist — but a
long-lived dev database can still have drifted (mine had this user on the staff
password). Override without re-seeding:

```bash
CYPRESS_CLIENT_PASSWORD=... npm run e2e
```

---

## Cypress Cloud

Recording needs **two** values, and they are not the same kind of thing:

| Value | Secret? | Where it lives |
|---|---|---|
| `projectId` | No | committed in `cypress.config.ts` (`fp9rva`) |
| record key | **Yes** | `CYPRESS_RECORD_KEY` — a GitHub secret, or your shell |

`--record` without a `projectId` fails before it reaches the network, so the
key alone is not enough. That is why the id is committed: it is an identifier,
not a credential, and Cypress's own convention is to check it in. Override it
for a different Cloud project with `CYPRESS_PROJECT_ID`, which Cypress honors
natively — no edit needed.

**The record key never goes in this repo.** It is a write credential for the
org's Cypress Cloud; anyone holding it can post runs. Rotate it in Project
Settings if it is ever pasted somewhere it shouldn't be.

```bash
export CYPRESS_RECORD_KEY=<from Cypress Cloud>
CYPRESS_BASE_URL=http://localhost:3000 npm run e2e:record
```

A recorded run uploads **Test Replay** — Cypress Cloud's DOM-level capture, and
the thing to open when a CI failure needs debugging. It is strictly better than
video for that, so local runs don't encode video at all (`video` is on only
under `CI`, where it is the fallback evidence for a run that had no record key
and therefore no Test Replay).

---

## CI

[`.github/workflows/e2e.yml`](../.github/workflows/e2e.yml) runs on every pull
request and on pushes to `main`: a throwaway Postgres, `prisma db push`,
`npm run db:seed`, `build:assets`, `next start`, then the suite against the
production bundle.

A `main` run that fails, or passes with flaky tests, posts to Slack. It's the
same card as the component suite (`.github/scripts/test-alert.sh` builds both),
headed "E2E tests". The **Run workflow** button has the same **test_alert**
preview (see [component-testing.md](component-testing.md#previewing-the-slack-alert)).

### Running it locally like CI

A long-lived dev database drifts: the seeded passwords change and the schema
falls behind, and the suite fails for reasons that aren't bugs. To run it the
way CI does without touching your dev data, give it a database of its own:

```bash
E2E_DB="postgresql://<user>:<password>@127.0.0.1:5432/loomi_e2e?schema=public"
DATABASE_URL=$E2E_DB npx prisma db push && DATABASE_URL=$E2E_DB npm run db:seed
npm run build:assets
DATABASE_URL=$E2E_DB npm start                                   # terminal 1
DATABASE_URL=$E2E_DB CYPRESS_BASE_URL=http://127.0.0.1:3000 npm run e2e   # terminal 2
```

`CYPRESS_BASE_URL` must be the exact origin in your `NEXTAUTH_URL`
(`127.0.0.1` and `localhost` are different origins to the session cookie).

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
