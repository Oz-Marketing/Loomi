# Loomi vs. Fluency — Where We Stand and What It Takes to Close the Gap

**Written:** August 2026
**Source:** 4As webinar transcript — Fluency (Heather, VP Growth) with LT Agency (Chase Lane, CEO), on "agentic automation for scaling campaigns"
**Audience:** the Loomi team. No technical background assumed.

---

## The short version

Fluency is a nine-year-old platform that automates ad operations for agencies. The
webinar is their pitch, told through a 75-person Phoenix agency that has been using
them for about a year.

**We are ahead of them on the thing that is hard to copy, and behind them on the
thing that is easy to build.**

Ahead: Loomi already owns the data, and Loomi already understands the car business.
Fluency spends the first month of every new client relationship just cleaning up
that client's spreadsheets, because their platform knows nothing about the client's
business until someone teaches it. We never have that problem, and we know things
about dealer advertising — manufacturer offer rules, co-op reimbursement
requirements, inventory feeds, vehicle photography — that a general-purpose platform
has no reason to learn.

Behind: Fluency builds the ad **and launches it, watches it, and adjusts it.** Loomi
builds the ad and stops. That's the gap, and it's a normal amount of work to close,
not a rebuild.

---

## What Fluency actually claims

Four things, stripped of webinar language:

**1. "Deterministic automation."** Their headline positioning. It means: AI can help
draft things, but the *outcome* has to be guaranteed by fixed rules, not by AI
judgment. If you set a $100,000 budget, the system must spend $100,000 — not
"probably around" $100,000. They spent years getting to this position.

**2. The full loop.** They build, assemble, launch, monitor, maintain, and optimize
ad accounts across Google, Meta, TikTok, and YouTube, with Amazon and Trade Desk
being added. Then they push the results back out to reporting and billing systems.

**3. The hard part is the customer's data.** Said repeatedly and at length. Agencies
arrive with everything in spreadsheets, structured differently by each person who
touched it. Fluency's first month is often spent fixing that before automation can
begin. Their words: automation "needs to be able to crawl something that is
repeatable in structure to be effective."

**4. The business case is growth without hiring.** Creative refreshes went from four
hours to twenty minutes. "Hundreds of compliant localized ads launched while we
sleep." Senior people stopped being "the most senior doers." The agency hired a data
scientist instead of two more junior staff, and can now credibly bid on work it used
to pass on because it couldn't staff it.

**The most revealing moment:** asked what excites her most about the future, Fluency's
VP of Growth answers — *"Can you pipe us in an inventory feed? A forward-looking
bookings feed? Occupancy rates, weather data?"*

Getting real business data into the system is their frontier. It's our starting line.

---

## Where Loomi is already even or ahead

### 1. We reached their "deterministic" conclusion first, and more completely

Fluency's 2026 flagship positioning is how Loomi's automation was built from day one.
Every decision in our unattended ad pipeline — which offer to advertise, which
template to use, whether the ad passes compliance, whether the budget is off pace —
is made by fixed rules, not by AI.

We do use AI, but only where a person is sitting there reviewing the output (copy
suggestions, campaign drafting). Nothing that runs overnight without a human uses it.

Fluency had to build a layer to force AI into behaving predictably. We never put AI
in that position, so there's nothing to force.

### 2. We don't have their biggest problem

This is the most important line in this document.

Fluency sits *on top of* someone else's data. Loomi *is* the data. Everything —
accounts, sub-accounts, contacts, offers, inventory, creative, budgets, performance —
already lives in one place with one consistent structure.

The story Chase tells about "spreadsheet ninjas," multiple people structuring the
same data differently, and months of prep work before anything could be automated is
a problem Loomi is incapable of having. We should say this out loud in every sales
conversation. It is worth more than any feature.

### 3. We already do what they describe as their exciting future

Loomi today pulls live dealer inventory feeds, polls manufacturer incentive programs,
pulls vehicle photography, and knows manufacturer offer requirements, disclaimer
rules, and pricing details.

Any platform can accept an inventory feed. Knowing what's *in* it is different. Our
system knows that one Chevrolet financing program can cover a Silverado 2500HD and a
3500HD but not a 1500 — the kind of thing you only learn by doing this work in this
industry.

### 4. Our compliance is real compliance

When Fluency says "compliant," they mean the ad matches the client's brand
guidelines. When we say it, we mean the ad won't get a co-op reimbursement claim
rejected — which is actual money, and which surfaces weeks later when it's too late
to fix.

Loomi checks each ad against manufacturer advertising rules, records which version
of the rules it checked against, and automatically notices when a manufacturer
reissues its guideline document so someone can review the change. We also
deliberately refuse to guess at a rule we haven't verified, because a made-up rule is
worse than no rule — it creates false confidence.

A general platform has no commercial reason to build any of this.

### 5. The unattended parts are built responsibly

The daily automation already: retires ads whose offer has expired before building
anything new, recognizes an offer it has already made an ad for and updates that ad
instead of creating a duplicate, records why it *didn't* make an ad on a given day,
and ran in observe-only mode for a period before it was allowed to produce anything.

That's the boring discipline that separates a real system from a demo.

---

## Where we are genuinely behind

### 1. We build the ad. We don't launch it. ← the main gap

Fluency's list of verbs is build, assemble, **launch, monitor, maintain, optimize.**
Loomi's automation produces a finished, compliance-checked ad and marks it ready. A
person then takes it somewhere else to actually run it.

So today we automate the *creative production* half of ad operations. Fluency
automates the whole thing. This is the honest difference and it's the first thing to
fix.

