import { prisma } from '@/lib/prisma';
import { loadAcceptedCoopPack } from '@/lib/ad-generator/coop-pack-store';
import type { CoopRulePack } from '@/lib/ad-generator/coop-rules';
import { loadPreviewAccountData } from '@/lib/email/preview-substitute';
import { getAccountOems } from '@/lib/oems';
import { getAncestorAccountKeys } from '@/lib/services/accounts';
import { buildDraft, footerBackground, siteUrl, type BuiltDraft } from './assemble';
import type { DraftAsset } from './assets';
import type { DraftAccount } from './compliance/types';
import { findConflicts, type DraftConflict } from './conflicts';
import { COPY_RULE_IDS, repairCopy, writeCopy, type CopyResult } from './copywriter';
import { pickHero } from './approved-files';
import { findDraftingTemplate } from './drafting-templates';
import { readCreative } from './extract';
import { coopNotes, loadGuidelineDocs, pickPages, type GuidelineDoc } from './guidelines';
import { accountLinks, checkLink, resolveCtas, type CtaPurpose } from './links';
import { footerLogo } from './logo';
import { factSources } from './extraction';
import type { ProjectRequest } from './monday-board';
import { blockedUpdate, cantDraftUpdate, conflictUpdate } from './notes';
import { noticeOnce } from './notice';
import { promptHash } from './model';
import { publishDraftVersion } from './publish';
import { parseReading, type CreativeReading } from './reading';
import { campaignSlug } from './utm';

/**
 * The stages between fetch and publish (docs/email-drafting.md §4, 3–8):
 * read the creative, classify it, check it against the request, write the
 * copy, assemble and validate the email, and hand a clean version to publish.
 *
 * Every stop leaves the request in a status that says why and one notice on
 * the subitem. A version is saved whether or not it passes: a blocked version
 * is the record of why nothing reached Draft Files.
 */

type Row = NonNullable<Awaited<ReturnType<typeof prisma.draftRequest.findUnique>>>;

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function stop(
  row: Row,
  status: 'conflict' | 'blocked' | 'failed',
  error: string,
  notice: string,
  extra: { conflicts?: DraftConflict[] } = {},
): Promise<void> {
  await prisma.draftRequest.update({
    where: { id: row.id },
    data: { status, error, ...(extra.conflicts ? { conflicts: JSON.stringify(extra.conflicts) } : {}) },
  });
  await noticeOnce(row, notice);
}

/** The account as the rules and the assembler need it. */
async function loadAccount(accountKey: string) {
  const row = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { key: true, dealer: true, oem: true, oems: true, website: true, siteDisplay: true, customValues: true },
  });
  if (!row) return null;
  const preview = await loadPreviewAccountData(accountKey);
  const logos = preview?.logos;
  const draftAccount: DraftAccount = {
    key: row.key,
    dealer: row.dealer,
    oems: getAccountOems(row),
    groupKeys: await getAncestorAccountKeys(row.key),
    siteDisplay: row.siteDisplay,
    website: row.website,
  };
  return {
    draftAccount,
    logoUrl: await footerLogo(logos, footerBackground(draftAccount.oems)),
    links: accountLinks(row.customValues),
  };
}

/** The make whose co-op pack applies: the featured vehicle's, when the store sells it, else the store's only make. */
function coopMake(reading: CreativeReading, oems: string[]): string | null {
  const make = reading.vehicle?.make?.toLowerCase();
  const sold = make ? oems.find((o) => o.toLowerCase() === make) : undefined;
  return sold ?? (oems.length === 1 ? oems[0] : null);
}

function bannedPhrases(pack: CoopRulePack | null): string[] {
  if (!pack) return [];
  const out: string[] = [];
  for (const rule of pack.rules) {
    if (rule.kind !== 'banned_phrase') continue;
    if (rule.phrases?.length) out.push(...rule.phrases);
    else if (rule.phrase) out.push(rule.phrase);
  }
  return [...new Set(out.map((p) => p.trim()).filter(Boolean))];
}

