import type { Block, EmailTemplate } from '@/lib/email/types';
import { stripTags } from './html';
import type { DraftArtifact } from './types';

/**
 * Walking the v2 template, and turning it into the labelled pieces of text a
 * rule judges.
 *
 * Copy rules read the TEMPLATE rather than the rendered HTML: blocks carry ids,
 * so a finding can point at the exact block, and the two code-assembled parts —
 * the footer and the verbatim disclaimer — can be told apart from the copy the
 * model wrote. The HTML is still checked, by the rules that judge what renders
 * (links, colors, fonts).
 *
 * Pure.
 */

export function walkBlocks(
  blocks: Block[],
  visit: (block: Block, parents: Block[]) => void,
  parents: Block[] = [],
): void {
  for (const block of blocks) {
    visit(block, parents);
    if (block.children?.length) walkBlocks(block.children, visit, [...parents, block]);
  }
}

export function findBlock(template: EmailTemplate, id: string): Block | null {
  let found: Block | null = null;
  walkBlocks(template.blocks, (block) => {
    if (!found && block.id === id) found = block;
  });
  return found;
}

/** Ids of `root` and everything nested in it. */
export function subtreeIds(root: Block): Set<string> {
  const ids = new Set<string>([root.id]);
  walkBlocks(root.children ?? [], (block) => ids.add(block.id));
  return ids;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** The text a block displays from its own props. Markup stripped, entities decoded. */
export function blockText(block: Block): string {
  switch (block.type) {
    case 'heading':
    case 'text':
    case 'button':
      return stripTags(str(block.props.text));
    default:
      return '';
  }
}

export function blockAlt(block: Block): string {
  return block.type === 'image' || block.type === 'logo' ? stripTags(str(block.props.alt)) : '';
}

export interface TextSurface {
  /** "subject 2 (urgent)", "block:hero-copy", "alt:hero". */
  where: string;
  text: string;
  /** The block uppercases its text with CSS, so the reader sees capitals the copy doesn't have. */
  uppercase: boolean;
  /** Part of the code-assembled footer. */
  inFooter: boolean;
  /** The disclaimer, carried verbatim — legal text, not our copy. */
  isDisclaimer: boolean;
}

/** Every piece of text a reader of this draft sees, in reading order. */
export function textSurfaces(artifact: DraftArtifact): TextSurface[] {
  const footer = findBlock(artifact.template, artifact.footerBlockId);
  const footerIds = footer ? subtreeIds(footer) : new Set<string>();
  const out: TextSurface[] = [];
  const plain = { uppercase: false, inFooter: false, isDisclaimer: false };

  artifact.subjects.forEach((s, i) =>
    out.push({ where: `subject ${i + 1} (${s.kind})`, text: s.text, ...plain }),
  );
  artifact.previews.forEach((p, i) =>
    out.push({ where: `preview ${i + 1} (${p.kind})`, text: p.text, ...plain }),
  );

  walkBlocks(artifact.template.blocks, (block) => {
    const inFooter = footerIds.has(block.id);
    const text = blockText(block);
    if (text) {
      out.push({
        where: `block:${block.id}`,
        text,
        uppercase: block.props.textTransform === 'uppercase',
        inFooter,
        isDisclaimer: artifact.disclaimer?.blockId === block.id,
      });
    }
    const alt = blockAlt(block);
    if (alt) out.push({ where: `alt:${block.id}`, text: alt, uppercase: false, inFooter, isDisclaimer: false });
  });
  return out;
}

/** The copy we wrote: everything but the verbatim disclaimer. */
export function copySurfaces(artifact: DraftArtifact): TextSurface[] {
  return textSurfaces(artifact).filter((s) => !s.isDisclaimer);
}
