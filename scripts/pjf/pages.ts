// PJF campaign — landing pages (HTML mode), styled to match pjfcorp.com:
// blue + gold system, "Quality. Integrity. Service." voice, 50-yr proof,
// three pillars, named-client trust, healthcare/dental focus.
//
// HTML-mode LPs render the body HTML as-is, hydrating
// <div data-loomi-form="<formId>"></div> with the published form server-side
// (see src/app/lp/[slug]/page.tsx). We build each LP with the real form id.

import type { LandingPageContent } from '@/lib/landing-pages/types';
import { BRAND, withUtm } from './brand';

const c = BRAND.colors;
const projectsUrl = withUtm(`${BRAND.website}/projects`, 'lp-projects');

const STYLE = `<style>
  .pjf { font-family:${BRAND.fonts.body}; color:${c.text}; background:#eef2f6; margin:0; }
  .pjf * { box-sizing:border-box; }
  .pjf-wrap { max-width:1100px; margin:0 auto; padding:0 22px; }
  .pjf h1,.pjf h2,.pjf h3 { font-family:${BRAND.fonts.heading}; }
  /* top bar */
  .pjf-bar { background:#fff; border-bottom:1px solid ${c.border}; }
  .pjf-bar-in { display:flex; align-items:center; justify-content:space-between; padding:14px 22px; max-width:1100px; margin:0 auto; gap:16px; flex-wrap:wrap; }
  .pjf-bar img { height:38px; width:auto; display:block; }
  .pjf-bar a { color:${c.primary}; text-decoration:none; font-weight:bold; font-size:14px; }
  .pjf-bar .ph { color:${c.text}; font-weight:bold; }
  /* hero */
  .pjf-hero { background:${c.primary}; color:#fff; border-bottom:5px solid ${c.secondary}; }
  .pjf-hero-in { padding:54px 22px 50px; max-width:1100px; margin:0 auto; }
  .pjf-eyebrow { color:${c.secondary}; font-family:${BRAND.fonts.heading}; font-weight:bold; font-size:13px; letter-spacing:2px; text-transform:uppercase; margin:0 0 14px; }
  .pjf-hero h1 { font-size:40px; line-height:1.12; margin:0 0 16px; max-width:760px; font-weight:bold; }
  .pjf-hero p.sub { font-size:19px; line-height:1.5; margin:0 0 26px; max-width:620px; opacity:.95; }
  /* buttons */
  .pjf-btn { display:inline-block; background:${c.secondary}; color:#1a1a1a; font-family:${BRAND.fonts.heading}; font-weight:bold; font-size:15px; text-decoration:none; padding:14px 28px; border-radius:6px; border:2px solid ${c.secondary}; }
  .pjf-btn.ghost { background:transparent; color:#fff; border-color:#fff; }
  .pjf-btn.solid { background:${c.primary}; color:#fff; border-color:${c.primary}; }
  .pjf-btn-row { display:flex; gap:12px; flex-wrap:wrap; }
  /* stat band */
  .pjf-stats { background:#013a66; }
  .pjf-stats-in { display:flex; flex-wrap:wrap; gap:8px; max-width:1100px; margin:0 auto; padding:18px 22px; }
  .pjf-stat { flex:1 1 200px; text-align:center; color:#fff; padding:8px; }
  .pjf-stat b { display:block; font-family:${BRAND.fonts.heading}; color:${c.secondary}; font-size:26px; line-height:1; margin-bottom:5px; }
  .pjf-stat span { font-size:13px; opacity:.9; }
  /* main grid */
  .pjf-grid { display:flex; flex-wrap:wrap; gap:36px; padding:50px 0; align-items:flex-start; }
  .pjf-main { flex:1 1 460px; min-width:300px; }
  .pjf-aside { flex:0 1 400px; min-width:300px; }
  .pjf-main h2 { color:${c.primary}; font-size:25px; margin:0 0 14px; }
  .pjf-main h2 .u { border-bottom:3px solid ${c.secondary}; padding-bottom:4px; }
  .pjf-main li { margin:0 0 12px; line-height:1.5; font-size:16px; }
  .pjf-lead { font-size:18px; line-height:1.55; color:${c.text}; margin:0 0 22px; }
  /* form card */
  .pjf-card { background:#fff; border:1px solid ${c.border}; border-top:4px solid ${c.primary}; border-radius:12px; padding:10px; position:sticky; top:18px; box-shadow:0 8px 30px rgba(1,58,102,.08); }
  .pjf-card h3 { color:${c.primary}; font-size:19px; margin:14px 16px 2px; }
  .pjf-card .note { color:${c.muted}; font-size:13px; margin:0 16px 6px; }
  /* pillars */
  .pjf-pillars { background:#fff; border-top:1px solid ${c.border}; }
  .pjf-pillars-in { display:flex; flex-wrap:wrap; gap:26px; max-width:1100px; margin:0 auto; padding:46px 22px; }
  .pjf-pill { flex:1 1 280px; }
  .pjf-pill .ic { width:46px; height:46px; border-radius:10px; background:${c.softBg}; display:flex; align-items:center; justify-content:center; margin-bottom:12px; }
  .pjf-pill h3 { color:${c.primary}; font-size:18px; margin:0 0 6px; }
  .pjf-pill p { color:${c.muted}; font-size:15px; line-height:1.5; margin:0; }
  /* trust + footer */
  .pjf-trust { background:${c.softBg}; text-align:center; padding:24px 22px; color:${c.muted}; font-size:14px; }
  .pjf-trust b { color:${c.text}; }
  .pjf-foot { background:#fff; border-top:1px solid ${c.border}; text-align:center; color:${c.muted}; font-size:13px; line-height:1.6; padding:28px 22px 44px; }
  .pjf-foot .tag { color:${c.secondary}; font-family:${BRAND.fonts.heading}; font-weight:bold; letter-spacing:1px; text-transform:uppercase; font-size:11px; }
  .pjf-sched { background:#fff; border:1px dashed ${c.accent}; border-radius:12px; padding:24px; color:${c.muted}; font-size:15px; line-height:1.5; margin-top:18px; }
  .pjf-sched b { color:${c.text}; display:block; margin-bottom:4px; font-family:${BRAND.fonts.heading}; }
  @media (max-width:760px){ .pjf-hero h1{font-size:29px;} .pjf-grid{padding:30px 0;} .pjf-card{position:static;} .pjf-bar img{height:32px;} }
</style>`;

