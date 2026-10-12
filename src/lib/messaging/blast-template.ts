// How a blast email follows the template it was built from.
//
// A blast stores COMPILED html (what the worker sends) plus the slug of the
// template it came from in metadata.templateSlug. Edits happen in the template
// editor, which saves the template, not the blast — so each builder step that
// shows the email re-compiles the template and writes it back to the draft.
// That "re-sync" lives here, once, for every page that needs it; the email +
// text pages used to have none, so editor changes never reached their email.
//
// Rules this module holds:
//   - Only a DRAFT is ever re-synced. A scheduled or sent blast keeps exactly
//     the content it was committed with.
//   - A re-sync that can't be saved changes nothing on screen: the caller keeps
//     showing the stored html and says so, rather than previewing an email the
//     send won't use.
//   - A blast never edits a template it doesn't own. Picking a shared library
//     (or group) template copies it into the blast's account first, so the
//     editor's in-place saves land on that copy and not on everyone's template.
//   - The subject and preheader written in the editor are carried onto the
//     blast while the blast's own fields are blank or still the template's —
//     and the blast's NAME is never used as a subject.

import { parseV2Template } from '@/lib/email/types';
import { writeHtmlTemplateTitle } from '@/lib/email/html-template-title';
import { parseBlastMetadata, readTemplateSlug } from './blast-metadata';
import { isEditableBlastStatus } from './blast-builder-steps';

export interface TemplateMeta {
  subject: string;
  preheader: string;
}

// The drag-and-drop starter seeds its subject with the template's name, and
// "Create New" names it this. Copying it would stamp a placeholder onto the
// blast and tick "Subject line is set" for a subject nobody wrote.
const STARTER_SUBJECTS = new Set(['untitled template']);

function frontmatterValue(block: string, key: string): string {
  const line = block.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
  return line ? line[1].trim().replace(/^["']|["']$/g, '').trim() : '';
}

/**
 * The subject and preheader a template carries. Drag-and-drop templates keep
 * them as the v2 doc's `subject` / `preheader` (the editor's Subject Line and
 * Preheader fields); an HTML template may carry `subject:` / `preheader:` in
 * its frontmatter. A template's `title` is its NAME and is never a subject.
 */
export function extractTemplateMeta(raw: string): TemplateMeta {
  const v2 = parseV2Template(raw);
  let subject = '';
  let preheader = '';
  if (v2) {
    subject = (v2.subject || '').trim();
    preheader = (v2.preheader || '').trim();
  } else {
    const block = raw.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/);
    if (block) {
      subject = frontmatterValue(block[1], 'subject');
      preheader = frontmatterValue(block[1], 'preheader');
    }
  }
  if (STARTER_SUBJECTS.has(subject.toLowerCase())) subject = '';
  return { subject, preheader };
}

export interface TemplateMetaPlan {
  /** Set only when the blast's subject should change. */
  subject?: string;
  /** Set only when the blast's preview text should change. */
  previewText?: string;
  /** Recorded so the next sync can tell "still the template's" from "edited". */
  metadataPatch: { templateSubject: string; templatePreheader: string };
}

/**
 * Decide what a template's subject and preheader do to the blast.
 *
 * A blast field FOLLOWS the template while it is blank or still equal to what
 * the template last supplied (metadata.templateSubject / templatePreheader).
 * Once someone types their own, the template stops overriding it. A subject
 * that merely repeats the blast's name is treated as blank too: drafts made
 * before this rule defaulted their subject to the name, and the template's
 * real subject is better than that.
 */
export function planTemplateMetaSync(input: {
  blastName: string;
  blastSubject: string;
  blastPreview: string;
  metadata: string | null | undefined;
  template: TemplateMeta;
}): TemplateMetaPlan {
  const meta = parseBlastMetadata(input.metadata);
  const prevSubject = typeof meta.templateSubject === 'string' ? meta.templateSubject : undefined;
  const prevPreheader =
    typeof meta.templatePreheader === 'string' ? meta.templatePreheader : undefined;
  const plan: TemplateMetaPlan = {
    metadataPatch: {
      templateSubject: input.template.subject,
      templatePreheader: input.template.preheader,
    },
  };

  const subject = input.blastSubject;
  const subjectFromTemplate = prevSubject !== undefined && subject === prevSubject;
  const subjectIsName = input.blastName.trim() !== '' && subject.trim() === input.blastName.trim();
  if (input.template.subject && subject !== input.template.subject) {
    if (subject.trim() === '' || subjectFromTemplate || subjectIsName) {
      plan.subject = input.template.subject;
    }
  } else if (!input.template.subject && subjectFromTemplate && subject !== '') {
    // The template dropped its subject; one the template put there goes too.
    plan.subject = '';
  }

  const preview = input.blastPreview;
  const previewFromTemplate = prevPreheader !== undefined && preview === prevPreheader;
  if (preview !== input.template.preheader && (preview.trim() === '' || previewFromTemplate)) {
    plan.previewText = input.template.preheader;
  }

  return plan;
}

/** Name for a blast's private copy of a shared template. */
export function forkedTemplateName(templateName: string, blastName: string): string {
  const base = templateName.trim() || 'Template';
  const blast = blastName.trim();
  const name = blast ? `${base} — ${blast}` : base;
  return name.length > 120 ? `${name.slice(0, 119)}…` : name;
}

/**
 * Does a blast in `blastAccountKey` need its own copy before it can edit this
 * template? Yes unless the account owns it outright: a library template
 * (no account) and a group's template are both shared with other accounts.
 */
export function needsFork(
  templateAccountKey: string | null | undefined,
  blastAccountKey: string,
): boolean {
  return (templateAccountKey ?? null) !== blastAccountKey;
}

// ── Network ──────────────────────────────────────────────────────────────

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function errorText(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === 'string' && data.error ? data.error : fallback;
}

/**
 * Compile template source (v2 JSON or HTML) into email-ready html. The blast
 * stores the compiled form: v2 JSON would render as code in a preview and as
 * nonsense in an inbox.
 */
export async function compileTemplateHtml(raw: string): Promise<string> {
  const res = await fetch('/api/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html: raw, previewValues: {} }),
  });
  const data = await readJson(res);
  if (!res.ok || typeof data.html !== 'string' || !data.html) {
    throw new Error(errorText(data, 'Failed to compile the template.'));
  }
  return data.html;
}

