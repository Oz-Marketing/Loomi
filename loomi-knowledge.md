# Loomi Studio Knowledge Base

This file is the source of truth for Loomi Studio AI assistants. Update this file to change what the AI knows.

---

## Platform Overview

Loomi Studio is an internal email production platform built by Oz Marketing. Teams use it to design, manage, and deploy branded email and SMS campaigns across dealership and business accounts.

The platform is built with Next.js 14 and uses [react-email](https://react.email/) (`@react-email/components` + `@react-email/render`) for template rendering. Email sends go out through SendGrid; SMS sends through Twilio. Contacts, lists, templates, and campaign state are stored locally in Postgres — no third-party ESP integration is involved.

---

## Navigation And Pages

- **Dashboard** (`/`) - Stats, activity, and account-aware analytics.
- **Templates** (`/templates`) - Browse OEM templates and open the visual/code editor.
- **Sections** (`/components`) - _Legacy Maizzle component management page; deprecated in v2 and now returns empty results. The visual editor's block library lives in code at `src/lib/email/components/`._
- **Emails** (`/emails`) - Account email instances (draft, active, archived), organized by folders.
- **Accounts** (`/accounts`) - Manage account records, branding, and integrations.
- **Settings** (`/settings`) - Accounts, users, integrations, custom values, knowledge, appearance.
- **Users** (`/users`, `/users/[id]`, `/users/new`) - User management for developer/admin permissions.

### Settings Tabs

- **Accounts** - Account list and detail management.
- **Custom Values** - Account-level fields used by template variable replacement.
- **Users** - User CRUD and access assignment.
- **Knowledge** - This knowledge base editor.
- **Appearance** - Theme options.

---

## Roles And Permissions

### Developer
- Full system access.
- Can manage users and all accounts.
- Can switch between admin mode and account views.

### Admin
- Can manage templates, emails, and assigned accounts.
- Cannot manage users.

### Client
- Limited account-scoped access.
- No user management or global admin controls.

### Account Switcher
Developers and admins can switch between admin view and assigned account views. Client-role users are restricted to assigned account scope.

---

## Template Builder Architecture

### Overview
The template editor is the core tool for creating and editing email templates. It has two modes:

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
- Dealer/business identity fields (name, address, phone, website, timezone)
- Branding (logos, colors, fonts)
- Custom values for template substitution
- Per-account Twilio credentials (for SMS sends)

---

## Campaign Sending And Webhooks

Loomi sends campaigns natively — no third-party ESP is involved on either the send or the analytics path.

- **Email sends:** routed through SendGrid. Engagement events (delivered / open / click / bounce / spam-report / unsubscribe) come back via the SendGrid Event Webhook at `POST /api/webhooks/sendgrid/events` and are persisted as `EmailCampaignEvent` rows keyed to the `EmailCampaignRecipient`.
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

## Common Questions

### How do I create an email?
Open the template editor from Templates, choose visual or code mode, drag blocks onto the canvas (visual) or write email-safe HTML (code), then save the template. From a campaign you can attach the saved template and schedule it.

### How do I add a new account?
Create the account in Accounts, then fill in business/branding data and (for SMS) Twilio credentials in Settings.

### How do I use the AI assistant in the template editor?
Click the sparkle button in the bottom-right corner or press Cmd/Ctrl+Shift+A. Ask Loomi to build a full email, edit component props, write subject lines, or improve copy. Loomi can generate complete emails using your account's branding, logos, and business details. In code mode, it can write custom branded HTML beyond the visual component catalog.

---

## Technical Notes

- **Framework:** Next.js 14 (App Router)
- **Styling:** Tailwind CSS + CSS variables
- **Database:** PostgreSQL via Prisma
- **Auth:** NextAuth credentials flow
- **Rendering:** react-email (`@react-email/components` + `@react-email/render`) for email template compilation
- **AI:** Anthropic Claude API integration
- **Sending:** SendGrid (email) and Twilio (SMS) as the send transports; all campaign state, events, and analytics live in Postgres
- **Secrets:** `src/lib/crypto/encryption.ts` encrypts Twilio + SendGrid credentials at rest using `TOKEN_ENCRYPTION_SECRET` (legacy `ESP_TOKEN_SECRET` still accepted as a fallback during env migration)

---

## Dynamic Data

Runtime-generated dynamic data is appended automatically (components, template variables, template tags, categories).
