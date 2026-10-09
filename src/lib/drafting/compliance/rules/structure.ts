import type { Block } from '@/lib/email/types';
import { anchors, collapseWhitespace, stripTags, visibleText } from '../html';
import { blockText, findBlock, walkBlocks } from '../surfaces';
import type { CopyOption, DraftRule, Finding, SendTarget } from '../types';

/**
 * Rules about the shape of every draft, whatever the brand.
 */

/**
 * The unsubscribe link each sender understands. GoHighLevel's token means
 * nothing to Loomi's sender and Loomi's means nothing to GoHighLevel's — the
 * wrong one sends an email whose unsubscribe link goes nowhere.
 */
export const UNSUBSCRIBE_TOKENS: Record<SendTarget, string> = {
  ghl: '{{email.unsubscribe_link}}',
  loomi: '{{unsubscribe_link}}',
};

const SENDER_NAME: Record<SendTarget, string> = { ghl: 'GoHighLevel', loomi: 'Loomi' };

/** Every href a block subtree links to: buttons, linked images, links inside rich text. */
function linksUnder(root: Block): string[] {
  const out: string[] = [];
  walkBlocks([root], (block) => {
    for (const key of ['url', 'linkUrl']) {
      const v = block.props[key];
      if (typeof v === 'string' && v.trim()) out.push(v.trim());
    }
    const text = block.props.text;
    if (typeof text === 'string') {
      for (const m of text.matchAll(/\bhref\s*=\s*["']([^"']*)["']/gi)) out.push(m[1].trim());
    }
  });
  return out;
}

export const unsubscribeRule: DraftRule = {
  id: 'footer.unsubscribe',
  scope: {},
  summary: "The footer links to the sender's unsubscribe token.",
  check(a) {
    const token = UNSUBSCRIBE_TOKENS[a.sendTarget];
    const footer = findBlock(a.template, a.footerBlockId);
    if (!footer) {
      return [{ severity: 'error', message: `The footer block "${a.footerBlockId}" isn't in the email.`, where: 'footer' }];
    }
    const findings: Finding[] = [];
    if (!linksUnder(footer).includes(token)) {
      findings.push({
        severity: 'error',
        message: `The footer has no unsubscribe link. It must link to ${token} for a ${SENDER_NAME[a.sendTarget]} send.`,
        where: 'footer',
      });
    } else if (!anchors(a.html).some((l) => l.href === token)) {
      findings.push({
        severity: 'error',
        message: 'The unsubscribe link is in the template but missing from the rendered email.',
        where: 'footer',
      });
    }
    for (const [target, other] of Object.entries(UNSUBSCRIBE_TOKENS) as [SendTarget, string][]) {
      if (target === a.sendTarget) continue;
      if (anchors(a.html).some((l) => l.href === other)) {
        findings.push({
          severity: 'error',
          message: `A link uses ${other}, which only works when ${SENDER_NAME[target]} sends. This draft goes out through ${SENDER_NAME[a.sendTarget]}.`,
          excerpt: other,
        });
      }
    }
    return findings;
  },
};

function optionFindings(label: 'subject' | 'preview', options: CopyOption[]): Finding[] {
  const findings: Finding[] = [];
  const filled = options.filter((o) => o.text.trim());
  if (!filled.some((o) => o.kind === 'initial')) {
    findings.push({ severity: 'error', message: `There's no initial ${label} line.` });
  }
  if (!filled.some((o) => o.kind === 'urgent')) {
    findings.push({
      severity: 'error',
      message: `There's no urgent ${label} variation for the follow-up send.`,
    });
  }
  options.forEach((o, i) => {
    if (!o.text.trim()) {
      findings.push({ severity: 'error', message: `${label} ${i + 1} is empty.`, where: `${label} ${i + 1} (${o.kind})` });
    }
  });
  const seen = new Map<string, number>();
  options.forEach((o, i) => {
    const key = collapseWhitespace(o.text).toLowerCase();
    if (!key) return;
    const first = seen.get(key);
    if (first !== undefined) {
      findings.push({
        severity: 'error',
        message: `${label}s ${first + 1} and ${i + 1} are the same line — each option has to be a real alternative.`,
        where: `${label} ${i + 1} (${o.kind})`,
        excerpt: o.text,
      });
    } else {
      seen.set(key, i);
    }
  });
  return findings;
}

