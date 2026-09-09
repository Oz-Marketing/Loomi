import { prisma } from '@/lib/prisma';
import type { EmailTemplate } from '@/lib/email/types';
import { isV2Template } from '@/lib/email/types';
import {
  buildOfferEmail,
  ctaBlocks,
  offerBlocks,
  resolveLogoBlocks,
  spliceOffers,
  type OfferEmailInput,
} from './offer-email-doc';

/**
 * The email shell a run builds through, and the document it produces.
 *
 * WHERE THE PAIRING LIVES. A creative **Playbook** is the bundle — one ad plate
 * set, its sizes, and the email shell that goes with them, authored once for the
 * agency and applied to many rooftops. Applying one PRESETS
 * `AdAutomationConfig.emailTemplateId`; that column stays the single source of
 * truth for what a run actually uses, so generation never resolves a playbook
 * and drift is derived by comparing the two.
 *
 * An earlier version of this file resolved the shell from
 * `AdTemplateDoc.emailTemplateSlug` — a second pairing that silently overrode
 * the config column, which broke exactly that invariant: the config no longer
 * described what ran, so playbook drift detection compared the wrong thing.
 * Removed 2026-09-08. If you are tempted to re-add a per-template shell, put it
 * in the playbook definition instead.
 */

/** Metadata the offer-email generator writes onto its draft blast. */
export interface OfferEmailMetadata {
  templateSlug?: string;
  runId?: string | null;
  offers?: number;
  /** The exact input the document was built from — replayed on a design pick. */
  offerInput?: OfferEmailInput;
  /**
   * The SHELL the body was spliced into, as a `Template.slug`.
   *
   * Deliberately not the same field as `templateSlug` above, which names the
   * rendered artifact `createCampaignEmailTemplate` writes on every save. They
   * were conflated once and the no-op check below could never match, so a pick
   * re-rendered the email and left a new template row behind each time.
   */
  shellSlug?: string | null;
}

/**
 * The shell for this account, or null to compose a standalone email.
 *
 * Deliberately a one-liner behind a function: it is the seam a playbook presets
 * into, and keeping it named makes "where does the shell come from" answerable
 * by grep rather than by reading the generator.
 */
export function resolveEmailShellSlug(accountShellSlug: string | null): string | null {
  return accountShellSlug?.trim() || null;
}

/**
 * Build the email document for one set of offers through a given shell.
 *
 * Returns null when the shell exists but carries no `{{offers}}` marker — the
 * caller must treat that as a configuration error rather than sending a shell
 * with no offers in it.
 */
export async function buildDocForShell(
  input: OfferEmailInput,
  shellSlug: string | null,
): Promise<EmailTemplate | null> {
  if (!shellSlug) return buildOfferEmail(input);
  const shellRow = await prisma.template.findUnique({
    where: { slug: shellSlug },
    select: { content: true },
  });
  if (!shellRow || !isV2Template(shellRow.content)) return null;
  let shell: EmailTemplate | null = null;
  try {
    shell = JSON.parse(shellRow.content) as EmailTemplate;
  } catch {
    return null;
  }
  // `offerBlocks` is the fallback layout, used when the shell holds the built-in
  // slot. `vehicles` + `trailing` are what a DESIGNER-authored card needs —
  // `spliceOffers` prefers that card when the shell has one.
  const spliced = spliceOffers(shell, offerBlocks(input), {
    vehicles: input.vehicles,
    trailing: ctaBlocks(input),
    // So a card marked "use the dealer's brand colour" wears THIS dealer's.
    accentColor: input.accentColor,
  });
  if (!spliced) return null;
  // The shell's empty logo block takes THIS account's logo, or is dropped.
  return { ...spliced, blocks: resolveLogoBlocks(spliced.blocks, input.logoUrl) };
}

/**
 * Which template row a rebuild may write into — never the shell.
 *
 * The generated body and the SHELL it was built from are different things. When
 * a caller conflates them (older metadata carries the shell's slug in
 * `templateSlug`), reusing that row writes the rendered email OVER the shell,
 * destroying its `{{offers}}` marker and breaking every future run with
 * `shell_template_no_placeholder`. This is the guard for that; it is not
 * hypothetical, it is what happened the first time reuse was added.
 *
 * Returns null to mean "make a new row".
 */
export function reusableTemplateSlug(
  recorded: string | null | undefined,
  shellSlug: string | null,
): string | null {
  if (!recorded) return null;
  if (shellSlug && recorded === shellSlug) return null;
  return recorded;
}
