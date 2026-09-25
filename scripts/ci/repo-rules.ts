/**
 * Checks a PR's ADDED lines against rules CLAUDE.md states but no compiler
 * enforces. Runs in .github/workflows/pr-checks.yml, and locally:
 *
 *   node --experimental-strip-types scripts/ci/repo-rules.ts [base-ref]
 *
 * base-ref defaults to origin/main. Only added lines are checked, so existing
 * code is grandfathered and a PR is judged on what it adds.
 *
 * Errors fail the check; warnings only annotate the PR. A line containing
 * `repo-rules-ignore` is skipped, for the rare case a rule is wrong there.
 *
 * Plain TypeScript with node builtins only, so Node runs it directly with no
 * install and the job takes seconds.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export interface AddedLine {
  file: string;
  line: number;
  text: string;
}

export interface Finding {
  level: 'error' | 'warning';
  rule: string;
  message: string;
  file?: string;
  line?: number;
}

export interface ChangedFile {
  status: string; // git's A / M / D / R…
  file: string;
}

const IGNORE = 'repo-rules-ignore';

// ── Diff parsing ────────────────────────────────────────────────────────────

/** Added lines from a `git diff --unified=0` patch, with their new line numbers. */
export function parseAddedLines(diff: string): AddedLine[] {
  const out: AddedLine[] = [];
  let file: string | null = null;
  let line = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw === '+++ /dev/null' ? null : raw.slice(4).replace(/^b\//, '');
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (!file) continue;
    if (raw.startsWith('+')) {
      out.push({ file, line, text: raw.slice(1) });
      line += 1;
    } else if (!raw.startsWith('-') && !raw.startsWith('\\')) {
      line += 1;
    }
  }
  return out;
}

const isComment = (text: string) => /^\s*(\/\/|\/\*|\*|\{\s*\/\*)/.test(text);

/** App source a user can see the output of: src/**\/*.ts(x), minus tests. */
const isAppSource = (file: string) => /^src\/.*\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file);

/**
 * The parts of a line a USER reads: string literals and JSX text. Everything
 * else — identifiers, comments — is for developers. Calibrated against the last
 * 40 merged PRs: checking whole lines flagged `let cancelled = false` (React's
 * effect-cleanup idiom), test names and comment prose, dozens of times per PR.
 *
 * A single-quoted string must not follow a letter, so the apostrophes in
 * "don't … isn't" aren't read as one.
 */
