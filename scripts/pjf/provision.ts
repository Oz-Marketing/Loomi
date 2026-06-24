/**
 * PJF Corporation — Dental/Medical Conquest Campaign (Phase 1) provisioner.
 *
 * Idempotent. Builds the campaign LIVE on the PJF Corp subaccount via Loomi's
 * own service layer (same code paths the app uses). Re-running updates in
 * place (account, fields, forms, pages, templates) and fully rebuilds flows.
 *
 *   DATABASE_URL=... npx tsx scripts/pjf/provision.ts
 *
 * Builds, in order:
 *   1. PJF Corp subaccount (branding, address, sender identity, quiet hours)
 *   2. Custom fields (practice_name, job_title, specialty, segment, region,
 *      consent_date, consent_source, lifecycle_stage)
 *   3. "PJF Prospects" contact list
 *   4. Forms: lead-magnet opt-in + consultation request (published)
 *   5. Landing pages: gated guide + consultation (published, forms embedded)
 *   6. Email templates: intro, lead-magnet, mistakes A/B, guide-delivery,
 *      re-engagement (account-scoped HTML, flow-ready)
 *   7. Flows (published): cold sequence, opt-in capture, qualified→HubSpot
 *
 * HubSpot push_to_crm is built but inert until a CRM destination is connected.
 */

import { prisma } from '@/lib/prisma';
import { createAccount, getAccount, updateAccount } from '@/lib/services/accounts';
import { createField, listFieldsForAccount } from '@/lib/services/contact-custom-fields';
import { createList } from '@/lib/services/contact-lists';
import { createForm, updateForm } from '@/lib/services/forms';
import { createLandingPage, updateLandingPage } from '@/lib/services/landing-pages';
import {
  createFlow,
  updateFlow,
  updateFlowGraph,
  createTrigger,
  publishFlow,
  type FlowSettings,
} from '@/lib/services/loomi-flows';
import type { NodeType, TriggerType } from '@/lib/flows/validation';
import type { CustomFieldType } from '@/lib/contacts/custom-field-types';

import { ACCOUNT_KEY, ACCOUNT_SLUG, BRAND, TAGS, PUBLIC_BASE, LEAD_MAGNET_PDF_PLACEHOLDER } from './brand';
import { buildEmails } from './emails';
import { leadMagnetForm, consultationForm, type FormSpec } from './forms';
import { leadMagnetLP, consultationLP } from './pages';

const DAY = 86_400_000;
const log = (m: string) => console.log(m);

type GNode = { id?: string; type: NodeType; config: unknown; x: number; y: number };
type GEdge = { fromNodeId: string; toNodeId: string; branch?: string | null };

// ── 1. Account ──────────────────────────────────────────────────────
async function upsertAccount() {
  const branding = JSON.stringify({
    colors: {
      primary: BRAND.colors.primary,
      secondary: BRAND.colors.secondary,
      accent: BRAND.colors.accent,
      background: BRAND.colors.background,
      text: BRAND.colors.text,
    },
    fonts: { heading: BRAND.fonts.headingName, body: BRAND.fonts.bodyName },
  });
  const logos = JSON.stringify({ light: BRAND.logoLight });

  const base = {
    dealer: BRAND.company,
    category: BRAND.category,
    email: BRAND.email,
    phone: BRAND.phone,
    address: BRAND.address,
    city: BRAND.city,
    state: BRAND.state,
    postalCode: BRAND.postalCode,
    website: BRAND.website,
    timezone: BRAND.timezone,
    logos,
    branding,
  };

  const existing = await getAccount(ACCOUNT_KEY);
  if (!existing) {
    await createAccount({ key: ACCOUNT_KEY, slug: ACCOUNT_SLUG, ...base });
    log(`  created account ${ACCOUNT_KEY}`);
  } else {
    log(`  account ${ACCOUNT_KEY} exists — updating`);
  }
  // updateAccount also carries the sending identity (createAccount doesn't).
  await updateAccount(ACCOUNT_KEY, {
    ...base,
    senderEmail: BRAND.senderEmail,
    senderName: BRAND.senderName,
    sendingDomain: BRAND.sendingDomain,
    replyToEmail: BRAND.replyToEmail,
  });
}

