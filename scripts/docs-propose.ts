/**
 * Propose doc updates for the articles `docs-drift.ts` flagged.
 *
 * Reads the drift report, and for each stale article hands Claude three things —
 * the article as it stands, the diff of the code it claims to cover, and the
 * house rules for what an article may say — then writes the revision back to the
 * markdown file. It changes NOTHING else: the workflow that calls this opens a
 * pull request, and a person merges it.
 *
 * That shape is deliberate and matches how release notes already work here
 * (docs/changelog.md): a machine may notice, draft, and propose. Publishing
 * customer-facing words stays a human act.
 *
 * The model is told, in order of priority:
 *   1. If the change does not affect what a user does, return the article
 *      UNCHANGED. Most commits under a covered path are refactors.
 *   2. Edit surgically. Rewriting a good article to say the same thing costs a
 *      reviewer their ability to see what actually changed.
 *   3. Never invent. If the diff implies a behavior the article can't confirm,
 *      flag it in the PR body instead of writing it as fact.
 *
 * Run: npx tsx scripts/docs-propose.ts --report /tmp/docs-drift.json
 */
try { require('dotenv/config'); } catch { /* production sets env vars directly */ }
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import Anthropic from '@anthropic-ai/sdk';

import { docsRoot } from '../src/lib/docs/source';
import type { DriftEntry, DriftReport } from './docs-drift';

/** Sonnet: this is close reading against a diff, at ~40 articles a month. */
const MODEL = 'claude-sonnet-4-5-20250929';

/** Diffs get long. Past this, the model gets the file list and commit subjects only. */
const MAX_DIFF_CHARS = 60_000;

/** Don't spend a whole workflow run on one enormous release. */
const MAX_ARTICLES_PER_RUN = 12;

const SYSTEM = `You maintain the in-app documentation for Loomi, a multi-tenant marketing
operations platform used by an agency and its clients.

You are given ONE documentation article and the code changes made since that
article was last confirmed accurate. Decide whether the article is still true,
and if it is not, correct it.

Rules, in priority order:

1. DEFAULT TO NO CHANGE. Most commits are refactors, renames, and internal
   plumbing that change nothing a reader does. If what the user does, sees, or
   should expect is unchanged, return the article exactly as given.
2. EDIT SURGICALLY. Change the sentences that are now wrong. Do not rewrite,
   restructure, or "improve" prose that is still accurate — a reviewer must be
   able to see what changed at a glance.
3. NEVER INVENT. Write only what the diff and the article support. If the diff
   suggests a behavior you cannot confirm, leave the article alone and say so
   in your note.
4. KEEP THE FRONTMATTER. Return the complete file including the --- block. You
   may update 'summary' if the article's subject genuinely changed. Do not
   change 'sector', 'category', or 'audience'.
5. MATCH THE VOICE. Second person, present tense, American spelling. Explain
   what to do and why it works that way. No marketing language, no "simply",
   no exclamation marks. An 'audience: everyone' article is read by dealership
   staff — it must not name infrastructure, other clients, or internal tooling.

Respond with a single JSON object and nothing else:

{
  "changed": boolean,
  "note": "one or two sentences: what you changed and why, or why nothing needed changing",
  "uncertain": "optional — a behavior the diff implies that you could not confirm",
  "article": "the complete file contents, frontmatter included"
}`;

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
}

/** The combined diff across an article's covered paths, oldest review → HEAD. */
function diffFor(entry: DriftEntry): { text: string; truncated: boolean } {
  if (!entry.reviewedSha) return { text: '', truncated: false };
  let text = '';
  try {
    text = git([
      'diff',
      `${entry.reviewedSha}..HEAD`,
      '--',
      ...entry.covers.map((c) => `:(glob)${c}`),
    ]);
  } catch {
    return { text: '', truncated: false };
  }
  if (text.length <= MAX_DIFF_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_DIFF_CHARS), truncated: true };
}

interface Proposal {
  changed: boolean;
  note: string;
  uncertain?: string;
  article: string;
}

function parseProposal(raw: string): Proposal | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : raw).trim();
  try {
    const parsed = JSON.parse(candidate) as Partial<Proposal>;
    if (typeof parsed.article !== 'string' || typeof parsed.changed !== 'boolean') return null;
    return {
      changed: parsed.changed,
      note: typeof parsed.note === 'string' ? parsed.note : '',
      uncertain: typeof parsed.uncertain === 'string' ? parsed.uncertain : undefined,
      article: parsed.article,
    };
  } catch {
    return null;
  }
}

