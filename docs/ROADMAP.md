# Loomi Roadmap

Living document for planned but unbuilt features. When something ships,
move it out of this file (and into the changelog / CHANGELOG entry).

## In progress

_Nothing currently in active build — track open PRs in GitHub._

## Up next

### AI Campaign Builder Assistant
- **Surface**: studio home (`/dashboard`) — the hero placeholder is
  already wired in `src/app/dashboard/page.tsx` and shows a
  "Coming soon" preview of the textarea + Generate button.
- **What it does**: user describes a campaign idea in plain language
  (e.g. _"Service reminder for customers who haven't been in for 6+
  months"_) and the assistant drafts coordinated touchpoints across
  every medium the studio supports — email, SMS, flows, landing pages.
- **Output**: a multi-channel campaign plan the user can edit before
  scheduling. Each touchpoint lands in its appropriate builder
  (Messaging, Flows, Landing Pages) as a draft.
- **Why this slot**: the hero is the first thing a creative-mode user
  sees after the analytics moved out — it's the natural place to bias
  them toward starting a new thing.

### Forms analytics
- Build out `/reporting/websites` form-funnel rollup (submission counts,
  conversion by source, top abandonment fields). Studio has no
  per-form analytics today, so the API endpoint is net new.

### Landing pages rollup
- Aggregate per-LP analytics endpoints (`/api/landing-pages/[id]/analytics`)
  into an account-wide view for `/reporting/websites`. Each LP card
  links into its existing per-page detail.

### Ads reporting
- Surface Meta ad performance (spend, impressions, CTR) under
  `/reporting/ads`. Data already powers the studio Ad Planner /
  Ad Pacer tools; reporting just needs read-only visuals.

### Cross-surface date range filter
- `/reporting/engagement` currently uses a hardcoded `DEFAULT_DATE_RANGE`.
  Add a shared filter bar at the top of each reporting page driven by
  the same `DateRangeKey` enum studio already uses.

## Backlog (lower priority)

- Account-aware deep-links from reporting → studio (e.g. clicking a
  flow row jumps into the flow editor with the right account context).
- Forms / Landing Pages individual analytics surfaced under reporting
  (drill-down from the rollup).
- More granular permissions for client users (which areas of reporting
  they can see).
