// PJF campaign — opt-in + consultation request forms (v1 FormTemplate).
//
// Field `name` keys matter: field_email → email identifier, field_phone →
// phone, and a text field named "firstName"/"lastName" maps onto the Contact
// (see src/lib/forms/validate.ts). practice_name / specialty are captured in
// the submission record. Tagging + CRM handoff happen in the form_submission
// flows, NOT on the form (so forwardToCrm stays false here).

import type { FormTemplate } from '@/lib/forms/types';
import { BRAND } from './brand';

const c = BRAND.colors;

const settings = {
  bodyBg: c.softBg,
  contentBg: c.background,
  contentWidth: 560,
  contentPaddingTop: 32,
  contentPaddingRight: 32,
  contentPaddingBottom: 32,
  contentPaddingLeft: 32,
  contentMarginTop: 24,
  contentMarginRight: 16,
  contentMarginBottom: 24,
  contentMarginLeft: 16,
  contentBorderRadius: 12,
  fontFamily: BRAND.fonts.body,
  textColor: c.text,
};

const submitButton = (label: string) => ({
  id: 'submit_1',
  type: 'submit_button' as const,
  props: { label, bgColor: c.primary, textColor: '#ffffff' },
});

const heading = (text: string) => ({
  id: 'heading_1',
  type: 'heading' as const,
  props: { text, level: 'h2', alignment: 'left', color: c.primary },
});

const intro = (content: string) => ({
  id: 'text_1',
  type: 'text' as const,
  props: { content, alignment: 'left', color: c.text },
});

export interface FormSpec {
  name: string;
  slug: string;
  successMessage: string;
  /** Optional external redirect after submit (e.g. guide download). */
  redirectUrl?: string;
  schema: FormTemplate;
}

// ── Lead-magnet opt-in form (gated guide) ───────────────────────────
export const leadMagnetForm: FormSpec = {
  name: 'PJF — Clinic Build Guide (Opt-in)',
  slug: 'pjf-clinic-build-guide',
  successMessage:
    'Thanks! Your guide is on its way to your inbox. Check your email in the next few minutes.',
  schema: {
    version: '1',
    title: 'Get the free clinic build guide',
    settings,
    blocks: [
      heading('Get “What dentists should know before building a clinic”'),
      intro(
        'Tell us where to send it. No spam — just the guide, and the occasional clinic-build resource you can opt out of any time.',
      ),
      {
        id: 'f_first',
        type: 'field_text',
        props: { name: 'firstName', label: 'First name', required: true, placeholder: 'Jordan' },
      },
      {
        id: 'f_last',
        type: 'field_text',
        props: { name: 'lastName', label: 'Last name', required: false, placeholder: 'Lee' },
      },
      {
        id: 'f_email',
        type: 'field_email',
        props: {
          name: 'email',
          label: 'Work email',
          required: true,
          placeholder: 'you@yourpractice.com',
        },
      },
      {
        id: 'f_practice',
        type: 'field_text',
        props: {
          name: 'practice_name',
          label: 'Practice / clinic name',
          required: false,
          placeholder: 'Wasatch Family Dental',
        },
      },
      {
        id: 'f_consent',
        type: 'field_consent',
        props: {
          name: 'consent',
          label:
            'Send me the guide and occasional clinic build/remodel resources from PJF Corporation. I can unsubscribe any time.',
          required: true,
        },
      },
      submitButton('Send me the guide'),
    ],
  } as unknown as FormTemplate,
};

// ── Consultation request form (qualified trigger) ───────────────────
export const consultationForm: FormSpec = {
  name: 'PJF — Request a Consultation',
  slug: 'pjf-request-consultation',
  successMessage:
    'Thanks — we’ll be in touch shortly. Prefer to pick a time now? Use the scheduler on this page to grab a slot.',
  schema: {
    version: '1',
    title: 'Request a consultation',
    settings,
    blocks: [
      heading('Talk through your clinic project'),
      intro(
        'Tell us a little about your build or remodel and we’ll follow up. No obligation — just a conversation with a contractor who builds clinics.',
      ),
      {
        id: 'f_first',
        type: 'field_text',
        props: { name: 'firstName', label: 'First name', required: true, placeholder: 'Jordan' },
      },
      {
        id: 'f_last',
        type: 'field_text',
        props: { name: 'lastName', label: 'Last name', required: false, placeholder: 'Lee' },
      },
      {
        id: 'f_email',
        type: 'field_email',
        props: {
          name: 'email',
          label: 'Work email',
          required: true,
          placeholder: 'you@yourpractice.com',
        },
      },
      {
        id: 'f_phone',
        type: 'field_phone',
        props: { name: 'phone', label: 'Phone', required: false, placeholder: '(801) 555-0123' },
      },
      {
        id: 'f_practice',
        type: 'field_text',
        props: {
          name: 'practice_name',
          label: 'Practice / clinic name',
          required: false,
          placeholder: 'Wasatch Family Dental',
        },
      },
      {
        id: 'f_project',
        type: 'field_textarea',
        props: {
          name: 'project_notes',
          label: 'What are you planning?',
          required: false,
          placeholder: 'New build, remodel, expansion, timeline, location…',
        },
      },
      {
        id: 'f_consent',
        type: 'field_consent',
        props: {
          name: 'consent',
          label: 'It’s OK for PJF Corporation to contact me about my project.',
          required: true,
        },
      },
      submitButton('Request my consultation'),
    ],
  } as unknown as FormTemplate,
};
