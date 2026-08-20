/**
 * Find doc articles the code has moved on from.
 *
 * Every article declares the source it documents:
 *
 *   covers:
 *     - src/app/contacts/**
 *     - src/lib/segments/**
 *
 * This asks git a narrow, checkable question — "have any commits touched those
 * paths since the article was last confirmed?" — and answers it per article. No
 * model is involved at this stage on purpose: staleness is a fact about the
 * commit graph, and a fact is worth more than an opinion when it decides whether
 * a human gets interrupted.
 *
 * Two outputs, both optional, so this is useful in CI and by hand:
 *
 *   --out <file>   write the JSON report (what the AI review step reads)
 *   --post         flag the stale articles in Loomi, so staff see the badge
 *
 * Run: npx tsx scripts/docs-drift.ts --out /tmp/docs-drift.json --post
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { loadDocFiles, type DocFile } from '../src/lib/docs/source';

export interface DriftCommit {
  sha: string;
  subject: string;
  author: string;
  files: string[];
}

export interface DriftEntry {
  sourceKey: string;
  slug: string;
  title: string;
  sector: string;
  covers: string[];
  reviewedSha: string | null;
  commits: DriftCommit[];
}

export interface DriftReport {
  headSha: string;
  generatedAt: string;
  /** Articles with at least one commit against their `covers` since review. */
  stale: DriftEntry[];
  /** Articles that declare no `covers` — invisible to this check, by omission. */
  uncovered: { sourceKey: string; title: string }[];
}

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 }).trim();
}

/**
 * ASCII record/unit separators, matching the `%x1e` / `%x1f` in the log format.
 * Commit subjects contain every printable delimiter anyone might reach for —
 * pipes, tabs, and colons all appear in this repo's history — so the framing has
 * to use characters that cannot occur in the payload.
 */
const RECORD_SEP = '\u001e';
const FIELD_SEP = '\u001f';

/**
 * Git pathspecs, with `:(glob)` magic so `**` means what the author meant.
 * Without it git's default matching treats the pattern loosely and `src/lib/*`
 * would sweep in far more than the article claims to cover.
 */
function pathspecs(covers: string[]): string[] {
  return covers.map((c) => `:(glob)${c}`);
}

/** Commits touching `covers` in `since..HEAD`, newest first. */
function commitsSince(since: string, covers: string[]): DriftCommit[] {
  const range = `${since}..HEAD`;
  const raw = git([
    'log',
    range,
    '--no-merges',
    '--name-only',
    '--format=%x1e%H%x1f%s%x1f%an',
    '--',
    ...pathspecs(covers),
  ]);
  if (!raw) return [];

  return raw
    .split(RECORD_SEP)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [header, ...fileLines] = chunk.split('\n');
      const [sha, subject, author] = header.split(FIELD_SEP);
      return {
        sha,
        subject: subject ?? '',
        author: author ?? '',
        files: fileLines.map((l) => l.trim()).filter(Boolean),
      };
    });
}

/**
 * Where to start looking. The article's `reviewedSha` if we have one and git
 * still knows it; otherwise null, which we treat as "not stale" rather than
 * "everything is stale".
 *
 * That default matters. A rewritten history or a shallow clone would otherwise
 * flag all forty-odd articles at once, and a review queue that says "everything"
 * is one nobody works through.
 */
function resolveSince(sha: string | null | undefined): string | null {
  if (!sha) return null;
  try {
    git(['cat-file', '-e', `${sha}^{commit}`]);
    return sha;
  } catch {
    return null;
  }
}

interface ReviewState {
  sourceKey: string;
  reviewedSha: string | null;
}

/**
 * The review stamps live in the database, not in the files — an article is
 * confirmed against a deployed environment, and staging and production can
 * legitimately be at different commits. In CI we ask the app for them; run
 * locally without an endpoint, every article falls back to its file history.
 */
