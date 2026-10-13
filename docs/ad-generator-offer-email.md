# Ad Generator — the companion offer email (built 2026-08-16)

Moved here from `docs/playbooks.md` when Playbooks was removed (2026-10-13);
the email never depended on it. It closes the open half of
[ad-generator-campaign-launch.md](./ad-generator-campaign-launch.md) ("The
direction beyond this"): one OEM program now produces ads **and** an email,
against the same offers, under one `Campaign` row.

## Shape

```
poll offers → generate ads → generate ONE draft email from the same offers
```

`generateAllAccounts()` calls `generateOfferEmail()` after each account's ads, in
its own try — an email that fails to build must never lose the ads that were
already generated and recorded.

| File | Role |
|---|---|
| `automation/offer-email-doc.ts` | PURE: offers → v2 `EmailTemplate`. No prisma, no network. |
| `automation/generate-offer-email.ts` | Orchestration: read creatives + snapshots, render, persist a draft. |

## Decisions, and why

- **One email per RUN, not per offer.** An OEM drop routinely covers six models;
  six sends to one dealer list is how a database gets burned. The featured
  offers are exactly the ones that produced ads, so the email can never
  advertise something the paid side isn't running.
- **Always a draft.** There is deliberately no `mode: 'ready'` counterpart. The
  ads' auto-publish path creates PAUSED campaigns; email has no pause, and a
  wrong send is permanent.
- **Content is the manufacturer's, verbatim.** `programName`, `description`,
  `offerDetails` and `eligibility` pass straight through from the MarketCheck
  payload, and the disclaimer is reproduced exactly as `resolveDisclaimerText`
  resolved it *for the ad*. Nothing is reworded by a model. Numbers come from
  the creative's own `AdData`, so the email cannot disagree with the ad beside
  it.
- **One disclaimer per offer**, not one per email — each program has its own
  terms.
- **Idempotent on the offer SET.** `EmailBlast.automationKey` is
  `adgen:<accountKey>:<hash of sorted fingerprints>`, so re-running over
  unchanged offers updates the one draft; a new offer yields a new key and a new
  draft. Same discipline as `AdCreative.offerFingerprint`. A draft that has left
  the `draft` state is never rewritten — a person has scheduled or sent it.
- **Pre-targeted, or untargeted.** The draft is pointed at the configured
  `Audience`. An audience belonging to another account is *refused*, not
  used, and the draft lands untargeted — which cannot send, and is the safe
  failure.

## Traps found while building

- **Block props are the components' own names.** `text`, `url`, `bgColor` — not
  `content`, `href`, `backgroundColor`. A wrong key renders a structurally valid
  but **blank** block rather than erroring, so `offer-email-doc.test.ts` renders
  through react-email for real. Nothing short of rendering catches it.
- **`EmailBlast` has no `accountKey` column** — accounts live in an
  `accountKeys` JSON array, so it cannot be grouped by account. Parse
  `automationKey` to find an account's last offer email.
- **Branding is read WITHOUT the group inheritance chain.** That is deliberate: `generate-ads` resolves the creative's
  colors the same way, and an email whose brand color disagrees with its own
  ad is worse than one that inherits nothing.
- **A missing EVOX jellybean drops the image, not the offer.** `resolveJellybean`
  returns null wherever EVOX is unconfigured or coverage is missing (Accord and
  Civic 404 today) — an offer with real numbers is still worth sending.

## Settings

An **Offer email** block on the automation Settings tab: an on/off switch plus
audience, shell template, and max-offers. It sits in its own block below the ad
settings rather than as another cell in that grid — everything above configures
the ADS, and a customer-facing send sitting inline among render settings is too
easy to switch on without noticing.

The shell is chosen from **rendered cards, not a dropdown** — the same treatment
the ad design gets, and for the same reason: the thing being chosen is a picture,
and a list of names makes a wrong pick invisible until the send goes out. Every
card is the real email HTML in a sandboxed iframe, built with this account's
own offers, branding and disclaimers.

A shell with no `{{offers}}` block still renders — as ITSELF, with no offers in
it — under a "nothing would be sent" label. Hiding it would answer the question
"why isn't my template here?" with silence.

`previewOfferEmail` shares the document builders with the generator and nothing
else. It deliberately isn't `generateOfferEmail` in dry-run: that function needs
a completed run's ads, writes a Campaign and a blast, and refuses outright on
exactly the states a preview most needs to SHOW. When no ads exist yet it draws
the layout with **obvious placeholders** (`$XXX/mo`) rather than plausible fake
figures, and says so — someone will screenshot this.

Choosing no audience warns that drafts will need one picked by hand.

> **The trap.** `save_config` is a FULL REPLACE — every field the request omits
> is reset to its column default. The email settings therefore had to join
> `ScopeForm` and `toPayload`, or merely flipping the automation on/off switch
> (which re-posts the saved scope through the same function) would silently wipe
> them. `use-automation.test.ts` pins this for every field, not just today's.

## Not built

- **SMS.** The same offers could drive it and `Campaign` already aggregates
  `smsBlasts`, but it wasn't asked for.
- **A landing page to point at.** The CTA uses `Account.website`; Phase D of the
  campaign-launch doc is what would replace it.
