/**
 * Draft co-op rules from a guideline document, and report what survived screening.
 *
 * Phase 1 of docs/ad-generator-ai-compliance.md. Deliberately a SCRIPT and not a
 * feature: no UI, no schema change, and it writes nothing. The risky part of the
 * whole plan is whether a grounded drafting pass produces rules worth reviewing,
 * so that question gets answered on its own, against documents whose correct
 * answer is already known.
 *
 * THE TEST THAT MATTERS: run it against the Mazda, Chevrolet or Subaru document.
 * Those three have hand-transcribed packs (16, 8 and 22 rules), so they are a real
 * answer key. If a pass doesn't recover most of them with matching citations, the
 * prompt isn't ready — and we learn that here rather than in production.
 *
 * Run against a registered document (needs a DB and an API key):
 *   npx tsx --env-file=.env.local scripts/draft-coop-rules.ts --doc <guidelineDocId>
 *
 * Run against a local PDF (no DB; needs `pdftotext` from poppler):
 *   npx tsx --env-file=.env.local scripts/draft-coop-rules.ts \
 *     --pdf ~/"Oz Marketing/Projects/Loomi/co-op-guidelines/MCAP_Interactive_Guidelines_Aug_2025.pdf" \
 *     --make Mazda
 *
 * Inspect the prompt without spending anything:
 *   ... --pdf <file> --make Mazda --dry
 *
 * Flags: --out <file.json> writes the full result. --quiet drops the per-rule list.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { screenRuleProposals, summarizeDrops } from '../src/lib/ad-generator/coop-draft';
import { draftCoopRules, draftRequiredFields } from '../src/lib/ai/coop-rule-draft';
import { renderPagesForPrompt } from '../src/lib/ad-generator/guideline-quotes';
import { anthropicConfigured } from '../src/lib/anthropic';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const has = (name: string) => process.argv.includes(`--${name}`);

/** Page text from a local PDF, for testing without a populated database. */
function pagesFromPdf(path: string): string[] {
  if (!fs.existsSync(path)) throw new Error(`No such file: ${path}`);
  let raw: string;
  try {
    raw = execFileSync('pdftotext', ['-q', path, '-'], {
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
    });
  } catch {
    throw new Error(
      'pdftotext is not available. Install poppler (brew install poppler), or use --doc against a registered document.',
    );
  }
  // pdftotext separates pages with a form feed, which is what makes page
  // citations checkable. A trailing feed yields one empty page; drop it.
  const pages = raw.split('\f');
  if (pages.length && pages[pages.length - 1].trim() === '') pages.pop();
  return pages;
}

/** Page text from a registered `AdGuidelineDoc`. */
async function pagesFromDoc(id: string): Promise<{ pages: string[]; make: string; title: string }> {
  const { prisma } = await import('../src/lib/prisma');
  const row = await prisma.adGuidelineDoc.findUnique({
    where: { id },
    select: { make: true, title: true, pageText: true },
  });
  if (!row) throw new Error(`No guideline document with id ${id}`);
  if (!row.pageText) {
    // The reason this is fatal rather than a warning: with no stored text there is
    // nothing to verify a quote against, so every proposal would be discarded and
    // the run would look like "the document has no rules".
    throw new Error(
      `"${row.title}" has no extracted text (pageText is empty) — it cannot be drafted from. Non-PDF uploads land here; convert it to PDF and re-register.`,
    );
  }
  const pages = JSON.parse(row.pageText) as string[];
  return { pages, make: row.make, title: row.title };
}

