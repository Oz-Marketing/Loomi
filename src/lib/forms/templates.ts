/**
 * Form template presets.
 *
 * Hardcoded for v1 — these are simple starting points that get cloned
 * into a fresh Form record on creation. The user edits them in the
 * builder afterward; templates aren't linked back (no template-instance
 * relationship like Flows). If a template later proves popular enough
 * to track adoption / re-sync, we'll promote them to a DB-backed model
 * the same way Flows did.
 */
import type { FormTemplate } from './types';
import { DEFAULT_FORM_SETTINGS } from './types';

export interface FormTemplatePreset {
  id: string;
  name: string;
  description: string;
  /** Approximate field count — surfaced in the picker. */
  fieldCount: number;
  /** Heroicon name (string match) used by the picker chip. */
  icon:
    | 'envelope'
    | 'sparkles'
    | 'calendar-days'
    | 'cursor-arrow-rays'
    | 'document-text'
    | 'identification';
  build: () => FormTemplate;
}

function makeId(prefix: string, idx: number): string {
  return `${prefix}-${idx}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Blank ────────────────────────────────────────────────────────
//
// "From scratch" — minimal but not empty. Seeds a small but real
// baseline (heading, intro text, name, email, phone, submit) so the
// canvas isn't a blank rectangle when the user lands in the builder.
// They can wipe it, drag from the palette, or just tweak the seed.

const BLANK: FormTemplatePreset = {
  id: 'blank',
  name: 'Start from scratch',
  description: 'A small starter form (heading, name, email, phone, submit). Tweak to taste.',
  fieldCount: 3,
  icon: 'sparkles',
  build: () => ({
    version: '1',
    settings: {
      ...DEFAULT_FORM_SETTINGS,
      contentWidth: 560,
    },
    blocks: [
      {
        id: makeId('h', 1),
        type: 'heading',
        props: {
          text: 'Your form title',
          level: 1,
          fontSize: 30,
          fontWeight: 700,
          align: 'left',
          color: '#0f172a',
          marginBottom: 8,
        },
      },
      {
        id: makeId('t', 1),
        type: 'text',
        props: {
          text: "Short intro line — tell visitors what this form is for and they'll fill it out.",
          fontSize: 15,
          lineHeight: 1.55,
          color: '#475569',
          align: 'left',
          marginBottom: 28,
        },
      },
      {
        id: makeId('f', 1),
        type: 'field_text',
        props: {
          label: 'Full name',
          placeholder: 'Jane Doe',
          required: true,
          name: 'name',
          inputBorderRadius: 8,
          inputPaddingY: 11,
          marginBottom: 18,
        },
      },
      {
        id: makeId('f', 2),
        type: 'field_email',
        props: {
          label: 'Email',
          placeholder: 'you@example.com',
          required: true,
          name: 'email',
          inputBorderRadius: 8,
          inputPaddingY: 11,
          marginBottom: 18,
        },
      },
      {
        id: makeId('f', 3),
        type: 'field_phone',
        props: {
          label: 'Phone',
          placeholder: '(555) 555-5555',
          required: false,
          name: 'phone',
          inputBorderRadius: 8,
          inputPaddingY: 11,
          marginBottom: 28,
        },
      },
      {
        id: makeId('s', 1),
        type: 'submit_button',
        props: {
          text: 'Submit',
          fullWidth: false,
          align: 'left',
          paddingY: 12,
          paddingX: 28,
          borderRadius: 8,
          fontWeight: 600,
        },
      },
    ],
  }),
};

// ── Contact form ─────────────────────────────────────────────────

const CONTACT: FormTemplatePreset = {
  id: 'contact',
  name: 'Contact form',
  description: 'Name, email, message, consent. The classic "Get in touch" form.',
  fieldCount: 4,
  icon: 'envelope',
  build: () => ({
    version: '1',
    title: 'Contact form',
    settings: { ...DEFAULT_FORM_SETTINGS },
    blocks: [
      {
        id: makeId('h', 1),
        type: 'heading',
        props: {
          text: 'Get in touch',
          level: 1,
          fontSize: 28,
          fontWeight: 700,
          align: 'left',
          marginBottom: 8,
        },
      },
      {
        id: makeId('t', 1),
        type: 'text',
        props: {
          text: "Tell us a little about yourself and we'll get back to you within a business day.",
          fontSize: 14,
          color: '#6b7280',
          marginBottom: 24,
        },
      },
      {
        id: makeId('f', 1),
        type: 'field_text',
        props: { label: 'Name', placeholder: 'Jane Doe', required: true, name: 'name' },
      },
      {
        id: makeId('f', 2),
        type: 'field_email',
        props: { label: 'Email', placeholder: 'you@example.com', required: true, name: 'email' },
      },
      {
        id: makeId('f', 3),
        type: 'field_textarea',
        props: {
          label: 'How can we help?',
          placeholder: 'A few sentences is fine.',
          rows: 4,
          required: true,
          name: 'message',
        },
      },
      {
        id: makeId('f', 4),
        type: 'field_consent',
        props: {
          label: 'I agree to be contacted about my inquiry.',
          required: true,
          name: 'consent',
        },
      },
      {
        id: makeId('s', 1),
        type: 'submit_button',
        props: { text: 'Send message', fullWidth: false, align: 'left' },
      },
    ],
  }),
};

// ── Newsletter signup ────────────────────────────────────────────

const NEWSLETTER: FormTemplatePreset = {
  id: 'newsletter',
  name: 'Newsletter signup',
  description: 'Single-field email capture with a marketing-consent checkbox.',
  fieldCount: 2,
  icon: 'cursor-arrow-rays',
  build: () => ({
    version: '1',
    title: 'Newsletter signup',
    settings: { ...DEFAULT_FORM_SETTINGS, contentWidth: 480 },
    blocks: [
      {
        id: makeId('h', 1),
        type: 'heading',
        props: {
          text: 'Join the newsletter',
          level: 2,
          fontSize: 24,
          fontWeight: 700,
          align: 'center',
          marginBottom: 8,
        },
      },
      {
        id: makeId('t', 1),
        type: 'text',
        props: {
          text: 'One email a week. The good stuff only.',
          fontSize: 14,
          color: '#6b7280',
          align: 'center',
          marginBottom: 24,
        },
      },
      {
        id: makeId('f', 1),
        type: 'field_email',
        props: { label: 'Email', placeholder: 'you@example.com', required: true, name: 'email' },
      },
      {
        id: makeId('f', 2),
        type: 'field_consent',
        props: {
          label: 'Send me marketing emails about new products and offers.',
          required: false,
          name: 'marketing_consent',
        },
      },
      {
        id: makeId('s', 1),
        type: 'submit_button',
        props: { text: 'Subscribe', fullWidth: true, align: 'center' },
      },
    ],
  }),
};

// ── Lead magnet ──────────────────────────────────────────────────

const LEAD_MAGNET: FormTemplatePreset = {
  id: 'lead-magnet',
  name: 'Lead magnet',
  description: 'First name + email — short forms convert best for gated content.',
  fieldCount: 2,
  icon: 'document-text',
  build: () => ({
    version: '1',
    title: 'Get the guide',
    settings: { ...DEFAULT_FORM_SETTINGS, contentWidth: 480 },
    blocks: [
      {
        id: makeId('h', 1),
        type: 'heading',
        props: {
          text: 'Send me the guide',
          level: 2,
          fontSize: 24,
          fontWeight: 700,
          align: 'left',
          marginBottom: 8,
        },
      },
      {
        id: makeId('t', 1),
        type: 'text',
        props: {
          text: "We'll email it to you immediately.",
          fontSize: 14,
          color: '#6b7280',
          marginBottom: 24,
        },
      },
      {
        id: makeId('f', 1),
        type: 'field_text',
        props: { label: 'First name', placeholder: '', required: true, name: 'first_name' },
      },
      {
        id: makeId('f', 2),
        type: 'field_email',
        props: { label: 'Email', placeholder: '', required: true, name: 'email' },
      },
      {
        id: makeId('s', 1),
        type: 'submit_button',
        props: { text: 'Send me the guide', fullWidth: true, align: 'left' },
      },
    ],
  }),
};

// ── Event RSVP ───────────────────────────────────────────────────

const EVENT_RSVP: FormTemplatePreset = {
  id: 'event-rsvp',
  name: 'Event RSVP',
  description: 'Name, email, party size, dietary note. Tweak for your event.',
  fieldCount: 4,
  icon: 'calendar-days',
  build: () => ({
    version: '1',
    title: 'Event RSVP',
    settings: { ...DEFAULT_FORM_SETTINGS },
    blocks: [
      {
        id: makeId('h', 1),
        type: 'heading',
        props: {
          text: 'RSVP',
          level: 1,
          fontSize: 28,
          fontWeight: 700,
          align: 'left',
          marginBottom: 8,
        },
      },
      {
        id: makeId('t', 1),
        type: 'text',
        props: {
          text: 'Let us know you can make it.',
          fontSize: 14,
          color: '#6b7280',
          marginBottom: 24,
        },
      },
      {
        id: makeId('f', 1),
        type: 'field_text',
        props: { label: 'Full name', placeholder: '', required: true, name: 'name' },
      },
      {
        id: makeId('f', 2),
        type: 'field_email',
        props: { label: 'Email', placeholder: '', required: true, name: 'email' },
      },
      {
        id: makeId('f', 3),
        type: 'field_select',
        props: {
          label: 'How many in your party?',
          required: true,
          name: 'party_size',
          options: [
            { label: 'Just me', value: '1' },
            { label: '2', value: '2' },
            { label: '3', value: '3' },
            { label: '4', value: '4' },
            { label: '5 or more', value: '5+' },
          ],
        },
      },
      {
        id: makeId('f', 4),
        type: 'field_textarea',
        props: {
          label: 'Dietary needs or notes',
          placeholder: 'Allergies, accessibility, etc.',
          rows: 3,
          required: false,
          name: 'notes',
        },
      },
      {
        id: makeId('s', 1),
        type: 'submit_button',
        props: { text: 'Confirm attendance', fullWidth: false, align: 'left' },
      },
    ],
  }),
};

// ── Demo request ─────────────────────────────────────────────────

const DEMO_REQUEST: FormTemplatePreset = {
  id: 'demo-request',
  name: 'Demo request',
  description: 'Qualifying questions for sales — name, company, role, fit.',
  fieldCount: 5,
  icon: 'identification',
  build: () => ({
    version: '1',
    title: 'Request a demo',
    settings: { ...DEFAULT_FORM_SETTINGS },
    blocks: [
      {
        id: makeId('h', 1),
        type: 'heading',
        props: {
          text: 'See it in action',
          level: 1,
          fontSize: 28,
          fontWeight: 700,
          align: 'left',
          marginBottom: 8,
        },
      },
      {
        id: makeId('t', 1),
        type: 'text',
        props: {
          text: 'A 20-minute walkthrough tailored to your team.',
          fontSize: 14,
          color: '#6b7280',
          marginBottom: 24,
        },
      },
      {
        id: makeId('f', 1),
        type: 'field_text',
        props: { label: 'Full name', placeholder: '', required: true, name: 'name' },
      },
      {
        id: makeId('f', 2),
        type: 'field_email',
        props: { label: 'Work email', placeholder: '', required: true, name: 'email' },
      },
      {
        id: makeId('f', 3),
        type: 'field_text',
        props: { label: 'Company', placeholder: '', required: true, name: 'company' },
      },
      {
        id: makeId('f', 4),
        type: 'field_text',
        props: { label: 'Role', placeholder: 'e.g. Marketing Director', required: false, name: 'role' },
      },
      {
        id: makeId('f', 5),
        type: 'field_textarea',
        props: {
          label: "What problem are you trying to solve?",
          rows: 4,
          required: false,
          name: 'use_case',
        },
      },
      {
        id: makeId('s', 1),
        type: 'submit_button',
        props: { text: 'Request demo', fullWidth: false, align: 'left' },
      },
    ],
  }),
};

// ── Catalog ──────────────────────────────────────────────────────

// Order is the presentation order in the picker. Blank goes first
// so users with no template preference don't have to scroll.
export const FORM_TEMPLATE_PRESETS: FormTemplatePreset[] = [
  BLANK,
  CONTACT,
  NEWSLETTER,
  LEAD_MAGNET,
  EVENT_RSVP,
  DEMO_REQUEST,
];

export function getFormTemplatePreset(id: string): FormTemplatePreset | undefined {
  return FORM_TEMPLATE_PRESETS.find((p) => p.id === id);
}
