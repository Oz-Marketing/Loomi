/**
 * Seed script: YAG (Young Automotive Group) GoHighLevel → Loomi migration.
 *
 *   1. Automotive custom-field blueprints (industryTag "Automotive").
 *   2. The 10 YAG lifecycle flows as deployable templates (accountKey = null).
 *
 * Idempotent — safe to re-run. Blueprints are skipped if their key already
 * exists; templates are matched by name and rebuilt in place (graph +
 * settings + triggers replaced), so editing this file and re-running
 * updates the templates without creating duplicates.
 *
 * Run: npx tsx scripts/seed-yag-templates.ts
 *
 * After seeding, deploy a template to sub-accounts from the admin UI (or
 * deployFlowToAccounts). Deployed instances start with triggers DISABLED
 * and status draft — the account admin reviews copy, then enables.
 *
 * Email/SMS bodies are intentional placeholders ("[Placeholder …]") — the
 * per-OEM copy is dropped in at template-edit time, exactly as the GHL
 * build spec intends.
 */
import 'dotenv/config';
import { prisma } from '@/lib/prisma';
import {
  createField,
  listBlueprints,
  CustomFieldValidationError,
} from '@/lib/services/contact-custom-fields';
import {
  createFlow,
  updateFlow,
  updateFlowGraph,
  createTrigger,
  getFlow,
  type FlowSettings,
  type TriggerType,
} from '@/lib/services/loomi-flows';
import { validateFlowGraph, type NodeType } from '@/lib/flows/validation';

// ── 1. Automotive custom-field blueprints ───────────────────────────
// Keys are snake_case (the JSON property in Contact.customFields). Date
// of Birth is NOT here — it's a first-class Contact column.

const BLUEPRINTS: Array<{
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'boolean' | 'select' | 'multiselect';
  description?: string;
  options?: Array<{ value: string; label: string }>;
  csvAliases?: string[];
  sortOrder: number;
}> = [
  {
    key: 'deal_type',
    label: 'Deal Type',
    type: 'select',
    options: [
      { value: 'Purchase', label: 'Purchase' },
      { value: 'Lease', label: 'Lease' },
    ],
    csvAliases: ['dealtype', 'deal type', 'saletype'],
    sortOrder: 10,
  },
  {
    key: 'last_purchase_date',
    label: 'Last Purchase Date',
    type: 'date',
    csvAliases: ['lastpurchase', 'purchasedate', 'soldon', 'last purchase date'],
    sortOrder: 20,
  },
  {
    key: 'last_lease_date',
    label: 'Last Lease Date',
    type: 'date',
    csvAliases: ['lastlease', 'leasedate', 'last lease date'],
    sortOrder: 30,
  },
  {
    key: 'lease_end_date',
    label: 'Lease End Date',
    type: 'date',
    csvAliases: ['leaseend', 'lease end date', 'leaseexpiration'],
    sortOrder: 40,
  },
  {
    key: 'last_service_date',
    label: 'Last Service Date',
    type: 'date',
    csvAliases: ['lastservice', 'service date', 'last service date', 'lastrodate'],
    sortOrder: 50,
  },
  {
    key: 'warranty_end_date',
    label: 'Warranty End Date',
    type: 'date',
    csvAliases: ['warrantyend', 'warranty end date', 'warrantyexpiration'],
    sortOrder: 60,
  },
  {
    key: 'unit_age_at_purchase',
    label: 'Unit Age At Purchase',
    type: 'number',
    description: 'Vehicle age (years) at time of purchase. Drives trade-in timing.',
    csvAliases: ['unitage', 'unit age', 'vehicleage'],
    sortOrder: 70,
  },
  {
    key: 'trade_in_inquiry',
    label: 'Trade-In Inquiry',
    type: 'boolean',
    description: 'Set true when the contact submits a trade-in inquiry.',
    csvAliases: ['tradein', 'trade in inquiry', 'tradeininquiry'],
    sortOrder: 80,
  },
];

async function seedBlueprints(): Promise<void> {
  const existing = new Set((await listBlueprints()).map((b) => b.key));
  for (const bp of BLUEPRINTS) {
    if (existing.has(bp.key)) {
      console.log(`  · blueprint ${bp.key} already exists — skipped`);
      continue;
    }
    try {
      await createField({
        accountKey: null,
        industryTag: 'Automotive',
        category: 'Automotive',
        key: bp.key,
        label: bp.label,
        type: bp.type,
        description: bp.description,
        options: bp.options ?? null,
        csvAliases: bp.csvAliases ?? [],
        sortOrder: bp.sortOrder,
      });
      console.log(`  ✓ created blueprint ${bp.key}`);
    } catch (err) {
      if (err instanceof CustomFieldValidationError) {
        console.error(`  ✗ blueprint ${bp.key}: ${err.message}`);
      } else {
        throw err;
      }
    }
  }
}