export function userFacingText(text: string): string[] {
  if (text.includes(IGNORE) || isComment(text)) return [];
  const code = text.replace(/\/\/.*$/, '').replace(/\{?\/\*.*?\*\/\}?/g, '');
  const out: string[] = [];
  for (const m of code.matchAll(/(?<![\w])'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`([^`\n]*)`/g)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  // JSX text: between a tag's `>` and the next `<` or `{`.
  for (const m of code.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)(?=<|\{|$)/g)) out.push(m[1]);
  // Prose has a space or starts with a capital ("Cancelled" on a badge). A
  // lone lowercase token is code: a stored status (`s === 'cancelled'` —
  // renaming it would orphan existing rows), a key, an import path.
  return out.filter((t) => /[A-Za-z]/.test(t) && (/\s/.test(t.trim()) || /^[A-Z]/.test(t.trim())));
}

// ── Rule 1: account wording in UI copy ──────────────────────────────────────

/**
 * CLAUDE.md, "UI conventions": say "account" (and "group"), never
 * "sub-account", "rooftop" or "organization" in user-facing prose — and watch
 * the article trap, "a account". Identifiers (`subaccount`, `rooftopId`,
 * `organizationId`) don't match: the patterns need a word boundary after the
 * word or a hyphen/space inside it.
 */
const COPY_RULES: ReadonlyArray<{ pattern: RegExp; message: string }> = [
  { pattern: /\bsub[- ]accounts?\b/i, message: 'Say "account", not "sub-account".' },
  { pattern: /\brooftops?\b/i, message: 'Say "account", not "rooftop".' },
  { pattern: /\borgani[sz]ations?\b/i, message: 'Say "account" or "group", not "organization".' },
  { pattern: /\ba account/i, message: 'Article trap: "a account" should be "an account".' },
];

export function checkCopy(lines: AddedLine[]): Finding[] {
  const found: Finding[] = [];
  for (const l of lines) {
    if (!isAppSource(l.file)) continue;
    // schema.org JSON-LD, not copy (app/marketing/page.tsx).
    if (l.text.includes('@type')) continue;
    const text = userFacingText(l.text).join(' ');
    for (const r of COPY_RULES) {
      if (r.pattern.test(text)) found.push({ level: 'error', rule: 'account-wording', message: r.message, file: l.file, line: l.line });
    }
  }
  return found;
}

// ── Rule 2: American spelling ───────────────────────────────────────────────

/**
 * CLAUDE.md: American English only; existing British spellings are
 * grandfathered, new ones aren't. A curated list rather than an `-ise` rule,
 * which would flag "promise", "raise" and "exercise".
 */
const BRITISH: ReadonlyArray<[RegExp, string]> = [
  [/\bcolour(s|ed|ing|ful)?\b/i, 'color'],
  [/\bbehaviour(s|al)?\b/i, 'behavior'],
  [/\bfavourite(s|d)?\b/i, 'favorite'],
  [/\bhonour(s|ed|ing)?\b/i, 'honor'],
  [/\bcentre(s|d)?\b/i, 'center'],
  [/\bgrey(s|ed|ing)?\b/i, 'gray'],
  [/\bcancell(ed|ing|er)\b/i, 'canceled / canceling'],
  [/\borganis(e|es|ed|ing|ation|ations)\b/i, 'organize / organization'],
  [/\brecognis(e|es|ed|ing)\b/i, 'recognize'],
  [/\bcustomis(e|es|ed|ing|ation)\b/i, 'customize'],
  [/\boptimis(e|es|ed|ing|ation)\b/i, 'optimize'],
  [/\bprioritis(e|es|ed|ing)\b/i, 'prioritize'],
  [/\binitialis(e|es|ed|ing|ation)\b/i, 'initialize'],
  [/\brealis(e|es|ed|ing)\b/i, 'realize'],
  [/\banalys(e|ed|ing)\b/i, 'analyze'],
  [/\bcatalogue(s|d)?\b/i, 'catalog'],
  [/\blicence(s|d)?\b/i, 'license'],
  [/\bdefence\b/i, 'defense'],
  [/\b(travell|modell|labell)(ed|ing)\b/i, 'one "l" (traveled, modeling, labeled)'],
  [/\benrol(s|ment|ments)?\b/i, 'enroll / enrollment'],
];

export function checkSpelling(lines: AddedLine[]): Finding[] {
  const found: Finding[] = [];
  for (const l of lines) {
    if (!isAppSource(l.file)) continue;
    const text = userFacingText(l.text).join(' ');
    for (const [pattern, american] of BRITISH) {
      const m = pattern.exec(text);
      if (m) {
        found.push({ level: 'error', rule: 'american-spelling', message: `"${m[0]}" is British. Use ${american}.`, file: l.file, line: l.line });
      }
    }
  }
  return found;
}

// ── Rule 3: NEXT_PUBLIC_* must reach the build ──────────────────────────────

const NEXT_PUBLIC = /\bNEXT_PUBLIC_[A-Z0-9_]+\b/g;

/**
 * CLAUDE.md, "Database and deploy-time scripts": `NEXT_PUBLIC_*` is inlined by
 * `next build`, which runs on the GitHub runner. A flag set only on the droplet
 * has no effect and no visible error — the feature just stays off. So a
 * variable this PR introduces must be in the build `env:` of BOTH deploy
 * workflows. Variables the base branch already uses are grandfathered.
 */
export function checkNextPublic(
  lines: AddedLine[],
  alreadyUsed: ReadonlySet<string>,
  inProdBuild: ReadonlySet<string>,
  inStagingBuild: ReadonlySet<string>,
): Finding[] {
  const found: Finding[] = [];
  const reported = new Set<string>();
  for (const l of lines) {
    if (!l.file.startsWith('src/') || l.text.includes(IGNORE)) continue;
    for (const name of l.text.match(NEXT_PUBLIC) ?? []) {
      if (alreadyUsed.has(name) || reported.has(name)) continue;
      const missing = [!inProdBuild.has(name) && 'deploy.yml', !inStagingBuild.has(name) && 'deploy-staging.yml'].filter(Boolean);
      if (missing.length === 0) continue;
      reported.add(name);
      found.push({
        level: 'error',
        rule: 'next-public-build-env',
        message: `${name} is new, but it isn't in the build env: of ${missing.join(' or ')}. NEXT_PUBLIC_* is inlined at build time on the runner; set only on the droplet, it silently does nothing.`,
        file: l.file,
        line: l.line,
      });
    }
  }
  return found;
}

// ── Rule 4: a new unique constraint needs an ensure script ──────────────────

/**
 * CLAUDE.md: `db push` refuses to add a unique constraint to an existing table,
 * and the deploy has no `--accept-data-loss`. The pattern is an idempotent
 * `scripts/ensure-*.ts` wired into `deploy:prepare`. A warning, not an error:
 * a unique on a brand-new model is fine without one.
 */
export function checkUniqueNeedsEnsure(lines: AddedLine[], changed: ChangedFile[]): Finding[] {
  const touchesEnsure = changed.some((c) => /^scripts\/ensure-.*\.ts$/.test(c.file));
  if (touchesEnsure) return [];
  return lines
    .filter((l) => l.file === 'prisma/schema.prisma' && /@@?unique\b/.test(l.text) && !l.text.includes(IGNORE))
    .map((l) => ({
      level: 'warning' as const,
      rule: 'unique-needs-ensure',
      message:
        'New unique constraint with no scripts/ensure-*.ts in this PR. If it is on an EXISTING table, db push will refuse it on deploy; add an ensure script to deploy:prepare (see scripts/ensure-adcreative-offer-unique.ts).',
      file: l.file,
      line: l.line,
    }));
}

// ── Rule 5: loomi-knowledge.md ──────────────────────────────────────────────

/**
 * CLAUDE.md: a change that adds a feature, surface, integration or data model
 * updates loomi-knowledge.md in the same change. A warning, since only a
 * person can judge whether the change was "meaningful".
 */
export function checkKnowledge(changed: ChangedFile[]): Finding[] {
  if (changed.some((c) => c.file === 'loomi-knowledge.md')) return [];
  const triggers = changed.filter(
    (c) =>
      (c.status.startsWith('A') && /^src\/app\/.*\/(page\.tsx|route\.ts)$/.test(c.file)) ||
      c.file === 'prisma/schema.prisma',
  );
  if (triggers.length === 0) return [];
  return [
    {
      level: 'warning',
      rule: 'loomi-knowledge',
      message: `This PR adds pages or routes, or changes the data model (${triggers
        .slice(0, 3)
        .map((t) => t.file)
        .join(', ')}${triggers.length > 3 ? ', …' : ''}), but doesn't touch loomi-knowledge.md. Update it if a feature, surface or model changed.`,
    },
  ];
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** NEXT_PUBLIC_* names in a workflow file's text. */
export function namesIn(text: string): Set<string> {
  return new Set(text.match(NEXT_PUBLIC) ?? []);
}

function annotate(f: Finding): string {
  const where = f.file ? ` file=${f.file}${f.line ? `,line=${f.line}` : ''}` : '';
  return `::${f.level}${where},title=${f.rule}::${f.message}`;
}

function main() {
  const base = process.argv[2] ?? 'origin/main';
  const range = `${base}...HEAD`;
  const lines = parseAddedLines(git('diff', '--unified=0', '--no-color', range));
  const changed: ChangedFile[] = git('diff', '--name-status', range)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((row) => {
      const parts = row.split('\t');
      return { status: parts[0], file: parts[parts.length - 1] };
    });

  const mergeBase = git('merge-base', base, 'HEAD').trim();
  let usedAtBase = '';
  try {
    usedAtBase = git('grep', '-ohE', 'NEXT_PUBLIC_[A-Z0-9_]+', mergeBase, '--', 'src');
  } catch {
    // git grep exits 1 when nothing matches.
  }
  const findings = [
    ...checkCopy(lines),
    ...checkSpelling(lines),
    ...checkNextPublic(
      lines,
      namesIn(usedAtBase),
      namesIn(readFileSync('.github/workflows/deploy.yml', 'utf8')),
      namesIn(readFileSync('.github/workflows/deploy-staging.yml', 'utf8')),
    ),
    ...checkUniqueNeedsEnsure(lines, changed),
    ...checkKnowledge(changed),
  ];

  for (const f of findings) console.log(annotate(f));
  const errors = findings.filter((f) => f.level === 'error').length;
  const warnings = findings.length - errors;
  console.log(`\nRepo rules: ${lines.length} added lines checked, ${errors} error(s), ${warnings} warning(s).`);
  if (errors > 0) {
    console.log(`Fix them, or add "${IGNORE}" to a line where a rule is genuinely wrong.`);
    process.exit(1);
  }
}

// Run only as a script, not when a test imports this file.
if (process.argv[1]?.endsWith('repo-rules.ts')) main();