// ── 2. Custom fields ────────────────────────────────────────────────
const FIELDS: Array<{
  key: string;
  label: string;
  type: CustomFieldType;
  options?: { value: string; label: string }[];
  csvAliases: string[];
}> = [
  { key: 'practice_name', label: 'Practice / Clinic Name', type: 'text', csvAliases: ['practice', 'practice name', 'clinic', 'clinic name', 'company'] },
  { key: 'job_title', label: 'Title', type: 'text', csvAliases: ['title', 'job title', 'role'] },
  { key: 'specialty', label: 'Specialty', type: 'text', csvAliases: ['specialty', 'speciality'] },
  {
    key: 'segment',
    label: 'Segment',
    type: 'select',
    options: [
      { value: 'A', label: 'A — Specialists' },
      { value: 'B', label: 'B — General / Cosmetic / Medical' },
    ],
    csvAliases: ['segment', 'seg'],
  },
  { key: 'region', label: 'Region', type: 'text', csvAliases: ['region', 'area', 'county', 'metro'] },
  { key: 'consent_date', label: 'Consent Date', type: 'date', csvAliases: ['consent date', 'consentdate'] },
  { key: 'consent_source', label: 'Consent Source', type: 'text', csvAliases: ['consent source', 'source of consent'] },
  {
    key: 'lifecycle_stage',
    label: 'Lifecycle Stage',
    type: 'select',
    options: [
      { value: 'prospect', label: 'Prospect' },
      { value: 'engaged', label: 'Engaged' },
      { value: 'opted_in', label: 'Opted In' },
      { value: 'qualified', label: 'Qualified' },
      { value: 'handoff', label: 'Handoff' },
    ],
    csvAliases: ['lifecycle', 'stage', 'lifecycle stage'],
  },
];

async function ensureFields() {
  const existing = new Set((await listFieldsForAccount(ACCOUNT_KEY)).map((f) => f.key));
  for (const f of FIELDS) {
    if (existing.has(f.key)) {
      log(`  field ${f.key} exists`);
      continue;
    }
    await createField({
      accountKey: ACCOUNT_KEY,
      key: f.key,
      label: f.label,
      type: f.type,
      options: f.options ?? null,
      category: 'PJF Campaign',
      csvAliases: f.csvAliases,
    });
    log(`  + field ${f.key}`);
  }
}

// ── 3. List ─────────────────────────────────────────────────────────
async function ensureList(): Promise<string> {
  const existing = await prisma.contactList.findFirst({
    where: { accountKey: ACCOUNT_KEY, name: 'PJF Prospects' },
  });
  if (existing) return existing.id;
  const l = await createList({
    name: 'PJF Prospects',
    accountKey: ACCOUNT_KEY,
    description: 'Cold conquest list — Utah dental & medical practices (Apollo export).',
  });
  log('  + list "PJF Prospects"');
  return l.id;
}

// ── 4. Forms ────────────────────────────────────────────────────────
async function ensureForm(spec: FormSpec): Promise<{ id: string; slug: string }> {
  let form = await prisma.form.findFirst({ where: { accountKey: ACCOUNT_KEY, name: spec.name } });
  if (!form) {
    const created = await createForm({
      accountKey: ACCOUNT_KEY,
      name: spec.name,
      schema: spec.schema,
      isTemplate: false,
    });
    form = await prisma.form.findUnique({ where: { id: created.id } });
  }
  const updated = await updateForm(form!.id, null, {
    schema: spec.schema,
    status: 'published',
    successMessage: spec.successMessage,
    forwardToCrm: false, // CRM handoff happens in the qualified flow, not the form
    ...(spec.redirectUrl ? { redirectUrl: spec.redirectUrl } : {}),
  });
  log(`  ✓ form "${updated.name}" → /f/${updated.slug}`);
  return { id: updated.id, slug: updated.slug };
}