const ICON_SHIELD = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${c.primary}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>`;
const ICON_CLOCK = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${c.primary}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
const ICON_CHAT = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${c.primary}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

function topBar(): string {
  return `<div class="pjf-bar"><div class="pjf-bar-in">
    <a href="${withUtm(BRAND.website, 'lp-logo')}" target="_blank"><img src="${BRAND.logoLight}" alt="${BRAND.company}"></a>
    <div><span class="ph">${BRAND.phoneDisplay}</span> &nbsp;&middot;&nbsp; <a href="${withUtm(BRAND.website, 'lp-nav')}" target="_blank">pjfcorp.com</a></div>
  </div></div>`;
}

function statBand(): string {
  return `<div class="pjf-stats"><div class="pjf-stats-in">
    <div class="pjf-stat"><b>50+ yrs</b><span>Building Utah&rsquo;s clinics</span></div>
    <div class="pjf-stat"><b>100s</b><span>Commercial projects delivered</span></div>
    <div class="pjf-stat"><b>Northern Utah</b><span>Weber &middot; Davis &middot; Salt Lake</span></div>
    <div class="pjf-stat"><b>Healthcare</b><span>Dental &amp; medical specialists</span></div>
  </div></div>`;
}

function pillars(): string {
  return `<div class="pjf-pillars"><div class="pjf-pillars-in">
    <div class="pjf-pill"><div class="ic">${ICON_SHIELD}</div><h3>Proven Industry Expertise</h3><p>Healthcare-specific know-how, from operatories to surgical suites and imaging.</p></div>
    <div class="pjf-pill"><div class="ic">${ICON_CLOCK}</div><h3>Streamlined Delivery</h3><p>Safe, on-time, cost-effective &mdash; with phasing that keeps you seeing patients.</p></div>
    <div class="pjf-pill"><div class="ic">${ICON_CHAT}</div><h3>Transparent Communication</h3><p>You always know where your project stands. No surprises, start to finish.</p></div>
  </div></div>`;
}

function trustLine(): string {
  return `<div class="pjf-trust">Trusted by Utah healthcare &amp; dental practices &mdash; <b>Tanner Clinic</b> &middot; <b>St. Mark&rsquo;s Hospital</b> &middot; <b>Alpine Dental</b></div>`;
}

function footer(): string {
  return `<div class="pjf-foot">
    <strong style="color:${c.text};font-size:15px;">${BRAND.company}</strong><br>
    <span class="tag">Quality. Integrity. Service.</span><br>
    ${BRAND.address}, ${BRAND.city}, ${BRAND.state} ${BRAND.postalCode} &middot; ${BRAND.phoneDisplay} &middot; <a href="${withUtm(BRAND.website, 'lp-foot')}" target="_blank" style="color:${c.primary};text-decoration:none;">pjfcorp.com</a>
  </div>`;
}

function page(opts: {
  title: string;
  eyebrow: string;
  heroTitle: string;
  heroSub: string;
  primaryCta: string;
  mainHtml: string;
  formHeading: string;
  formNote: string;
  formId: string;
  asideExtra?: string;
}): LandingPageContent {
  const html = `${STYLE}
