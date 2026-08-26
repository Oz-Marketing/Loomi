# Specialist agents

Replacing the single global Knowledge Base with a roster of per-sector specialists —
each one a master of its own realm, managed by the team that owns that realm.

Status: **Phase 0 built** (`src/lib/ai/agent-runtime.ts`); the rest is proposal.

**Decisions locked (2026-08-25)**

- **Agency staff only** build and manage agents in v1. Clients use what they're given.
- **Owner scope goes on the model now**, so per-account agents are later a config change
  rather than a migration.
- **First-party specialists first** — co-op, email, and the rest. The custom-agent builder
  is designed for throughout but deliberately not built yet.
- **Advisory specialists reason freely and label their claims**; they do not inherit the
  Ad Gen compliance engine's cite-or-fail posture. See "Two grades of AI".

---

## The problem with one knowledge base

Today there is exactly one body of curated knowledge and one assistant that reads it:

- `AppSetting['loomi-knowledge']` — a ~400-line hand-written markdown blob, edited in
  Agency Settings → Knowledge Base, gated by `agency.knowledge.manage`.
- `getChatSystemPrompt()` (`src/lib/ai-knowledge.ts`) pastes that blob, plus an
  auto-generated "dynamic data" section, into one system prompt.
- `/api/ai/chat` serves the floating bubble with it. No tools, no retrieval, no memory
  beyond the last 10 turns.

Three things are wrong with that shape, and they get worse as Loomi grows:

1. **One blob can't be owned.** The co-op team knows co-op. The pacing team knows
   pacing. Neither can edit "the knowledge base" without reading past everyone else's
   section and risking a change that degrades an unrelated answer. So in practice
   nobody edits it, and it goes stale.
2. **It duplicates things the code already knows.** The component catalog is in the
   blob *and* generated into dynamic data. Every fact typed by hand into that file is a
   fact that will eventually contradict the database.
3. **Depth is capped by the context window.** The genuinely valuable knowledge — 33
   co-op PDFs, live spend, template check results — is far too large to paste, and
   pasting is the only mechanism the current design has.

Meanwhile the pieces of a much better answer are already in the repo.

## What already exists

| Piece | Where | What it gives us |
|---|---|---|
| A real tool-using agent loop | `src/app/api/flows/[id]/ai/chat/route.ts` + `src/lib/ai/flow-tools.ts` | 11 tools, a bounded `tool_use` loop, an executor. This is the prototype for everything below. |
| The co-op corpus, already ingested | `AdGuidelineDoc.pageText` / `.sections` (per-page JSON), keyed by make | A searchable, citable document store — no ingestion project needed. |
| Machine-checkable co-op rules | `AdCoopRulePack`, `AdTemplateCoopCheck`, `AdTemplateCoopApproval` | Deterministic answers an agent can *call* rather than guess. |
| A document reader with page deep-links | `src/components/ad-generator/guideline-reader.tsx`, `guideline-search.ts` | Somewhere for a citation to land. |
| Sector-scoped permissions | `src/lib/permissions/registry.ts` — incl. `agency.coop.manage` | The co-op team is already a distinct, addressable owner. |
| Per-sector settings rails | `settings-registry.ts` (`rail: 'sector'`) | A place to hang each specialist's management UI. |

So this isn't a from-scratch build. It's generalizing one existing agent and pointing it
at data that is already sitting in Postgres.

---

## What a "specialist" is

A specialist is six things. Almost all of them are composable in a UI — that composition
surface *is* the agent builder, and it's the competitive part of this:

| # | Part | Composable? | Example (Co-op specialist) |
|---|---|---|---|
| 1 | **Identity** — name, icon, blurb, where it appears | Yes | "Co-op", shown in Agency + the Ad Gen builder |
| 2 | **Instructions** — its brief, voice, how it thinks | Yes | "You are the agency's co-op expert. Think hard. Reason across documents." |
| 3 | **Depth** — model + effort + verbosity | Yes | Opus 5, effort `high`, long-form answers |
| 4 | **Knowledge** — documents in scope + curated notes | Yes | Chevy/Subaru/Mazda guideline PDFs + the team's own house notes |
| 5 | **Capabilities** — which tools it may call | Yes, from a catalog | `search_guidelines`, `get_rule_pack`, `list_sales_events` |
| 6 | **The tools themselves** | **No — code** | Each tool is a function with a permission check baked in |

