// PJF campaign — Phase 1 email content (6 templates), styled to match
// pjfcorp.com and reframed for EXISTING dental + oral-surgery practices
// (build / remodel / expand).
//
// Each template is final responsive HTML (the flow email node sends it raw).
// Merge tokens use Loomi's flow syntax: {{firstName}}, {{practice_name}}.
// Every CTA link is UTM-tagged via ctaRow(). Subject + preview text come in
// INITIAL and URGENT variants (the flow uses INITIAL; alternates live in
// campaigns/pjf-dental-conquest/copy/subject-lines.md).
//
// Tone: confident, trustworthy, value-first. No emojis. No hard pitch (Phase 1).

import { BRAND } from './brand';
import { emailLayout, p, sectionLabel, callout, bullets, ctaRow } from './email-layout';

export interface EmailLinks {
  leadMagnetUrl: string; // gated guide LP (opt-in form)
  consultationUrl: string; // consultation LP (request form + Meetings)
  guideDownloadUrl: string; // direct guide PDF (post opt-in)
  projectsUrl: string; // pjfcorp.com projects page
}

export interface EmailSpec {
  key: string;
  slug: string;
  title: string;
  category: string;
  subjectInitial: string;
  subjectUrgent: string;
  preheaderInitial: string;
  preheaderUrgent: string;
  utmContent: string;
  html: string;
}

const SIGN = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;border-top:1px solid ${BRAND.colors.border};padding-top:14px;"><tr><td style="font-family:${BRAND.fonts.body};color:${BRAND.colors.text};font-size:15px;line-height:22px;">Talk soon,<br><strong>The PJF Corporation Team</strong><br><span style="color:${BRAND.colors.muted};font-size:13px;">Commercial construction for dental &amp; medical practices</span></td></tr></table>`;

