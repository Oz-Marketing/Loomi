import { prisma } from '@/lib/prisma';
import { loadPreviewAccountData, resolvePreviewTokens } from '@/lib/email/preview-substitute';
import { renderCampaignScreenshotFromHtml } from '@/lib/email/screenshot';
import { resolveAccountFooter } from '@/lib/sending/account-footer';
import { UNSUBSCRIBE_TOKEN, injectUnsubscribeFooter } from '@/lib/sending/unsubscribe-footer';
import { mergeBlastMetadata, readTemplateSlug } from '@/lib/messaging/blast-metadata';
import { upsertCampaignEmailTemplate } from '@/lib/services/campaigns';
import { createDraftEmailBlast, updateEmailBlastDraft } from '@/lib/services/email-blasts';
import type { DraftEvaluation } from './compliance/registry';
import type { CopyOption } from './compliance/types';
import { cantDraftUpdate, draftReadyUpdate } from './notes';
import { parseReading } from './reading';
import { postDraftUpdate, setTemplateLink, uploadDraftFile } from './monday-board';
import { noticeOnce } from './notice';

/**
 * The output: a drafted, rule-cleared version becomes a DRAFT EMAIL BLAST for
 * the account, and monday hears about it (Connor, 2026-10-15 — one library of
 * reusable templates, blasts filled from them, no new template per send).
 *
 *   1. The blast and its design. The design is a hidden per-blast template
 *      (type `campaign`, kept out of the library) — the same shape every Loomi
 *      blast has, so the blast's design step opens it. Created on the first
 *      draft; a re-draft updates the same blast and design while the blast is
 *      still a draft, and starts a fresh one if someone has already scheduled
 *      or sent it.
 *   2. Render the proof the way a recipient will get it: Loomi's send-time
 *      footer injected, the account's real values filled in.
 *   3. Attach the PNG and HTML to Draft Files, point the Loomi Template column
 *      at the draft blast, and post an update carrying what was read off the
 *      creative, so the proofer can compare it with the image.
 *
 * Nothing is sent: the blast has no audience and no schedule until a person
 * gives it both.
 */

/** A screenshot can hang on a stuck asset; one render must never pin the worker. */
const RENDER_TIMEOUT_MS = 90_000;

export function studioUrl(path: string): string {
  const base = (process.env.NEXTAUTH_URL || 'https://studio.loomilm.com').trim().replace(/\/+$/, '');
  return `${base}${path}`;
}

/** The draft blast's design step — bare, not account-prefixed, so it opens for anyone with access. */
export function draftBlastUrl(blastId: string): string {
  return studioUrl(`/messaging/blasts/${encodeURIComponent(blastId)}/template`);
}

/** The HTML a recipient receives, short of their own name: tokens filled, the send-time footer in. */
export async function proofHtml(html: string, accountKey: string): Promise<string> {
  const account = await loadPreviewAccountData(accountKey);
  const row = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { dealer: true, address: true, city: true, state: true, postalCode: true },
  });
  // Exactly what the sender does: the unsubscribe tag becomes SendGrid's token
  // BEFORE the footer goes in, so the footer sees the link and doesn't repeat it.
  const sendReady = resolvePreviewTokens(html.replaceAll('{{unsubscribe_link}}', UNSUBSCRIBE_TOKEN), account);
  const withFooter = row
    ? injectUnsubscribeFooter({
        html: sendReady,
        text: '',
        account: {
          dealer: row.dealer,
          address: row.address,
          city: row.city,
          state: row.state,
          postalCode: row.postalCode,
        },
        config: (await resolveAccountFooter(accountKey)).config,
      }).html
    : sendReady;
  // A proof has no recipient to unsubscribe.
  return withFooter.replaceAll(UNSUBSCRIBE_TOKEN, '#');
}

async function renderPng(html: string, filename: string): Promise<Buffer> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Rendering the proof image took too long.')), RENDER_TIMEOUT_MS);
  });
  try {
    const shot = await Promise.race([renderCampaignScreenshotFromHtml({ html, filename }), timeout]);
    return shot.image;
  } finally {
    clearTimeout(timer);
  }
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export type PublishResult = { ok: true; blastId: string; templateSlug: string } | { ok: false; error: string };

