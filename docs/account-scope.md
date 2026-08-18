# Account scope — what "all accounts" means, and when to offer it

Which roll-up a page should use, and why the answer is a property of the PAGE
rather than of the surface it sits on. Written 2026-08-18, when Playbooks became
the first Studio page that is genuinely cross-account.

## The scopes that exist

| Scope | `AccountType` | Rolls up | Set by |
| --- | --- | --- | --- |
| One account | `{ mode: 'account' }` | itself, plus its descendants | the account switcher |
| A group | `{ mode: 'account' }` on a parent | the parent and every rooftop under it | the account switcher |
| All accounts | `{ mode: 'all' }` | every account the session may see | "All accounts" in the switcher |
| Unresolved | `{ mode: 'admin' }` | — | never chosen; the pre-resolution state |

A group is not a separate mode. Selecting Young Automotive Group IS
`mode: 'account'` on the YAG key, and `scopedAccountKeys` fans it out to the
whole subtree. `isGroup` is "this account has children", which is why it reads
false when nothing is selected.

`admin` is not a scope anyone picks — it is the state before the account list
lands, and it always resolves away. Only `all` is a deliberate destination.

## The rule

The agency's book of business is not one organization. It contains Young
Automotive Group and its rooftops, and it also contains PJF Corp, Burton Family
Law, and other clients with nothing to do with each other. So "all accounts"
means *everything this agency manages*, across unrelated businesses.

That makes it right for some pages and wrong for others, and the split is not
per-surface:

**Views about OUR OPERATIONS — offer all-accounts.**
The Playbooks coverage audit, campaign lists, run history, feed health, "what is
misconfigured across the book of business". Unrelated clients sitting side by
side is *the point*: "which of my 36 accounts has no sender identity" is a good
question that spans a car dealer and a law firm without embarrassment. You are
looking at your own work, not a client's data.

**Views about A CLIENT'S DATA — group only, never all-accounts.**
Contacts, audiences, campaign recipients. Merging unrelated
businesses here is meaningless at best and a data-handling problem at worst. The
roll-up unit is the GROUP, which already does exactly this: YAG rolls up its
rooftops and gives you the full roster across them.

Reporting sits across the line and is worth calling out: it now offers
all-accounts, and the reports carrying a roll-up config render one. The rest
still ask for a single account. So "does this surface offer the scope" and "can
this particular view aggregate" are separate questions there — see REPORTS
WITHOUT A ROLL-UP.

### The test

> If two unrelated clients' rows sat next to each other in this list, would that
> be **useful** or **alarming**?

Useful → the page may offer all-accounts. Alarming → group only.

### Why this dissolves the obvious objection

The worry that reaches for a fourth scope is: "all accounts rolls up YAG *and*
PJF Corp, which I never want together." True — and it never happens, because the
pages where mixing would hurt do not offer the scope. Contacts uses the group.
Groups are the client-data roll-up; all-accounts is the ops roll-up. They are
different tools and they do not compete, so neither needs to grow a filter to
imitate the other.

This replaces the earlier reasoning, which excluded all-accounts from Studio
*wholesale* because Contacts could not aggregate meaningfully. That was the right
instinct applied at the wrong granularity: the problem was Contacts, not Studio.

## The second axis: a group as an entity vs. a group as a parent

Everything above answers *which accounts am I looking at*. There is a second,
independent question, and conflating the two wastes time:

> When I select a group, do I mean the group ITSELF, or the group and everything
> under it?

That question exists because of a deliberate schema decision. From `Account`:

> A group like Young Automotive Group is BOTH a marketing entity (it sends its
> own email/SMS/ads) and a parent that rolls up rooftops. Modelling the group as
> its own Account with children captures both, so there's no "org mode" that has
> to borrow a child account to do its own work.

There is no house/primary child holding YAG's own data — YAG's contacts live on
the YAG row. So the group row is genuinely ambiguous, and something has to
disambiguate it. Today that is the **Roll up / Just this** control on the
selected group in the account switcher, which sets `isRollup`.

**The all-accounts work does not remove the need for this.** They are different
axes: all-accounts widens past any one client, and this one narrows within one.
Do not read the two as redundant — the obvious-looking simplification here is
wrong, and this section exists because it nearly got made.

