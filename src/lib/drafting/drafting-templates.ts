import { prisma } from '@/lib/prisma';
import { parseV2Template, type EmailTemplate } from '@/lib/email/types';
import { getAncestorAccountKeys } from '@/lib/services/accounts';
import { getEffectiveTemplatesForAccount } from '@/lib/services/templates';
import { REQUEST_TYPES } from './extraction';
import { parseDraftingFor, starterSlug, starterTemplate } from './template-slots';

/**
 * The drafting template for one account and request type, if someone marked
 * one (docs/email-drafting.md §4.1).
 *
 * Scoped like every template: the account's own, then its group's (nearest
 * first), then the shared library — so a group can set the layout for all its
 * stores and one store can still have its own. At one level, the most recently
 * edited wins. Drafts themselves (category `drafted`) are never candidates.
 */
export async function findDraftingTemplate(
  accountKey: string,
  requestType: string,
): Promise<{ slug: string; title: string; template: EmailTemplate } | null> {
  const [templates, ancestors] = await Promise.all([
    getEffectiveTemplatesForAccount(accountKey),
    getAncestorAccountKeys(accountKey),
  ]);
  const rank = (owner: string | null) => (owner === accountKey ? 0 : owner === null ? 1000 : 1 + ancestors.indexOf(owner));
  const marked = templates
    .filter((t) => t.category !== 'drafted' && parseDraftingFor(t.draftingFor).includes(requestType as never))
    .sort((a, b) => rank(a.accountKey) - rank(b.accountKey) || b.updatedAt.getTime() - a.updatedAt.getTime());
  for (const t of marked) {
    const template = parseV2Template(t.content);
    if (template) return { slug: t.slug, title: t.title, template };
  }
  return null;
}

/**
 * Make sure the shared library has a starter drafting template for every
 * request type (§4.1), so nobody has to build one. Create-only: a starter
 * someone restyled is never overwritten, and one that exists in any form is
 * left alone. A starter that's deleted comes back on the next draft — to stop
 * using one, unmark it ("Use for drafted emails") rather than delete it.
 */
export async function ensureStarterTemplates(): Promise<number> {
  const slugs = REQUEST_TYPES.map(starterSlug);
  const have = new Set(
    (await prisma.template.findMany({ where: { slug: { in: slugs } }, select: { slug: true } })).map((t) => t.slug),
  );
  let made = 0;
  for (const type of REQUEST_TYPES) {
    const slug = starterSlug(type);
    if (have.has(slug)) continue;
    const template = starterTemplate(type);
    try {
      await prisma.template.create({
        data: {
          slug,
          title: template.title ?? slug,
          type: 'design',
          category: 'drafting',
          accountKey: null,
          content: JSON.stringify(template),
          draftingFor: JSON.stringify([type]),
        },
      });
      made++;
    } catch (err) {
      // Two drafts racing to seed: the other one won, which is the same outcome.
      if ((err as { code?: string })?.code !== 'P2002') throw err;
    }
  }
  return made;
}
