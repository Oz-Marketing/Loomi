# Should we scrap Loomi's Ad Studio for Adobe GenStudio or The Brief?

**Written:** August 2026
**Question asked:** the team is pushing to replace Loomi's ad builder with Adobe
GenStudio or The Brief (thebrief.ai). Is that the right call?
**Audience:** the Loomi team. No technical background assumed.

---

## The short version

**No — but the team is right about something, and dismissing them would be a
mistake.**

Loomi's "ad builder" is two products wearing one coat:

1. **A design canvas** — the thing a person opens, drags a headline around in, and
   picks a font. Roughly two months old, one developer.
2. **An offer-to-ad engine** — the thing that reads a dealer's live inventory feed,
   polls manufacturer incentive programs, picks which offer is worth advertising,
   checks it against co-op rules, resolves the legal disclaimer, and builds the ad
   overnight without anyone present.

**The team is comparing #1 and reaching a verdict on #2.** On the design canvas
alone, they're correct: The Brief is better than us and always will be. On the
engine, neither GenStudio nor The Brief has anything at all, and never will,
because neither has a commercial reason to learn what a Silverado 2500HD is.

Scrapping the whole thing would throw away the only part that is actually hard.

But there is a third option nobody has put on the table, and it's a good one:
**keep the engine, rent the canvas.** The Brief sells an embeddable version of
their editor designed to sit inside another company's product. That is worth a
serious look.

---

## What your team is actually reacting to

Before anything else: find out which complaint you're hearing. They're very
different problems.

- *"The canvas is frustrating to use"* — legitimate, fixable, and not an argument
  for scrapping anything.
- *"We can't do things these tools can do"* — mostly legitimate (see below), and
  the embed option addresses it directly.
- *"Why are we building design software at all?"* — the sharpest version of the
  criticism, and honestly the fair one. We shouldn't be. That's the case for the
  embed.
- *"These tools would replace the whole Ad Generator"* — this one is wrong, and
  it's the one to push back on.

If the feedback has been arriving as a general "we should be using these instead,"
it is probably all four tangled together.

---

## What each product actually is

### Adobe GenStudio for Performance Marketing

An enterprise content factory for large brand marketing teams. You give it brand
guidelines and locked Adobe Express templates, and it mass-produces on-brand copy,
image and video variants using Firefly, Azure OpenAI, Google's image models and
Veo — then reports on how the variants performed.

Sold by custom enterprise quote only. A base license covers 10 power users, 20
collaborators, 5 brands, 2 TB of storage and 60,000 AI generations a year.

**Who it's for:** a national brand that needs 400 on-brand variants of one campaign
for 12 markets. **Who it isn't for:** a dealer group that needs one legally
defensible ad about a lease offer that expires in nine days.

### The Brief (thebrief.ai)

A genuinely impressive modern ad production tool. Four AI "agents" — Discover
(research what competitors are running), Create (generate ads), Launch (publish to
40+ ad networks), Optimize (analyze and recommend). Plus a real design workspace:
timeline animation, AI resize, bulk edit across a hundred ads at once, one-click
localization, PSD and Figma import, background and object removal.

Pricing is public and reasonable: free tier, $49/mo Pro, $79/mo Team, custom
Enterprise.

**This is the serious one.** GenStudio is not really in the conversation.

---

## Where they genuinely beat us

This list is honest, and the team deserves to see it acknowledged.

| | Loomi today | The Brief |
|---|---|---|
| AI image generation | ❌ None | ✅ Multiple models |
| Background / object removal | ❌ None | ✅ Yes |
| PSD / Figma import | ❌ None | ✅ Yes |
| Timeline animation editor | ⚠️ Video layers, no timeline | ✅ Full editor |
| Edit many ads at once | ❌ One at a time | ✅ 100 at once |
| Auto-translate / localize | ❌ None | ✅ One click |
| Competitor ad research | ❌ None | ✅ Discover agent |
| Publishing destinations | ⚠️ Meta only, always paused | ✅ 40+ networks |
| Who maintains it | Us | Them |

That last row is the real argument. Every hour spent on gradient stops and corner
radii is an hour not spent on the parts of Loomi nobody else can build.

---

## Where they can't follow us

None of the following exists in either product, and none of it would ever be built
by a general-purpose creative tool — there's no market in it for them.

**We know the car business.** Live dealer inventory feeds, manufacturer incentive
polling, trim-level offer matching, EVOX vehicle photography. One Chevrolet
financing program covers a 2500HD and a 3500HD but not a 1500 — the kind of thing
you only learn by doing this work.

**Our compliance is about money, not tidiness.** When The Brief says "brand-safe,"
it means the ad matches your brand kit. When we say compliant, we mean the ad won't
get a co-op reimbursement claim rejected weeks later when it's too late to fix. We
check each ad against manufacturer advertising rules, record which version of the
rules we checked against, and notice when a manufacturer reissues a guideline
document.