### The Contacts filter already expresses it

`ContactsAccountFilter` (`src/components/contacts/contacts-toolbar.tsx`) is fed
`accountOptions` derived from `scopedAccountKeys`, and `descendantsOf` starts at
the root key — so the GROUP ITSELF is in that list alongside its children:

| Selection | Means |
| --- | --- |
| nothing selected | group + children — the roll-up |
| the group alone | the group as an entity — "Just this" |
| a child | that rooftop |
| any subset | something a two-state toggle cannot express |

So on Contacts the switcher toggle is redundant, and the dropdown is strictly
more capable.

### Why it is still not safe to just delete the toggle

`isRollup` is consumed by **22 files** — 17 Reporting pages, Projects calendar
and tasks, and the three Contacts pages. Reporting branches on it to decide
whether to render a roll-up or ask for a single account. Removing the control
would leave every one of those with no way to reach a group's own numbers.

Replacing the toggle therefore means lifting a per-page account filter into a
shared control and adopting it on those pages — not deleting a button. Worth
doing, probably; cheap, no.

### Label collision to fix regardless

The in-page filter says **"All accounts"** meaning *all accounts in the current
scope*. The switcher now says **"All accounts"** meaning *every account the
agency manages, across unrelated clients*. Since Playbooks put the switcher
option on Studio, both can be on screen at once, meaning different things.
Rename the in-page one — "All in group", "All rooftops" — whatever happens to
the toggle.

## It can split inside one tool

Campaigns is the clear case:

| | Scope | Why |
| --- | --- | --- |
| Campaign **list** | all-accounts allowed | operational — what is running where |
| Campaign **builder** | one account required | you cannot compose a send to "everyone we manage" |

So "Campaigns supports all accounts" means the list does and the editor still
demands a selection. The same shape applies to Templates, Flows, and Assets:
browsing is operational, authoring is per-account.

## How a page opts in

`ALL_ACCOUNTS_SURFACES` in `src/contexts/account-context.tsx` lists whole
surfaces (`app`). `ALL_ACCOUNTS_PATHS` lists individual pages that are
cross-account even though their surface is not — Playbooks is the first.

Opt in per page rather than per surface. Adding `'studio'` to the surfaces list
would offer the scope on every Studio page at once, and most of them would render
"pick an account" with nothing selected.

There is also a concrete hazard that opt-in removes by construction: if
all-accounts were available across Studio, someone eventually lands on Contacts
in that scope and exports a list mixing a dealer's customers with a law firm's
clients. A path list makes that impossible; a surface list makes it a thing
everyone has to remember.

`allAccountsSurface()` is what both the switcher (whether to show the option) and
the auto-resolve effect (whether to snap back to a real account on navigation)
read. So a page that has not opted in cannot be *reached* in all-accounts scope
either — navigating to it returns you to an account rather than leaving it empty.

## Server side

Client scope is a request input, never a permission. An endpoint takes the keys
it is asked for and INTERSECTS them with what the session may see
(`filterAccountKeysByAccess`), so a hand-written query cannot widen anyone's
reach. Omitting the parameter means "everything I'm allowed to see", which is the
all-accounts case and is already bounded by the same filter.

## Status

| Page | Scope | State |
| --- | --- | --- |
| Projects (App surface) | all-accounts | shipped |
| Reporting | all-accounts | shipped; reports gate on `isRollup` |
| Playbooks audit | all-accounts + per-account | shipped |
| Campaign list | all-accounts | candidate, not built |
| Templates / Flows / Assets browsing | all-accounts | candidate, not built |
| Contacts, audiences, lists, segments | group only | deliberate, not a gap |

Second axis (group as entity vs. parent):

| Piece | State |
| --- | --- |
| `Roll up` / `Just this` in the switcher | shipped; sets `isRollup`, read by 22 files |
| Contacts account filter | shipped; already expresses self / roll-up / subsets |
| A shared filter for Reporting + Projects | not built — the prerequisite for retiring the toggle |
| Renaming the in-page "All accounts" label | done — reads `All N accounts`, so the count distinguishes it from the switcher's |