export function buildEmails(links: EmailLinks): EmailSpec[] {
  // ── 1. Introduction (both segments) ──────────────────────────────
  const intro: EmailSpec = {
    key: 'intro',
    slug: 'pjf-dental-01-intro',
    title: 'Build, remodel, or expand — without the guesswork',
    category: 'cold-intro',
    subjectInitial: 'Planning a clinic build, remodel, or expansion?',
    subjectUrgent: 'Before you sign a clinic construction contract, read this',
    preheaderInitial:
      'A short, no-pitch series from the Utah contractor behind Tanner Clinic and Alpine Dental.',
    preheaderUrgent: 'The planning decisions that cost practices the most — and how to avoid them.',
    utmContent: 'intro-cta',
    html: emailLayout({
      preheader: 'A short, no-pitch series from the Utah contractor behind Tanner Clinic and Alpine Dental.',
      eyebrow: 'Dental & Medical Clinic Construction',
      title: 'Build, remodel, or expand — without the guesswork',
      body: [
        p(`Hi {{firstName}},`),
        p(
          `I'm with ${BRAND.company}. For 50+ years we've built and remodeled clinics across Northern Utah — operatories, imaging and surgical suites, and full practice fit-outs — for practices like Tanner Clinic, St. Mark's Hospital, and Alpine Dental.`,
        ),
        p(
          `Over the next few weeks I'll send a short, practical series for established practices weighing a build, remodel, or expansion: what to decide early, where projects slip, and how to keep seeing patients through it. No pitch — just the things we wish every practice knew before the first wall moves.`,
        ),
        callout(
          'First up: a free planning guide',
          `“What dentists should know before they build, remodel, or expand” — the budget, timeline, and design decisions that matter most.`,
        ),
        ctaRow([
          { label: 'Get the free guide', url: links.leadMagnetUrl, utm: 'intro-cta' },
          { label: 'View our projects', url: links.projectsUrl, utm: 'intro-projects', variant: 'secondary' },
        ]),
        SIGN,
      ].join('\n'),
    }),
  };

  // ── 2. Gated lead magnet ──────────────────────────────────────────
  const leadMagnet: EmailSpec = {
    key: 'lead_magnet',
    slug: 'pjf-dental-02-lead-magnet',
    title: 'What dentists should know before they build or remodel',
    category: 'cold-leadmagnet',
    subjectInitial: 'The clinic build & remodel guide we wish every practice had',
    subjectUrgent: '5 costly clinic construction mistakes (free guide inside)',
    preheaderInitial: 'Budget, timeline, and the design calls that matter most — free, no strings.',
    preheaderUrgent: 'A quick read before you budget your next build, remodel, or expansion.',
    utmContent: 'leadmagnet-cta',
    html: emailLayout({
      preheader: 'Budget, timeline, and the design calls that matter most — free, no strings.',
      eyebrow: 'Free Planning Guide',
      title: 'What dentists should know before they build or remodel',
      body: [
        p(`Hi {{firstName}},`),
        p(
          `Most clinic budgets don't blow up on construction — they blow up on decisions made (or skipped) before it. We put the big ones in a short, free guide for established practices.`,
        ),
        sectionLabel('Inside the guide'),
        bullets([
          'The 3 numbers to lock before you talk to any contractor',
          'Operatory &amp; equipment rough-ins that are costly to change later',
          'Imaging, plumbing &amp; electrical surprises in older Utah buildings',
          'How to keep seeing patients while you build (phasing that works)',
          'Remodel vs. expand vs. relocate: how to choose',
        ]),
        ctaRow([{ label: 'Download the free guide', url: links.leadMagnetUrl, utm: 'leadmagnet-cta' }]),
        p(`It's a two-minute read that can save months. Reply any time if you'd like it tailored to your space.`),
        SIGN,
      ].join('\n'),
    }),
  };

  // ── 3. Common mistakes — Segment A (oral surgery / specialty) ─────
  const mistakesA: EmailSpec = {
    key: 'mistakes_a',
    slug: 'pjf-dental-03-mistakes-specialists',
    title: 'Where specialty build-outs go over budget',
    category: 'cold-education',
    subjectInitial: 'Why oral surgery build-outs go over budget',
    subjectUrgent: 'Surgical suite over budget? Here’s why — and the fix',
    preheaderInitial: 'Imaging, surgical suites, and sedation — where complex builds slip.',
    preheaderUrgent: 'Surgical suites and CBCT are where complex builds quietly slip.',
    utmContent: 'mistakes-a-cta',
    html: emailLayout({
      preheader: 'Imaging, surgical suites, and sedation — where complex builds slip.',
      eyebrow: 'For Oral Surgery & Specialty Practices',
      title: 'Where specialty build-outs go over budget',
      body: [
        p(`Hi {{firstName}},`),
        p(
          `Oral surgery and surgical specialty spaces carry build complexity a general office doesn't. The overruns are predictable — and avoidable when they're planned for early.`,
        ),
        sectionLabel('The four we see most'),
        bullets([
          '<strong>CBCT / imaging shielding and power</strong> specified after layout is locked, forcing rework.',
          '<strong>Surgical suite MEP</strong> — medical gas, sedation support, and dedicated HVAC underscoped.',
          '<strong>Sterilization &amp; infection-control finishes</strong> chosen late, when lead times are longest.',
          '<strong>Expansion phasing</strong> that ignores how you keep operating during the build.',
        ]),
        callout(
          'The fix is sequence',
          `Nail equipment and clinical requirements before design, not after. That single change prevents most specialty overruns.`,
        ),
        p(`If it's useful, we're happy to walk through your specific space — no pitch, just a second set of eyes.`),
        ctaRow([{ label: 'Request a consultation', url: links.consultationUrl, utm: 'mistakes-a-cta' }]),
        SIGN,
      ].join('\n'),
    }),
  };

  // ── 4. Common mistakes — Segment B (general / family / cosmetic) ──
  const mistakesB: EmailSpec = {
    key: 'mistakes_b',
    slug: 'pjf-dental-03-mistakes-general',
    title: 'The remodel mistakes patients notice first',
    category: 'cold-education',
    subjectInitial: 'The remodel mistakes patients notice first',
    subjectUrgent: 'Patients notice these remodel mistakes first',
    preheaderInitial: 'Patient experience, flow, and finishes — small misses that cost goodwill.',
    preheaderUrgent: 'The small remodel misses that quietly cost patient goodwill.',
    utmContent: 'mistakes-b-cta',
    html: emailLayout({
      preheader: 'Patient experience, flow, and finishes — small misses that cost goodwill.',
      eyebrow: 'For General & Cosmetic Practices',
      title: 'The remodel mistakes patients notice first',
      body: [
        p(`Hi {{firstName}},`),
        p(
          `For general, family, and cosmetic practices, a remodel is a patient-experience project as much as a construction one. The misses that hurt most are the ones patients feel the moment they walk in.`,
        ),
        sectionLabel('The four we see most'),
        bullets([
          '<strong>Reception &amp; flow</strong> designed around staff, not the patient journey.',
          '<strong>Sound privacy</strong> between operatories and consults left as an afterthought.',
          '<strong>Lighting &amp; finishes</strong> that photograph poorly and age fast.',
          '<strong>Downtime</strong> — remodeling around a live schedule without a phasing plan.',
        ]),
        callout(
          'Design for the first 30 seconds',
          `Patients judge the space before they meet you. Small, early choices in flow and finish carry outsized weight.`,
        ),
        p(`Happy to share how we would approach your remodel — no pitch, just ideas you can use either way.`),
        ctaRow([{ label: 'Request a consultation', url: links.consultationUrl, utm: 'mistakes-b-cta' }]),
        SIGN,
      ].join('\n'),
    }),
  };

  // ── 5. Guide delivery (opt-in flow) ───────────────────────────────
  const guideDelivery: EmailSpec = {
    key: 'guide_delivery',
    slug: 'pjf-dental-guide-delivery',
    title: 'Your clinic build & remodel guide',
    category: 'opt-in',
    subjectInitial: 'Your clinic build guide is here, {{firstName}}',
    subjectUrgent: 'Here’s your clinic build & remodel guide',
    preheaderInitial: 'Your download link inside — plus what to read first.',
    preheaderUrgent: 'Download inside — start with the budget section.',
    utmContent: 'guide-download',
    html: emailLayout({
      preheader: 'Your download link inside — plus what to read first.',
      eyebrow: 'Your Guide Inside',
      title: 'Your guide is ready',
      body: [
        p(`Hi {{firstName}},`),
        p(`Thanks for grabbing “What dentists should know before they build, remodel, or expand.” Here's your copy:`),
        ctaRow([{ label: 'Download the guide (PDF)', url: links.guideDownloadUrl, utm: 'guide-download' }]),
        p(
          `Start with the budget section — it's the one most practices tell us they wish they'd read first. When you're ready to pressure-test your own plans, we're here.`,
        ),
        ctaRow([
          { label: 'Request a consultation', url: links.consultationUrl, utm: 'guide-consult', variant: 'secondary' },
        ]),
        SIGN,
      ].join('\n'),
    }),
  };

  // ── 6. Re-engagement (non-engaged branch) ─────────────────────────
  const reengage: EmailSpec = {
    key: 'reengage',
    slug: 'pjf-dental-reengage',
    title: 'In case it’s useful',
    category: 'cold-reengage',
    subjectInitial: 'Still planning a clinic project?',
    subjectUrgent: 'Did you miss our clinic planning guide?',
    preheaderInitial: `No pressure — just the free guide, in case it's useful.`,
    preheaderUrgent: 'One link, no pitch — the free planning guide.',
    utmContent: 'reengage-cta',
    html: emailLayout({
      preheader: `No pressure — just the free guide, in case it's useful.`,
      eyebrow: 'Still Planning?',
      title: 'In case it’s useful',
      body: [
        p(`Hi {{firstName}},`),
        p(
          `I sent over a short, free guide on planning a clinic build or remodel and wasn't sure it reached you. No pressure at all — here it is again if the timing's better now.`,
        ),
        ctaRow([{ label: 'Get the free guide', url: links.leadMagnetUrl, utm: 'reengage-cta' }]),
        p(`If a build or remodel isn't on the horizon, just reply “not now” and I'll close the loop.`),
        SIGN,
      ].join('\n'),
    }),
  };

  return [intro, leadMagnet, mistakesA, mistakesB, guideDelivery, reengage];
}
