import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, forbidden } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as projects from '@/lib/services/projects';
import { createCampaign } from '@/lib/services/campaigns';

/**
 * POST /api/projects/tasks/[id]/launch — the "Build it" action. For campaign
 * kinds it creates a Campaign container pre-filled with the task's account +
 * brief and back-links it to the task; ads/flow deep-link to their tools.
 * Returns a Studio-host relative `url` the client opens via getStudioUrl().
 */
const CAMPAIGN_KINDS = new Set(['email', 'sms', 'landing_page', 'form']);

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;
  const { id } = await params;

  const task = await projects.getTask(id);
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!projects.canAccess(getAccountScope(session!), task.accountKey)) return forbidden();

  // Already linked to a campaign → just reopen it.
  if (task.linkedAssetType === 'campaign' && task.linkedAssetId) {
    return NextResponse.json({ url: `/campaign-builder/${task.linkedAssetId}` });
  }

  if (CAMPAIGN_KINDS.has(task.kind)) {
    const campaign = await createCampaign({
      name: task.title,
      accountKey: task.accountKey,
      source: 'ai',
      goal: task.description || task.title,
      createdByUserId: session!.user.id,
      createdByRole: session!.user.role,
    });
    await projects.linkTaskAsset(
      id,
      'campaign',
      campaign.id,
      session!.user.id,
      `Linked campaign "${campaign.name}"`,
    );
    return NextResponse.json({ url: `/campaign-builder/${campaign.id}` });
  }

  if (task.kind === 'ads') return NextResponse.json({ url: '/tools/meta-ads-pacer' });
  if (task.kind === 'flow') return NextResponse.json({ url: '/flows' });

  return NextResponse.json({ error: 'This task type has no launch target' }, { status: 400 });
}
