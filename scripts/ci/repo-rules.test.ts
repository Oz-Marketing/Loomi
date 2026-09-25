import { describe, expect, it } from 'vitest';
import {
  checkCopy,
  checkKnowledge,
  checkNextPublic,
  checkSpelling,
  checkUniqueNeedsEnsure,
  namesIn,
  parseAddedLines,
  type AddedLine,
} from './repo-rules';

const added = (file: string, text: string, line = 1): AddedLine => ({ file, line, text });

describe('parseAddedLines', () => {
  it('returns only added lines, with their new line numbers', () => {
    const diff = [
      'diff --git a/src/a.tsx b/src/a.tsx',
      '--- a/src/a.tsx',
      '+++ b/src/a.tsx',
      '@@ -3,0 +4,2 @@ context',
      '+first',
      '+second',
      '@@ -10 +12 @@',
      '-old',
      '+replaced',
      'diff --git a/gone.ts b/gone.ts',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-deleted',
    ].join('\n');
    expect(parseAddedLines(diff)).toEqual([
      { file: 'src/a.tsx', line: 4, text: 'first' },
      { file: 'src/a.tsx', line: 5, text: 'second' },
      { file: 'src/a.tsx', line: 12, text: 'replaced' },
    ]);
  });
});

describe('checkCopy', () => {
  it('flags the retired account words in UI copy', () => {
    const found = checkCopy([
      added('src/app/x/page.tsx', '<p>Pick a sub-account</p>'),
      added('src/app/x/page.tsx', '<p>Every rooftop gets one</p>'),
      added('src/app/x/page.tsx', "toast('Organization saved')"),
      added('src/app/x/page.tsx', '<p>Create a account first</p>'),
    ]);
    expect(found.map((f) => f.rule)).toEqual(Array(4).fill('account-wording'));
  });

  it('leaves identifiers, routes, comments and JSON-LD alone', () => {
    expect(
      checkCopy([
        added('src/app/x/page.tsx', "router.push(`/subaccount/${slug}`)"),
        added('src/app/x/page.tsx', 'const { rooftopId, organizationId } = row;'),
        added('src/app/x/page.tsx', '// the old sub-account wording is gone'),
        added('src/app/marketing/page.tsx', "'@type': 'Organization',"),
        added('src/lib/x.test.ts', "it('names no rooftop or sub-account', () => {});"), // tests aren't UI
        added('src/lib/x.ts', 'type RooftopRow = { id: string };'),
        added('src/app/x/page.tsx', '<p>Pick a sub-account</p> {/* repo-rules-ignore */}'),
      ]),
    ).toEqual([]);
  });
});

describe('checkSpelling', () => {
  it('flags British spellings and names the American one', () => {
    const [f] = checkSpelling([added('src/components/x.tsx', '<p>Pick a colour</p>')]);
    expect(f).toMatchObject({ rule: 'american-spelling', level: 'error' });
    expect(f.message).toContain('color');
  });

  it('catches the common families', () => {
    const text = 'behaviour favourite centre grey cancelled organisation customise analysed catalogue enrolment';
    expect(checkSpelling([added('src/lib/x.ts', `const s = '${text}';`)])).toHaveLength(10);
  });

  it('checks user-facing text, not identifiers, comments or tests', () => {
    // Calibration: whole-line matching flagged all of these, dozens of times a PR.
    expect(
      checkSpelling([
        added('src/components/x.tsx', '    let cancelled = false;'), // React effect cleanup
        added('src/components/x.tsx', '      if (!cancelled) setData(d);'),
        added('src/lib/x.test.ts', "it('honours a custom priority order', () => {"),
        added('src/components/x.tsx', '          primary colour is already carrying so much of this page'), // comment interior
        added('src/components/x.tsx', "const note = 1; // don't let the colour drift, it isn't ours"),
        added('src/components/x.tsx', "if (s === 'canceled' || s === 'cancelled') {"), // a stored status value
        added('src/components/x.tsx', "import { organizationOptions } from '@/lib/organization-options';"),
      ]),
    ).toEqual([]);
    expect(
      checkSpelling([
        added('src/components/x.tsx', "toast.success('Blast cancelled');"),
        added('src/components/x.tsx', '<Badge>Cancelled</Badge>'),
        added('src/components/x.tsx', '<span className="x">Pick a colour</span>'),
        added('src/app/api/x/route.ts', 'return NextResponse.json({ error: `Unrecognised colour ${c}` });'),
      ]),
    ).toHaveLength(4);
  });

  it('allows the American forms and words that only look British', () => {
    expect(
      checkSpelling([
        added('src/lib/x.ts', "'color behavior center gray canceled organize analyze catalog enrollment'"),
        added('src/lib/x.ts', "'promise raise exercise analyses surprise'"),
        added('src/lib/x.ts', '// the old colour field was renamed'),
        added('docs/x.md', 'colour'),
      ]),
    ).toEqual([]);
  });
});

