import { prisma } from '@/lib/prisma';
import { loadPreviewAccountData, resolvePreviewTokens } from '@/lib/email/preview-substitute';
import { renderCampaignScreenshotFromHtml } from '@/lib/email/screenshot';
import { resolveAccountFooter } from '@/lib/sending/account-footer';
import { UNSUBSCRIBE_TOKEN, injectUnsubscribeFooter } from '@/lib/sending/unsubscribe-footer';
import { createTemplate, getTemplateById, updateTemplate } from '@/lib/services/templates';
import type { DraftEvaluation } from './compliance/registry';
import type { CopyOption } from './compliance/types';
import { cantDraftUpdate, draftReadyUpdate } from './notes';
import { parseReading } from './reading';
import { postDraftUpdate, setTemplateLink, uploadDraftFile } from './monday-board';
import { noticeOnce } from './notice';

/**
 * The template output: a drafted, rule-cleared version becomes the
 * deliverable's Loomi email template, and monday hears about it.
 *
 *   1. Save it as the account's template — created on the first draft, updated
 *      after that (updateTemplate snapshots the previous draft into
 *      TemplateVersion, so nothing a re-draft replaces is lost).
 *   2. Render the proof the way a recipient will get it: Loomi's send-time
 *      footer injected, the account's real values filled in.
 *   3. Attach the PNG and HTML to Draft Files, point the Loomi Template column
 *      at the template, and post an update carrying what was read off the
 *      creative, so the proofer can compare it with the image.
 *
 * Nothing is sent: the template sits in the library until a person uses it.
 */

/** A screenshot can hang on a stuck asset; one render must never pin the worker. */
const RENDER_TIMEOUT_MS = 90_000;

export function studioUrl(path: string): string {
  const base = (process.env.NEXTAUTH_URL || 'https://studio.loomilm.com').trim().replace(/\/+$/, '');
  return `${base}${path}`;
}

export function templateEditorUrl(slug: string): string {
  return studioUrl(`/templates/editor?design=${encodeURIComponent(slug)}`);
}

/** "Email Blast 1 - Young Powersports Euro" → "draft-email-blast-1-young-powersports-euro-k3x9q2ab". */
export function draftTemplateSlug(subitemName: string, requestId: string): string {
  const base = subitemName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `draft-${base || 'email'}-${requestId.slice(-8)}`;
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

export type PublishResult = { ok: true; templateSlug: string } | { ok: false; error: string };

export async function publishDraftVersion(versionId: string): Promise<PublishResult> {
  const version = await prisma.draftVersion.findUnique({ where: { id: versionId }, include: { request: true } });
  if (!version) return { ok: false, error: `Draft version ${versionId} not found.` };
  const request = version.request;
  if (!request.accountKey) return { ok: false, error: 'The request has no Loomi account.' };
  const evaluation = parseJson<DraftEvaluation | null>(version.evaluation, null);
  if (!evaluation || evaluation.blocked) return { ok: false, error: 'This version was blocked by a rule and is not publishable.' };

  try {
    // 1. The template.
    const subjects = parseJson<CopyOption[]>(version.subjects, []);
    const previews = parseJson<CopyOption[]>(version.previews, []);
    const title = request.projectName ? `${request.projectName} · ${request.name}` : request.name;
    const preheader = previews.find((p) => p.kind === 'initial')?.text;
    let slug: string;
    const existing = request.templateId ? await getTemplateById(request.templateId) : null;
    if (existing) {
      slug = existing.slug;
      await updateTemplate(slug, { content: version.template, title, preheader });
    } else {
      slug = draftTemplateSlug(request.name, request.id);
      const created = await createTemplate({
        slug,
        title,
        type: 'design',
        category: 'drafted',
        content: version.template,
        preheader,
        accountKey: request.accountKey,
      });
      await prisma.draftRequest.update({ where: { id: request.id }, data: { templateId: created.id } });
    }

    // 2. The proof.
    const html = await proofHtml(version.html, request.accountKey);
    const base = `${request.name} - v${version.number}`;
    const png = await renderPng(html, `${base}.png`);

    // 3. monday.
    const uploaded = [
      await uploadDraftFile(request.mondaySubitemId, new File([new Uint8Array(png)], `${base}.png`, { type: 'image/png' })),
      await uploadDraftFile(request.mondaySubitemId, new File([html], `${base}.html`, { type: 'text/html' })),
    ];
    const url = templateEditorUrl(slug);
    await setTemplateLink(request.mondaySubitemId, url, 'Open in Loomi');
    await postDraftUpdate(
      request.mondaySubitemId,
      draftReadyUpdate({
        templateUrl: url,
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
    return { ok: true, templateSlug: slug };
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