// ── 2. Flow template builders ───────────────────────────────────────

const MS = {
  h2: 2 * 60 * 60 * 1000,
  d1: 24 * 60 * 60 * 1000,
  d7: 7 * 24 * 60 * 60 * 1000,
  d14: 14 * 24 * 60 * 60 * 1000,
  d20: 20 * 24 * 60 * 60 * 1000,
  d30: 30 * 24 * 60 * 60 * 1000,
};

interface NodeDef {
  id: string;
  type: NodeType;
  config: Record<string, unknown>;
  col?: number;
}
interface EdgeDef {
  fromNodeId: string;
  toNodeId: string;
  branch?: string | null;
}
interface Rule {
  id: string;
  field: string;
  operator: string;
  value: string;
  value2?: string;
}
interface Branch {
  id: string;
  label: string;
  logic: 'AND' | 'OR';
  rules: Rule[];
}
interface TriggerDef {
  type: string;
  config: Record<string, unknown>;
  enabled: boolean;
}
interface FlowDef {
  name: string;
  description: string;
  settings: FlowSettings;
  triggers: TriggerDef[];
  nodes: NodeDef[];
  edges: EdgeDef[];
}

const settings = (
  reEntryPolicy: 'never' | 'always' | 'after-days',
): FlowSettings => ({
  reEntry: { policy: reEntryPolicy },
  quietHours: { enabled: true, start: '09:00', end: '19:00' }, // 9a–7p, account tz
  goal: { enabled: false, type: 'tag-added', value: '' },
  maxDuration: { enabled: false, days: 90 },
  dndHandling: 'skip',
});

const rule = (field: string, operator: string, value = '', value2?: string): Rule => ({
  id: `${field}_${operator}`,
  field,
  operator,
  value,
  value2,
});
const branch = (
  id: string,
  label: string,
  logic: 'AND' | 'OR',
  rules: Rule[],
): Branch => ({ id, label, logic, rules });

// Node constructors (yag id is closed over per flow via makeNodes()).
function makeNodes(yag: string) {
  return {
    trigger: (): NodeDef => ({ id: 'trig', type: 'trigger', config: {} }),
    email: (id: string, label: string, col = 0): NodeDef => ({
      id,
      type: 'email',
      col,
      config: {
        subject: `[${yag}] ${label}`,
        html: `<p>[Placeholder — ${label}. Replace with the per-OEM template before enabling.]</p>`,
      },
    }),
    sms: (id: string, label: string, col = 0): NodeDef => ({
      id,
      type: 'sms',
      col,
      config: {
        message: `[${yag} placeholder SMS — ${label}. Replace per OEM. Reply STOP to opt out.]`,
      },
    }),
    wait: (id: string, ms: number, col = 0): NodeDef => ({
      id,
      type: 'wait',
      col,
      config: { ms },
    }),
    addTag: (id: string, tag: string, col = 0): NodeDef => ({
      id,
      type: 'add_tag',
      col,
      config: { tag },
    }),
    rmTag: (id: string, tag: string, col = 0): NodeDef => ({
      id,
      type: 'remove_tag',
      col,
      config: { tag },
    }),
    cond: (id: string, title: string, branches: Branch[], col = 0): NodeDef => ({
      id,
      type: 'condition',
      col,
      config: { title, branches, fallbackLabel: 'No' },
    }),
    exit: (id: string, col = 2): NodeDef => ({ id, type: 'exit', config: {}, col }),
  };
}

const ed = (fromNodeId: string, toNodeId: string, branch?: string): EdgeDef => ({
  fromNodeId,
  toNodeId,
  branch: branch ?? null,
});

// ── The 10 flows ────────────────────────────────────────────────────

