# Ad Generator — template → ad design sync

How a template edit reaches the ads built from it, and why the apply is a
background job rather than an HTTP request.

Status: **the 504 fix landed 2026-09-10**, verified end to end against a
throwaway database with the real worker and real Chromium.

| Piece | Where |
| --- | --- |
| Sync state, design hash, cosmetic vs structural | `src/lib/ad-generator/template-sync.ts` (pure) |
| Applying to ads, size policy, browser lifecycle | `src/lib/ad-generator/template-sync-apply.ts` |
| The background job and its progress row | `src/lib/ad-generator/template-sync-job.ts` |
| Queue registration | `src/worker/index.ts` |
| Start a run / follow a run | `src/app/api/ad-generator/templates-doc/[id]/sync/route.ts` |
| What a save would affect | `src/app/api/ad-generator/templates-doc/[id]/sync-impact/route.ts` |
| Pull one ad up to date | `src/app/api/ad-generator/creatives/[id]/sync/route.ts` |
| The dialog | `src/components/ad-generator/template-sync-modal.tsx` |
| Progress row | `AdTemplateSyncRun` |

## Why it 504'd

Reported as "updating a template and applying to other ad sizes times out."
Three independent problems stacked up.

**Nothing in the code knew the real timeout.** Production nginx sets no
`proxy_read_timeout`, so an upstream request is cut off at nginx's 60-second
default. The route declared `maxDuration = 300` and the dialog split itself into
10-ad requests to "stay inside the timeout." `maxDuration` is a Vercel
serverless setting and does nothing on the droplet, so both were calibrated to a
budget that never existed.

**Every apply re-rendered every size of every ad.** Neither sync route passed
`sizeIds`, so the render defaulted to the template's full size list. On the
template that prompted the report — 9 sizes, 214 ads to update — that is 1,926
retina screenshots and 1,926 uploads, requested as 22 sequential 60-second
calls. No batch size makes that fit.

**Each ad launched its own Chromium.** `renderAdBatch` opens and closes a
session per call, so a 10-ad request started the browser 10 times.

Measured floor for one 10-ad request, on a blank page with no photos and no
uploads: **15.2 seconds**. A real ad adds a vehicle photo and a logo that
Chromium fetches per render, and a photo-like retina PNG measures 11 MB at
1080×1080 and 20 MB at 1080×1920, so each request also pushed hundreds of
megabytes to S3.

## Why one size is enough

The stored per-size PNGs are **write-only**. `renderCreativeToS3` returns a list
and only `persisted[0].url` is kept, as the ad's thumbnail. Everything that
actually needs pixels re-renders from the ad's own stored doc: launching to Meta,
the ZIP export, the launch kit, and the ad detail preview. So a size rendered
during a sync was uploaded and never fetched.

Generation already made this call — `previewSizeId`, the squarest size — for the
same reason, and `syncRenderSizeIds` now matches it.

**Preflight is deliberately NOT narrowed to the rendered size.** It is a static
check over the whole design and costs nothing to run wide. Narrowing it would let
a template edit break the co-op legibility minimum on a leaderboard and still
report the ad compliant. Rendering one size and checking every size is the whole
point of the split.

## Why the apply is a job

Even at one render per ad, 214 ads is minutes of Chromium, and no HTTP request
should be holding that open. So the request does only what a request can:

1. Authorize the submitted ad ids against the caller's scope. This must happen
   here — the worker has no session, so the run row is the record of an
   already-authorized decision.
2. **Freeze the design into the run.** The worker never re-reads
   `AdTemplateDoc`. The builder autosaves every 1.2 seconds, so re-reading would
   push whatever the designer typed since into ads whose owner approved a
   different design.
3. Create `AdTemplateSyncRun`, enqueue, return the id. Measured at **71 ms**.

The dialog then polls `GET …/sync?runId=`, which reports per-outcome counts and
the per-ad results as they land. The person can close the dialog; a
`template_sync_finished` notification carries the outcome.

### Progress is written per ad

Once per ad, not in blocks — one small `UPDATE` against hundreds of milliseconds
of Chromium is not the expensive part of the loop, and a progress bar that does
not move is the thing this feature was being blamed for.

### Telling a dead run from a slow one