**Build the builder.** Row 6 is the only thing users can't author, and that's not a
limitation worth designing around — it's the same shape every competitor ships. monday,
Intercom, Agentforce, Breeze all give you a catalog of platform capabilities and let you
compose agents from them. The catalog is the moat: every tool we add makes every agent
anyone builds more capable. A builder without a tool catalog is a prompt library; a tool
catalog without a builder is what we have today.

An earlier draft of this document argued against a builder. That was wrong — it took the
one true constraint (tools are code) and over-generalized it into "don't let people
compose agents," which throws away the most valuable surface here.

### Loomi AI is the system; specialists have names

The generalist is **Loomi AI** — the product's own voice, keeping the sparkle mark the
assistant has always had. It has no name and no face on purpose, because a name and a
face appearing in that slot is exactly the signal that you have stopped talking to the
product and started talking to somebody in particular: Vera, for co-op.

(The generalist was called "Iris" until 2026-08-25. A proper noun on the system assistant
made the named specialists read as peers of the platform itself rather than as experts
within it, and it left nothing distinctive for a specialist to claim. Renamed across all
user-facing copy and every system prompt; internal identifiers were left alone.)

The panel follows the same rule. It is one surface, and its header swaps between
`Loomi AI + sparkle` and `<name> + avatar` based on which agent owns the current page —
so there is never a question of which one you're addressing.

### The three things that stay code-owned

Not because composition is dangerous in general, but because these three fail in ways a
user can't see:

1. **The tool catalog.** A tool is code that queries Postgres under a permission check.
   Users pick from the catalog; they don't write entries in it.
2. **Permission inheritance.** An agent can only ever *narrow* what its user can already
   do, never widen it. The builder cannot grant scope. Otherwise "build an agent that can
   see all accounts" becomes a privilege-escalation button with a friendly icon.
3. **Act vs. advise.** Whether an agent may *write* is a property of the tools it's given,
   granted deliberately — not something a free-text instruction can talk its way into.

Everything else — including how deeply it thinks, how it talks, and how willing it is to
reason past the literal text — is a setting, not a law.

## Two grades of AI, and why co-op needs both

The single most important distinction in this document, and the one an earlier draft got
wrong by collapsing the two:

|  | **Gating AI** | **Advisory AI** |
|---|---|---|
| Example | The Ad Gen co-op compliance check | The Co-op specialist in conversation |
| Who reads the output | A machine, then thousands of published ads | One person, right now, who asked |
| Failure cost | A wrong permissive rule silently ships non-compliant ads across a brand's whole month | A weak suggestion the reader can weigh, with the citation in front of them |
| Correct posture | Deterministic, conservative, cite-or-fail, blocks | Conversational, deep-thinking, synthesizes, infers |

**The conversational co-op specialist must not inherit the compliance engine's rules.**
Gate-grade conservatism in a chat window produces an assistant that answers "that isn't in
the guidelines" to almost everything — technically defensible and completely useless. The
whole point of a specialist is that it reasons: compares two makes' rules, notices that a
program's language changed between editions, says *"the guidelines don't address
co-branded lockups directly, but §4.2's exclusivity language implies it wouldn't qualify —
worth confirming with your rep."* That sentence is genuinely valuable and no
deterministic engine will ever produce it.

So the requirement isn't *refuse without a citation*. It's **be explicit about which mode
each claim is in**:

- **Quoted** — here is the text, here is the page (linked).
- **Derived** — the rule pack says this, and it was transcribed from that page.
- **Inference** — the documents don't say this; here's my reasoning and what would
  confirm it.
- **Not covered** — nothing on file addresses this; here's who to ask.

