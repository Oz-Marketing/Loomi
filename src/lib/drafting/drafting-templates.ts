import { parseV2Template, type EmailTemplate } from '@/lib/email/types';
import { getAncestorAccountKeys } from '@/lib/services/accounts';
import { getEffectiveTemplatesForAccount } from '@/lib/services/templates';
import { parseDraftingFor } from './template-slots';

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