async function fetchReviewState(): Promise<Map<string, string | null>> {
  const endpoint = process.env.DOCS_DRIFT_ENDPOINT;
  const secret = process.env.INTERNAL_JOB_SECRET;
  if (!endpoint || !secret) return new Map();

  try {
    const res = await fetch(endpoint, { headers: { 'x-internal-job-secret': secret } });
    if (!res.ok) {
      console.warn(`::warning::Could not read doc review state (HTTP ${res.status})`);
      return new Map();
    }
    const data = (await res.json()) as { articles?: ReviewState[] };
    return new Map((data.articles ?? []).map((a) => [a.sourceKey, a.reviewedSha]));
  } catch (err) {
    console.warn(`::warning::Could not read doc review state: ${String(err)}`);
    return new Map();
  }
}

/** Fall back to "when did this article's own file last change?" */
function lastCommitForFile(sourceKey: string): string | null {
  try {
    const sha = git(['log', '-1', '--format=%H', '--', `content/docs/${sourceKey}`]);
    return sha || null;
  } catch {
    return null;
  }
}

function buildEntry(file: DocFile, since: string | null): DriftEntry | null {
  if (file.covers.length === 0 || !since) return null;
  const commits = commitsSince(since, file.covers);
  if (commits.length === 0) return null;
  return {
    sourceKey: file.sourceKey,
    slug: file.slug,
    title: file.title,
    sector: file.sector,
    covers: file.covers,
    reviewedSha: since,
    commits,
  };
}

async function postFlags(report: DriftReport): Promise<void> {
  const endpoint = process.env.DOCS_DRIFT_ENDPOINT;
  const secret = process.env.INTERNAL_JOB_SECRET;
  if (!endpoint || !secret) {
    console.log('Docs drift: no DOCS_DRIFT_ENDPOINT / INTERNAL_JOB_SECRET — not flagging.');
    return;
  }

  const body = {
    headSha: report.headSha,
    // One line per article, written for whoever opens /docs — the commit
    // subjects are the most useful thing we can say without a model.
    flags: report.stale.map((entry) => ({
      sourceKey: entry.sourceKey,
      note:
        `${entry.commits.length} change${entry.commits.length === 1 ? '' : 's'} ` +
        `since this was last checked: ` +
        entry.commits.slice(0, 3).map((c) => c.subject).join('; ') +
        (entry.commits.length > 3 ? `; and ${entry.commits.length - 3} more` : ''),
    })),
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-job-secret': secret },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.warn(`::warning::Flagging stale docs failed with HTTP ${res.status}`);
    return;
  }
  console.log(`Docs drift: flagged ${body.flags.length} article(s) in Loomi.`);
}

async function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const outFile = outIndex === -1 ? null : args[outIndex + 1];
  const shouldPost = args.includes('--post');

  const { files, errors } = loadDocFiles();
  for (const { sourceKey, error } of errors) {
    console.warn(`::warning::Docs drift skipped ${sourceKey}: ${error}`);
  }

  const reviewed = await fetchReviewState();
  const headSha = git(['rev-parse', 'HEAD']);

  const stale: DriftEntry[] = [];
  const uncovered: { sourceKey: string; title: string }[] = [];

  for (const file of files) {
    if (file.covers.length === 0) {
      uncovered.push({ sourceKey: file.sourceKey, title: file.title });
      continue;
    }
    const since = resolveSince(reviewed.get(file.sourceKey) ?? lastCommitForFile(file.sourceKey));
    const entry = buildEntry(file, since);
    if (entry) stale.push(entry);
  }

  const report: DriftReport = {
    headSha,
    generatedAt: new Date().toISOString(),
    stale,
    uncovered,
  };

  if (outFile) {
    writeFileSync(outFile, JSON.stringify(report, null, 2));
    console.log(`Docs drift: report written to ${outFile}`);
  }

  console.log(
    `Docs drift: ${stale.length} of ${files.length} article(s) have code changes since review` +
      (uncovered.length ? `; ${uncovered.length} declare no \`covers\` and were not checked.` : '.'),
  );
  for (const entry of stale) {
    console.log(`  - ${entry.slug}: ${entry.commits.length} commit(s)`);
  }

  if (shouldPost) await postFlags(report);
}

main().catch((err) => {
  console.error('Docs drift failed:', err);
  process.exitCode = 1;
});
