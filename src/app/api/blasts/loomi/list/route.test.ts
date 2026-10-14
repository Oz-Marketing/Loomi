import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// An account's Blasts list shows that account's blasts and nothing else.
// Blasts with no account used to show in EVERY account's list — so a blast
// made while a group was selected appeared under each of its rooftops too.

const listEmailBlasts = vi.fn();
const listSmsBlasts = vi.fn();

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(async () => ({
    session: { user: { id: 'u1', role: 'super_admin', accountKeys: [] } },
    error: null,
  })),
}));

vi.mock('@/lib/services/email-blasts', () => ({
  listEmailBlasts: (...a: unknown[]) => listEmailBlasts(...a),
  getWarmupHolds: vi.fn(async () => new Map()),
  followUpInfo: () => ({ resendOf: undefined, followUpDelayHours: undefined }),
}));

vi.mock('@/lib/services/sms-blasts', () => ({
  listSmsBlasts: (...a: unknown[]) => listSmsBlasts(...a),
}));

vi.mock('@/lib/services/email-analytics', () => ({ CAMPAIGN_ROW_LIMIT: 500 }));

const { GET } = await import('./route');

function blast(id: string, accountKeys: string[]) {
  return {
    id,
    name: id,
    status: 'draft',
    flowNodeKey: '',
    metadata: null,
    accountKeys,
    createdAt: '2026-10-12T12:00:00.000Z',
    updatedAt: '2026-10-12T12:00:00.000Z',
    scheduledFor: null,
    completedAt: null,
    sentCount: 0,
    totalRecipients: 0,
    failedCount: 0,
    error: null,
  };
}

async function namesFor(accountKey: string): Promise<string[]> {
  const res = await GET(
    new NextRequest(`http://localhost/api/blasts/loomi/list?accountKey=${accountKey}`),
  );
  const body = (await res.json()) as { campaigns: { name: string }[] };
  return body.campaigns.map((c) => c.name);
}

beforeEach(() => {
  listEmailBlasts.mockReset();
  listSmsBlasts.mockReset();
  // Ignore the DB-side filter: hand back everything, as an over-broad query
  // would, so the route's own matching is what's under test.
  listEmailBlasts.mockResolvedValue([
    blast('group-blast', ['youngPowersports']),
    blast('rooftop-blast', ['ridersEdge']),
    blast('unassigned-blast', []),
  ]);
  listSmsBlasts.mockResolvedValue([]);
});

describe('GET /api/blasts/loomi/list', () => {
  it("shows a rooftop only its own blasts — not its group's, not unassigned ones", async () => {
    expect(await namesFor('ridersEdge')).toEqual(['rooftop-blast']);
  });

  it("shows a group only the group's own blasts", async () => {
    expect(await namesFor('youngPowersports')).toEqual(['group-blast']);
  });

  it('asks the database for exactly the requested account', async () => {
    await namesFor('ridersEdge');
    expect(listEmailBlasts).toHaveBeenCalledWith(
      expect.objectContaining({ accountKeys: ['ridersEdge'] }),
    );
    expect(listEmailBlasts.mock.calls[0][0]).not.toHaveProperty('includeUnassigned');
  });
});
