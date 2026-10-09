import { prisma } from '@/lib/prisma';
import { postDraftUpdate } from './monday-board';

/**
 * Post an update on a request's subitem — unless it's exactly what was posted
 * last time. The poller runs every five minutes, and a request that can't be
 * drafted would otherwise say so on monday every five minutes.
 *
 * Never throws: a notice is courtesy, and a monday hiccup posting it mustn't
 * fail the work it reports on.
 */
export async function noticeOnce(
  request: { id: string; mondaySubitemId: string; lastNotice: string | null },
  html: string,
): Promise<boolean> {
  if (request.lastNotice === html) return false;
  try {
    await postDraftUpdate(request.mondaySubitemId, html);
    await prisma.draftRequest.update({ where: { id: request.id }, data: { lastNotice: html } });
    return true;
  } catch (err) {
    console.error(`[drafting] could not post an update on subitem ${request.mondaySubitemId}:`, err);
    return false;
  }
}