describe('checkNextPublic', () => {
  const both = new Set(['NEXT_PUBLIC_WIRED']);

  it('flags a new variable missing from a deploy build', () => {
    const found = checkNextPublic(
      [added('src/lib/x.ts', 'process.env.NEXT_PUBLIC_NEW_FLAG')],
      new Set(),
      new Set(['NEXT_PUBLIC_NEW_FLAG']),
      new Set(),
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('deploy-staging.yml');
    expect(found[0].message).not.toContain('deploy.yml or');
  });

  it('allows a new variable wired into both builds', () => {
    expect(checkNextPublic([added('src/lib/x.ts', 'process.env.NEXT_PUBLIC_WIRED')], new Set(), both, both)).toEqual([]);
  });

  it('grandfathers variables the base branch already uses', () => {
    expect(
      checkNextPublic([added('src/lib/x.ts', 'process.env.NEXT_PUBLIC_APP_URL')], new Set(['NEXT_PUBLIC_APP_URL']), both, both),
    ).toEqual([]);
  });

  it('reports each variable once', () => {
    const lines = [added('src/a.ts', 'NEXT_PUBLIC_X', 1), added('src/b.ts', 'NEXT_PUBLIC_X', 2)];
    expect(checkNextPublic(lines, new Set(), new Set(), new Set())).toHaveLength(1);
  });

  it('reads names out of a workflow file', () => {
    expect(namesIn('env:\n  NEXT_PUBLIC_ENABLE_PLAYBOOKS: ${{ vars.X }}\n')).toEqual(new Set(['NEXT_PUBLIC_ENABLE_PLAYBOOKS']));
  });
});

describe('checkUniqueNeedsEnsure', () => {
  const schemaLine = added('prisma/schema.prisma', '  sourceKey String? @unique');

  it('warns about a new unique constraint with no ensure script', () => {
    const found = checkUniqueNeedsEnsure([schemaLine], [{ status: 'M', file: 'prisma/schema.prisma' }]);
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe('warning');
  });

  it('is satisfied by an ensure script in the same PR', () => {
    expect(
      checkUniqueNeedsEnsure([schemaLine], [
        { status: 'M', file: 'prisma/schema.prisma' },
        { status: 'A', file: 'scripts/ensure-thing-unique.ts' },
      ]),
    ).toEqual([]);
  });
});

describe('checkKnowledge', () => {
  it('warns when a new page ships without loomi-knowledge.md', () => {
    const found = checkKnowledge([{ status: 'A', file: 'src/app/widgets/page.tsx' }]);
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe('warning');
  });

  it('is quiet for edits to existing pages, or when the file is updated', () => {
    expect(checkKnowledge([{ status: 'M', file: 'src/app/widgets/page.tsx' }])).toEqual([]);
    expect(
      checkKnowledge([
        { status: 'A', file: 'src/app/widgets/page.tsx' },
        { status: 'M', file: 'loomi-knowledge.md' },
      ]),
    ).toEqual([]);
  });
});
