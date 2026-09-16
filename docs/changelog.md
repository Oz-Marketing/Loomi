# Changelog & product-update notifications

How a change gets from a merged PR to the `/changelog` page and, if someone opts
in, to their inbox.

## The short version

1. Put a `## Changelog` block in your PR description — **the PR that does the
   work**, whichever branch it targets.
2. Merge it. A workflow files the entry as a **draft** when the PR lands on
   `staging` or on `main`.
3. Someone opens `/changelog`, reads it, presses **Publish & notify**.
4. Only then is it visible to anyone else, and only then does anything send.

**Write the block once, in the feature PR.** A `staging -> main` promotion must
not restate entries its feature PRs already declared — they were filed when
those PRs merged, and repeating them files a second copy under a different
`sourceKey`. The promotion's own block is for notes about the release itself,
if any.

> Until 2026-09-16 the workflow listened on `main` only. Since work reaches
> production as feature -> staging -> main, the only body it ever read was the
> promotion's — which does not carry the feature PRs' descriptions — so blocks
> written in feature PRs were silently dropped.

Nothing publishes itself. The gap between step 2 and 3 is deliberate: a release
note is customer-facing copy, and "it merged" is not the same claim as "this is
worth telling a dealer about, in these words."

## Writing the block

````markdown
## Changelog
type: feature
audience: everyone
title: Bulk download in the Asset Library

Select any number of assets and download them as a single zip. Large
selections stream as they're built, so there's no wait on a progress bar.
````

| Field      | Values                        | Default       |
| ---------- | ----------------------------- | ------------- |
| `type`     | `feature` `improvement` `fix` | `improvement` |
| `audience` | `everyone` `staff`            | `everyone`    |
| `title`    | one line                      | **required**  |
| body       | after the blank line          | **required**  |

- The block ends at the next markdown heading, so put it wherever you like.
- Several entries in one PR: separate them with a line of `---`.
- Anything inside an HTML comment is ignored — that's how the PR template can
  carry a worked example without filing it on every merge.
- An unrecognized `type` or `audience` falls back to the default rather than
  dropping the entry. A typo shouldn't silently lose the release note.
- **No block, no entry.** Most PRs are plumbing and shouldn't produce one.
- **`title:` and a body are both required, and a block missing either produces
  nothing.** That is deliberate — a half-filled template should file nothing
  rather than an empty entry someone has to notice and delete — but it means a
  perfectly good paragraph written straight under the heading, with no `title:`
  line, yields no release note. The import workflow now leaves a **warning
  annotation** on its run when a block is present and no complete entry came
  out of it, so this fails loudly instead of silently. If you wrote a note and
  no draft appeared, check that run first.
- The block ends at the next markdown heading, so a trailing attribution or
  sign-off line gets absorbed into the last entry's body unless a heading
  follows it.

### `audience` is the important field

`everyone` includes client-role users — dealers. Write it for them: what they
can now do, not what we refactored. `staff` keeps the entry off client screens
and out of their notifications entirely.

## Publishing

`/changelog` shows staff both drafts and published entries; clients only ever
receive published `everyone` entries from the API, so an unfinished draft can't
leak by URL.

On a draft, the `⋮` menu offers **Publish & notify**. It confirms first, naming
who the entry reaches. Publishing:

- flips `status` to `published` and stamps `publishedAt` / `publishedBy`
- writes one in-app notification per eligible user — **per release, not per
  entry**, so a ten-fix release is one line in the bell panel
- emails the users who have turned product-update email on
- stamps `notifiedAt`

Publishing an already-published entry is a no-op, so a double-click can't
announce anything twice.

The hand-written "Add Entry" form publishes immediately (with a "Save as draft
instead" escape hatch). It runs through the same publish path, so there is one
implementation of "tell people", not two.

## Notification preferences

`product_update` lives in a **Product Updates** category, visible in
Settings → Notifications on both Studio and the App.

Its defaults are deliberately asymmetric: **in-app on, email off**. An
unsolicited product email is a different kind of intrusion from an alert
somebody's work depends on, so the inbox is opt-in.

### The email/in-app split

`NotificationPreference` has two independent booleans:

- `enabled` — show in the bell panel
- `emailEnabled` — also send mail

This applies to *every* notification type, not just product updates. Turning
in-app off stops both (there's nothing to mail if the alert is never raised);
turning email off keeps the panel entry and mutes the inbox.

Existing rows were backfilled with `emailEnabled = enabled` by
`scripts/backfill-notification-email-pref.ts`, so the split didn't switch mail
back on for anyone who had previously turned a type off. That script is guarded
by an `AppSetting` key and runs once per environment.

## Re-importing a PR

If the block was wrong or missing at merge time: fix the PR description, then
run the **Import Changelog from Merged PR** workflow from the Actions tab with
the PR number. It reads the *current* description.

Import is idempotent on `sourceKey` (`pr:<number>#<index>`) and only ever
**creates**. An entry already filed for that key is left exactly as it is — so a
re-run can neither duplicate it nor overwrite wording edited in Loomi
afterwards. To re-import from scratch, delete the entry in Loomi first.

## Why the old entries kept coming back

Before this, `scripts/seed-changelog-entries.ts` ran inside `build` *and*
`deploy:prepare`, upserting a fixed set of February-2026 entries by hard-coded
id. Deleting them in the UI worked until the next deploy put them straight back.

That script is gone. Its one useful half — the "Service Reminder" starter
template — moved to `scripts/seed-test-template.ts`, and
`scripts/purge-legacy-changelog.ts` clears the residue (everything published
before 2026-03-01), once per environment, guarded by an `AppSetting` key so a
deliberately backdated entry can't be eaten by a later deploy.

## Files

| Path                                             | What it does                                     |
| ------------------------------------------------ | ------------------------------------------------ |
| `.github/workflows/changelog.yml`                | On merge to staging or main, POSTs the PR body   |
| `.github/pull_request_template.md`               | Carries the block format                         |
| `src/lib/changelog-pr.ts`                        | Parses the block (unit-tested, no DB)            |
| `src/app/api/internal/changelog/import/route.ts` | Files drafts, idempotent on `sourceKey`          |
| `src/lib/changelog-publish.ts`                   | The one publish + fan-out path                   |
| `src/lib/changelog.ts`                           | Client-safe types, unread helpers                |
| `src/app/changelog/page.tsx`                     | Full page — drafts, publish, audience            |
| `src/components/changelog-panel.tsx`             | Top-bar popover — published only                 |

The workflow needs the `INTERNAL_JOB_SECRET` repo secret, the same one the pacer
alert cron uses.