/** A template's source and record title; null when it no longer exists. */
export async function fetchTemplateRaw(
  slug: string,
): Promise<{ raw: string; title: string } | null> {
  const res = await fetch(`/api/templates?design=${encodeURIComponent(slug)}&format=raw`);
  if (res.status === 404) return null;
  const data = await readJson(res);
  if (!res.ok) throw new Error(errorText(data, 'Failed to load the template.'));
  const raw = typeof data.raw === 'string' ? data.raw : '';
  if (!raw) return null;
  return { raw, title: typeof data.title === 'string' ? data.title : '' };
}

/** The fields of an email draft the template sync reads and writes. */
export interface TemplateSyncDraft {
  id: string;
  name: string;
  status: string;
  subject: string;
  previewText: string;
  htmlContent: string;
  metadata?: string | null;
}

export interface TemplateSyncResult<D> {
  draft: D;
  /** Set when the template could not be applied; the draft is unchanged. */
  error: string | null;
}

async function patchEmailDraft(
  id: string,
  patch: Record<string, unknown>,
): Promise<{ ok: true; campaign: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/blasts/email/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await readJson(res);
    if (!res.ok || !data.campaign || typeof data.campaign !== 'object') {
      return { ok: false, error: errorText(data, `Save failed (HTTP ${res.status}).`) };
    }
    return { ok: true, campaign: data.campaign as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Save failed.' };
  }
}

/**
 * Everything a template's current content does to a draft, as a PATCH body.
 * Returns null when the draft already matches. `textContent` is cleared with
 * any html change — the send derives the plain-text part from the html when
 * it's empty, so a stale text part can never ride along with new html.
 */
function templatePatch(
  draft: TemplateSyncDraft,
  compiled: string,
  meta: TemplateMeta,
  extraMetadata: Record<string, unknown> = {},
): Record<string, unknown> | null {
  const plan = planTemplateMetaSync({
    blastName: draft.name,
    blastSubject: draft.subject,
    blastPreview: draft.previewText,
    metadata: draft.metadata,
    template: meta,
  });
  const patch: Record<string, unknown> = {};
  if (compiled !== draft.htmlContent) {
    patch.htmlContent = compiled;
    patch.textContent = '';
  }
  if (plan.subject !== undefined) patch.subject = plan.subject;
  if (plan.previewText !== undefined) patch.previewText = plan.previewText;

  const stored = parseBlastMetadata(draft.metadata);
  const metadataPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries({ ...plan.metadataPatch, ...extraMetadata })) {
    if (stored[key] !== value) metadataPatch[key] = value;
  }
  if (Object.keys(metadataPatch).length > 0) patch.metadataPatch = metadataPatch;
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Bring a draft's email up to date with its template. Drafts only; anything
 * else comes back untouched. Never throws — failures come back in `error`
 * with the draft exactly as stored.
 */
export async function syncEmailDraftFromTemplate<D extends TemplateSyncDraft>(
  draft: D,
): Promise<TemplateSyncResult<D>> {
  if (!isEditableBlastStatus(draft.status)) return { draft, error: null };
  const slug = readTemplateSlug(draft.metadata);
  if (!slug) return { draft, error: null };

  let compiled: string;
  let meta: TemplateMeta;
  try {
    const template = await fetchTemplateRaw(slug);
    // Template deleted: nothing newer exists, so the stored email stands.
    if (!template) return { draft, error: null };
    meta = extractTemplateMeta(template.raw);
    compiled = await compileTemplateHtml(template.raw);
  } catch (err) {
    return { draft, error: err instanceof Error ? err.message : 'Failed to load the template.' };
  }

  const patch = templatePatch(draft, compiled, meta);
  if (!patch) return { draft, error: null };
  const saved = await patchEmailDraft(draft.id, patch);
  if (!saved.ok) return { draft, error: saved.error };
  return { draft: { ...draft, ...saved.campaign } as D, error: null };
}