async function reviewArticle(
  client: Anthropic,
  entry: DriftEntry,
  current: string,
): Promise<Proposal | null> {
  const { text: diff, truncated } = diffFor(entry);

  const commitList = entry.commits
    .map((c) => `- ${c.sha.slice(0, 8)} ${c.subject}\n    ${c.files.join('\n    ')}`)
    .join('\n');

  const prompt = [
    `## Article: content/docs/${entry.sourceKey}`,
    '',
    '```markdown',
    current,
    '```',
    '',
    `## Commits touching ${entry.covers.join(', ')} since this article was confirmed`,
    '',
    commitList,
    '',
    truncated
      ? '## Diff (TRUNCATED — it exceeded the size limit, so judge conservatively and prefer no change)'
      : '## Diff',
    '',
    diff ? '```diff\n' + diff + '\n```' : '_No diff available._',
  ].join('\n');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return parseProposal(text);
}

async function main() {
  const args = process.argv.slice(2);
  const reportIndex = args.indexOf('--report');
  if (reportIndex === -1) {
    console.error('Usage: npx tsx scripts/docs-propose.ts --report <file>');
    process.exitCode = 1;
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    // Not an error. An environment without a key simply doesn't get the AI half;
    // the drift flags in Loomi still tell staff what to look at.
    console.log('Docs propose: ANTHROPIC_API_KEY is not set — skipping the review pass.');
    return;
  }

  const report = JSON.parse(readFileSync(args[reportIndex + 1], 'utf-8')) as DriftReport;
  if (report.stale.length === 0) {
    console.log('Docs propose: nothing flagged, nothing to review.');
    return;
  }

  const queue = report.stale.slice(0, MAX_ARTICLES_PER_RUN);
  if (report.stale.length > queue.length) {
    console.log(
      `::notice::${report.stale.length} articles flagged; reviewing the first ${queue.length}. ` +
        'The rest stay flagged and will be picked up by the next run.',
    );
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const root = docsRoot();
  const changed: { sourceKey: string; note: string }[] = [];
  const unchanged: { sourceKey: string; note: string }[] = [];
  const uncertain: { sourceKey: string; note: string }[] = [];

  for (const entry of queue) {
    const path = join(root, entry.sourceKey);
    const current = readFileSync(path, 'utf-8');

    let proposal: Proposal | null = null;
    try {
      proposal = await reviewArticle(client, entry, current);
    } catch (err) {
      console.warn(`::warning::Review of ${entry.sourceKey} failed: ${String(err)}`);
      continue;
    }

    if (!proposal) {
      console.warn(`::warning::Review of ${entry.sourceKey} returned an unusable response.`);
      continue;
    }

    if (proposal.uncertain) uncertain.push({ sourceKey: entry.sourceKey, note: proposal.uncertain });

    // Trust the diff, not the flag: a model that says "changed" but returns
    // identical bytes has not changed anything, and a PR listing a file with no
    // diff wastes the reviewer's first thirty seconds.
    if (!proposal.changed || proposal.article.trim() === current.trim()) {
      unchanged.push({ sourceKey: entry.sourceKey, note: proposal.note });
      continue;
    }

    writeFileSync(path, proposal.article.endsWith('\n') ? proposal.article : `${proposal.article}\n`);
    changed.push({ sourceKey: entry.sourceKey, note: proposal.note });
  }

  // The workflow reads this to build the PR body, and skips opening one at all
  // when nothing changed.
  const summary = [
    changed.length
      ? `### Updated\n\n${changed.map((c) => `- **${c.sourceKey}** — ${c.note}`).join('\n')}`
      : '',
    uncertain.length
      ? `### Needs a human eye\n\nThe review could not confirm these from the diff:\n\n${uncertain
          .map((c) => `- **${c.sourceKey}** — ${c.note}`)
          .join('\n')}`
      : '',
    unchanged.length
      ? `### Checked, no change needed\n\n${unchanged.map((c) => `- ${c.sourceKey} — ${c.note}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  writeFileSync('/tmp/docs-propose-summary.md', summary || '_Nothing to report._\n');
  console.log(`Docs propose: ${changed.length} article(s) updated, ${unchanged.length} left alone.`);
}

main().catch((err) => {
  console.error('Docs propose failed:', err);
  process.exitCode = 1;
});