// ── 5. Landing pages ────────────────────────────────────────────────
async function ensureLP(
  name: string,
  schema: ReturnType<typeof leadMagnetLP>,
  seoTitle: string,
  seoDescription: string,
): Promise<{ id: string; slug: string; publicUrl: string }> {
  let lp = await prisma.landingPage.findFirst({ where: { accountKey: ACCOUNT_KEY, name } });
  if (!lp) {
    const created = await createLandingPage({
      accountKey: ACCOUNT_KEY,
      name,
      schema,
      isTemplate: false,
    });
    lp = await prisma.landingPage.findUnique({ where: { id: created.id } });
  }
  const updated = await updateLandingPage(lp!.id, null, {
    schema,
    status: 'published',
    seoTitle,
    seoDescription,
  });
  const publicUrl = updated.publicUrl || `${PUBLIC_BASE}/lp/${updated.slug}`;
  log(`  ✓ page "${updated.name}" → /lp/${updated.slug}`);
  return { id: updated.id, slug: updated.slug, publicUrl };
}

// ── 6. Email templates ──────────────────────────────────────────────
async function upsertTemplate(spec: {
  slug: string;
  title: string;
  category: string;
  preheaderInitial: string;
  html: string;
}): Promise<string> {
  const row = await prisma.template.upsert({
    where: { slug: spec.slug },
    create: {
      slug: spec.slug,
      accountKey: ACCOUNT_KEY,
      title: spec.title,
      type: 'design',
      category: spec.category,
      content: spec.html,
      preheader: spec.preheaderInitial,
      published: true,
      publishedAt: new Date(),
    },
    update: {
      title: spec.title,
      category: spec.category,
      content: spec.html,
      preheader: spec.preheaderInitial,
    },
  });
  log(`  ✓ template ${spec.slug}`);
  return row.id;
}

// ── 7. Flows ────────────────────────────────────────────────────────
async function resetFlows() {
  const existing = await prisma.loomiFlow.findMany({
    where: { accountKey: ACCOUNT_KEY, name: { startsWith: 'PJF —' } },
    select: { id: true },
  });
  for (const f of existing) await prisma.loomiFlow.delete({ where: { id: f.id } });
  if (existing.length) log(`  reset ${existing.length} existing PJF flow(s)`);
}

async function buildFlow(opts: {
  name: string;
  description: string;
  settings: FlowSettings;
  nodes: GNode[]; // edges may reference 'TRIGGER' as the seed-trigger placeholder
  edges: GEdge[];
  trigger: { type: TriggerType; config: unknown };
}): Promise<void> {
  const flow = await createFlow({
    name: opts.name,
    description: opts.description,
    accountKey: ACCOUNT_KEY,
  });
  const seed = flow.nodes.find((n) => n.type === 'trigger');
  if (!seed) throw new Error(`${opts.name}: no seed trigger node`);

  const nodes: GNode[] = [{ id: seed.id, type: 'trigger', config: {}, x: 80, y: 80 }, ...opts.nodes];
  const edges: GEdge[] = opts.edges.map((e) => ({
    branch: e.branch ?? null,
    fromNodeId: e.fromNodeId === 'TRIGGER' ? seed.id : e.fromNodeId,
    toNodeId: e.toNodeId === 'TRIGGER' ? seed.id : e.toNodeId,
  }));

  await updateFlowGraph(flow.id, { nodes, edges });
  await updateFlow(flow.id, { settings: opts.settings });
  await createTrigger(flow.id, { type: opts.trigger.type, config: opts.trigger.config, enabled: true });
  const published = await publishFlow(flow.id);
  log(`  ✓ flow "${opts.name}" → ${published.status}`);
}

const businessHours: FlowSettings = {
  reEntry: { policy: 'never' },
  quietHours: { enabled: true, start: '08:00', end: '17:00' },
  goal: { enabled: true, type: 'tag-added', value: TAGS.optedIn },
  maxDuration: { enabled: true, days: 45 },
  dndHandling: 'skip',
};
const prompt: FlowSettings = {
  reEntry: { policy: 'never' },
  quietHours: { enabled: false, start: '08:00', end: '17:00' },
  goal: { enabled: false, type: 'tag-added', value: '' },
  maxDuration: { enabled: false, days: 30 },
  dndHandling: 'skip',
};

