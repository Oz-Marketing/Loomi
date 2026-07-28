# Oz Reports → Loomi contact sync

How CRM contacts stay current in Loomi: what runs, where it runs, how often,
and how you find out when it stops.

## The pipeline

```
Oz Reports MySQL                  Oz Reports host                Loomi (studio/app)
─────────────────                 ───────────────                ──────────────────
sales_data          ┐
service_data        │   cron  →  oz-reports-contact-sync.sh  →   POST /api/ingest/contacts
ps_sales_data       ├──────────►  (GETs /loomi/push* routes)  →   POST /api/ingest/events
ps_service_data     │             app/Controllers/Loomi.php         │
leads_individual    ┘                                               ▼
                                                              Contact + ContactEvent
                                                              IngestRun (heartbeat)
                                                                    │
                          GitHub Actions (daily) ──────────────────►│
                          contact-sync-health.yml                   ▼
                                                    GET /api/internal/contact-sync/health
```

Two halves, deliberately:

- **Push** lives on the Oz Reports host, because that's where the CRM data and
  the dealer→account mapping (`dealer_map.loomi_account_key`) live.
- **Monitoring** lives in Loomi, because Loomi is the only place that can tell
  whether the push actually arrived.

Ingest is an **idempotent merge** — tags unioned, `customFields` shallow-merged,
`dnd` never cleared by a feed that omits it. Every job below is safe to re-run,
overlap, or run twice by hand.

## Cadence

| Job | Schedule | Endpoints | Window |
|---|---|---|---|
| `leads` | hourly, :07 | `pushleads` | 2 days |
| `nightly` | 03:30 MT | `pushcustomers`, `pushcustomersps`, `pushevents`, `pusheventsps`, `pushleads` | controller defaults — service 7d, sales 45d — plus 3d leads catch-up |
| `sweep` | Sunday 02:00 MT | all five, `?all=1`, **one dealer per request** | full history |

Why three and not one:

- **Leads are the time-sensitive feed.** A lead that lands at 9am shouldn't wait
  until tomorrow's nightly to be reachable in Loomi.
- **Sales/service arrive in Oz Reports on nightly CRM loads**, so pushing them
  more often than daily just re-sends the same rows.
- **The sweep is not redundant.** The incremental windows filter on *event date*
  (`closedate`, `contractdate`, `lead_time`) — there is no last-modified column
  in these tables to key off. So a phone-number change, an email correction, or
  an opt-out flip on a **two-year-old** purchase is invisible to every
  incremental run. The weekly `?all=1` sweep is the only thing that repairs it.
  Don't disable it. (The deeper fix is a `modified_at` column on the Oz Reports
  tables plus a `?modified_since=` window on the controller — worth doing if the
  bridge outlives its "transitional" label.)

The nightly deliberately repeats leads with a 3-day window: if the hourly job is
wedged, leads still land within a day instead of waiting for Sunday.

### Why the sweep fans out per dealer

38 rooftops are mapped (25 automotive, 13 powersports, all in `loomi_set = 0`).
The incremental jobs batch every dealer into one request per endpoint safely,
because their windows are days wide. A full sweep can't: ingest upserts
contact-by-contact, so all-time sales + service across 38 rooftops in a single
request would hit the timeout and be killed **mid-run, every Sunday**, having
silently done partial work.

So `sweep` first asks each endpoint which accounts it covers — a `?dry_run=1&days=1`
call, cheap because a 1-day window builds almost no payload, but the response
still names every mapped dealer — then walks them one request at a time with
`?all=1&dealer=KEY`. Bounded work per request, failures attributable to a single
rooftop, and progress visible in the log as it goes.

Budget hours, not minutes, for a sweep, and note the hourly leads job logs
`SKIP another sync holds the lock` while one is running. That's intentional (one
sync at a time keeps load off the MySQL box); Sunday's leads are covered by the
nightly 3-day catch-up. `SWEEP_MAX_TIME` (default 3600) is the per-dealer
ceiling, separate from `CURL_MAX_TIME` for incremental runs.

## Install (Oz Reports host, cPanel UI only)