async function main() {
  const docId = arg('doc');
  const pdf = arg('pdf');
  if (!docId && !pdf) throw new Error('Pass --doc <guidelineDocId> or --pdf <path>.');

  let pages: string[];
  let make: string;
  let title: string;

  if (docId) {
    const loaded = await pagesFromDoc(docId);
    pages = loaded.pages;
    make = arg('make') ?? loaded.make;
    title = arg('title') ?? loaded.title;
  } else {
    pages = pagesFromPdf(pdf!);
    make = arg('make') ?? '';
    title = arg('title') ?? pdf!.split('/').pop() ?? 'Untitled';
    if (!make) throw new Error('--pdf needs --make <manufacturer>.');
  }

  const words = pages.join(' ').split(/\s+/).filter(Boolean).length;
  console.log(`${title}`);
  console.log(`${make} · ${pages.length} pages · ${words.toLocaleString()} words`);

  if (has('dry')) {
    const prompt = renderPagesForPrompt(pages);
    console.log(`\nPrompt document block: ${prompt.length.toLocaleString()} chars`);
    console.log(`Rough input estimate: ~${Math.round(prompt.length / 4).toLocaleString()} tokens`);
    console.log('\n--- first 600 chars of the document block ---');
    console.log(prompt.slice(0, 600));
    return;
  }

  if (!anthropicConfigured()) throw new Error('ANTHROPIC_API_KEY is not set.');

  console.log('\nDrafting…');
  const started = Date.now();
  const draft = await draftCoopRules({ make, title, pages });
  const seconds = Math.round((Date.now() - started) / 1000);

  // Second pass, over the same document, asking only "which values must a person
  // state". Asked together with the rules it made them worse — 76 proposals with 1
  // unverifiable quote became 48 with 11 — so the two questions stay separate.
  const fields = await draftRequiredFields({ make, title, pages });

  const screened = screenRuleProposals(
    draft.proposals,
    pages,
    { source: title, make },
    draft.unexpressible,
    fields.requiredFields,
  );

  // Both passes, so the cache read on the second one is visible — that number is the
  // whole reason splitting them is cheap.
  const u = {
    inputTokens: draft.usage.inputTokens + fields.usage.inputTokens,
    outputTokens: draft.usage.outputTokens + fields.usage.outputTokens,
    cacheCreationTokens: draft.usage.cacheCreationTokens + fields.usage.cacheCreationTokens,
    cacheReadTokens: draft.usage.cacheReadTokens + fields.usage.cacheReadTokens,
  };
  console.log(
    `\nDone in ${seconds}s · in ${u.inputTokens.toLocaleString()} (cache write ${u.cacheCreationTokens.toLocaleString()}, read ${u.cacheReadTokens.toLocaleString()}) · out ${u.outputTokens.toLocaleString()}`,
  );
  console.log(
    `\nProposed ${draft.proposals.length} · accepted ${screened.accepted.length} · dropped ${screened.dropped.length}`,
  );
  console.log(
    `Required fields: ${screened.requiredFields.length} kept, ${screened.droppedRequiredFields.length} dropped`,
  );
  console.log(
    `Unexpressible: ${screened.notes.length} kept, ${screened.droppedNotes.length} dropped`,
  );

  const tally = summarizeDrops(screened.dropped);
  if (Object.keys(tally).length) {
    console.log('\nWhy proposals were dropped:');
    for (const [reason, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${reason}`);
    }
  }

  if (!has('quiet')) {
    console.log('\n── Accepted ──');
    for (const a of screened.accepted) {
      const flag = a.source.pageCorrected ? ` [page corrected from ${a.source.statedPage}]` : '';
      console.log(`\n• ${a.rule.id}  (${a.rule.kind}, ${a.rule.severity})${flag}`);
      console.log(`  ${a.rule.description}`);
      console.log(`  ${a.rule.citation}`);
      console.log(`  quote: "${a.source.quote.slice(0, 160)}${a.source.quote.length > 160 ? '…' : ''}"`);
    }

    if (screened.notes.length) {
      console.log('\n── Stated but not expressible ──');
      for (const n of screened.notes) {
        console.log(`\n• ${n.requirement}`);
        console.log(`  why: ${n.why}`);
        console.log(`  p.${n.at.page}${n.section ? ` §${n.section}` : ''}`);
      }
    }

    if (screened.dropped.length) {
      console.log('\n── Dropped (never reaches a reviewer) ──');
      for (const d of screened.dropped) {
        console.log(`\n• [${d.reason}] ${d.proposal.rule?.description ?? '(no description)'}`);
        console.log(`  ${d.detail}`);
      }
    }
  }

  const out = arg('out');
  if (out) {
    fs.writeFileSync(out, JSON.stringify({ make, title, usage: u, ...screened }, null, 2));
    console.log(`\nWrote ${out}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