Both look identical from outside, and a crash-looping worker is a recurring
failure here (see `CLAUDE.md`). The status route reports `stalled` for two
shapes: `queued` for over a minute (nothing ever claimed it) and `running` with
no progress write for over five minutes (the worker died mid-run). `updatedAt`
on the row is what makes the second measurable.

The five-minute grace is not arbitrary. **A cold worker process pays roughly 100
seconds** before its first render, transpiling the module graph and loading
puppeteer. Measured: the same 12-ad run took 105 s on a cold worker and 3 s on a
warm one. That cost is per process, not per run, and every adgen job on the
worker already pays it.

## One browser, and what that cost

The batch shares one Chromium. That removed 9 launches out of every 10 — and
introduced a failure the per-ad launch did not have: a browser that dies stays
dead, so every later ad fails with `Session closed`.

This is not hypothetical. It happened on the **first live run** of this code: ad
1 died inside `Page.captureScreenshot` with `Target closed`, and ads 2 and 3
failed as collateral. So a render failure now recycles the session, and the next
ad gets a fresh browser. A crash costs one ad again.

`ApplyResult.renderFailed` is what drives that, and it is deliberately narrower
than `outcome === 'failed'`: an ad that was simply not found says nothing about
the browser's health, and relaunching over it would pay a second of launch for
nothing. `template-sync-session.test.ts` pins both halves — one launch for a
healthy run, a replacement after a render failure.

## A render that never returns

`page.screenshot()` takes no timeout, and under resource pressure it does not get
slow — it never comes back. Reproduced here with about ten Chromium instances
competing for one machine: the screenshot hung indefinitely, and the same page
rendered in 74 ms once the machine was clear. `setContent` has a 20-second
timeout and the font, image and video waits are each raced against their own
deadline, so the screenshot was the only unbounded step in the pipeline.

That was survivable while this work sat in a request, because nginx killed the
response at 60 seconds. On the worker there is nothing to kill it. The first live
run of the job form sat at 0 of 24 processed with the queue entry held `active`,
and pg-boss would not have expired it for an hour.

So each ad's render is bounded (`withRenderTimeout`, two minutes — reaching it
means wedged, not slow) and a timeout is reported as that ad's failure. Because
it counts as `renderFailed`, it also recycles the browser, which kills the hung
Chromium and gives the next ad a live one. One ad lost instead of the run.

## Two defects the live run caught

Worth recording, because both passed types and unit tests and only failed when
actually run.

**The dialog never polled.** The run id was held in a `useRef`, and the polling
effect keyed on `busy`. React ran the effect the moment `busy` flipped, while the
ref was still null, so it bailed out — and a ref assignment re-renders nothing,
so it never ran again. The dialog sat on "0 of 24" through a run that had already
finished all 24. The id is state now.

**One dead browser took the whole run.** See the section above on sharing one
Chromium.

## The single-ad pull stays synchronous

`POST /api/ad-generator/creatives/[id]/sync` is one ad, therefore one render, so
it answers in its own request. It had the identical all-sizes bug: on a 16-size
template it could blow past 60 seconds for a SINGLE ad.

## Measured

Synthetic ads (no remote photos), local Postgres, warm worker.

| | Before | After |
| --- | --- | --- |
| HTTP request | minutes, then 504 | 71 ms |
| Renders per ad | every size (up to 16) | 1 |
| Chromium launches per 10 ads | 10 | 1 |
| 12 ads | did not complete | 3 s |
| 24 ads, through the real dialog | 504 | 4.5 s |
| 60 ads | did not complete | 7 s |

Real ads are slower per render because Chromium fetches the vehicle photo and
logo each time. The shape is what changed: the request no longer waits on any of
it.

## Not done

**nginx still has no `proxy_read_timeout`**, so 60 seconds remains the hard
ceiling for every route on the droplet. Nothing in this feature needs more than
that any more, and the streaming routes (the ZIP export) are safe because the
timeout applies between reads rather than to the total. Raising it in the deploy
workflow is a shared-infrastructure change and was deliberately left alone —
it would have hidden this bug rather than fixed it.

`AdTemplateSyncRun` rows are not purged. One row per template-save-with-apply is
low volume, and `AdAutomationRun` is treated the same way.