**Legal disclaimers resolve automatically.** Not a text box someone remembers to
fill in.

**It runs unattended, carefully.** Ads whose offer expired are retired before new
ones are built. An offer we've already advertised updates the existing ad instead
of duplicating it. Every day it *doesn't* build something, it records why. It ran
in observe-only mode before it was allowed to produce anything.

**AI drafts, rules decide.** Ad copy is drafted by AI, then every number in it must
appear in the actual offer data or the draft is thrown away and a rule-built caption
is used instead. An invented "$199/mo" is false advertising. We made that
structurally impossible rather than trusting a model.

**It's in the same building as everything else.** The ads sit next to the budget
pacer, the reporting, the contacts, the campaign records. An ad The Brief makes is
a file you then have to carry somewhere.

**Also worth saying plainly:** the design canvas is not primitive. It has layers
and groups, multi-artboard editing across 18 ad sizes with independent per-size
layouts, multi-stop gradients, blend modes, image cropping with per-size focal
points, conditional elements, custom and Google fonts, and video backgrounds with
MP4 export. It is genuinely missing the AI-assisted and bulk features above. It is
not missing the fundamentals.

---

## The option nobody has put on the table

**The Brief sells their editor as something you embed inside your own product.**

Their "Extend" offering gives you the Ad Studio running inside Loomi, behind our
own login, with:

- Toolbar items you choose to show or hide
- Brand kits restricted to the account the user is actually in
- Their publish-to-Meta and publish-to-Google buttons switchable on or off
- An API to generate assets from a template with data we supply
- White-label branding

That maps almost exactly onto the split we want: **their canvas, our brain.**

Loomi keeps doing the part that's hard and defensible — reading inventory, picking
the offer, clearing co-op, resolving the disclaimer, running overnight, tracking
the budget. The Brief handles pixels, AI imagery, resizing and animation. The team
gets the tool they're asking for. We stop maintaining design software.

### What has to be true for this to work

Four questions, in order of how likely they are to kill it:

1. **Can their templates be driven by our data?** Our engine's whole output is
   structured offer data — payment, term, due at signing, expiration, disclaimer,
   vehicle photo. If their template API accepts that and reliably places it, this
   works. If it needs a human in the loop, it doesn't.
2. **Can it run unattended, nightly, reliably?** Our pipeline builds ads at 3am with
   nobody watching. That becomes a dependency on their uptime and their rate limits.
3. **Do we lose our render guarantee?** Today the preview a designer sees and the
   exported PNG and the exported MP4 come out of the same renderer, so they are
   identical by construction. That guarantee goes away.
4. **What does it cost at our volume?** Public pricing is per-seat and modest.
   Enterprise API and white-label pricing is quote-only, and per-generation pricing
   across many rooftops running daily is a different shape of bill entirely.

Questions 1 and 2 are answerable in a two-week trial. Don't guess at them.

---

## The two jobs, and why they invert the answer

The Ad Generator gets used for two completely different jobs, and almost every
part of this decision changes depending on which one you're talking about.

### Job 1 — OEM incentives, automated monthly

A designer builds a template once. From then on the engine fills it: it reads the
inventory feed, polls the manufacturer's incentive program, picks the offer,
clears co-op, resolves the disclaimer, and builds the ad overnight.

**The canvas is touched rarely, by one person.** After setup, the design work is
approximately zero. All the value is in the engine.

### Job 2 — in-store offers, events, service, hiring

Someone sits down and makes an ad. Then next week they do it again. There is no
feed to poll, because nobody publishes a machine-readable list of your oil-change
coupons or your tent sale.

**The canvas is touched constantly, by the whole design team.** All the value is
in the canvas.

### What follows

Your design team's frustration is concentrated in Job 2 — precisely the job where
Loomi's engine contributes least and the drawing tool contributes most. That is
why the complaint feels so total to them and so wrong to you. **You are both
describing different halves of the product and using the same name for it.**

---

## Correction: Loomi already supports Job 2 — mostly

This is worth checking before anyone buys anything, because the premise that
"Loomi can't really support those today" is mostly out of date. The **custom offer
kind** shipped on 20 August 2026 — four days ago — and it was built for exactly
this list: *service, parts and accessories, hiring, events, sell-us-your-car,
sponsorships, a new location.*

**What is already built and working:**

- A 25-field schema for non-vehicle offers — headline, subheadline, body, CTA,
  what's on offer, price, regular price, minimum spend, coupon code, redemption
  limit, exclusions, part number, availability, expiration, states, disclaimer.
- Five offer types: flat price, percent off, dollars off, a phrase, or **no offer
  at all** — that last one is what carries an event or hiring ad.
- **Savings figures are derived, never typed.** There is deliberately nowhere for
  a person to enter "SAVE $50," because the classic coupon failure is a savings
  claim that doesn't subtract. The engine computes it from the regular price.
