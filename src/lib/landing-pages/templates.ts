/**
 * Landing page template presets.
 *
 * Hardcoded for v1 — same approach as Form templates. Each preset
 * returns a fresh `LandingPageTemplate` that's cloned into a new
 * LandingPage record on create. Templates aren't linked back; users
 * edit freely after creation.
 *
 * Adding a template: define it here, register in PRESETS, and the
 * picker modal lights up automatically.
 */
import type { LandingPageTemplate } from './types';
import { DEFAULT_LP_SETTINGS } from './types';

export interface LandingPageTemplatePreset {
  id: string;
  name: string;
  description: string;
  /** Heroicon name (string match) used by the picker chip. */
  icon:
    | 'sparkles'
    | 'cursor-arrow-rays'
    | 'rocket-launch'
    | 'calendar-days'
    | 'megaphone';
  /** Short label shown under the icon (e.g. "5 blocks"). */
  meta: string;
  build: () => LandingPageTemplate;
}

function makeId(prefix: string, idx: number): string {
  return `${prefix}-${idx}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Blank ────────────────────────────────────────────────────────
//
// "From scratch" — empty page. Users start with the Page Settings
// panel on the right and pick blocks from the left palette.

const BLANK: LandingPageTemplatePreset = {
  id: 'blank',
  name: 'Start from scratch',
  description: 'Empty canvas. Build the page block-by-block.',
  icon: 'sparkles',
  meta: 'Empty',
  build: () => ({
    version: '1',
    settings: { ...DEFAULT_LP_SETTINGS },
    blocks: [],
  }),
};

// ── Lead capture ────────────────────────────────────────────────
//
// The most common LP shape: a Hero with primary CTA, supporting
// features grid, social proof testimonial, FAQ, then a final CTA.
// The embedded form block stays empty (formId: '') so the user
// wires it to one of their existing forms after creation.

const LEAD_CAPTURE: LandingPageTemplatePreset = {
  id: 'lead-capture',
  name: 'Lead capture',
  description: 'Hero + features + testimonial + FAQ + closing CTA. Wire in a form to capture leads.',
  icon: 'cursor-arrow-rays',
  meta: '7 blocks',
  build: () => ({
    version: '1',
    settings: { ...DEFAULT_LP_SETTINGS, primaryColor: '#6366f1' },
    blocks: [
      {
        id: makeId('hero', 1),
        type: 'hero',
        props: {
          layout: 'centered',
          eyebrow: 'NEW',
          heading: 'Turn more visitors into customers.',
          subheading:
            'A plain-English explanation of the problem you solve and the outcome you deliver. Keep it short — two lines max.',
          primaryCtaLabel: 'Get started',
          primaryCtaHref: '#signup',
          secondaryCtaLabel: 'See how it works',
          secondaryCtaHref: '#features',
          imageSrc: '',
          minHeight: 480,
        },
      },
      {
        id: makeId('feat', 1),
        type: 'feature_grid',
        props: {
          columns: 3,
          heading: 'Why teams choose us',
          subheading: 'Three quick reasons to keep reading.',
          items: [
            { heading: 'Set up in minutes', body: 'No engineering required. Drop in a snippet and you\'re live.' },
            { heading: 'Built for scale', body: 'From your first 10 leads to your 10,000th, the same workflow.' },
            { heading: 'Plays well with others', body: 'Integrates with the tools your team already uses every day.' },
          ],
        },
      },
      {
        id: makeId('testi', 1),
        type: 'testimonial',
        props: {
          quote: '"This unblocked a workflow our team had been hacking around for months."',
          authorName: 'Alex Morgan',
          authorRole: 'Head of Growth, Acme Co',
          avatarSrc: '',
          align: 'center',
        },
      },
      {
        id: makeId('cta', 1),
        type: 'cta',
        props: {
          heading: 'Ready when you are.',
          body: 'Drop your email below and we\'ll be in touch within one business day.',
          ctaLabel: 'Get started',
          ctaHref: '#signup',
          buttonStyle: 'solid',
          align: 'center',
          backgroundColor: 'rgba(99,102,241,0.06)',
        },
      },
      {
        id: makeId('emb', 1),
        type: 'embedded_form',
        props: { formId: '', maxWidth: 640, align: 'center' },
      },
      {
        id: makeId('faq', 1),
        type: 'faq',
        props: {
          heading: 'Common questions',
          items: [
            { question: 'How long does setup take?', answer: 'Most teams are live in under 15 minutes.' },
            { question: 'Do I need a credit card to start?', answer: 'No. The starter plan is free, forever.' },
            { question: 'Can I migrate from another tool?', answer: 'Yes — our team will handle the import for you.' },
          ],
        },
      },
      {
        id: makeId('spc', 1),
        type: 'spacer',
        props: { height: 64 },
      },
    ],
  }),
};

// ── Coming soon ─────────────────────────────────────────────────
//
// Minimal "we're launching soon" page — hero + email capture + that's
// it. Designed to drop in front of a domain before the real product
// page is ready.

const COMING_SOON: LandingPageTemplatePreset = {
  id: 'coming-soon',
  name: 'Coming soon',
  description: 'Single-screen launch teaser. Hero + signup form. Drop a domain on this and walk away.',
  icon: 'rocket-launch',
  meta: '2 blocks',
  build: () => ({
    version: '1',
    settings: {
      ...DEFAULT_LP_SETTINGS,
      bodyBg: '#0a0a0a',
      contentBg: '#0a0a0a',
      textColor: '#ffffff',
      primaryColor: '#ffffff',
    },
    blocks: [
      {
        id: makeId('hero', 1),
        type: 'hero',
        props: {
          layout: 'centered',
          eyebrow: 'LAUNCHING SOON',
          heading: 'Something new is coming.',
          subheading: 'Drop your email and you\'ll be the first to know when we go live.',
          primaryCtaLabel: '',
          secondaryCtaLabel: '',
          backgroundColor: 'transparent',
          textColor: '#ffffff',
          minHeight: 360,
        },
      },
      {
        id: makeId('emb', 1),
        type: 'embedded_form',
        props: { formId: '', maxWidth: 480, align: 'center' },
      },
    ],
  }),
};

// ── Event / webinar ─────────────────────────────────────────────
//
// Event registration page: hero with date/time, agenda (as a feature
// grid), speakers (testimonial-styled), embedded RSVP form, FAQ.

const EVENT: LandingPageTemplatePreset = {
  id: 'event',
  name: 'Event / webinar',
  description: 'Date-driven landing page for webinars, workshops, or product demos.',
  icon: 'calendar-days',
  meta: '6 blocks',
  build: () => ({
    version: '1',
    settings: { ...DEFAULT_LP_SETTINGS },
    blocks: [
      {
        id: makeId('hero', 1),
        type: 'hero',
        props: {
          layout: 'centered',
          eyebrow: 'LIVE WEBINAR — JUNE 18, 2026',
          heading: 'How modern teams ship faster without breaking things.',
          subheading: 'A 45-minute deep dive with Q&A. Replay available for registrants who can\'t attend live.',
          primaryCtaLabel: 'Reserve your seat',
          primaryCtaHref: '#rsvp',
          minHeight: 440,
        },
      },
      {
        id: makeId('feat', 1),
        type: 'feature_grid',
        props: {
          columns: 3,
          heading: 'What we\'ll cover',
          items: [
            { heading: 'The problem', body: 'Why most release pipelines fight you instead of helping.' },
            { heading: 'The shift', body: 'A handful of small changes that compound.' },
            { heading: 'The Q&A', body: 'Bring your gnarliest deploy stories — we\'ll workshop them.' },
          ],
        },
      },
      {
        id: makeId('testi', 1),
        type: 'testimonial',
        props: {
          quote: '"Best 45 minutes I\'ve spent on professional development this year."',
          authorName: 'Sam Chen',
          authorRole: 'Engineering Manager, prior attendee',
          align: 'center',
        },
      },
      {
        id: makeId('cta', 1),
        type: 'cta',
        props: {
          heading: 'RSVP — it\'s free.',
          body: 'Drop your email below and we\'ll send the joining link an hour before we go live.',
          ctaLabel: '',
          align: 'center',
        },
      },
      {
        id: makeId('emb', 1),
        type: 'embedded_form',
        props: { formId: '', maxWidth: 560, align: 'center' },
      },
      {
        id: makeId('faq', 1),
        type: 'faq',
        props: {
          heading: 'Logistics',
          items: [
            { question: 'Will there be a recording?', answer: 'Yes — every registrant gets the replay link within 24 hours.' },
            { question: 'Can I submit a question in advance?', answer: 'Yes, there\'s a question field on the RSVP form.' },
            { question: 'What if my time zone is awkward?', answer: 'Register anyway and you\'ll get the replay.' },
          ],
        },
      },
    ],
  }),
};

// ── Product launch ──────────────────────────────────────────────

const PRODUCT_LAUNCH: LandingPageTemplatePreset = {
  id: 'product-launch',
  name: 'Product launch',
  description: 'Hero with image, features, social proof, big closing CTA. Visual-forward.',
  icon: 'megaphone',
  meta: '5 blocks',
  build: () => ({
    version: '1',
    settings: { ...DEFAULT_LP_SETTINGS },
    blocks: [
      {
        id: makeId('hero', 1),
        type: 'hero',
        props: {
          layout: 'split-right',
          eyebrow: 'INTRODUCING',
          heading: 'A new way to <thing your product does>.',
          subheading: 'Replace this with a single sentence that explains the product and what changes for the customer.',
          primaryCtaLabel: 'Try it free',
          primaryCtaHref: '#cta',
          secondaryCtaLabel: 'Watch the demo',
          secondaryCtaHref: '#demo',
          imageSrc: '',
          minHeight: 560,
        },
      },
      {
        id: makeId('feat', 1),
        type: 'feature_grid',
        props: {
          columns: 3,
          heading: 'What\'s inside',
          items: [
            { heading: 'Feature one', body: 'Replace with what makes this real for your customer.' },
            { heading: 'Feature two', body: 'Each cell should describe a concrete benefit.' },
            { heading: 'Feature three', body: 'Avoid vague buzzwords. Be specific.' },
          ],
        },
      },
      {
        id: makeId('logos', 1),
        type: 'logo_strip',
        props: { heading: 'Trusted by teams at', logos: [], grayscale: true },
      },
      {
        id: makeId('testi', 1),
        type: 'testimonial',
        props: {
          quote: '"A short, punchy quote from a customer here."',
          authorName: 'Jamie Reyes',
          authorRole: 'Director of Marketing, Globex',
          align: 'center',
        },
      },
      {
        id: makeId('cta', 1),
        type: 'cta',
        props: {
          heading: 'Ready to get started?',
          body: 'Free for 14 days. No credit card required.',
          ctaLabel: 'Start free trial',
          ctaHref: '#',
          buttonStyle: 'solid',
        },
      },
    ],
  }),
};

export const LP_TEMPLATE_PRESETS: LandingPageTemplatePreset[] = [
  BLANK,
  LEAD_CAPTURE,
  PRODUCT_LAUNCH,
  EVENT,
  COMING_SOON,
];

export function getLandingPagePreset(id: string): LandingPageTemplatePreset | undefined {
  return LP_TEMPLATE_PRESETS.find((p) => p.id === id);
}
