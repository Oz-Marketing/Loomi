/**
 * Deterministic FormTemplate builder for the AI Campaign Builder.
 *
 * We do NOT ask the model for raw form-block JSON (that's fragile). Instead the
 * planner proposes a small list of field labels, and this maps them to valid
 * form blocks with stable snake_case names, always including an email field
 * (the submission pipeline upserts the Contact by it) and exactly one submit
 * button. The form is styled from the account's brand colors.
 */
import { DEFAULT_FORM_SETTINGS, type Block, type FormBlockType, type FormTemplate } from '@/lib/forms/types';
import type { CampaignPlanFormSpec } from '@/lib/campaigns/types';

/** Pull brand hexes out of the account-context string (built by buildAccountContext). */
function parseBrandColors(ctx?: string): { primary?: string; accent?: string; background?: string; text?: string } {
  if (!ctx) return {};
  const get = (k: string) => ctx.match(new RegExp(`${k}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  return { primary: get('primary'), accent: get('accent'), background: get('background'), text: get('text') };
}

function blockId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function snake(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field';
}

/** Map a human field label to a form field block with a stable unique name. */
function fieldBlockFor(label: string, used: Set<string>): Block {
  const l = label.toLowerCase();
  let type: FormBlockType = 'field_text';
  let name = snake(label);

  if (l.includes('email') || /\be-?mail\b/.test(l)) {
    type = 'field_email';
    name = 'email';
  } else if (l.includes('phone') || l.includes('mobile') || l.includes('cell') || /\btel\b/.test(l)) {
    type = 'field_phone';
    name = 'phone';
  } else if (l.includes('message') || l.includes('comment') || l.includes('note') || l.includes('question')) {
    type = 'field_textarea';
  } else if (l === 'name' || l.includes('full name')) {
    name = 'name';
  } else if (l.includes('first')) {
    name = 'first_name';
  } else if (l.includes('last')) {
    name = 'last_name';
  }

  let unique = name;
  let n = 1;
  while (used.has(unique)) {
    n += 1;
    unique = `${name}_${n}`;
  }
  used.add(unique);

  const props: Record<string, unknown> = {
    label,
    name: unique,
    required: type === 'field_email',
    placeholder: '',
    marginBottom: 16,
    ...(type === 'field_textarea' ? { rows: 4 } : {}),
  };
  return { id: blockId(type), type, props };
}

export function buildFormTemplate(
  spec: CampaignPlanFormSpec,
  opts: { accountContext?: string } = {},
): { schema: FormTemplate; name: string } {
  const colors = parseBrandColors(opts.accountContext);
  const used = new Set<string>();

  const labels = (spec.fields ?? []).map((s) => s.trim()).filter(Boolean);
  const effective = labels.length > 0 ? labels : ['Full name', 'Email', 'Phone'];
  const fieldBlocks = effective.map((l) => fieldBlockFor(l, used));
  // Lead capture needs an email — submissions upsert the Contact by it.
  if (!fieldBlocks.some((b) => b.type === 'field_email')) {
    fieldBlocks.push(fieldBlockFor('Email', used));
  }

  const blocks: Block[] = [
    {
      id: blockId('heading'),
      type: 'heading',
      props: {
        text: spec.purpose || 'Get in touch',
        level: 2,
        fontSize: 24,
        fontWeight: 700,
        align: 'left',
        color: colors.text || '#1a1a1a',
        marginBottom: 12,
      },
    },
    ...fieldBlocks,
    {
      id: blockId('submit'),
      type: 'submit_button',
      props: {
        text: 'Submit',
        fullWidth: true,
        align: 'center',
        bgColor: colors.primary || '#1a1a1a',
        textColor: '#ffffff',
        borderRadius: 8,
        paddingY: 14,
        paddingX: 24,
        fontSize: 15,
        fontWeight: 600,
      },
    },
  ];

  const settings = {
    ...DEFAULT_FORM_SETTINGS,
    ...(colors.background ? { contentBg: colors.background } : {}),
    ...(colors.text ? { textColor: colors.text } : {}),
  };

  return {
    schema: { version: '1', title: spec.purpose, settings, blocks },
    name: spec.purpose || 'Lead form',
  };
}
