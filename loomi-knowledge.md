# Loomi Studio Knowledge Base

This file is the source of truth for Loomi Studio AI assistants. Update this file to change what the AI knows.

> **Maintenance:** Keep this file current. Whenever a change adds, removes, or
> meaningfully alters a Loomi feature, surface, integration, or data model,
> update the relevant section here in the same change.

---

## Platform Overview

Loomi Studio is Oz Marketing's all-in-one, multi-tenant **marketing operations platform**. From one workspace, agency teams and their clients run client marketing end-to-end: audiences/CRM, native email + SMS campaigns, marketing automation (flows), web lead-capture (forms + landing pages), paid-ads budget pacing and reconciliation (Meta + Google), on-brand ad creative generation, client reporting, and the internal project management that ties delivery together.

Loomi is **native everywhere** — it does not sit on top of a third-party ESP, ad tool, or CRM as a thin UI. Contacts, templates, campaigns, sends, engagement events, ad-spend data, and analytics all live in Loomi's own PostgreSQL database. SendGrid (email), Twilio (SMS), and the Meta/Google ad APIs are used as transports/data sources only — Loomi owns the data and the logic, which is what lets it stitch every channel together under one account model.

Loomi is **industry-agnostic by design** (avoid hardcoding terms like "dealer" — use "account"; Industry is a per-account setting). Automotive and Powersports are the most built-out verticals via OEM/brand awareness, but the platform serves any local business.

**Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Prisma + PostgreSQL. AI features are powered by the Anthropic Claude API. Background work runs on a pg-boss worker. Built and rendered with [react-email](https://react.email/) for email templates.

---

## Surfaces (host-based routing)

One Next.js app serves several host classes (routed by an edge proxy in `src/proxy.ts`):

- **Marketing** (`loomilm.com` apex + `www.`; dev `marketing.localhost:3000`) — the public, unauthenticated marketing site. Currently a single full-screen hero teaser (`src/app/marketing/`). The proxy rewrites the apex to `/marketing`, and the root layout detects the marketing host (`isMarketingHost` → `surface === 'marketing'`) and renders it **bare + server-side** (no app providers), locked to the dark theme — the app's `ThemeProvider` returns `null` until client hydration, so providers-wrapped pages don't server-render (fine for the auth'd app, bad for SEO). SEO is wired up: `metadata`/OpenGraph/Twitter/canonical (`src/app/marketing/layout.tsx` + `src/lib/marketing/seo.ts`), JSON-LD on the page, a host-aware `/sitemap.xml`, and a marketing branch in `/robots.txt`. Sign-in CTAs link to `/login?callbackUrl=<app-origin>` so login lands on the **App** surface (the root admin), not Studio — the login page honors a same-site `callbackUrl` (`resolveSafeCallbackUrl`).
- **Studio** (`studio.loomilm.com`) — the main marketing workspace: Dashboard, Campaigns, Templates, Audiences, Emails & SMS, Website (Forms + Landing Pages), Flows, Ad Generator, Media.
- **App** (`app.loomilm.com`) — internal delivery surface: **Projects** (project management) and the **Ad Pacing / Planner** tools.
- **Reporting** (`reporting.loomilm.com`) — client-facing analytics dashboards.
- **Public** — client custom domains and the anonymous routes `/lp/[slug]` (landing pages) and `/f/[slug]` (forms).

A shared cross-subdomain cookie (`loomi-active-account`) keeps the active-account context in sync across surfaces. The session cookie is scoped to `.loomilm.com` in prod, so logging in on one subdomain carries to the others (this is why marketing→App login works in prod; in local dev cookies don't span `*.localhost`, so the App redirect won't carry the session there).

---

## Sectors / Features

### Audiences & CRM
Native contact database (not ESP-synced). Full CRUD with extensible per-account **custom fields** (blueprint inheritance by industry), tags, vehicle data, and materialized engagement flags. Admins get a cross-account deduped view (merge by email/phone). Contact hygiene normalizes phones to E.164 and filters disposable emails. **Smart Lists / Segments** are nested AND/OR filter definitions evaluated across text/number/date/tag/boolean/select fields; saved filters become named **Audiences** that feed campaigns and flows.

### Email & SMS Campaigns
- **Email** sends through **SendGrid** (direct v3 API) with auto-injected CAN-SPAM unsubscribe footers, RFC 8058 one-click unsubscribe, and open/click tracking. Engagement events return via webhook (`POST /api/webhooks/sendgrid/events`) into `EmailEvent` and drive suppression lists.
- **SMS/MMS** sends through **Twilio** with A2P 10DLC messaging-service support. Status callbacks land at `POST /api/webhooks/twilio/status`; inbound replies (incl. STOP) at `POST /api/webhooks/twilio/inbound`.
- Sends run per-recipient (a single failure doesn't poison the batch) on a pg-boss worker that polls for due campaigns every minute. Aggregate analytics are derived directly from the event tables — no separate stats store.

### Email Production (template builder)
The visual drag-and-drop editor produces **v2 JSON** templates compiled to email-safe HTML via react-email. There is also a raw-HTML **code mode** (Monaco). Templates can be global library assets (`accountKey = null`) or account-owned, with publish/draft states and version snapshots. See the detailed **Template Builder Architecture** and **Component Catalog** sections below — that detail is functional guidance for the AI assistant.

### Flows (marketing automation)
Visual journey builder (nodes + branches). Triggers (list, audience, manual, form submission, tag added, birthday, date reminder) enroll contacts; the worker advances each enrollment tick-by-tick through node types (email, SMS, tag/field updates, waits, conditions, splits, webhooks, CRM push, create task). Respects timezone-aware quiet hours, goals, re-entry policy, and max duration. Flows can be published as global templates and deployed as per-account instances with sync-from-parent.

### Campaigns (AI Campaign Builder)
A multi-channel container orchestrating the above. Workflow: **Plan → Generate → Review.** The user describes a campaign in plain language; Claude returns a structured plan (audience suggestion, email/SMS specs, clarifying questions). On generate, assets stream in (SSE) and land as editable **drafts** — the builder never auto-sends. Phase 2 adds landing pages + forms; Phase 3 will add flows.

### Web & Lead Capture
- **Forms** — block-based builder. Submissions upsert a Contact, can enroll into a flow, forward to a CRM (ADF email for Tekion/VinSolutions, or HubSpot API), and capture UTM/LP attribution. Embeddable via auto-resizing iframe script or hosted at `/f/[slug]`. Spam defense via Cloudflare Turnstile + honeypots. A form can be saved as a reusable template (`isTemplate=true`); admin-level templates live in the global library (`accountKey=null`) and can be **deployed** from Templates → Forms into one or more sub-accounts as live draft forms — a detached copy (schema deep-copied, fresh unique slug, no parent link), so the source template stays the source of truth. (`POST /api/forms/[id]/deploy`.)
- **Landing Pages** — block-based or raw-HTML mode, with marketing components (hero, features, testimonials, FAQ, embedded forms), responsive mobile overrides, SEO metadata, and pixel/GA4/GTM injection. Served at `/lp/[slug]` or on verified **custom domains** (DNS TXT + optional Cloudflare-for-SaaS SSL). Anonymous event tracking (views, CTA clicks, scroll depth, submits) with privacy-preserving hashed IPs.
- **Iris** — an AI chat assistant inside the landing-page editor that conversationally builds/edits pages as structured JSON, grounded in the account's brand.

### Ad Pacing & Reconciliation
A paid-media spend-management system across **Meta** and **Google Ads**, organized as three views:
- **Planner** — intended budget allocation, flight dates, team assignments per ad.
- **Pacer** — live spend vs. plan (recommended daily budget, projected spend, account-wide pace %), synced from the ad platforms.
- **Reconciliation** — monthly over/under settlement vs. the *client* budget, with a carryover ledger that cascades variance across months, markup/margin resolved in exactly one place (per-account override or agency default), and cross-month "lifetime" run settlement (a run settles once, on its final month). An alert engine runs daily on the worker, syncing fresh spend and firing threshold notifications routed to each ad's owner/designer/rep. All changes auto-log to a 365-day audit trail.

The Meta and Google channels share one engine (pools, carryover ledger, margin, the three views) but render platform-aware cards. **Google-specific behavior:** a Google daily budget is an *average*, so its real cap is the **monthly ceiling = daily rate × 30.4** (reprorated across mid-month budget changes via `change_event`), not the daily number — the on-track band is wide enough to absorb 2× single-day swings and alerts fire on the monthly projection, not one hot day. The pacing card shows monthly ceiling + recommended daily *rate* (`allocation ÷ 30.4`) instead of Meta's remaining-budget framing; the planner shows a `$/day avg` subline (`monthly allocation ÷ 30.4`, the allocation stays the stored source of truth). Budgets carry a **Daily/Total** pacing tag (Total = Google's `CUSTOM_PERIOD`, reusing the lifetime branch) and a **Shared** badge keyed off `campaign_budget.reference_count > 1`. Two delivery signals with opposite remedies are surfaced distinctly: **budget-limited** (`primary_status_reasons` BUDGET_CONSTRAINED → raise budget) and **ads-disapproved** (ad-level `approval_status` → fix the ads, never raise budget). Spend is **served** cost (`metrics.cost_micros`), labeled as such (billed truth is account-level only, via InvoiceService). Daily campaigns bill continuously so nothing defers to month-end; only a `CUSTOM_PERIOD` total flight uses the lifetime month-end exclusion. The Google integration is pinned to the Google Ads API **v24** endpoint. Google calc lives in `src/lib/ad-pacer/google-pacer-calc.ts` (pure, unit-tested), sync in `src/lib/integrations/google-ads-pacer.ts`, and the Google card render bits in `src/app/app/tools/_shared/google-pacer-card.tsx`.

The Google tool reaches full Meta parity on the planner workflow: a Search-ads field + **Add Plan** dropdown (create from scratch / copy from previous month / import from Google) via the shared `AddPlanButton` + `CopyPlanModal`; the page-title header lays out **notes icon · month selector · Filters** exactly like Meta (the `AccountNotesButton` left of the selector, the shared `MetaAdsPacerFilterSidebar` right of it, with `applyFilters`/`activeFilterCount` driving the list); per-period **account comments** (the shared `AccountNotesDrawer`, comment icon in the page title and on admin cards); an **admin all-accounts overview** listing every accessible account (cards with note count + Open) shown when no sub-account is selected; and the editor modal exposes Recurring/Co-Op + Creative & Design + Approvals as optional fields. The notes, copy-from, periods, and overview APIs are all **platform-scoped via `?platform=google`** (the shared `adPlatformWhere` fragment), so Google and Meta never cross-contaminate lines, notes, or counts. The admin all-accounts view reuses Meta's expandable `OverviewView` drill-down for exact parity (platform prop threads the notes drawer).

**Status model (both platforms):** there are two statuses per line. **Task Status** is the team's editable planning lifecycle (the `adStatus` DB field — In Draft / Pending Design / Live / Stuck / Completed Run / Off / …; kept as-is, just relabeled "Task Status" in the UI). Pacer automations key off its *values* (the Run-Complete banner on `Completed Run`, the platform-mismatch nudge, `reconcileCompletedRuns` auto-complete, `ACTIVE_STATUSES`, StatusBattery). **Ad Status** is the read-only, platform-true delivery state, normalized to one shared vocabulary (Active / Paused / Limited / Disapproved / Removed / Not linked / Unknown) by `src/lib/ad-pacer/platform-status.ts` from `metaEffectiveStatus` / `googleEffectiveStatus` + Google's budget-constrained/disapproved signals; shown via `AdStatusBadge` in the editor modal and the pacer card. The two are independent — Ad Status never drives Task Status.

### Ad Generator
Template-driven visual ad builder (in active build). Designers author data-driven templates (render function: data + size → HTML) in a visual builder (drag/resize, layer tree, style + binding editing, save/publish to DB). The canvas is a pan/zoom transform viewport (Figma-style: space/middle-mouse/two-finger-scroll pan, ⌘/⌃-wheel cursor-anchored zoom), and a multi-artboard "All sizes" mode lays every checked size out together on that canvas — the active size stays editable in place while the rest are live previews you click to activate (per-size checkbox chips + select/deselect-all pick which show). Images support an **interactive crop**: a Crop button on the Image panel enters crop mode where you drag the photo on the canvas to reposition and zoom to crop in (stored per-size as `object-position` + `objectScale`, applied by the renderer as object-position + a focal-point scale). Editor chrome: the element/background settings panel floats full-height (inset with rounded corners) at the canvas's right edge; there is a single **Background/Canvas** panel with **Color / Image tabs** (Color = solid or gradient fill + brand accent bar; Image = add/replace/remove the full-bleed background photo, which is itself a normal image element you can also select to crop). It opens only when the canvas is focused — click the empty artboard — and closes on outside-click / Esc / its ✕ (it does NOT auto-open on load). **Shape** elements come in multiple kinds (rectangle/ellipse/triangle/diamond/star — non-rects via CSS `clip-path`, shared `SHAPE_CLIP` map in the renderer) and take a solid **or gradient** fill. All "add" actions (Text/Image/Button/Shape + a full-bleed **Background**) live in the left Insert panel; sizes are managed from a **centered modal** opened by clicking the size label in the canvas action bar (bottom) — each size shows a ratio-accurate preview swatch, and "View all sizes together" lives inside the modal (no standalone Sizes / All-sizes buttons on the bar); zoom is a vertical stack pinned bottom-left inside the canvas; and the outline + safe-area-margin view guides live on the left rail. The top bar is minimal (Back · name · **Publish** control · **settings cog** · Save). Publish is a popover (Loomi components): **Draft**, **Publish — live now** (indefinite), or **Publish — scheduled** (a Loomi range `DatePicker`); the schedule is stored in `doc.schedule` ({start,end} ISO, no DB column) and the /templates library hides a template outside its window (Scheduled/Expired badges on the cards). Each Ads-tab card also shows its **account scope** — the dealer name (from the accounts map) for an account-scoped template, or "All accounts" (globe) for a global one. Templates can be **deployed to subaccounts** (`DeployTemplateModal`, a multiselect of accounts) from both the Ads-tab row menu and the builder's settings cog — it POSTs a published, account-scoped copy of the doc into each selected account's library. The cog holds template-scope settings (Industries — which accounts the template is offered to — plus Save-as-new). Elements may **bleed past the artboard** (the artboard clips them in preview + export); dragging one **fully off** the artboard **detaches** it — a canvas-only parking spot rendered in the builder overlay but omitted from the ad (`isDetached`/`isBoxDetached`), and dragging it back onto the artboard re-attaches it. A new template opens on a **blank artboard** (no starter layout); the builder is entered from the Ad Generator index (ads) or the /templates **Ads** tab (**New template** → start from scratch, or duplicate a published template — either path **creates the draft record immediately** so it shows in the Ads list). **Back** returns to wherever you came from (`?from=<path>`, e.g. `/templates?tab=ads`). Opening/creating happens outside the builder (no Open/New buttons in its header); opening a template shows no toast. Undo/redo history uses **key-based coalescing**: every discrete action (group, delete, resize/drag commit, media swap, reorder, size add/remove) is its own atomic step, while continuous same-property edits (typing a field, holding a number stepper, dragging a color/gradient slider) collapse into one step — so undo reflects each real change instead of merging whatever happened within a fixed time window. Reps fill a guided form and export pixel-perfect PNGs via headless Chromium (Puppeteer) — per size, or every size at once as a single ZIP rendered in one browser session. Image fields pull from the account media library (backgrounds) or EVOX (vehicle imagery). MarketCheck supplies OEM incentives with pagination (the API caps at 10/page), automatic fallbacks (prior model year; national when a ZIP-scoped search is empty — both surfaced to the designer), a 24h server cache, and the search ZIP defaulting from the account profile. AI copy generation (Claude) writes platform-constrained Meta/Google headlines & descriptions (copy only — never prices or legal text). An OEM compliance rule engine (per-make required fields) blocks export until satisfied, and disclaimer templates compose legal text via {token} substitution. Gated by the `AD_GENERATOR_ENABLED` flag.

### Reporting
Client-facing dashboards on their own subdomain — engagement, contacts, reputation, ads, and account profile views (some rollups in progress).

### Projects (internal delivery management)
A project-management surface on the App host. **Initiatives** (account-scoped bodies of work) wrap **Tasks** (typed tickets — design, dev, email, ads, video, print, etc.) routed to **Teams** (departments). Views: Initiatives, Tasks (Kanban board + spreadsheet table), My Work, Calendar. Multi-account ticket intake with shared-vs-unique creative fanout, comment threads with mentions, audit trail, assignment/due-soon notifications, and daily digests.

---

## Roles And Permissions

- **Developer / Super Admin** — full system access; manage all users and accounts; impersonation.
- **Admin** — manage templates, emails, flows, and assigned accounts; cannot manage users.
- **Client** — account-scoped access to their own account; build/ops tools hidden; redirected from top-level admin pages to their sub-account.

Developers and admins can switch between admin mode and assigned account views via the account switcher. Access is enforced by `getAccountScope(session)` (null = full access; otherwise an array of account keys).

---

## Template Builder Architecture

### Overview
The template editor is the core tool for creating and editing email templates. Two modes:

- **Visual mode (Drag & Drop)** — Block-based editing. Templates are stored as **v2 JSON** with a top-level `settings` object and an ordered array of `blocks`. Containers (`section`, `columns`) hold child blocks via a `children` array. Each block has a stable `id`, a `type`, and a `props` object (typed values: numbers, strings, booleans, nested objects).
- **Code mode** — Raw email-safe HTML editing with a Monaco code editor. Pure HTML only — the legacy Maizzle `<x-base>` / `<x-core.*>` scaffold has been removed.

### Template Structure (v2 JSON)

```json
{
  "version": "2",
  "subject": "Your Subject Line",
  "preheader": "Preview text shown in inbox",
  "settings": {
    "bodyBg": "#f5f5f5",
    "contentBg": "#ffffff",
    "contentWidth": 600,
    "fontFamily": "-apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif",
    "textColor": "#1a1a1a"
  },
  "blocks": [
    {
      "id": "b-hero-1",
      "type": "section",
      "props": { "bgColor": "#0a0a0a", "paddingTop": 64, "paddingBottom": 64, "paddingLeft": 40, "paddingRight": 40 },
      "children": [
        { "id": "b-h-1", "type": "heading", "props": { "text": "Welcome aboard.", "level": 1, "color": "#fff", "fontSize": 36 } }
      ]
    },
    { "id": "b-cta-1", "type": "button", "props": { "text": "Get Started", "url": "https://example.com", "bgColor": "#1a1a1a" } }
  ]
}
```

**Top-level fields:**
- `version` — Always `"2"` for the current format
- `subject` — Email subject line
- `preheader` — Inbox preview text
- `settings` — Email-wide defaults (see below)
- `blocks` — Ordered array of root-level blocks

**Settings object:**
- `bodyBg` — Body background (around the centered email container)
- `contentBg` — Inner email container background
- `contentWidth` — Max content width in pixels (default 600)
- `fontFamily` — Default font stack
- `textColor` — Default body text color

**Block fields:**
- `id` — Stable unique id (used for selection / undo / drag identity)
- `type` — One of the block types in the catalog below
- `props` — Per-type props (typed values, never YAML strings)
- `children` — Optional, only for container types (`section`, `columns`)

### Compilation
Templates are rendered server-side via `@react-email/render`. The renderer maps each block's `type` + `props` to a JSX component from `src/lib/email/components/` and calls `render(<EmailDocument template={...} />)`. The output is email-safe HTML with inline styles, table-based layout, and MSO conditionals where needed. The visual editor canvas renders the same React components live in the browser (no iframe round-trip).

---

## Component Catalog (v2)

The visual editor exposes ten block types. Containers hold child blocks; the rest are leaf content blocks.

### Containers

#### `section`
Full-width content row that holds child blocks. The most common layout primitive.
- **Background:** `bgColor`, `bgImage`, `bgSize` (cover/contain/auto), `bgPosition`, `bgRepeat`
- **Border:** `borderWidth`, `borderStyle` (solid/dashed/dotted/double), `borderColor`
- **Border radius (4 corners):** `borderRadiusTopLeft`, `borderRadiusTopRight`, `borderRadiusBottomRight`, `borderRadiusBottomLeft`
- **Layout:** `align` (left/center/right), `gap` (vertical space between children), `minHeight`
- **Padding (4 sides):** `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft`

#### `columns`
Grid layout — 2 or 3 side-by-side columns. Each column is a section block in `children`. Stacks vertically on mobile.
- **Layout:** `columnCount` (2 | 3), `valign` (top/middle/bottom), `gap` (horizontal between columns), `stackOnMobile` (default true)
- **Background / Border / Border radius / Min height:** same as `section`
- **Padding:** same as `section`

### Content blocks

#### `heading`
H1–H6 heading.
- **Content:** `text`, `level` (1–6), `align`
- **Typography:** `color`, `fontSize`, `fontWeight` (400/500/600/700/800), `fontFamily`, `lineHeight`, `letterSpacing`, `textTransform`
- **Margin (4 sides):** `marginTop`, `marginRight`, `marginBottom`, `marginLeft`

#### `text`
Paragraph block.
- **Content:** `text`, `allowHtml` (when true, the text is rendered as raw HTML — useful for inline merge tags / links)
- **Typography:** same as `heading`
- **Margin:** same as `heading`

#### `image`
Single image, optionally wrapped in a link.
- **Content:** `src`, `alt`, `linkUrl`
- **Layout:** `align`, `width` (px), `height` (px), `maxWidth`
- **Border radius (4 corners):** same as `section`

#### `button`
Call-to-action button. Email-safe via react-email's `<Button>` (renders as `<a>` with bulletproof MSO).
- **Content:** `text`, `url`
- **Style:** `bgColor`, `textColor`, `borderColor`, `borderWidth`, plus 4-corner `borderRadius{Corner}`
- **Layout:** `align`, `fullWidth`
- **Padding (4 sides):** `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft`
- **Typography:** `fontSize`, `fontWeight`, `fontFamily`, `letterSpacing`, `textTransform`

#### `logo`
Logo image, sized for header use. Same props as `image` but with a `width` default of 140px.

#### `spacer`
Vertical empty space.
- **Layout:** `height` (px), `bgColor`

#### `divider`
Horizontal rule.
- **Style:** `color`, `thickness`, `style` (solid/dashed/dotted)
- **Layout:** `width` (% or px), `align`, `marginTop`, `marginBottom`

#### `social`
Row of social media icons.
- **Content:** `links` (array of `{ platform, url, iconUrl?, label? }`) — supported platforms: facebook, instagram, twitter, youtube, linkedin, tiktok
- **Layout:** `iconSize`, `spacing`, `align`, `variant` (color/mono-light/mono-dark)

---

## Email Generation Guidelines

### When to ask clarifying questions
Before generating a full email, ask the user for details if ANY of these are unclear:
- **Purpose/type** — What kind of email? (service reminder, promotion, newsletter, welcome, etc.)
- **Key message** — What's the main thing the reader should know or do?
- **Call to action** — What action should the reader take?
- **Tone** — Professional, casual, urgent, friendly?
- **Special content** — Any specific offer, deadline, product, or event to mention?

If the user provides a clear, specific request (e.g., "Build a service reminder email with a 15% oil change discount"), generate immediately without asking.

### Block ordering conventions
A well-structured email typically follows this rough order:
1. `logo` (or a `section` containing the logo) — Brand identity at the top
2. Hero `section` — Headline + tagline + primary CTA, often with a dark `bgColor` or `bgImage`
3. Body `section`(s) — Greeting, main message, supporting content
4. CTA `button` — Primary action (can live in its own section or inside the body section)
5. Footer `section` — Business info, social icons, unsubscribe link

You can intersperse `spacer` and `divider` blocks for breathing room. Use `columns` (Grid) when you need a side-by-side layout (e.g., feature highlights, two product callouts).

### Applying account branding
When account branding is available in the context:
- **Primary color** → Use for main CTA `button.bgColor` and section accents
- **Secondary color** → Secondary buttons, accent borders
- **Accent color** → Highlights, dividers, eyebrow text
- **Background color** → Section `bgColor` if the brand uses a non-white base
- **Text color** → `heading.color` / `text.color` overrides if not standard dark
- **Brand fonts** → `fontFamily` on heading/text/button (use email-safe stacks: Arial, Helvetica, Georgia, Verdana, Tahoma; or `-apple-system, …` system stack)
- When no branding is available, use safe defaults: `#1a1a1a` (dark text), `#ffffff` (white backgrounds), `#71717a` (muted text), `#3a3a3a` (body text)

### Image handling
- For all image props (`src`, `bgImage`), use the placeholder image URL unless the user provides specific images
- Placeholder: `https://loomistorage.sfo3.digitaloceanspaces.com/media/_admin/69fa3adf4ae444edaadd1d0d7fee4b87/image placeholder.png`
- For logos, prefer `{{custom_values.logo_url}}` so each account's logo renders automatically
- Tell the user they can replace placeholder images with their own from the media library

### Template variable usage
- **Contact personalization:** `{{contact.first_name}}`, `{{contact.last_name}}`, `{{contact.email}}`
- **Vehicle data:** `{{contact.vehicle_year}}`, `{{contact.vehicle_make}}`, `{{contact.vehicle_model}}`
- **Location/business:** `{{location.name}}`, `{{location.phone}}`, `{{location.address}}`
- **Custom values:** `{{custom_values.website_url}}`, `{{custom_values.service_scheduler_url}}`, `{{custom_values.logo_url}}`
- **System:** `{{unsubscribe_link}}`

### Email best practices
- **Width:** Default 600px content; override with `settings.contentWidth` if needed
- **Fonts:** Use email-safe stacks via the `fontFamily` dropdown (System Default / Arial / Helvetica / Verdana / Georgia / etc.)
- **Colors:** Ensure text has sufficient contrast against backgrounds (WCAG AA minimum)
- **CTAs:** One primary CTA per email. Make it prominent and action-oriented.
- **Copy:** Keep email body concise — 50-150 words for promotional, up to 250 for newsletters
- **Subject lines:** 6-10 words, no spam triggers, create curiosity or urgency
- **Preview text:** 40-90 characters, complements subject line

### Email types and typical block structures

**Service Reminder:**
logo → section (hero with vehicle/service image bg, headline) → section (greeting heading + body text + button) → section (footer with social + unsubscribe)

**Promotional / Sale:**
logo → section (bold offer headline on dark bgColor + button) → section (offer details + deadline emphasis) → columns (3 benefit callouts) → section (CTA button) → section (footer)

**Newsletter:**
logo → section (newsletter title heading) → section (intro text) → columns (2-col featured story + image) → section (additional links via text/button) → section (footer)

**Welcome:**
logo → section (welcome heading + body text) → section (3 onboarding steps as headings + text) → section (primary CTA button) → section (footer)

**Testimonial / Social Proof:**
logo → image (product/service photo) → section (intro text + quoted text block) → section (CTA button) → section (footer)

---

## Account Management

Each account can store:
- Business identity fields (name, address, phone, website, timezone; industry/category; OEM/brand affiliations)
- Branding (logos light/dark/white, colors, fonts, favicon)
- Custom values for template substitution and extensible contact custom fields
- Per-account send credentials: SendGrid API key + from domain (email); Twilio creds + messaging-service SID (SMS) — all AES-256-GCM encrypted at rest
- Ad-platform identifiers (Meta ad-account ID, Google Ads customer ID, StackAdapt advertiser ID) and per-account markup/margin overrides
- CRM destinations (Tekion / VinSolutions via ADF, or HubSpot)
- Custom domains for landing pages/forms

---

## Campaign Sending And Webhooks

Loomi sends campaigns natively — no third-party ESP is involved on either the send or the analytics path.

- **Email sends:** routed through SendGrid. Engagement events (delivered / open / click / bounce / spam-report / unsubscribe) come back via the SendGrid Event Webhook at `POST /api/webhooks/sendgrid/events` and are persisted as `EmailEvent` rows keyed to the recipient.
- **SMS sends:** routed through Twilio. Status callbacks land at `POST /api/webhooks/twilio/status`; inbound replies (including STOP) at `POST /api/webhooks/twilio/inbound`.
- Aggregate campaign analytics (sent / opened / clicked counts) are derived directly from the event tables — no separate stats store.

---

## Template Variables

Templates use Loomi's variable catalog, including:
- Contact fields (`{{contact.first_name}}`, etc.)
- Location/account fields (`{{location.name}}`, `{{location.phone}}`, etc.)
- Custom values (`{{custom_values.website_url}}`, etc.)
- System fields (`{{unsubscribe_link}}`, `{{message.id}}`)

The variable catalog is resolved per-recipient at send time.

---

## Background Jobs

A pg-boss worker (separate PM2 process; see `ecosystem.config.js`) handles:
- **Campaign sends** (`loomi.process-due-campaigns`) — every minute
- **Flow enrollment execution** (`loomi.process-flow-enrollments`) — every minute
- **Flow trigger polling** (`loomi.process-flow-triggers`) — every 5 minutes
- **Ad-spend sync + pacing alert scan** — daily
- **CRM lead delivery** — event-driven (form submission / flow push-to-CRM)
- **Archive retention sweep** (`loomi.purge-archived`) — daily

---

## Integrations

- **Email/SMS:** SendGrid, Twilio (+ SMTP fallback)
- **Ad platforms:** Meta Ads, Google Ads, StackAdapt
- **CRM:** Tekion / VinSolutions (ADF email), HubSpot (API)
- **Creative data:** EVOX (vehicle imagery), MarketCheck (OEM incentives), Google Places
- **Cloud:** AWS S3 / DigitalOcean Spaces (media), Cloudflare (custom-domain SSL via Cloudflare-for-SaaS)
- **Analytics:** GA4, Meta Pixel, GTM (injected on landing pages)
- **AI:** Anthropic Claude API (campaign planning, email/SMS/flow/LP generation, ad copy, copy suggestions)

Third-party credentials are encrypted at rest via `src/lib/crypto/encryption.ts` using `TOKEN_ENCRYPTION_SECRET` (legacy `ESP_TOKEN_SECRET` accepted as fallback).

---

## Common Questions

### How do I create an email?
Open the template editor from Templates, choose visual or code mode, drag blocks onto the canvas (visual) or write email-safe HTML (code), then save the template. From a campaign you can attach the saved template and schedule it.

### How do I add a new account?
Create the account in Settings → Accounts, then fill in business/branding data and (for sending) SendGrid/Twilio credentials.

### How do I use the AI assistant in the template editor?
Click the sparkle button in the bottom-right corner or press Cmd/Ctrl+Shift+A. Ask Loomi to build a full email, edit component props, write subject lines, or improve copy. Loomi can generate complete emails using your account's branding, logos, and business details. In code mode, it can write custom branded HTML beyond the visual component catalog.

---

## Technical Notes

- **Framework:** Next.js 16 (App Router), React 19
- **Styling:** Tailwind CSS + CSS variables
- **Database:** PostgreSQL via Prisma
- **Auth:** NextAuth credentials flow with cross-subdomain JWT sessions; token-based invite onboarding; staff impersonation
- **Rendering:** react-email (`@react-email/components` + `@react-email/render`) for email template compilation; Puppeteer/headless Chromium for ad-creative PNG export and preview screenshots
- **Sending:** SendGrid (email) and Twilio (SMS) as the send transports; all campaign state, events, and analytics live in Postgres
- **Background work:** pg-boss worker (separate process) for sends, flow execution, ad sync/alerts, CRM delivery, and retention
- **Secrets:** `src/lib/crypto/encryption.ts` encrypts third-party credentials at rest using `TOKEN_ENCRYPTION_SECRET`

---

## Dynamic Data

Runtime-generated dynamic data is appended automatically (components, template variables, template tags, categories).