export const copyOptionsRule: DraftRule = {
  id: 'copy.subject-and-preview-options',
  scope: {},
  summary: 'Every draft carries initial and urgent subject lines, and initial and urgent preview text.',
  check(a) {
    return [...optionFindings('subject', a.subjects), ...optionFindings('preview', a.previews)];
  },
};

/** Where two strings first differ, as a window of the expected text. */
function firstDifference(expected: string, actual: string): string {
  let i = 0;
  while (i < expected.length && expected[i] === actual[i]) i++;
  const start = Math.max(0, i - 30);
  return `expected "…${expected.slice(start, i + 30)}…", found "…${actual.slice(start, i + 30)}…"`;
}

export const disclaimerVerbatimRule: DraftRule = {
  id: 'disclaimer.verbatim',
  scope: {},
  summary: 'The disclaimer is the creative\'s, word for word — never regenerated, reworded or summarized.',
  check(a) {
    if (!a.disclaimer) return [];
    const expected = collapseWhitespace(a.disclaimer.text);
    if (!expected) {
      return [{ severity: 'error', message: 'The disclaimer carried from the creative is empty.', where: 'disclaimer' }];
    }
    const block = findBlock(a.template, a.disclaimer.blockId);
    if (!block) {
      return [{ severity: 'error', message: `The disclaimer block "${a.disclaimer.blockId}" isn't in the email.`, where: 'disclaimer' }];
    }
    const raw = typeof block.props.text === 'string' ? block.props.text : '';
    const placed = block.props.allowHtml ? stripTags(raw) : collapseWhitespace(raw);
    const findings: Finding[] = [];
    if (placed !== expected) {
      findings.push({
        severity: 'error',
        message: "The disclaimer in the email isn't the creative's word for word.",
        where: `block:${block.id}`,
        excerpt: firstDifference(expected, placed),
      });
    } else if (!visibleText(a.html).includes(expected)) {
      findings.push({
        severity: 'error',
        message: "The disclaimer is in the template but doesn't render in the email.",
        where: `block:${block.id}`,
      });
    }
    return findings;
  },
};

function buttonsUnder(root: Block): Block[] {
  const out: Block[] = [];
  walkBlocks([root], (block) => {
    if (block.type === 'button') out.push(block);
  });
  return out;
}

/** Two or more buttons in a row in one container — they stack on desktop. */
function stackedRuns(blocks: Block[]): Block[][] {
  const runs: Block[][] = [];
  let run: Block[] = [];
  for (const block of blocks) {
    if (block.type === 'button') {
      run.push(block);
      continue;
    }
    if (run.length > 1) runs.push(run);
    run = [];
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

export const multiCtaRule: DraftRule = {
  id: 'layout.multi-cta',
  scope: {},
  summary: 'Several CTAs sit side by side on desktop and stack full width on mobile.',
  check(a) {
    const findings: Finding[] = [];
    const stacked = (blocks: Block[]) => {
      for (const run of stackedRuns(blocks)) {
        findings.push({
          severity: 'error',
          message: `${run.length} buttons sit one above another on desktop. Put them side by side in a Columns block.`,
          where: `block:${run[0].id}`,
          excerpt: run.map(blockText).join(' / '),
        });
      }
    };

    stacked(a.template.blocks);
    walkBlocks(a.template.blocks, (block) => {
      if (block.type !== 'columns') {
        // A column's children ARE side by side, so only non-columns containers can stack.
        if (block.children?.length) stacked(block.children);
        return;
      }
      const count = typeof block.props.columnCount === 'number' ? block.props.columnCount : 2;
      const ctaColumns = (block.children ?? []).slice(0, count).map(buttonsUnder).filter((b) => b.length > 0);
      if (ctaColumns.length < 2) return;
      if (block.props.stackOnMobile === false) {
        findings.push({
          severity: 'error',
          message: 'These CTAs stay side by side on mobile. Turn Stack on Mobile back on.',
          where: `block:${block.id}`,
        });
      }
      for (const button of ctaColumns.flat()) {
        if (button.props.fullWidth !== true) {
          findings.push({
            severity: 'error',
            message: `"${blockText(button)}" won't fill the screen once the CTAs stack on mobile. Set it to full width.`,
            where: `block:${button.id}`,
          });
        }
      }
    });
    return findings;
  },
};
