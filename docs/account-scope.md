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
Contacts, audiences, campaign recipients, reporting. Merging unrelated
businesses here is meaningless at best and a data-handling problem at worst. The
roll-up unit is the GROUP, which already does exactly this: YAG rolls up its
rooftops and gives you the full roster across them.

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
| Playbooks audit | all-accounts + per-account | in progress |
| Campaign list | all-accounts | candidate, not built |
| Templates / Flows / Assets browsing | all-accounts | candidate, not built |
| Contacts, audiences, reporting | group only | deliberate, not a gap |