/** Run stages 3–8 for a request the fetch stage left at `awaiting_extraction`. */
export async function runDraftStages(requestId: string): Promise<void> {
  const claimed = await prisma.draftRequest.updateMany({
    where: { id: requestId, status: 'awaiting_extraction' },
    data: { status: 'extracting', error: null },
  });
  if (claimed.count === 0) return;
  const row = await prisma.draftRequest.findUnique({ where: { id: requestId } });
  if (!row) return;

  try {
    const assets = parse<DraftAsset[]>(row.assets) ?? [];
    const request = parse<ProjectRequest>(row.request);
    if (!row.accountKey) {
      await stop(row, 'failed', 'The request has no Loomi account.', cantDraftUpdate('Loomi doesn\'t know which account this is for.'));
      return;
    }

    // 3. Extract + classify. A reading of the same creative is reused — the
    // fetch stage clears it when the creative changes.
    let reading = parseReading(row.extraction);
    if (!reading) {
      reading = await readCreative(assets);
      await prisma.draftRequest.update({ where: { id: row.id }, data: { extraction: JSON.stringify(reading) } });
    }
    // Every kind of creative is drafted (Connor, 2026-10-15). The request type
    // only steers the copy and picks the examples; it never stops a draft.

    // 4. Conflict check — report both values, never choose.
    const check = findConflicts(reading, request);
    if (check.conflicts.length) {
      await stop(
        row,
        'conflict',
        `The creative and the request disagree on ${check.conflicts.map((c) => c.label).join(', ')}.`,
        conflictUpdate(check.conflicts),
        { conflicts: check.conflicts },
      );
      return;
    }

    // 6. Draft.
    await prisma.draftRequest.update({ where: { id: row.id }, data: { status: 'drafting', conflicts: null } });
    const loaded = await loadAccount(row.accountKey);
    if (!loaded) {
      await stop(row, 'failed', `No Loomi account "${row.accountKey}".`, cantDraftUpdate(`Loomi has no account "${row.accountKey}".`));
      return;
    }
    const { draftAccount, logoUrl, links } = loaded;
    // Design marks the email's main image "Hero"; otherwise the first image.
    const images = assets.filter((a) => a.contentType.startsWith('image/') && a.url);
    const hero = pickHero(images);
    if (!hero?.url) {
      const why = "The creative couldn't be stored in Spaces (S3 isn't configured here), and the email needs a lasting image URL for it.";
      await stop(row, 'failed', why, cantDraftUpdate(why));
      return;
    }
    if (!draftAccount.website) {
      const why = `${draftAccount.dealer} has no website on file in Loomi, and every link in the email goes there.`;
      await stop(row, 'blocked', why, cantDraftUpdate(why));
      return;
    }

    const coop = row.coop === 'yes' || row.coop === 'compliance_check';
    const make = coopMake(reading, draftAccount.oems);
    const coopPack = make ? ((await loadAcceptedCoopPack(make))?.pack ?? null) : null;
    // §8: the make's guideline pages as input to the copy — co-op requests only, never a gate.
    const guidelineDocs: GuidelineDoc[] = coop && make ? await loadGuidelineDocs(make) : [];
    const facts = factSources(reading, request);
    const now = new Date();
    const utmCampaign = campaignSlug(request?.name || row.projectName || row.name, now.getMonth() + 1, now.getFullYear());
    const website = siteUrl(draftAccount.website);
    const brief = {
      dealer: draftAccount.dealer,
      oems: draftAccount.oems,
      reading,
      facts,
      request: {
        project: request?.name ?? row.projectName,
        details: request?.details ?? '',
        audience: [request?.audience, request?.audienceDetails].filter(Boolean).join(' — '),
        runDates: request?.runDates ?? null,
      },
      bannedPhrases: coop ? bannedPhrases(coopPack) : [],
      guidelines: pickPages(guidelineDocs),
      linkedPurposes: Object.keys(links) as CtaPurpose[],
    };
    const common = { reading, account: draftAccount, logoUrl, heroUrl: hero.url, website, utmCampaign, facts, coop, coopPack };

    // 7. Validate, with one rewrite when only the copy is at fault.
    let written: CopyResult = await writeCopy(brief);
    let resolved = await resolveCtas(written.copy.ctas, links, website, checkLink);
    // §4.1: a marked template's layout when there is one; the built-in otherwise.
    const marked = await findDraftingTemplate(row.accountKey, reading.requestType ?? 'other');
    const build = (shell: typeof marked) =>
      buildDraft({ ...common, copy: written.copy, ctaUrls: resolved.map((r) => r.url), shell: shell?.template ?? null });
    let built = await build(marked);
    const copyErrors = (b: BuiltDraft) => b.evaluation.violations.filter((v) => v.severity === 'error' && COPY_RULE_IDS.has(v.ruleId));
    if (built.evaluation.blocked && copyErrors(built).length) {
      written = await repairCopy(written, copyErrors(built));
      resolved = await resolveCtas(written.copy.ctas, links, website, checkLink);
      built = await build(marked);
    }
    // A template that can't take the draft, or whose own design breaks a rule
    // for this store (a palette, a font), falls back to the built-in layout —
    // the copy is the same, so only the layout changes.
    const layoutNotes: string[] = [];
    if (marked && built.shellProblem) {
      layoutNotes.push(`The "${marked.title}" drafting template couldn't be used, so the built-in layout was: ${built.shellProblem}`);
    } else if (marked && built.usedShell && built.evaluation.blocked && copyErrors(built).length === 0) {
      const broken = built.evaluation.violations.filter((v) => v.severity === 'error').map((v) => v.message);
      const fallback = await build(null);
      if (!fallback.evaluation.blocked) {
        layoutNotes.push(`The "${marked.title}" drafting template breaks a rule for ${draftAccount.dealer} (${broken.join(' ')}), so the built-in layout was used.`);
        built = fallback;
      }
    } else if (marked && built.usedShell) {
      layoutNotes.push(`Built on the "${marked.title}" drafting template.`);
    }

    const notes = [
      ...layoutNotes,
      ...check.notes,
      ...built.copy.notes,
      ...coopNotes(written.coopUnmet, guidelineDocs),
      ...(coop && make && guidelineDocs.length === 0
        ? [`This is a co-op request, but Loomi has no ${make} guideline document to draft against.`]
        : []),
      ...(reading.unreadable ?? []).map((u) => `Couldn't read part of the creative: ${u}.`),
      ...(reading.disclaimer?.confidence === 'low'
        ? ['The disclaimer was hard to read. Check it against the creative word for word.']
        : []),
      // Deduped: an unconfirmable site gives every button the same note.
      ...new Set(resolved.map((r) => r.note).filter((n): n is string => !!n)),
    ];

    const previous = await prisma.draftVersion.findFirst({ where: { requestId: row.id }, orderBy: { number: 'desc' } });
    const version = await prisma.draftVersion.create({
      data: {
        requestId: row.id,
        number: (previous?.number ?? 0) + 1,
        parentId: previous?.id ?? null,
        template: JSON.stringify(built.artifact.template),
        subjects: JSON.stringify(built.copy.subjects),
        previews: JSON.stringify(built.copy.previews),
        html: built.artifact.html,
        evaluation: JSON.stringify(built.evaluation),
        notes: JSON.stringify(notes),
        model: reading.model,
        promptHash: promptHash(written.system, written.prompt),
        exampleIds: JSON.stringify(written.exampleIds),
      },
    });

    if (built.evaluation.blocked) {
      const errors = built.evaluation.violations.filter((v) => v.severity === 'error');
      await stop(row, 'blocked', errors.map((e) => e.message).join(' '), blockedUpdate(version.number, errors));
      return;
    }

    // 8. Publish — it records its own failure.
    await publishDraftVersion(version.id);
  } catch (err) {
    console.error(`[drafting] request ${requestId} failed while drafting:`, err);
    const why = `Drafting stopped unexpectedly: ${err instanceof Error ? err.message : String(err)}`;
    await stop(row, 'failed', why, cantDraftUpdate(why)).catch(() => {});
  }
}