That's a labeling discipline, not a muzzle. It preserves the thing that makes the answer
trustworthy (you can always see what it's standing on) without capping how hard it thinks.

### The one hard boundary

**Advisory output must never silently become gating input.** A conversation can conclude
that an ad looks compliant; that conclusion cannot approve a template, authorize a claim,
or write into `AdTemplateCoopApproval`. Crossing back into the gate requires the
human-accepts step that path already has. That's the real line — not "the agent must be
timid."

## The Co-op specialist, concretely

The first specialist to build, because it has the richest existing substrate and the
clearest owner.

**Tools** (all read-only, all running as the calling user):

```
search_guidelines(make, query)     → page hits + snippets from AdGuidelineDoc.pageText
read_guideline_pages(docId, pages) → full text of specific pages
get_rule_pack(make)                → the transcribed CoopRulePack, incl. verified flag
check_template(templateId)         → the existing deterministic check result
list_sales_events(make, window)    → the campaign mark and its window
list_guideline_docs(make)          → what's on file, hash status, last change
```

Note what these are: thin wrappers over engines that already exist and already have
tests. The agent's job is to *choose* which one to call and explain the result — not to
re-derive compliance in prose.

**Citations are the feature, not a nicety.** They come from `search_guidelines`, which
returns `{docId, page, snippet}` — the UI renders each as a link straight into
`GuidelineReader` at that page, where the reader already highlights the matched text.
The corpus searched is `AdGuidelineDoc.pageText`, which is already extracted and sitting
in Postgres.

**Not** by attaching the PDFs as `document` blocks with the API's native
`citations: {enabled: true}`. An earlier draft of this document proposed that and called
it the same thing as the quote-verification pattern chosen for the AI-drafted compliance
work. It is not the same thing, and it does not work here:

- Those are different mechanisms. Ours is *the model returns a quote, our code verifies
  it against stored text*. The API feature is *Anthropic grounds the answer in bytes we
  upload*. Only the first leaves the verification in our hands.
- The largest guideline PDF on file (Kia, ~35 MB) exceeds the 32 MB request cap once
  base64-encoded. It cannot be attached at all.
- Native citations are incompatible with `output_config.format` — a request with both
  returns a 400 — which would foreclose structured output from a specialist turn.
- We have already parsed these documents. Re-uploading them to have them parsed again is
  strictly more expensive than searching the text we stored.

A make has 1–3 documents, so the working set is small. Scope by make; never load all 33.

**Searching needs to tolerate extraction order.** PDF text extraction follows glyph
position, not reading order, so a pull-quote beside a paragraph lands *inside* the
sentence: Mazda §5a extracts as `...must be used once and should be(top placed
prominently in the ad.` Plain substring matching — what `guideline-search.ts::findHits`
does today — returns nothing for the sentence as a human would read it. The co-op
drafting branch has a tolerant bounded-subsequence matcher (`guideline-quotes.ts`) that
returns offsets into the ORIGINAL page text, which is exactly what `matchBoxes` needs to
draw a highlight. `search_guidelines` should move onto it when that branch lands;
`findHits` is the interim.

**Not every registered document is searchable.** The `.docx` guidelines never went
through the PDF text pipeline and have no `pageText`. A brand whose only document cannot
be searched must never read as a brand with no rules, so the tools report "no text
extracted" as a distinct state from "no matches".

**Unreviewed drafts are not facts.** The compliance branch adds AI-drafted rules to
`AdCoopRulePack.rules` carrying a `reviewState`; a `proposed` rule is a machine's
suggestion no human has checked. `get_rule_pack` filters to accepted rules only and
reports the rest merely as a count awaiting review. This is the mirror of the boundary
below: advisory output must not become gating input, and unreviewed gating drafts must
not become advisory truth. The long-term home for this is a shared
`loadAcceptedCoopPack()` accessor owned by the compliance branch, so it is impossible to
get wrong rather than a rule someone has to remember.

**Curated notes and disclaimer addenda must never share an input.** `AgentProfile.notes`
is advisory prose Vera may reason from. Per-make disclaimer addenda are cited clauses
appended to live ad copy. The same team writes both and both live under co-op settings,
so a tidy-minded merge into one "co-op notes" box is a real risk — and it would put
unreviewed prose into legal text on published ads.

**Guardrail, stated as a labeling rule rather than a refusal rule:** the specialist may
reason freely and infer — it just has to say which mode it's in (quoted / derived /
inference / not covered), per the two-grades section above. An unverified rule pack is
described as unverified, matching how the deterministic engine already downgrades it.
Depth is a setting on the profile, and for co-op it should be turned up: Opus 5 at
`effort: 'high'`, long-form answers, encouraged to compare documents and think across
editions.