/**
 * Copy a shared template into `accountKey` for one blast, and return the
 * copy's slug. The copy is named "<Template> — <Blast>" so it reads as this
 * blast's in the account's template list; naming is best-effort, the copy is
 * what matters.
 */
export async function forkTemplateForBlast(input: {
  sourceSlug: string;
  templateName: string;
  blastName: string;
  accountKey: string;
}): Promise<string> {
  const res = await fetch('/api/templates/clone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceDesign: input.sourceSlug, accountKey: input.accountKey }),
  });
  const data = await readJson(res);
  if (!res.ok || typeof data.design !== 'string' || !data.design) {
    const err = new Error(errorText(data, 'Failed to copy the template for this blast.'));
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  const slug = data.design;
  const name = forkedTemplateName(input.templateName, input.blastName);
  try {
    const copy = await fetchTemplateRaw(slug);
    if (copy) {
      const v2 = parseV2Template(copy.raw);
      const renamed = v2
        ? JSON.stringify({ ...v2, title: name }, null, 2)
        : (writeHtmlTemplateTitle(copy.raw, name) ?? copy.raw);
      await fetch('/api/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ design: slug, raw: renamed, title: name, createSnapshot: false }),
      });
    }
  } catch {
    // Cosmetic — the copy works under its default name.
  }
  return slug;
}

/** A template as the picker lists it. */
export interface PickedTemplate {
  design: string;
  name: string;
  /** Owner; null for the shared library. Undefined when unknown. */
  accountKey?: string | null;
}

/**
 * The slug a blast should edit for `template`: its own when the account owns
 * it, otherwise a fresh copy in the blast's account.
 *
 * A user who can't create templates can't edit one in place either (the
 * editor's save needs the same permission), so when the copy is refused for
 * lack of permission the shared template is used read-only rather than
 * blocking the pick.
 */
export async function resolveTemplateForBlast(input: {
  template: PickedTemplate;
  blastName: string;
  blastAccountKey: string;
}): Promise<string> {
  const { template, blastAccountKey } = input;
  if (template.accountKey === undefined || !needsFork(template.accountKey, blastAccountKey)) {
    return template.design;
  }
  try {
    return await forkTemplateForBlast({
      sourceSlug: template.design,
      templateName: template.name,
      blastName: input.blastName,
      accountKey: blastAccountKey,
    });
  } catch (err) {
    if ((err as Error & { status?: number }).status === 403) return template.design;
    throw err;
  }
}

/**
 * The slug a blast should open in the editor. A blast built before templates
 * were copied may still point at a shared library or group template — opening
 * that in the editor would edit it for everyone — so it gets its own copy
 * first. Ownership is looked up in the account's usable set (its own, its
 * group's, the library); a template not listed there (a per-blast campaign
 * template, say) already belongs to the blast and opens as is.
 */
export async function templateSlugToEdit(input: {
  slug: string;
  blastName: string;
  blastAccountKey: string;
}): Promise<string> {
  if (!input.blastAccountKey) return input.slug;
  const res = await fetch(`/api/templates?accountKey=${encodeURIComponent(input.blastAccountKey)}`);
  if (!res.ok) return input.slug;
  const items = (await res.json().catch(() => [])) as PickedTemplate[];
  const match = Array.isArray(items) ? items.find((t) => t.design === input.slug) : undefined;
  if (!match || match.accountKey === undefined) return input.slug;
  return resolveTemplateForBlast({
    template: { design: input.slug, name: match.name || input.slug, accountKey: match.accountKey },
    blastName: input.blastName,
    blastAccountKey: input.blastAccountKey,
  });
}

/**
 * Attach `slug` to a draft: compile it, copy its subject and preheader per
 * planTemplateMetaSync, and record the slug. Throws on failure — applying is
 * an explicit action, so the caller reports it and stays put.
 */
export async function attachTemplateToDraft<D extends TemplateSyncDraft>(
  draft: D,
  slug: string,
): Promise<D> {
  const template = await fetchTemplateRaw(slug);
  if (!template) throw new Error('That template no longer exists.');
  const meta = extractTemplateMeta(template.raw);
  const compiled = await compileTemplateHtml(template.raw);
  const patch = templatePatch(draft, compiled, meta, { templateSlug: slug }) ?? {};
  patch.sourceType = 'template-library';
  const saved = await patchEmailDraft(draft.id, patch);
  if (!saved.ok) throw new Error(saved.error);
  return { ...draft, ...saved.campaign } as D;
}

/**
 * Take the template off a draft. The slug goes with the html — leaving it
 * behind made the next page load re-sync the old template straight back on.
 * The recorded template subject/preheader stay, so the next template can tell
 * whether the blast's subject is still the old template's to replace.
 */
export async function detachTemplateFromDraft<D extends TemplateSyncDraft>(
  draft: D,
): Promise<D> {
  const saved = await patchEmailDraft(draft.id, {
    htmlContent: '',
    textContent: '',
    metadataPatch: { templateSlug: null },
  });
  if (!saved.ok) throw new Error(saved.error);
  return { ...draft, ...saved.campaign } as D;
}