export async function publishDraftVersion(versionId: string): Promise<PublishResult> {
  const version = await prisma.draftVersion.findUnique({ where: { id: versionId }, include: { request: true } });
  if (!version) return { ok: false, error: `Draft version ${versionId} not found.` };
  const request = version.request;
  if (!request.accountKey) return { ok: false, error: 'The request has no Loomi account.' };
  const evaluation = parseJson<DraftEvaluation | null>(version.evaluation, null);
  if (!evaluation || evaluation.blocked) return { ok: false, error: 'This version was blocked by a rule and is not publishable.' };

  try {
    // 1. The draft blast and its design.
    const subjects = parseJson<CopyOption[]>(version.subjects, []);
    const previews = parseJson<CopyOption[]>(version.previews, []);
    const name = request.projectName ? `${request.projectName} · ${request.name}` : request.name;
    const subject = subjects.find((s) => s.kind === 'initial')?.text ?? '';
    const previewText = previews.find((p) => p.kind === 'initial')?.text ?? '';
    const prior = request.blastId
      ? await prisma.emailBlast.findUnique({ where: { id: request.blastId }, select: { id: true, status: true, metadata: true } })
      : null;
    // A blast someone scheduled or sent is theirs; a re-draft never rewrites it.
    const reusable = prior?.status === 'draft' ? prior : null;
    const slug = await upsertCampaignEmailTemplate(reusable ? readTemplateSlug(reusable.metadata) || null : null, {
      accountKey: request.accountKey,
      title: name,
      content: version.template,
      previewText,
    });
    const blastId = reusable?.id ?? (await createDraftEmailBlast({ name, accountKeys: [request.accountKey] })).id;
    await updateEmailBlastDraft(blastId, {
      subject,
      previewText,
      htmlContent: version.html,
      sourceType: 'template-library',
      metadata: mergeBlastMetadata(reusable?.metadata, {
        templateSlug: slug,
        draftRequestId: request.id,
        draftVersion: version.number,
      }),
    });
    const design = await prisma.template.findUnique({ where: { slug }, select: { id: true } });
    await prisma.draftRequest.update({ where: { id: request.id }, data: { blastId, templateId: design?.id ?? null } });

    // 2. The proof.
    const html = await proofHtml(version.html, request.accountKey);
    const base = `${request.name} - v${version.number}`;
    const png = await renderPng(html, `${base}.png`);

    // 3. monday.
    const uploaded = [
      await uploadDraftFile(request.mondaySubitemId, new File([new Uint8Array(png)], `${base}.png`, { type: 'image/png' })),
      await uploadDraftFile(request.mondaySubitemId, new File([html], `${base}.html`, { type: 'text/html' })),
    ];
    const url = draftBlastUrl(blastId);
    await setTemplateLink(request.mondaySubitemId, url, 'Open draft in Loomi');
    await postDraftUpdate(
      request.mondaySubitemId,
      draftReadyUpdate({
        draftUrl: url,
        versionNumber: version.number,
        subjects,
        previews,
        reading: parseReading(request.extraction),
        notes: parseJson<string[]>(version.notes, []),
        warnings: evaluation.violations.filter((v) => v.severity === 'warning').map((v) => v.message),
      }),
    );

    await prisma.$transaction([
      prisma.draftVersion.update({
        where: { id: version.id },
        data: {
          uploadedAt: new Date(),
          mondayAssetIds: JSON.stringify(uploaded.map((u) => u.assetId).filter(Boolean)),
        },
      }),
      prisma.draftRequest.update({ where: { id: request.id }, data: { status: 'in_proofing', error: null } }),
    ]);
    return { ok: true, blastId, templateSlug: slug };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[drafting-publish] version ${versionId} failed:`, err);
    await prisma.draftRequest
      .update({ where: { id: request.id }, data: { status: 'failed', error: `Publishing the draft failed: ${message}` } })
      .catch(() => {});
    await noticeOnce(request, cantDraftUpdate(`Publishing the draft failed: ${message}`));
    return { ok: false, error: message };
  }
}