**What the co-op team manages** (Settings → Agents → Co-op):
- The specialist's instructions (versioned, with who changed what).
- Curated notes — the things not in any PDF: rep guidance, verbal exceptions, known
  rejections, "this program ended in March regardless of what the doc says."
- Which documents are in scope, and their caveats.
- The feedback queue: any answer a user marked wrong, with one click to turn the
  correction into a curated note.

---

## Architecture

```
src/lib/ai/agent-runtime.ts        the loop, extracted from the flow route
src/lib/ai/specialists/
  registry.ts                      code-owned specs: id, sector, model, tools, guardrails
  coop.ts  studio.ts  pacing.ts    one file per specialist
src/app/api/agents/[id]/chat/route.ts
```

**`agent-runtime.ts`** is the flow route's loop with the flow-specific parts pulled out:
take a spec, a conversation, and a tool executor; run until `stop_reason !== 'tool_use'`
or the iteration cap; return the reply plus whatever actions the executor produced. The
flow builder's Iris becomes its first consumer, which proves the abstraction against
working code before any new surface depends on it.

**New Prisma models** (small, four of them):

```prisma
model AgentProfile {
  id String @id @default(cuid())

  /// Non-null = a FIRST-PARTY specialist. The code registry owns its identity,
  /// tools and guardrails; this row carries only what a human may edit. Null =
  /// an agent composed entirely in the builder. Custom agents aren't built yet,
  /// so today every row has a key — but the column is what makes shipping them
  /// later an addition rather than a migration.
  specialistKey String? @unique

  name         String
  instructions String  @db.Text
  /// Curated notes: what isn't in any document. Rep guidance, verbal exceptions,
  /// known rejections. The reason a specialist beats reading the PDF yourself.
  notes        String? @db.Text

  /// Depth, as a SETTING rather than a hardcoded law — an advisory specialist is
  /// supposed to be turned up. low | medium | high | max.
  effort    String  @default("high")
  model     String?

  /// Which catalog tools this agent may call, and which documents it may read.
  /// Tools are picked FROM the catalog, never authored — see "three things that
  /// stay code-owned".
  toolKeys     String @db.Text // JSON string[]
  documentIds  String? @db.Text // JSON string[]

  /// WHO OWNS THIS AGENT. 'agency' is the only value v1 writes; 'account' is what
  /// per-rooftop agents will use. Present from the start deliberately: retrofitting
  /// an owner onto rows that already exist means backfilling a scope decision
  /// nobody recorded at the time.
  ownerScope      String  @default("agency") // agency | account
  /// Set only when ownerScope = 'account'.
  ownerAccountKey String?

  isActive  Boolean @default(true)
  createdBy String?
  updatedBy String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([ownerScope, ownerAccountKey])
}

AgentProfileRevision  // full history — a compliance assistant's instructions are a record
AgentConversation     // userId, accountKey, agentProfileId, surface
AgentMessage          // role, content, tool calls made, citations returned, token usage
AgentFeedback         // thumbs, the correction text, promoted-to-note flag
```

**A permission never comes from this row.** `toolKeys` can only ever narrow what the
calling user could already do; each tool re-checks scope when it runs. An agent is a
lens on a user's own access, never a grant of someone else's.

`AgentMessage` storing the tool calls and citations is what makes a wrong answer
*diagnosable* — otherwise every complaint is unfalsifiable.