function buildFlows(): FlowDef[] {
  const flows: FlowDef[] = [];

  // YAG-001 — Sales · New Purchase Introduction (re-entry OFF)
  {
    const n = makeNodes('YAG-001');
    flows.push({
      name: 'YAG-001 · Sales — New Purchase Introduction',
      description:
        'Welcome sequence after a purchase. Trigger: tag loomi-yag-purchased.',
      settings: settings('never'),
      triggers: [
        { type: 'tag_added', config: { tag: 'loomi-yag-purchased' }, enabled: true },
      ],
      nodes: [
        n.trigger(),
        n.cond('gate', 'Qualifies for New Purchase?', [
          branch('qualifies', 'Yes', 'AND', [
            rule('deal_type', 'is_one_of', 'Purchase'),
            rule('last_purchase_date', 'is_not_empty'),
            rule('tags', 'excludes', 'loomi-yag-new-purchase-active'),
          ]),
        ]),
        n.addTag('add_active', 'loomi-yag-new-purchase-active'),
        n.email('e1', 'Welcome email + next steps'),
        n.wait('w1', MS.h2),
        n.sms('s1', 'Welcome text from salesperson'),
        n.wait('w2', MS.d7),
        n.email('e2', 'Service department intro'),
        n.wait('w3', MS.d30),
        n.email('e3', 'Referral program intro'),
        n.rmTag('rm_active', 'loomi-yag-new-purchase-active'),
        n.addTag('add_complete', 'loomi-yag-new-purchase-complete'),
        n.exit('end'),
        n.exit('end_no'),
      ],
      edges: [
        ed('trig', 'gate'),
        ed('gate', 'add_active', 'qualifies'),
        ed('gate', 'end_no', 'else'),
        ed('add_active', 'e1'),
        ed('e1', 'w1'),
        ed('w1', 's1'),
        ed('s1', 'w2'),
        ed('w2', 'e2'),
        ed('e2', 'w3'),
        ed('w3', 'e3'),
        ed('e3', 'rm_active'),
        ed('rm_active', 'add_complete'),
        ed('add_complete', 'end'),
      ],
    });
  }

  // YAG-002 — Sales · Anniversary (re-entry ON, annual)
  {
    const n = makeNodes('YAG-002');
    flows.push({
      name: 'YAG-002 · Sales — Anniversary',
      description:
        'One-year anniversary of purchase. Trigger: Last Purchase Date + 365d, recurs annually.',
      settings: settings('always'),
      triggers: [
        {
          type: 'date_reminder',
          config: { field: 'last_purchase_date', offsetDays: 365, recurAnnually: true },
          enabled: true,
        },
      ],
      nodes: [
        n.trigger(),
        n.cond('gate', 'Qualifies for Anniversary?', [
          branch('qualifies', 'Yes', 'AND', [
            rule('last_purchase_date', 'is_not_empty'),
            rule('tags', 'excludes', 'loomi-yag-anniversary-active'),
          ]),
        ]),
        n.addTag('add_active', 'loomi-yag-anniversary-active'),
        n.email('e1', 'One-year anniversary email (vehicle make/model)'),
        n.wait('w1', MS.h2),
        n.sms('s1', 'Anniversary text (first name + vehicle)'),
        n.wait('w2', MS.d1),
        n.rmTag('rm_active', 'loomi-yag-anniversary-active'),
        n.addTag('add_complete', 'loomi-yag-anniversary-complete'),
        n.exit('end'),
        n.exit('end_no'),
      ],
      edges: [
        ed('trig', 'gate'),
        ed('gate', 'add_active', 'qualifies'),
        ed('gate', 'end_no', 'else'),
        ed('add_active', 'e1'),
        ed('e1', 'w1'),
        ed('w1', 's1'),
        ed('s1', 'w2'),
        ed('w2', 'rm_active'),
        ed('rm_active', 'add_complete'),
        ed('add_complete', 'end'),
      ],
    });
  }

  // YAG-003 — Sales · Trade-In Solicitation (re-entry OFF, dual triggers)
  {
    const n = makeNodes('YAG-003');
    const agedFilter = {
      version: 1,
      logic: 'AND',
      groups: [
        {
          id: 'g',
          logic: 'AND',
          conditions: [rule('unit_age_at_purchase', 'num_gte', '3')],
        },
      ],
    };
    const standardFilter = {
      version: 1,
      logic: 'AND',
      groups: [
        {
          id: 'g',
          logic: 'AND',
          conditions: [rule('unit_age_at_purchase', 'num_lt', '3')],
        },
      ],
    };
    flows.push({
      name: 'YAG-003 · Sales — Trade-In Solicitation',
      description:
        'Trade-in/upgrade pitch. Aged units (age ≥ 3) at 362d, standard units (< 3) at 544d after purchase.',
      settings: settings('never'),
      triggers: [
        {
          type: 'date_reminder',
          config: {
            field: 'last_purchase_date',
            offsetDays: 362,
            recurAnnually: false,
            filter: agedFilter,
          },
          enabled: true,
        },
        {
          type: 'date_reminder',
          config: {
            field: 'last_purchase_date',
            offsetDays: 544,
            recurAnnually: false,
            filter: standardFilter,
          },
          enabled: true,
        },
      ],
      nodes: [
        n.trigger(),
        n.cond('gate', 'Qualifies for Trade-In?', [
          branch('qualifies', 'Yes', 'AND', [
            rule('last_purchase_date', 'is_not_empty'),
            rule('tags', 'excludes', 'loomi-yag-trade-in-active'),
          ]),
        ]),
        n.addTag('add_active', 'loomi-yag-trade-in-active'),
        n.email('e1', 'Trade-in / upgrade offer'),
        n.wait('w1', MS.h2),
        n.sms('s1', 'Trade-in nudge'),
        n.wait('w2', MS.d14),
        n.cond('goal', 'Trade-in inquiry submitted?', [
          branch('converted', 'Yes', 'AND', [rule('trade_in_inquiry', 'is_true')]),
        ]),
        n.rmTag('rm_conv', 'loomi-yag-trade-in-active', 1),
        n.addTag('add_conv', 'loomi-yag-trade-in-converted', 1),
        n.exit('end_conv', 2),
        n.email('e2', 'Stronger trade-in offer'),
        n.wait('w3', MS.h2),
        n.sms('s2', 'Final trade-in nudge'),
        n.rmTag('rm_lost', 'loomi-yag-trade-in-active'),
        n.addTag('add_lost', 'loomi-yag-trade-in-lost'),
        n.exit('end_lost'),
        n.exit('end_no'),
      ],
      edges: [
        ed('trig', 'gate'),
        ed('gate', 'add_active', 'qualifies'),
        ed('gate', 'end_no', 'else'),
        ed('add_active', 'e1'),
        ed('e1', 'w1'),
        ed('w1', 's1'),
        ed('s1', 'w2'),
        ed('w2', 'goal'),
        ed('goal', 'rm_conv', 'converted'),
        ed('rm_conv', 'add_conv'),
        ed('add_conv', 'end_conv'),
        ed('goal', 'e2', 'else'),
        ed('e2', 'w3'),
        ed('w3', 's2'),
        ed('s2', 'rm_lost'),
        ed('rm_lost', 'add_lost'),
        ed('add_lost', 'end_lost'),
      ],
    });
  }

  // YAG-101 — Lease · New Introduction (re-entry OFF)
  {
    const n = makeNodes('YAG-101');
    flows.push({
      name: 'YAG-101 · Lease — New Introduction',
      description: 'Lease welcome sequence. Trigger: tag loomi-yag-leased.',
      settings: settings('never'),
      triggers: [
        { type: 'tag_added', config: { tag: 'loomi-yag-leased' }, enabled: true },
      ],
      nodes: [
        n.trigger(),
        n.cond('gate', 'Qualifies for New Lease?', [
          branch('qualifies', 'Yes', 'AND', [
            rule('deal_type', 'is_one_of', 'Lease'),
            rule('tags', 'excludes', 'loomi-yag-lease-new-active'),
          ]),
        ]),
        n.addTag('add_active', 'loomi-yag-lease-new-active'),
        n.email('e1', 'Lease welcome + next steps'),
        n.wait('w1', MS.h2),
        n.sms('s1', 'Lease welcome text'),
        n.wait('w2', MS.d7),
        n.email('e2', 'Service department / lease care intro'),
        n.rmTag('rm_active', 'loomi-yag-lease-new-active'),
        n.addTag('add_complete', 'loomi-yag-lease-new-complete'),
        n.exit('end'),
        n.exit('end_no'),
      ],
      edges: [
        ed('trig', 'gate'),
        ed('gate', 'add_active', 'qualifies'),
        ed('gate', 'end_no', 'else'),
        ed('add_active', 'e1'),
        ed('e1', 'w1'),
        ed('w1', 's1'),
        ed('s1', 'w2'),
        ed('w2', 'e2'),
        ed('e2', 'rm_active'),
        ed('rm_active', 'add_complete'),
        ed('add_complete', 'end'),
      ],
    });
  }

  // YAG-102 — Lease · End (90 Days) (re-entry ON), 3 touchpoints + goal checks
  {
    const n = makeNodes('YAG-102');
    const leaseGoal = (id: string, title: string): NodeDef =>
      n.cond(id, title, [
        branch('converted', 'Yes', 'OR', [
          rule('last_purchase_date', 'within_last_days', '30'),
          rule('last_lease_date', 'within_last_days', '30'),
        ]),
      ]);
    flows.push({
      name: 'YAG-102 · Lease — End (90 Days)',
      description:
        'Lease-end re-acquisition. Trigger: Lease End Date − 90d. Three touchpoints with conversion checks.',
      settings: settings('always'),
      triggers: [
        {
          type: 'date_reminder',
          config: { field: 'lease_end_date', offsetDays: -90, recurAnnually: false },
          enabled: true,
        },
      ],
      nodes: [
        n.trigger(),
        n.cond('gate', 'Qualifies for Lease-End?', [
          branch('qualifies', 'Yes', 'AND', [
            rule('deal_type', 'is_one_of', 'Lease'),
            rule('lease_end_date', 'is_not_empty'),
            rule('tags', 'excludes', 'loomi-yag-lease-end-active'),
          ]),
        ]),
        n.addTag('add_active', 'loomi-yag-lease-end-active'),
        // 90-days-left
        n.email('e1', '90-days-left offer'),
        n.wait('w1', MS.h2),
        n.sms('s1', '90-days-left nudge'),
        n.wait('w2', MS.d30),
        leaseGoal('goal1', 'Purchased or leased in last 30 days?'),
        // 60-days-left
        n.email('e2', '60-days-left offer'),
        n.wait('w3', MS.h2),
        n.sms('s2', '60-days-left nudge'),
        n.wait('w4', MS.d30),
        leaseGoal('goal2', 'Purchased or leased in last 30 days?'),
        // 30-days-left
        n.email('e3', '30-days-left offer'),
        n.wait('w5', MS.h2),
        n.sms('s3', '30-days-left nudge'),
        n.wait('w6', MS.d30),
        leaseGoal('goal3', 'Purchased or leased in last 30 days?'),
        // converted terminus (shared)
        n.rmTag('rm_conv', 'loomi-yag-lease-end-active', 1),
        n.addTag('add_conv', 'loomi-yag-lease-end-converted', 1),
        n.exit('end_conv', 2),
        // lost terminus
        n.rmTag('rm_lost', 'loomi-yag-lease-end-active'),
        n.addTag('add_lost', 'loomi-yag-lease-end-lost'),
        n.exit('end_lost'),
        n.exit('end_no'),
      ],
      edges: [
        ed('trig', 'gate'),
        ed('gate', 'add_active', 'qualifies'),
        ed('gate', 'end_no', 'else'),
        ed('add_active', 'e1'),
        ed('e1', 'w1'),
        ed('w1', 's1'),
        ed('s1', 'w2'),
        ed('w2', 'goal1'),
        ed('goal1', 'rm_conv', 'converted'),
        ed('goal1', 'e2', 'else'),
        ed('e2', 'w3'),
        ed('w3', 's2'),
        ed('s2', 'w4'),
        ed('w4', 'goal2'),
        ed('goal2', 'rm_conv', 'converted'),
        ed('goal2', 'e3', 'else'),
        ed('e3', 'w5'),
        ed('w5', 's3'),
        ed('s3', 'w6'),
        ed('w6', 'goal3'),
        ed('goal3', 'rm_conv', 'converted'),
        ed('goal3', 'rm_lost', 'else'),
        ed('rm_conv', 'add_conv'),
        ed('add_conv', 'end_conv'),
        ed('rm_lost', 'add_lost'),
        ed('add_lost', 'end_lost'),
      ],
    });
  }

  // YAG-201 — Loyalty · Birthday (re-entry ON)
  {
    const n = makeNodes('YAG-201');
    flows.push({
      name: 'YAG-201 · Loyalty — Birthday',
      description: 'Birthday gift email + text. Trigger: Birthday (day-of).',
      settings: settings('always'),
      triggers: [{ type: 'birthday', config: { daysBefore: 0 }, enabled: true }],
      nodes: [
        n.trigger(),
        n.cond('gate', 'Qualifies for Birthday?', [
          branch('qualifies', 'Yes', 'AND', [
            rule('dateOfBirth', 'is_not_empty'),
            rule('tags', 'excludes', 'loomi-yag-birthday-active'),
          ]),
        ]),
        n.addTag('add_active', 'loomi-yag-birthday-active'),
        n.email('e1', 'Birthday email with gift'),
        n.wait('w1', MS.h2),
        n.sms('s1', 'Birthday text (check email for gift)'),
        n.wait('w2', MS.d1),
        n.rmTag('rm_active', 'loomi-yag-birthday-active'),
        n.exit('end'),
        n.exit('end_no'),
      ],
      edges: [
        ed('trig', 'gate'),
        ed('gate', 'add_active', 'qualifies'),
        ed('gate', 'end_no', 'else'),
        ed('add_active', 'e1'),
        ed('e1', 'w1'),
        ed('w1', 's1'),
        ed('s1', 'w2'),
        ed('w2', 'rm_active'),
        ed('rm_active', 'end'),
      ],
    });
  }

  // YAG-301 — Service · Reminder (re-entry ON)
  {
    const n = makeNodes('YAG-301');
    flows.push({
      name: 'YAG-301 · Service — Reminder',
      description:
        'Service-due reminder ~2 weeks before the 6-month mark. Trigger: Last Service Date + 166d. Suppressed by loomi-yag-service-scheduled.',
      settings: settings('always'),
      triggers: [
        {
          type: 'date_reminder',
          config: { field: 'last_service_date', offsetDays: 166, recurAnnually: false },
          enabled: true,
        },
      ],
      nodes: [
        n.trigger(),
        n.cond('gate', 'Qualifies for Service Reminder?', [
          branch('qualifies', 'Yes', 'AND', [
            rule('last_service_date', 'is_not_empty'),
            rule('tags', 'excludes', 'loomi-yag-service-reminder-active'),
            rule('tags', 'excludes', 'loomi-yag-service-scheduled'),
          ]),
        ]),
        n.addTag('add_active', 'loomi-yag-service-reminder-active'),
        n.email('e1', 'Service-due reminder'),
        n.wait('w1', MS.h2),
        n.sms('s1', 'Schedule-service nudge'),
        n.wait('w2', MS.d7),
        n.cond('goal', 'Booked or scheduled service?', [
          branch('booked', 'Yes', 'OR', [
            rule('tags', 'includes_any', 'loomi-yag-service-scheduled'),
            rule('last_service_date', 'within_last_days', '7'),
          ]),
        ]),
        n.email('e2', 'Second service reminder'),
        n.wait('w3', MS.h2),
        n.sms('s2', 'Final schedule-service nudge'),
        n.rmTag('rm_active', 'loomi-yag-service-reminder-active'),
        n.exit('end'),
        n.exit('end_no'),
      ],
      edges: [
        ed('trig', 'gate'),
        ed('gate', 'add_active', 'qualifies'),
        ed('gate', 'end_no', 'else'),
        ed('add_active', 'e1'),
        ed('e1', 'w1'),
        ed('w1', 's1'),
        ed('s1', 'w2'),
        ed('w2', 'goal'),
        ed('goal', 'rm_active', 'booked'),
        ed('goal', 'e2', 'else'),
        ed('e2', 'w3'),
        ed('w3', 's2'),
        ed('s2', 'rm_active'),
        ed('rm_active', 'end'),
      ],
    });
  }

  // YAG-302 — Service · Thank You (re-entry ON)
  {
    const n = makeNodes('YAG-302');
    flows.push({
      name: 'YAG-302 · Service — Thank You',
      description:
        'Thank-you + review ask after a service visit. Trigger: tag loomi-yag-serviced-recent.',
      settings: settings('always'),
      triggers: [
        {
          type: 'tag_added',
          config: { tag: 'loomi-yag-serviced-recent' },
          enabled: true,
        },
      ],
      nodes: [
        n.trigger(),
        n.cond('gate', 'Qualifies for Thank-You?', [
          branch('qualifies', 'Yes', 'AND', [
            rule('tags', 'excludes', 'loomi-yag-service-thank-you-active'),
          ]),
        ]),
        n.addTag('add_active', 'loomi-yag-service-thank-you-active'),
        n.email('e1', 'Thank-you email'),
        n.wait('w1', MS.h2),
        n.sms('s1', 'Thank-you text'),
        n.wait('w2', MS.d1),
        n.email('e2', 'Review request email (Google review link)'),
        n.wait('w3', MS.h2),
        n.sms('s2', 'Review request text'),
        n.addTag('add_review', 'loomi-yag-review-requested-service'),
        n.rmTag('rm_serviced', 'loomi-yag-serviced-recent'),
        n.rmTag('rm_active', 'loomi-yag-service-thank-you-active'),
        n.addTag('add_complete', 'loomi-yag-service-thank-you-complete'),
        n.exit('end'),
        n.exit('end_no'),
      ],
      edges: [
        ed('trig', 'gate'),
        ed('gate', 'add_active', 'qualifies'),
        ed('gate', 'end_no', 'else'),
        ed('add_active', 'e1'),
        ed('e1', 'w1'),
        ed('w1', 's1'),
        ed('s1', 'w2'),
        ed('w2', 'e2'),
        ed('e2', 'w3'),
        ed('w3', 's2'),
        ed('s2', 'add_review'),
        ed('add_review', 'rm_serviced'),
        ed('rm_serviced', 'rm_active'),
        ed('rm_active', 'add_complete'),
        ed('add_complete', 'end'),
      ],
    });
  }

  // YAG-303 — Service · Win-back (6 Months) (re-entry ON)
  {
    const n = makeNodes('YAG-303');
    const winbackGoal = (id: string, days: string): NodeDef =>
      n.cond(id, 'Scheduled or completed service?', [
        branch('converted', 'Yes', 'OR', [
          rule('tags', 'includes_any', 'loomi-yag-service-scheduled'),
          rule('last_service_date', 'within_last_days', days),
        ]),
      ]);
    flows.push({
      name: 'YAG-303 · Service — Win-back (6 Months)',
      description:
        'We-miss-you win-back ~6 months after last service. Trigger: Last Service Date + 180d. Excludes recent buyers + scheduled.',
      settings: settings('always'),
      triggers: [
        {
          type: 'date_reminder',
          config: { field: 'last_service_date', offsetDays: 180, recurAnnually: false },
          enabled: true,
        },
      ],
      nodes: [
        n.trigger(),
        n.cond('gate', 'Qualifies for Win-back?', [
          branch('qualifies', 'Yes', 'AND', [
            rule('last_service_date', 'is_not_empty'),
            rule('tags', 'excludes', 'loomi-yag-service-winback-active'),
            rule('tags', 'excludes', 'loomi-yag-service-scheduled'),
            rule('tags', 'excludes', 'loomi-yag-new-purchase-active'),
            rule('tags', 'excludes', 'loomi-yag-lease-new-active'),
          ]),
        ]),
        n.addTag('add_active', 'loomi-yag-service-winback-active'),
        n.email('e1', 'We-miss-you + service offer'),
        n.wait('w1', MS.h2),
        n.sms('s1', 'We-miss-you text + 10% off'),
        n.wait('w2', MS.d14),
        winbackGoal('goal1', '14'),
        n.email('e2', 'Stronger service offer'),
        n.wait('w3', MS.h2),
        n.sms('s2', 'Stronger offer text'),
        n.wait('w4', MS.d30),
        winbackGoal('goal2', '30'),
        n.email('e3', 'Final win-back (strongest offer)'),
        n.wait('w5', MS.h2),
        n.sms('s3', 'Final win-back text'),
        n.rmTag('rm_conv', 'loomi-yag-service-winback-active', 1),
        n.addTag('add_conv', 'loomi-yag-service-winback-converted', 1),
        n.exit('end_conv', 2),
        n.rmTag('rm_lost', 'loomi-yag-service-winback-active'),
        n.addTag('add_lost', 'loomi-yag-service-winback-lost'),
        n.exit('end_lost'),
        n.exit('end_no'),
      ],
      edges: [
        ed('trig', 'gate'),
        ed('gate', 'add_active', 'qualifies'),
        ed('gate', 'end_no', 'else'),
        ed('add_active', 'e1'),
        ed('e1', 'w1'),
        ed('w1', 's1'),
        ed('s1', 'w2'),
        ed('w2', 'goal1'),
        ed('goal1', 'rm_conv', 'converted'),
        ed('goal1', 'e2', 'else'),
        ed('e2', 'w3'),
        ed('w3', 's2'),
        ed('s2', 'w4'),
        ed('w4', 'goal2'),
        ed('goal2', 'rm_conv', 'converted'),
        ed('goal2', 'e3', 'else'),
        ed('e3', 'w5'),
        ed('w5', 's3'),
        ed('s3', 'rm_lost'),
        ed('rm_conv', 'add_conv'),
        ed('add_conv', 'end_conv'),
        ed('rm_lost', 'add_lost'),
        ed('add_lost', 'end_lost'),
      ],
    });
  }

  // YAG-304 — Service · Warranty Expiration (re-entry OFF)
  {
    const n = makeNodes('YAG-304');
    flows.push({
      name: 'YAG-304 · Service — Warranty Expiration',
      description:
        'Warranty-expiration service push. Trigger: Warranty End Date − 60d. Three touchpoints (60/30/10 days).',
      settings: settings('never'),
      triggers: [
        {
          type: 'date_reminder',
          config: { field: 'warranty_end_date', offsetDays: -60, recurAnnually: false },
          enabled: true,
        },
      ],
      nodes: [
        n.trigger(),
        n.cond('gate', 'Qualifies for Warranty Expiration?', [
          branch('qualifies', 'Yes', 'AND', [
            rule('warranty_end_date', 'is_not_empty'),
            rule('tags', 'excludes', 'loomi-yag-warranty-expiration-active'),
            rule('tags', 'excludes', 'loomi-yag-warranty-expiration-complete'),
          ]),
        ]),
        n.addTag('add_active', 'loomi-yag-warranty-expiration-active'),
        n.email('e1', '60-day warning'),
        n.wait('w1', MS.h2),
        n.sms('s1', '60-day warning text'),
        n.wait('w2', MS.d30),
        n.cond('goal1', 'Serviced in last 30 days?', [
          branch('converted', 'Yes', 'AND', [
            rule('last_service_date', 'within_last_days', '30'),
          ]),
        ]),
        n.email('e2', '30-day warning'),
        n.wait('w3', MS.h2),
        n.sms('s2', '30-day warning text'),
        n.wait('w4', MS.d20),
        n.cond('goal2', 'Serviced in last 20 days?', [
          branch('converted', 'Yes', 'AND', [
            rule('last_service_date', 'within_last_days', '20'),
          ]),
        ]),
        n.email('e3', 'Final chance (10 days left)'),
        n.wait('w5', MS.h2),
        n.sms('s3', 'Final chance text'),
        // converted terminus (shared)
        n.rmTag('rm_conv', 'loomi-yag-warranty-expiration-active', 1),
        n.addTag('add_conv', 'loomi-yag-warranty-expiration-converted', 1),
        n.exit('end_conv', 2),
        // lost terminus
        n.rmTag('rm_lost', 'loomi-yag-warranty-expiration-active'),
        n.addTag('add_lost', 'loomi-yag-warranty-expiration-lost'),
        n.addTag('add_complete', 'loomi-yag-warranty-expiration-complete'),
        n.exit('end_lost'),
        n.exit('end_no'),
      ],
      edges: [
        ed('trig', 'gate'),
        ed('gate', 'add_active', 'qualifies'),
        ed('gate', 'end_no', 'else'),
        ed('add_active', 'e1'),
        ed('e1', 'w1'),
        ed('w1', 's1'),
        ed('s1', 'w2'),
        ed('w2', 'goal1'),
        ed('goal1', 'rm_conv', 'converted'),
        ed('goal1', 'e2', 'else'),
        ed('e2', 'w3'),
        ed('w3', 's2'),
        ed('s2', 'w4'),
        ed('w4', 'goal2'),
        ed('goal2', 'rm_conv', 'converted'),
        ed('goal2', 'e3', 'else'),
        ed('e3', 'w5'),
        ed('w5', 's3'),
        ed('s3', 'rm_lost'),
        ed('rm_conv', 'add_conv'),
        ed('add_conv', 'end_conv'),
        ed('rm_lost', 'add_lost'),
        ed('add_lost', 'add_complete'),
        ed('add_complete', 'end_lost'),
      ],
    });
  }

  return flows;
}