Written for no shell access — File Manager, phpMyAdmin, Cron Jobs and a browser
are enough. Everything runs as the cPanel account that owns the Oz Reports site
(`ozreports`, home directory `/home/ozreports`).

1. **Upload the script.** File Manager → `/home/ozreports` → **+ Folder** →
   `bin` (it won't exist yet — create it). Enter it, **Upload**
   `scripts/ops/oz-reports-contact-sync.sh` from the loomi-app repo. Then
   right-click it → **Change Permissions** → `0755` (owner:
   read/write/execute; group and world: read/execute).

   Do **not** put it in `cgi-bin`, `public_html` or `ozreports.com` — those are
   web-served, and a shell script sitting in a web root is reachable over HTTP.
   Same goes for `.loomi-sync.env` in step 4. `~/bin` is not web-served.

   Don't edit the file in File Manager's editor from a Windows machine — CRLF
   line endings produce `bad interpreter` in the cron mail. Re-upload if that
   happens.

2. **Confirm the ingest target.** File Manager → `app/Config/APIKeys.php` →
   **Edit**. The `Loomi` block needs `Base URL` (`https://app.loomilm.com` is
   correct — `/api/*` paths are host-global in Loomi's proxy, so studio/app/
   reporting all serve the ingest routes) and `Ingest Secret`, which must equal
   `OZ_INGEST_SECRET` in Loomi's env. The secret is intentionally blank in
   version control; it is only ever filled in on the server.

3. **Find the sets to walk.** phpMyAdmin → the Oz Reports database → **SQL**:

   ```sql
   SELECT loomi_set, dealer_type, COUNT(*) FROM dealer_map
    WHERE loomi_account_key <> '' AND loomi_account_key IS NOT NULL
    GROUP BY loomi_set, dealer_type;
   ```

   As of 2026-07-28 this returns `0 / Automotive / 25` and `0 / Powersports / 13`
   — everything in set `0`, so the defaults are right and step 4 is unnecessary.
   If any other `loomi_set` value ever appears, it must be listed in `SETS` or
   those rooftops silently never sync.

4. **Optional config file.** Only needed to override a default. File Manager →
   **Settings** → tick *Show Hidden Files (dotfiles)*, then in the home
   directory: **+ File** → `.loomi-sync.env` → **Edit**:

   ```
   SETS=0 1
   OZ_BASE=https://ozreports.com
   LEADS_DAYS=2
   PHP_BIN=/usr/local/bin/php
   ```

   `PHP_BIN` is normally unnecessary — the script probes the usual cPanel PHP
   locations itself and falls back to a coarse response check if it finds none.

5. **Browser smoke test of the bridge** (do this from an IP in
   `app/Config/Whitelist.php` — the Oz office). Visit:

   ```
   https://ozreports.com/loomi/pushcustomers/0?dry_run=1
   ```

   You should get JSON with a per-dealer `candidates` count and
   `"dry_run":true`. Being redirected to the homepage means your current IP
   isn't whitelisted. Nothing is sent to Loomi on a dry run.

   This proves the controller, the dealer mapping and the DB queries work. It
   does **not** prove the cron will work, because cron requests come from the
   server's own IP, not yours — that's step 6.

6. **Prove the script works from cron.** cPanel → **Cron Jobs**. Put your
   address in **Cron Email** at the top (the script is silent on success, so
   this becomes failure-only mail). Add a temporary job, every 5 minutes:

   ```
   /home/ozreports/bin/oz-reports-contact-sync.sh nightly dry_run=1
   ```

   Wait for it to fire, then read the log in File Manager at
   `loomi-sync/logs/sync-<today>.log` and the marker at
   `loomi-sync/logs/status-nightly.json` (`"exitCode": 0`). **Delete the
   temporary job** once it's green.

   This is the step that proves the two things only cron can prove: that the
   server's own IP passes `IpFilter`, and that a PHP CLI was found. A
   `HTTP 302 redirect` in the log means the server's IP needs adding to
   `acceptedIps` in `app/Config/Whitelist.php` — cPanel's sidebar shows the
   host's **Shared/Dedicated IP Address**. The existing `CRON Server` entry
   (`162.214.77.252`) is what makes the other Oz Reports crons work.

7. **First live push, one rooftop.** Still in Cron Jobs, temporarily add:

   ```
   /home/ozreports/bin/oz-reports-contact-sync.sh sweep dealer=youngHonda
   ```

   Check the log for `created=` / `updated=` counts, confirm the contacts in
   Loomi, then delete the job. `exit=2` in `status-sweep.json` means some
   batches were rejected — the log names each one.

8. **Install the three real jobs** (Cron Jobs → Add New Cron Job, one per row):

   | Minute | Hour | Day | Month | Weekday | Command |
   |---|---|---|---|---|---|
   | `7` | `*` | `*` | `*` | `*` | `/home/ozreports/bin/oz-reports-contact-sync.sh leads` |
   | `30` | `3` | `*` | `*` | `*` | `/home/ozreports/bin/oz-reports-contact-sync.sh nightly` |
   | `0` | `2` | `*` | `*` | `0` | `/home/ozreports/bin/oz-reports-contact-sync.sh sweep` |

   Don't append `>/dev/null 2>&1` — that suppresses the failure mail.

   **Sequence the nightly after the CRM loads.** Oz Reports pulls its own CDK /
   Tekion / VinSolutions data on separate crons (`/get/csv`, `/get/tekiondata`,
   etc.) visible on the same page. If any finish after 03:00, move the nightly
   to 30–60 minutes after the last one — pushing before the source data lands
   just means everything is a day stale.

9. **Turn on monitoring**: add `INTERNAL_JOB_SECRET` to the loomi-app repo
   secrets (same value as Loomi's env) if it isn't already there for the pacer
   alerts, then run **CRM Contact Sync Health** once from the Actions tab. It
   should come back green. Before step 8 it will correctly fail with
   `never-synced` for every account.

## Monitoring

`GET /api/internal/contact-sync/health` reports, per account, when it last
received a CRM batch. `.github/workflows/contact-sync-health.yml` calls it daily
at 15:00 UTC and fails the run — which mails whoever watches the repo — when any
account is `stale` (no batch inside `maxAgeHours`, default 30) or `never-synced`.

This reads the `IngestRun` table, not `Contact.updatedAt`, and the distinction
matters: a run that legitimately found nothing new leaves every `Contact` row
untouched, so `updatedAt` alone cannot tell "quiet Sunday" from "cron deleted
three weeks ago". Every accepted batch writes an `IngestRun` row even when it
changed nothing, so **no rows means no sync**.

### stale fails, never-synced only warns

Four mapped accounts have no CRM feed of their own — `youngAutomotiveGroup`,
`youngCollisionCenter`, `youngCommercialFleet`, `youngPowersports` all return
`candidates: 0`. The bridge skips the POST when a dealer has no rows in the
window, so these never produce a heartbeat and sit permanently at
`never-synced`. That's expected, so it's reported as a **warning**; failing on
it would mean a red run every single day, which is how a monitor gets muted and
stops being a monitor.

The failure conditions are:

- **any account `stale`** — it was receiving batches and stopped. This is the
  real signal.
- **`runsAllTime === 0`** — no account has *ever* received a batch, i.e. the
  cron was never installed or has never once succeeded.

If the `never-synced` count starts climbing past those four, that's worth a
look — it means a newly-mapped rooftop isn't pushing.

By hand:

```
curl -s -H "x-internal-job-secret: $INTERNAL_JOB_SECRET" \
  "https://studio.loomilm.com/api/internal/contact-sync/health?maxAgeHours=30" | jq .
```

Params: `maxAgeHours` (staleness threshold), `retentionDays` (prunes `IngestRun`
rows older than this on each call, default 180, `0` disables — the log is
self-maintaining, no separate cron).

Account discovery is the union of "has ever had an `IngestRun`" and "holds
contacts with `source` starting `oz-reports`". A hand-uploaded CSV account is
never flagged for a sync it was never part of. Note the leads push overrides
`source` per contact with the CRM lead source (`AutoTrader`, …), so a
**leads-only** account is discovered via its runs rather than its contacts.

On the host, each job also drops a marker you can read without grepping logs:

```
cat ~/loomi-sync/logs/status-nightly.json
```

## Running one-offs

```
~/bin/oz-reports-contact-sync.sh sweep dealer=youngHonda     # one rooftop, full history
~/bin/oz-reports-contact-sync.sh nightly dry_run=1           # build payloads, send nothing
```

Anything in the second argument is appended to every request, so the
controller's own params work: `all=1`, `days=N`, `from=YYYY-MM-DD&to=…`,
`dealer=KEY`, `dry_run=1`.

Onboarding a new rooftop: populate `dealer_map.loomi_account_key` (+ `loomi_set`,
and `loomi_make_include`/`loomi_make_exclude` for shared-accounting stores), then
backfill it once with `sweep dealer=<key>`. The regular crons pick it up after
that.

## Parking a rooftop (temporarily excluding it)

Exclusion has to happen in `dealer_map`, **not** in the script. The hourly and
nightly jobs push every mapped dealer in one request per endpoint, so the script
has no per-dealer control there — only the sweep does, and only because it fans
out deliberately.

Park a rooftop by moving its row to a `loomi_set` that isn't in `SETS`. That
preserves the mapping (unlike blanking `loomi_account_key`) so un-parking is a
one-line change:

```sql
-- Park. 9 is a convention, not special — any value not listed in SETS works.
UPDATE dealer_map SET loomi_set = 9
 WHERE loomi_account_key IN ('youngGrizzlyHarleyDavidson', 'youngPowersportsOfMissoula');

-- Un-park later.
UPDATE dealer_map SET loomi_set = 0
 WHERE loomi_account_key IN ('youngGrizzlyHarleyDavidson', 'youngPowersportsOfMissoula');
```

Then add the same keys to the `ignore=` list on the health endpoint in
`.github/workflows/contact-sync-health.yml`, or the monitor will keep reporting
them. **Remove them from `ignore=` the same day you un-park them** — an ignored
account is an unmonitored account.

Currently parked:

| Account | Why |
|---|---|
| `youngTruckAndTrailerOfKaysville` | Shares one CDK accounting code with Logan and no discriminator has been found in the data — not mapped in `dealer_map` yet |
| `youngTruckAndTrailerOfLogan` | Same shared-code problem |

Note that parking stops *future* pushes; it does not remove contacts an earlier
run already delivered.

## Splitting two rooftops that share an accounting code

Grizzly HD and Powersports Missoula are one physical store under CDK code
`800236`, so every query keyed on that code returns both rooftops' records —
each was receiving the other's customers. Grizzly sells only Harley-Davidson,
which makes `make` the discriminator:

```sql
UPDATE dealer_map SET loomi_make_include = 'HARLEY DAVIDSON,Harley', loomi_make_exclude = NULL
 WHERE loomi_account_key = 'youngGrizzlyHarleyDavidson';
UPDATE dealer_map SET loomi_make_exclude = 'HARLEY DAVIDSON,Harley', loomi_make_include = NULL
 WHERE loomi_account_key = 'youngPowersportsOfMissoula';
```

`applyMakeFilter()` runs at all 8 query sites (both customer pushes, both event
pushes), so the split covers contacts and timeline history alike.

Three things to know if you set up another one of these:

1. **Keep the two lists byte-identical** — one `include`, one `exclude`, same
   values. Identical lists mean every row lands in exactly one account. If they
   drift, rows either duplicate into both or fall into neither.
2. **Null the opposite column.** `include` wins when both are set on one row, so
   a leftover value silently overrides.
3. **Enumerate the spellings first** — matching is exact (per-value, case
   insensitive), so a variant you miss gets misrouted rather than erroring. This
   store had both `HARLEY DAVIDSON` (1,557 service rows) and `Harley` (22):

   ```sql
   SELECT make, COUNT(*) FROM ps_service_data
    WHERE accounting_account = '800236'
      AND (make LIKE '%HARL%' OR make LIKE '%DAVID%' OR make LIKE '%H-D%' OR make LIKE 'HD%')
    GROUP BY make;
   ```

Verify with a dry run: the two accounts' candidate counts must **sum** to what
the shared code produced before the split (55 + 99 = 154 here). A sum that's too
high means duplication, too low means dropped rows.

Note 271 service rows at this store have a blank `make` and therefore fall to
Missoula, as the non-Harley side. Some of those are probably Harleys with a
missing field — the alternative (excluding blanks from both) would drop them
from Loomi entirely, so this is the deliberate choice.

### When make isn't the discriminator

The Truck & Trailer pair share a code but sell the same products, so `make`
can't separate them. Candidate columns worth checking before resorting to a
heuristic — these carry per-`dealer_map`-row values for Tekion-sourced rows:

- `sales_data.tekion_dealer_id` and `sales_data.dealer_name`
- `service_data.dealership`, and `service_data.dealer` (set from `cdk_svc`,
  often per-store even when the sales code is shared)

Note the Tekion importer deliberately leaves `service_data.tekion_dealer_id`
empty (see the comment in `Tekion.php`), so it can solve sales but not service.

Splitting on any column other than `make` needs a generic filter added to the
bridge (`loomi_filter_column` + include/exclude, mirroring the make filter).
Splitting by customer city/zip is possible with the same mechanism but assigns
by where the customer *lives*, not where they transacted — acceptable for
top-of-funnel, wrong for service reminders. And the choice is sticky: ingest
never moves a contact between accounts, so records sent to the wrong one need
manual deletion and a re-push.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Clean — or skipped because another run held the lock (not an error; one sync at a time by design) |
| 1 | Hard failure — transport, non-200, or an unparseable response |
| 2 | Partial — some per-dealer batches reported errors |

Code 2 exists because the bridge returns **HTTP 200 even when individual dealer
batches failed** (per-dealer errors live in `summary.<dealer>.errors[]`), so the
status line alone would report success on a half-broken run.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `HTTP 302 redirect` | Calling host's IP not whitelisted | Add it to `app/Config/Whitelist.php` (`acceptedIps`) |
| `HTTP 500` + "Base URL / Ingest Secret not configured" | `APIKeys.php` `Loomi` block empty on the server | Fill in `Ingest Secret` (and `Base URL`) on the server |
| Batch errors: `HTTP 401` | Loomi rotated `OZ_INGEST_SECRET` | Re-sync the secret on both sides |
| Batch errors: `Unknown accountKey: X` | `dealer_map.loomi_account_key` doesn't match a Loomi `Account.key` | Correct the mapping row |
| `curl exited 28` | Request exceeded `CURL_MAX_TIME` (or `SWEEP_MAX_TIME`) | Raise it in `~/.loomi-sync.env`, or narrow the run with `from`+`to` chunks |
| `dealer discovery failed — cannot chunk the sweep` | The `?dry_run=1&days=1` probe didn't return 200 | Same causes as any other failure above — check the log for the probe response; the sweep refuses to run rather than fire one unbounded request |
| Health check: `never-synced` (warning) | That account has no CRM feed — expected for the four parent accounts | Nothing, unless the count grows; then check the rooftop's `loomi_set` and `loomi_account_key` |
| Health check: `runsAllTime: 0` | Cron not installed, or has never once succeeded | Install the crontab (steps 6–8) |
| Health check: `stale` for one account only | Its dealer row was unmapped or its make filter excludes everything | Check `dealer_map` for that rooftop |
| Health check: `stale` for everything | Cron disabled, host moved, or secret rotated | Check `~/loomi-sync/logs/status-*.json` and the day's log |
| Sync log shows `SKIP another sync holds the lock` repeatedly | A long sweep is still running, or a run died holding the lock | Locks older than `STALE_LOCK_HOURS` (6) are broken automatically and warn |
| Cron mail: `bad interpreter` | Script uploaded/edited with CRLF line endings | Re-upload it unmodified |
| Cron mail: `Permission denied` | Script isn't executable | File Manager → Change Permissions → `0755` |
| Log line `php=none` / `no php on this host` | No PHP CLI on cron's PATH | Set `PHP_BIN` in `~/.loomi-sync.env` (find the path in cPanel → MultiPHP Manager); the run still works, just without per-dealer detail |

## Retiring this

`app/Controllers/Loomi.php` is explicitly transitional. When native Loomi source
adapters replace it they call the same `/api/ingest/*` endpoints, so the run log,
the health endpoint and the workflow all survive unchanged — only the push half
(this script and its crontab) gets deleted.