**Routing.** Keep one bubble. Pick the specialist deterministically from surface + route
+ account industry (Ad Gen pages → Co-op; pacing cards → Pacing; template editor →
Studio), show which specialist is answering, and let the user switch. Add a handoff
instruction — "if this isn't your realm, say which specialist to ask" — rather than an
LLM router. Deterministic is cheaper, debuggable, and never sends a co-op question to the
email assistant.

**Permissions — the part to get right.** The agent runs *as the user*. Every tool goes
through the same `requirePermission` and account-scope path as the equivalent API route;
no tool ever queries Prisma unscoped. Otherwise the first reporting specialist becomes a
way for a client user to read another rooftop's spend by asking nicely. Management uses
existing permissions where they exist: `agency.coop.manage` owns the co-op profile,
`agency.knowledge.manage` owns the shared house knowledge, and each new specialist takes
its sector's manage permission.

---

## What happens to the Knowledge Center

It isn't deleted — it's split three ways:

1. **Facts the code already knows** (component catalog, template lists, tags) — already
   generated into dynamic data. Delete the hand-written duplicates. This is most of the
   staleness risk.
2. **Studio/email judgment** — the bulk of the current blob, honestly, is about
   templates and email production. It becomes the Studio specialist's profile, and
   `getAssistantSystemPrompt`'s hard-coded rules move there too, where a human can edit
   them without a deploy.
3. **Platform-wide facts** — what Loomi is, surfaces, roles, sectors. This becomes
   **house knowledge**: a short shared prelude every specialist gets, still edited under
   `agency.knowledge.manage`.

The Settings tab changes from a single code editor to a roster: each specialist a row,
each row opening its own profile editor. Same tab key, same permission for the house
knowledge, one new permission check per specialist.

---

## Models, caching, cost

Current pins are `claude-sonnet-4-5-20250929` for most features and `claude-opus-4-7`
for the flow agent. Both are behind; a pass over `src/lib/anthropic.ts` is worth doing
with this work:

- **`claude-opus-5`** for tool-driven specialists — the reasoning headroom is what makes
  "which of these six tools answers this" reliable. Adaptive thinking (`{type:
  "adaptive"}`); `budget_tokens` and `temperature` are rejected on this family, which the
  flow route's comment already notes.
- **`claude-haiku-4-5`** for anything mechanical (classification, suggestion chips).
- Set `output_config.effort` per specialist: `high` for co-op, lower for chatty ones.

**Prompt caching is the entire cost story.** Structure every specialist prompt as:

```
[ stable prefix: house knowledge → profile → tools → corpus ]  ← cache_control here
[ volatile: account, page, date, the question ]                ← after the breakpoint
```

Get that ordering wrong and cost is roughly 10× higher for identical behavior. One
existing trap to avoid copying: `getAssistantSystemPrompt` injects today's date *before*
the knowledge base — in a cached design, volatile content must come last. Verify with
`usage.cache_read_input_tokens`; if it's zero on repeat questions, something in the
prefix is moving.