// ── Persist a flow template (create or rebuild in place) ─────────────

function layout(nodes: NodeDef[]): Array<NodeDef & { x: number; y: number }> {
  return nodes.map((node, i) => ({
    ...node,
    x: 240 + (node.col ?? 0) * 340,
    y: 80 + i * 110,
  }));
}

async function upsertFlow(def: FlowDef): Promise<void> {
  const existing = await prisma.loomiFlow.findFirst({
    where: { accountKey: null, name: def.name },
    select: { id: true },
  });

  let flowId: string;
  if (existing) {
    flowId = existing.id;
    await prisma.loomiFlowTrigger.deleteMany({ where: { flowId } });
  } else {
    const created = await createFlow({ name: def.name, description: def.description });
    flowId = created.id;
  }

  const nodes = layout(def.nodes).map((nd) => ({
    id: nd.id,
    type: nd.type,
    config: nd.config,
    x: nd.x,
    y: nd.y,
  }));
  await updateFlowGraph(flowId, { nodes, edges: def.edges });
  await updateFlow(flowId, { description: def.description, settings: def.settings });
  for (const t of def.triggers) {
    await createTrigger(flowId, {
      type: t.type as TriggerType,
      config: t.config,
      enabled: t.enabled,
    });
  }

  // Validate the persisted graph the way publish would.
  const detail = await getFlow(flowId);
  if (detail) {
    const result = validateFlowGraph({
      nodes: detail.nodes.map((nd) => ({
        id: nd.id,
        type: nd.type as NodeType,
        config: nd.config,
      })),
      edges: detail.edges.map((e) => ({
        fromNodeId: e.fromNodeId,
        toNodeId: e.toNodeId,
        branch: e.branch,
      })),
    });
    const errors = result.issues.filter((i) => (i.severity ?? 'error') === 'error');
    if (errors.length) {
      console.error(`  ✗ ${def.name} — ${errors.length} validation error(s):`);
      for (const e of errors) console.error(`      • ${e.message}`);
    } else {
      console.log(`  ✓ ${def.name} (${existing ? 'updated' : 'created'})`);
    }
  }
}