The plan for this is already written and reviewed internally. It hasn't been started,
and it has four open questions that need answers before anyone writes code (see
"What it takes," below).

### 2. Our budget pacing advises. It doesn't act.

Loomi's pacing tool watches Meta and Google spend, understands how each platform's
budget system actually works, and tells you what to change and by how much. But a
person has to click the button.

Fluency's *original* product, years ago, was exactly this — automatically pacing to a
budget without a person in the loop. We've built the hard part (the math, and the
ability to send changes to the platforms). What's missing is permission: a way for a
person to say "you may adjust budgets on your own, within these limits, and log
everything you do."

### 3. Fewer advertising channels

We work with Meta, Google, and StackAdapt. Fluency covers those plus TikTok, YouTube
as its own channel, and two programmatic platforms.

For dealers this matters less than it does for Fluency's agency customers. It becomes
a real gap only if we sell outside automotive.

### 4. No self-service editing for clients

Chase's single most concrete client-experience win: instead of emailing the agency to
change one line of copy, the client gets their own restricted view and edits it
themselves. No waiting. And as he put it, if there's a typo — "you're the one who
typed it in."

We have client users and permissions already. We don't have this. It's inexpensive to
build and clients would feel it immediately.

### 5. No easy way to accept unusual data

Fluency pitches "pipe us anything." Each of our data connections is purpose-built.
That's the right trade for now — depth in automotive beats breadth — but if a dealer
group shows up with, say, a service-appointment database, there's no quick path to
using it.

---

## Scoreboard

| | Loomi today | Fluency |
|---|---|---|
| Predictable, rules-based automation | ✅ Yes, throughout | ✅ Yes (their headline) |
| Owns the underlying data | ✅ Yes — no cleanup project | ❌ No — cleanup comes first |
| Industry-specific knowledge (automotive) | ✅ Deep | ❌ Generic |
| Manufacturer co-op compliance | ✅ Rules engine w/ citations | ⚠️ Brand guidelines only |
| Builds ads unattended, daily | ✅ Yes | ✅ Yes |
| **Launches those ads** | ❌ **Not yet** | ✅ Yes |
| Monitors and adjusts budgets | ⚠️ Advises only | ✅ Acts |
| Channel coverage | ⚠️ 3 | ✅ 6+ |
| Client self-service editing | ❌ No | ✅ Yes |
| Accepts arbitrary new data sources | ❌ Purpose-built only | ✅ Flexible |
| Built to handle very high volume | ⚠️ Untested at their scale | ✅ Proven |

---

## What it takes to close the gap

Rough sizing, in the order I'd do them. "Weeks" assumes focused work, not calendar
time with everything else going on.

### Step 1 — Approval and hand-off (a few weeks) · highest value per unit of effort

Give auto-generated ads a proper review-and-approve flow, generate the ad copy
alongside the image, and let someone export a complete "launch kit" — creative,
copy, targeting, budget — ready to hand to whoever runs the campaign. Automatically
create the matching budget-tracking row at the same time.

Nothing in this step touches a live ad account, so the risk is near zero. And it's
what makes the automation *visible* to a dealer for the first time: right now the
system does impressive work that nobody sees.

**Before this starts, four open questions need answers:**

1. One manufacturer program can cover multiple vehicles. We hit this once already
   with a Silverado program and fixed it there — the same mistake is sitting in the
   new plan and would cause the second vehicle's ad to silently overwrite the first.
2. If a launch fails, the current design permanently blocks anyone from retrying it.
3. Is one launch one campaign, or one campaign per creative? The plan is ambiguous
   and it changes the shape of everything downstream.
4. Meta treats financing and lease advertising as a restricted category, which limits
   geographic targeting and removes demographic targeting entirely. This needs to be
   verified against current Meta policy, not assumed — it affects what we can even
   offer.

### Step 2 — One-click Meta launch (a few weeks)

Push an approved ad straight into Meta, always created **paused**, linked back to
budget tracking. A person still presses go — but the assembling, uploading, and
configuring is gone.

### Step 3 — Let the budget tool act, within limits (2–4 weeks)

Add a per-account setting: manual (today's behavior), suggest-only, or auto-adjust
within a stated range. Log every automatic change. This is where "hundreds of
compliant ads while we sleep" becomes "and the budgets manage themselves too," which
is the whole Fluency promise.

Most of the work here is already done — this is the permission layer and the safety
rails, not the engine.

### Step 4 — Client self-service copy edits (1–2 weeks)

Let a dealer contact update copy on their own ads through a restricted view. Cheap,
and it's the feature Chase talked about most warmly.

### Step 5 — Google, then more channels (ongoing, only if demand exists)

Google first, most likely by feeding our creative into campaigns that already exist
rather than building new ones. Beyond that, add channels when a client actually asks.

### Also needs attention, in parallel

- **Load capacity.** Everything above is about correctness, and correctness is in good
  shape. Volume is the untested part. Our current server setup is modest and also
  does its own software builds, which competes with serving live traffic. Worth
  addressing before we're launching hundreds of ads a night across many locations.
- **The compliance rule library.** We built the compliance engine, but the actual
  manufacturer rules still need to be entered from the real guideline documents. Until
  they are, the system correctly reports "no manufacturer rules were checked" on ads
  it produces — accurate, but not the value we want to be delivering.

---

## The thing to take into client conversations

Chase's argument for why his agency bought this: grow without hiring, improve margin,
and credibly bid on work you used to walk away from because you couldn't staff it.

That is exactly the argument Loomi should make to a dealer group. And we can make it
more credibly than Fluency can, because we don't have to spend the first ninety days
organizing anybody's spreadsheets before we start.