Order of magnitude with a make's PDF set cached: **a few cents per question.** Cap it
anyway — iteration limit (the flow route's 16 is a reasonable start), a per-conversation
token ceiling, and `usage` recorded on every `AgentMessage` so cost is visible per
specialist rather than as one line on the Anthropic bill.

**Managed Agents** was considered and isn't the right fit here: the tools are all
in-process reads of our own Postgres behind our own permission checks, and we want the
loop inside Next.js where the session lives. It becomes interesting later, for scheduled
autonomous specialists (see Phase 5).

---

## Risks, and what actually mitigates each

| Risk | Mitigation |
|---|---|
| **A confidently wrong co-op answer costs a real claim.** | Mode labeling (quoted / derived / inference / not covered) so the reader always sees what an answer stands on; unverified packs described as unverified; advisory output can never become gating input without the human-accepts step. Not a refusal rule — see "Two grades of AI". |
| **A user builds an agent that leaks or acts beyond its remit.** | The three code-owned constraints: catalog-only tools, permissions can only narrow, write access is a property of the tool not the prompt. |
| **Prompt injection from OEM PDFs.** These are third-party documents we did not write. | Document text is *data*: it goes in user-turn document blocks, never the system prompt, and can never trigger a tool or change instructions. |
| **Scope leak** — a client user reading another rooftop's data. | Every tool re-checks permission and account scope. No tool takes an accountKey from the model without validating it against the session's scope. |
| **The co-op team edits instructions and silently breaks good answers.** | Evals (Phase 3). This is the one that makes "managed by the team" safe rather than scary, and it's why profile editing ships *after* the specialist works. |
| **Cost runaway.** | Iteration cap, per-conversation ceiling, per-specialist usage recorded and visible. |
| **It becomes a chatbot nobody uses.** | Ship it where the work happens (the Ad Gen builder, the pacing card), not only as a floating bubble. Track feedback from day one. |

---

## Phasing

**Phase 0 — Runtime extraction. ✅ Built.** `src/lib/ai/agent-runtime.ts` — one
`runAgent()` loop taking a spec (prompt, tools, executor) and returning the reply plus
whatever the executor emitted. The flow builder's Iris is migrated onto it and behaves
identically. Caching, last-text-block reading, iteration capping and usage accounting are
handled once, in the runtime, so no specialist can get them wrong individually. 12 tests
cover the loop's silent-failure modes.

**Phase 1 — The Co-op specialist + profile storage.** *(in progress — tools, brief,
registry, route, and the panel/identity surface are built; profiles are not.)* The first-party specialist with the
richest substrate. Tools over the existing guideline and rule-pack stores; citations
deep-link into `GuidelineReader`. `AgentProfile` lands here (with `ownerScope`) so the
co-op team can edit instructions and notes without a deploy — that was the original ask,
and it's what makes the specialist theirs rather than ours. `agency.coop.manage` gates it.

**Phase 2 — The remaining first-party specialists.** Email/Studio (absorbing
`email-assistant`'s hardcoded rules into an editable profile), then Pacing/Reporting. Each
is a registry entry plus a tools file. The roster UI replaces the Knowledge Base tab here,
since there's finally a roster.

**Phase 3 — Evals.** A golden Q&A set per specialist, run on profile save and in CI. A
save that breaks a known-good answer is blocked, with the diff shown. This is what makes
"the co-op team manages it" safe rather than nerve-racking, and it must land before
non-engineers are editing prompts daily.

**Phase 4 — Grow the catalog.** From here the unit of work is *a tool*, not an agent:
every capability added multiplies across every agent. This is also where the first-party
specialists should become ordinary rows built from the same catalog a custom agent would
use — the honest test of whether the builder underneath is good enough.

**Phase 5 — The custom agent builder.** Compose an agent: instructions, depth, documents,
capabilities, audience. Unlocked rather than built from scratch, because Phases 1–4 built
every part of it. Flipping `ownerScope` to `'account'` is what opens it past agency staff.

**Phase 6 — Proactive specialists.** Run on the existing pg-boss cadence and write into
notifications instead of waiting to be asked: *"Chevrolet reissued their guidelines
overnight; three live templates cite the section that changed."* Where a specialist stops
being a chat window and starts being staff.

## Open questions

**Answered.** Who builds agents: agency staff only in v1, with `ownerScope` on the model
from day one. First-party specialists before the custom builder.

**Still open:**

1. **Which specialist follows co-op?** Email/Studio is the most-used surface and would
   absorb a pile of hardcoded prompt rules into something editable. Pacing is the one
   where an agent could read real numbers and explain them. Co-op first is settled; the
   order after that isn't.
2. **Where specialists appear.** A floating bubble is the cheap answer and the weak one.
   The co-op specialist probably belongs *inside* the guidelines tab and the ad builder,
   where the question actually gets asked.
3. **What "managed" means for a first-party specialist's instructions.** A profile edit
   changes behavior for everyone immediately. Straight to live, or draft-then-publish like
   the changelog? Phase 3's evals make the first option defensible; until then the second
   is safer.