// ── Orchestrate ─────────────────────────────────────────────────────
async function main() {
  log('\n=== PJF Dental/Medical Conquest — Phase 1 provisioning ===\n');

  log('[1/7] Account');
  await upsertAccount();

  log('[2/7] Custom fields');
  await ensureFields();

  log('[3/7] Contact list');
  const listId = await ensureList();

  log('[4/7] Forms');
  const lmForm = await ensureForm(leadMagnetForm);
  const consultForm = await ensureForm(consultationForm);

  log('[5/7] Landing pages');
  const lmPage = await ensureLP(
    'PJF — Clinic Build Guide (Lead Magnet)',
    leadMagnetLP(lmForm.id),
    'Free Guide: What Dentists Should Know Before Building a Clinic | PJF Corporation',
    'A free planning guide from a Utah commercial contractor specializing in dental & medical clinic construction.',
  );
  const consultPage = await ensureLP(
    'PJF — Request a Consultation',
    consultationLP(consultForm.id),
    'Request a Consultation | PJF Corporation',
    'Talk through your dental or medical clinic build or remodel with PJF Corporation.',
  );

  log('[6/7] Email templates');
  const emails = buildEmails({
    leadMagnetUrl: lmPage.publicUrl,
    consultationUrl: consultPage.publicUrl,
    guideDownloadUrl: LEAD_MAGNET_PDF_PLACEHOLDER,
    projectsUrl: `${BRAND.website}/projects`,
  });
  const tpl: Record<string, { id: string; subject: string }> = {};
  for (const e of emails) {
    const id = await upsertTemplate(e);
    tpl[e.key] = { id, subject: e.subjectInitial };
  }

  log('[7/7] Flows');
  await resetFlows();

  // Flow 1 — Cold sequence (Phase 1 drip)
  await buildFlow({
    name: 'PJF — Cold Sequence (Phase 1)',
    description:
      'Month-1 cold drip: intro → gated lead magnet → engagement branch → segment-tailored "common mistakes". Exits on opt-in.',
    settings: businessHours,
    trigger: { type: 'list', config: { listId } },
    nodes: [
      { id: 'tag_prospect', type: 'add_tag', config: { tag: TAGS.prospect }, x: 320, y: 80 },
      { id: 'email_intro', type: 'email', config: { templateId: tpl.intro.id, subject: tpl.intro.subject }, x: 560, y: 80 },
      { id: 'wait_1', type: 'wait', config: { ms: 3 * DAY }, x: 800, y: 80 },
      { id: 'email_lead', type: 'email', config: { templateId: tpl.lead_magnet.id, subject: tpl.lead_magnet.subject }, x: 1040, y: 80 },
      { id: 'wait_2', type: 'wait', config: { ms: 5 * DAY }, x: 1280, y: 80 },
      {
        id: 'cond_open',
        type: 'condition',
        config: {
          branches: [
            {
              id: 'engaged',
              label: 'Opened or clicked a previous email',
              logic: 'OR',
              rules: [
                { field: 'hasClickedEmail', operator: 'is_true', value: '' },
                { field: 'hasOpenedEmail', operator: 'is_true', value: '' },
              ],
            },
          ],
          fallbackLabel: 'Not engaged',
        },
        x: 1520,
        y: 80,
      },
      { id: 'tag_engaged', type: 'add_tag', config: { tag: TAGS.engaged }, x: 1760, y: -40 },
      {
        id: 'cond_seg',
        type: 'condition',
        config: {
          branches: [
            { id: 'segA', label: 'Segment A (Specialists)', logic: 'AND', rules: [{ field: 'tags', operator: 'includes_any', value: 'pjf-segment-a' }] },
          ],
          fallbackLabel: 'Segment B (General)',
        },
        x: 2000,
        y: -40,
      },
      { id: 'email_mistakes_a', type: 'email', config: { templateId: tpl.mistakes_a.id, subject: tpl.mistakes_a.subject }, x: 2240, y: -120 },
      { id: 'email_mistakes_b', type: 'email', config: { templateId: tpl.mistakes_b.id, subject: tpl.mistakes_b.subject }, x: 2240, y: 40 },
      { id: 'email_reengage', type: 'email', config: { templateId: tpl.reengage.id, subject: tpl.reengage.subject }, x: 1760, y: 200 },
    ],
    edges: [
      { fromNodeId: 'TRIGGER', toNodeId: 'tag_prospect' },
      { fromNodeId: 'tag_prospect', toNodeId: 'email_intro' },
      { fromNodeId: 'email_intro', toNodeId: 'wait_1' },
      { fromNodeId: 'wait_1', toNodeId: 'email_lead' },
      { fromNodeId: 'email_lead', toNodeId: 'wait_2' },
      { fromNodeId: 'wait_2', toNodeId: 'cond_open' },
      { fromNodeId: 'cond_open', toNodeId: 'tag_engaged', branch: 'engaged' },
      { fromNodeId: 'cond_open', toNodeId: 'email_reengage', branch: 'else' },
      { fromNodeId: 'tag_engaged', toNodeId: 'cond_seg' },
      { fromNodeId: 'cond_seg', toNodeId: 'email_mistakes_a', branch: 'segA' },
      { fromNodeId: 'cond_seg', toNodeId: 'email_mistakes_b', branch: 'else' },
    ],
  });

  // Flow 2 — Opt-in capture (lead-magnet form submit → guide delivery)
  await buildFlow({
    name: 'PJF — Opt-in Capture (Lead Magnet)',
    description: 'Lead-magnet form submission → tag opted-in (SMS now allowed) → email the gated guide.',
    settings: prompt,
    trigger: { type: 'form_submission', config: { formId: lmForm.id } },
    nodes: [
      { id: 'tag_optin', type: 'add_tag', config: { tag: TAGS.optedIn }, x: 320, y: 80 },
      { id: 'email_guide', type: 'email', config: { templateId: tpl.guide_delivery.id, subject: tpl.guide_delivery.subject }, x: 560, y: 80 },
    ],
    edges: [
      { fromNodeId: 'TRIGGER', toNodeId: 'tag_optin' },
      { fromNodeId: 'tag_optin', toNodeId: 'email_guide' },
    ],
  });

  // Flow 3 — Qualified handoff (consultation form submit → HubSpot)
  await buildFlow({
    name: 'PJF — Qualified Handoff (HubSpot)',
    description: 'Consultation-request form submission → tag qualified → push to HubSpot → tag handoff.',
    settings: prompt,
    trigger: { type: 'form_submission', config: { formId: consultForm.id } },
    nodes: [
      { id: 'tag_qualified', type: 'add_tag', config: { tag: TAGS.qualified }, x: 320, y: 80 },
      { id: 'push_crm', type: 'push_to_crm', config: { provider: 'hubspot' }, x: 560, y: 80 },
      { id: 'tag_handoff', type: 'add_tag', config: { tag: TAGS.handoff }, x: 800, y: 80 },
    ],
    edges: [
      { fromNodeId: 'TRIGGER', toNodeId: 'tag_qualified' },
      { fromNodeId: 'tag_qualified', toNodeId: 'push_crm' },
      { fromNodeId: 'push_crm', toNodeId: 'tag_handoff' },
    ],
  });

  log('\n=== Done. Summary ===');
  log(`Account:        ${ACCOUNT_KEY} (/${ACCOUNT_SLUG})`);
  log(`Prospect list:  ${listId}`);
  log(`Lead-magnet LP: ${lmPage.publicUrl}`);
  log(`Consult LP:     ${consultPage.publicUrl}`);
  log(`Emails:         ${emails.map((e) => e.slug).join(', ')}`);
  log('Flows:          Cold Sequence, Opt-in Capture, Qualified Handoff (all published)\n');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('\n[provision] FAILED:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