<div class="pjf">
  ${topBar()}
  <div class="pjf-hero"><div class="pjf-hero-in">
    <p class="pjf-eyebrow">${opts.eyebrow}</p>
    <h1>${opts.heroTitle}</h1>
    <p class="sub">${opts.heroSub}</p>
    <div class="pjf-btn-row">
      <a class="pjf-btn" href="#pjf-form">${opts.primaryCta}</a>
      <a class="pjf-btn ghost" href="${projectsUrl}" target="_blank">View our projects</a>
    </div>
  </div></div>
  ${statBand()}
  <div class="pjf-wrap"><div class="pjf-grid">
    <div class="pjf-main">${opts.mainHtml}</div>
    <div class="pjf-aside">
      <div class="pjf-card" id="pjf-form">
        <h3>${opts.formHeading}</h3>
        <p class="note">${opts.formNote}</p>
        <div data-loomi-form="${opts.formId}"></div>
      </div>
      ${opts.asideExtra ?? ''}
    </div>
  </div></div>
  ${pillars()}
  ${trustLine()}
  ${footer()}
</div>`;
  return { version: '1', mode: 'html', title: opts.title, html } as unknown as LandingPageContent;
}

// ── Lead-magnet landing page ────────────────────────────────────────
export function leadMagnetLP(formId: string): LandingPageContent {
  return page({
    title: 'Free Guide — What Dentists Should Know Before Building or Remodeling',
    eyebrow: 'Free Planning Guide',
    heroTitle: 'What dentists should know before they build, remodel, or expand',
    heroSub:
      'A free, no-pitch planning guide from the Utah contractor behind Tanner Clinic and Alpine Dental — the budget, timeline, and design decisions that matter most.',
    primaryCta: 'Get the free guide',
    formHeading: 'Get the free guide',
    formNote: 'Tell us where to send it. No spam — unsubscribe any time.',
    formId,
    mainHtml: `
      <h2><span class="u">Inside the guide</span></h2>
      <ul>
        <li>The 3 numbers to lock before you talk to any contractor</li>
        <li>Operatory &amp; equipment rough-ins that are costly to change later</li>
        <li>Imaging, plumbing &amp; electrical surprises in older Utah buildings</li>
        <li>How to keep seeing patients while you build (phasing that works)</li>
        <li>Remodel vs. expand vs. relocate: how to choose</li>
      </ul>
      <p style="color:${c.muted};font-size:14px;margin-top:18px;">Built for established dental &amp; medical practices across Northern Utah.</p>`,
  });
}

// ── Consultation landing page ───────────────────────────────────────
export function consultationLP(formId: string): LandingPageContent {
  return page({
    title: 'Request a Consultation — PJF Corporation',
    eyebrow: 'Dental & Medical Clinic Construction',
    heroTitle: 'Talk through your clinic build, remodel, or expansion',
    heroSub:
      'A no-obligation conversation with the Utah contractor that built Tanner Clinic, St. Mark’s Hospital, and Alpine Dental.',
    primaryCta: 'Request a consultation',
    formHeading: 'Request a consultation',
    formNote: 'Tell us about your project and we’ll follow up. No obligation.',
    formId,
    mainHtml: `
      <h2><span class="u">What to expect</span></h2>
      <ul>
        <li>A straight read on budget &amp; timeline for your space</li>
        <li>Early flags on imaging, MEP, sterilization, and phasing around a live schedule</li>
        <li>Ideas you can use whether or not we work together</li>
      </ul>
      <p class="pjf-lead" style="margin-top:20px;">For 50+ years, practices across Northern Utah have trusted PJF to build and remodel without disrupting patient care.</p>`,
    asideExtra: `<div class="pjf-sched">
        <b>Prefer to pick a time now?</b>
        <!-- PJF HubSpot Meetings embed goes here once the portal is connected:
             <div class="meetings-iframe-container" data-src="https://meetings.hubspot.com/USER?embed=true"></div>
             + add meetings-embed.js via the LP's "custom body-end HTML". -->
        Your live booking calendar will appear here once scheduling is connected. In the meantime, request a consultation and we&rsquo;ll send times.
      </div>`,
  });
}
