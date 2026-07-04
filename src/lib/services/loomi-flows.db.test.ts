// DB-backed integration tests for the Tier-1 flow-engine fixes.
// Self-skip unless RUN_DB_TESTS=1 so `npm test` stays green without a
// database. Run locally with:  RUN_DB_TESTS=1 npm test
//
// Requires DATABASE_URL (loaded from the env). Creates rows under a
// unique key prefix and cascade-deletes them in afterAll.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { enrollContacts, updateFlowGraph, createFlow, publishFlow } from './loomi-flows';
import { FlowValidationError } from '@/lib/flows/validation';

const RUN = !!process.env.RUN_DB_TESTS;
const PREFIX = '__vitest_yag_';
const accA = `${PREFIX}a`;
const accB = `${PREFIX}b`;

describe.skipIf(!RUN)('flow engine — DB integration', () => {
  beforeAll(async () => {
    await prisma.account.deleteMany({ where: { key: { startsWith: PREFIX } } });
    await prisma.account.createMany({
      data: [
        { key: accA, dealer: 'Vitest A' },
        { key: accB, dealer: 'Vitest B' },
      ],
    });
  });

  afterAll(async () => {
    // Cascade: deleting accounts removes their contacts, flows, enrollments.
    await prisma.account.deleteMany({ where: { key: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it('enrollContacts scopes contactIds to the flow account (no cross-tenant enroll)', async () => {
    const cA = await prisma.contact.create({
      data: { accountKey: accA, email: `${PREFIX}a@x.com` },
    });
    const cB = await prisma.contact.create({
      data: { accountKey: accB, email: `${PREFIX}b@x.com` },
    });

    // Minimal active flow in account A: trigger -> exit.
    const flow = await prisma.loomiFlow.create({
      data: {
        name: `${PREFIX}scoping`,
        accountKey: accA,
        status: 'active',
        nodes: { create: [{ type: 'trigger', config: '{}' }, { type: 'exit', config: '{}' }] },
      },
      include: { nodes: true },
    });
    const trig = flow.nodes.find((n) => n.type === 'trigger')!;
    const exit = flow.nodes.find((n) => n.type === 'exit')!;
    await prisma.loomiFlowEdge.create({
      data: { flowId: flow.id, fromNodeId: trig.id, toNodeId: exit.id },
    });

    const result = await enrollContacts(flow.id, [cA.id, cB.id]);

    expect(result.enrolled).toBe(1);
    expect(result.reason.wrong_account).toBe(1);

    const enrollments = await prisma.loomiFlowEnrollment.findMany({
      where: { flowId: flow.id },
      select: { contactId: true },
    });
    expect(enrollments).toHaveLength(1);
    expect(enrollments[0].contactId).toBe(cA.id); // never account B's contact
  });

  it('updateFlowGraph preserves existing node ids across re-saves', async () => {
    const created = await createFlow({ name: `${PREFIX}idsave`, accountKey: accA });
    const flowId = created.id;

    // First save: client ids -> fresh cuids.
    const first = await updateFlowGraph(flowId, {
      nodes: [
        { id: 'trig', type: 'trigger', config: {}, x: 0, y: 0 },
        { id: 'e1', type: 'email', config: { html: 'x' }, x: 0, y: 100 },
      ],
      edges: [{ fromNodeId: 'trig', toNodeId: 'e1' }],
    });
    const trigId = first.idMap['trig'];
    const e1Id = first.idMap['e1'];
    expect(trigId).toBeTruthy();
    expect(e1Id).toBeTruthy();

    // Second save with the SAME db ids (what the builder posts on
    // autosave-on-open) — ids must be PRESERVED, not regenerated.
    const second = await updateFlowGraph(flowId, {
      nodes: [
        { id: trigId, type: 'trigger', config: {}, x: 0, y: 0 },
        { id: e1Id, type: 'email', config: { html: 'y' }, x: 0, y: 100 },
      ],
      edges: [{ fromNodeId: trigId, toNodeId: e1Id }],
    });
    const secondIds = second.flow.nodes.map((n) => n.id).sort();
    expect(secondIds).toEqual([trigId, e1Id].sort());

    // Third save: drop e1, add a new client node — e1 deleted, trig kept,
    // new node gets a fresh id; no dangling edges.
    const third = await updateFlowGraph(flowId, {
      nodes: [
        { id: trigId, type: 'trigger', config: {}, x: 0, y: 0 },
        { id: 'client-new', type: 'sms', config: { message: 'hi' }, x: 0, y: 100 },
      ],
      edges: [{ fromNodeId: trigId, toNodeId: 'client-new' }],
    });
    const thirdIds = third.flow.nodes.map((n) => n.id);
    expect(thirdIds).toContain(trigId); // preserved
    expect(thirdIds).not.toContain(e1Id); // removed
    expect(third.flow.nodes).toHaveLength(2);
    // edge endpoints all resolve to existing nodes (no dangling)
    const nodeIdSet = new Set(thirdIds);
    for (const e of third.flow.edges) {
      expect(nodeIdSet.has(e.fromNodeId)).toBe(true);
      expect(nodeIdSet.has(e.toNodeId)).toBe(true);
    }
  });

  it('recipient upsert is idempotent on the unique key (re-entry safe)', async () => {
    const c = await prisma.contact.create({
      data: { accountKey: accA, email: `${PREFIX}r@x.com` },
    });
    const campaign = await prisma.emailBlast.create({
      data: {
        name: `${PREFIX}wrapper`,
        accountKeys: JSON.stringify([accA]),
        subject: 's',
        htmlContent: 'h',
        status: 'processing',
      },
    });
    const where = {
      campaignId_contactId_accountKey: {
        campaignId: campaign.id,
        contactId: c.id,
        accountKey: accA,
      },
    };
    const r1 = await prisma.emailBlastRecipient.upsert({
      where,
      create: { campaignId: campaign.id, contactId: c.id, accountKey: accA, email: c.email!, status: 'pending' },
      update: { status: 'pending', messageId: null, sentAt: null },
    });
    // Second cycle: same key — must NOT throw P2002, must reuse the row.
    const r2 = await prisma.emailBlastRecipient.upsert({
      where,
      create: { campaignId: campaign.id, contactId: c.id, accountKey: accA, email: c.email!, status: 'pending' },
      update: { status: 'pending', messageId: null, sentAt: null },
    });
    expect(r2.id).toBe(r1.id);
    const count = await prisma.emailBlastRecipient.count({ where: { campaignId: campaign.id } });
    expect(count).toBe(1);
  });

  it('publishFlow refuses to activate a template (no account)', async () => {
    const tmpl = await prisma.loomiFlow.create({
      data: {
        name: `${PREFIX}tmpl`,
        accountKey: null,
        status: 'draft',
        nodes: { create: [{ type: 'trigger', config: '{}' }] },
      },
    });
    await expect(publishFlow(tmpl.id)).rejects.toBeInstanceOf(FlowValidationError);
  });

  it('publishFlow rejects an account flow with no enabled trigger', async () => {
    // Graph is structurally valid (trigger -> exit) but there are no
    // LoomiFlowTrigger rows, so it could never enroll anyone.
    const flow = await prisma.loomiFlow.create({
      data: {
        name: `${PREFIX}notrig`,
        accountKey: accA,
        status: 'draft',
        nodes: { create: [{ type: 'trigger', config: '{}' }, { type: 'exit', config: '{}' }] },
      },
      include: { nodes: true },
    });
    const trig = flow.nodes.find((n) => n.type === 'trigger')!;
    const exit = flow.nodes.find((n) => n.type === 'exit')!;
    await prisma.loomiFlowEdge.create({
      data: { flowId: flow.id, fromNodeId: trig.id, toNodeId: exit.id },
    });
    await expect(publishFlow(flow.id)).rejects.toBeInstanceOf(FlowValidationError);
  });
});