// Validate every built graph structurally without touching the DB.
function dryRun(): void {
  let bad = 0;
  for (const def of buildFlows()) {
    const result = validateFlowGraph({
      nodes: def.nodes.map((nd) => ({ id: nd.id, type: nd.type, config: nd.config })),
      edges: def.edges.map((e) => ({
        fromNodeId: e.fromNodeId,
        toNodeId: e.toNodeId,
        branch: e.branch ?? null,
      })),
    });
    const errors = result.issues.filter((i) => (i.severity ?? 'error') === 'error');
    if (errors.length) {
      bad++;
      console.error(`✗ ${def.name} — ${errors.length} error(s):`);
      for (const e of errors) console.error(`    • [${e.nodeId ?? 'graph'}] ${e.message}`);
    } else {
      const warns = result.issues.filter((i) => i.severity === 'warning').length;
      console.log(`✓ ${def.name}  (${def.nodes.length} nodes, ${def.edges.length} edges${warns ? `, ${warns} warning(s)` : ''})`);
    }
  }
  console.log(bad === 0 ? '\nAll flows valid.' : `\n${bad} flow(s) have errors.`);
  process.exit(bad === 0 ? 0 : 1);
}

async function main(): Promise<void> {
  if (process.argv.includes('--dry-run')) {
    dryRun();
    return;
  }
  console.log('Seeding YAG Automotive custom-field blueprints…');
  await seedBlueprints();
  console.log('\nSeeding YAG flow templates…');
  for (const def of buildFlows()) {
    await upsertFlow(def);
  }
  console.log('\nDone.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