- **Manufacturer co-op rules still apply.** Service and parts co-op is real
  reimbursement money with real prohibited language, keyed by brand — so the
  custom kind deliberately keeps manufacturer checking while dropping the
  year/model/trim picker. A Now Hiring ad is never asked for a VIN.
- Its own disclaimer token map, separate from the vehicle one.

**What is actually missing — three things, and only one is real work:**

1. **There are no templates.** The shipped library offers exactly two layouts,
   both vehicle offers. Every custom-offer ad has to be drawn from scratch. This
   is the entire practical gap, and it is a designer-week, not an engineering
   project.
2. **Legal text hasn't arrived.** Service and parts disclaimer bodies, and whether
   service co-op prohibits different language than vehicle co-op, are outstanding
   asks to the Oz Co-op team. Not blocked on engineering — the engine accepts them
   the moment they exist.
3. **No unattended automation, permanently and correctly.** Nothing publishes a
   feed of in-store offers, so a human enters them. That will be true in The Brief
   too.

So the honest state of Job 2 is: **the plumbing is in and the taps aren't
installed.** Build three to five custom-offer templates before concluding Loomi
can't do this — it may dissolve a large share of the complaint for a week of
design work.

That said, it does not dissolve all of it. Even with a full template library, Job 2
is still someone drawing an ad by hand every week, and The Brief is still better at
that than we are.

---

## So can they tie into Loomi? Yes — at three levels

Take them in order. Each is useful on its own, and each is a decision point rather
than a commitment to the next.

### Level 1 — Run in parallel (this week, zero engineering)

The team uses The Brief for non-OEM ads, exports the finished creative, uploads it
to Loomi's media library, and launches through Loomi's existing Meta path. Budget
tracking and reporting still work, because those key off the campaign, not off how
the pixels were made.

**What you lose:** those ads skip the disclaimer engine and the co-op check
entirely. For a tent sale that's an annoyance. For a Toyota service coupon it's a
rejected reimbursement claim. That cost is the reason Levels 2 and 3 exist.

### Level 2 — Embed their editor inside Loomi (weeks)

The Brief's Extend puts Ad Studio inside Loomi behind your own login, with brand
kits scoped to the rooftop the user is actually in and toolbar items you choose.
Custom-offer ads open in their canvas; OEM template authoring stays in yours.

**This is the version worth scoping properly.** The team gets the tool they're
asking for without anything leaving Loomi, and the ads stay Loomi records.

### Level 3 — Push Loomi's data into their templates (needs their answer)

Their template-generation API accepts dynamic inputs. If you can push a custom
offer's resolved fields — including the composed disclaimer — into a Brief
template, then non-OEM ads keep compliance too, and Level 1's one real problem
goes away.

**This is the question to put to their sales team,** and it's a better question
than "what does it cost."


---

## Recommendation

**Adobe GenStudio: pass.** Wrong product, wrong buyer, wrong price. It's built for
brand marketing teams producing variant volume, priced by enterprise quote, and it
would drag Adobe Experience Cloud gravity along with it. Nothing in it addresses a
dealer's actual problem.

**The Brief: pilot it for Job 2 only, and scrap nothing.**

0. **First, build three to five custom-offer templates.** A designer-week. It's the
   cheapest possible test of how much of the complaint is "Loomi can't do this" versus
   "Loomi's canvas is worse," and you cannot tell those apart until the templates exist.
1. Take the free tier this week and let the two loudest people on the team build a
   few real in-store and event ads in it. Half the complaint may be about our canvas
   specifically, and half may be about wanting AI imagery — those lead different
   places.
2. In parallel, get on a call with their Extend/enterprise team with questions 1–4
   above written down. Ask specifically about template generation from an API with
   dynamic inputs, and about their "feed tool."
3. If 1 and 2 come back clean, plan the swap deliberately: their canvas replaces
   our builder page, our engine stays exactly as it is. That's a contained change,
   not a rebuild.
4. If they don't come back clean, we've lost two weeks and gained a real feature
   list to prioritize against — AI imagery, background removal, and bulk editing
   would be the three to take seriously.

**Either way: stop treating the design canvas as a strategic asset.** It isn't one.
It was built because we needed something to render with, and it does that job well.
If somebody else will maintain it for a monthly fee, that's a good trade. The
strategic asset is everything behind it, and that isn't for sale from anyone.

---

## How to take the criticism

The team is telling you something true — that our design experience isn't
competitive with tools built by companies who do only that. They are right, and
they should keep saying so.

They're reaching the wrong conclusion because they can only see the half they
touch. Nobody on the creative side ever watches the pipeline decide that a Mazda
lease offer has eleven days left, clear it against Mazda's co-op rules, and build
the ad at 3am. That work is invisible by design, which makes it very easy to
propose deleting.

The productive move is to say yes to the half they're right about — and to show
them the half they've never seen.
