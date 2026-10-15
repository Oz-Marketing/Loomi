import { nameTokens } from './accounts';

/**
 * Which of a project's approved graphics belong to which deliverable
 * (docs/email-drafting.md §3).
 *
 * Design uploads every final graphic for a request — email, text, landing
 * page, web banners — to its own Approved column, often as one zip, and it
 * reaches the project through the Approved Design mirror. The file names
 * carry the rest:
 *
 *   - the TYPE: "Email" in the name makes it an email graphic
 *     ("08) _ Email _ Text.png" is both);
 *   - the STORE, when the request is for more than one: whatever tells it
 *     from the request's other stores ("YPS Ogden" is enough beside Euro), in
 *     the file name or its folder.
 *
 * Design's usual name: "09 SEP - YPS Ogden - Winter Prep - Emailpng_Email - Hero.png"
 * — date, store, campaign, type, role.
 *
 * Anything Loomi can't place it reports rather than guesses: a wrong guess
 * drafts one store's offer for another.
 *
 * Pure.
 */

export interface ApprovedFile {
  /** Path inside a zip ("Email/Young Powersports Euro.png"), or the file's own name. */
  path: string;
}

/** Tokens of a file path, split on anything that isn't a letter or digit. */
function pathTokens(path: string): Set<string> {
  return new Set(
    path
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, '')
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

export function isImagePath(path: string): boolean {
  return IMAGE_EXT.test(path);
}

/** "Email" (or "E-mail", "Emails") as a word anywhere in the path. */
export function isEmailFile(path: string): boolean {
  return /(^|[^a-z0-9])e-?mails?([^a-z0-9]|$)/i.test(path);
}

function contains(haystack: Set<string>, needle: Set<string>): boolean {
  for (const t of needle) if (!haystack.has(t)) return false;
  return needle.size > 0;
}

/**
 * The words that tell `client` apart from the request's other clients:
 * "Ogden" for Young Powersports Ogden beside Young Powersports Euro. A name
 * that is wholly inside another ("Young Powersports" beside "Young
 * Powersports Euro") has none of its own, so it needs all of its words.
 */
function distinguishing(client: string, clients: string[]): Set<string> {
  const own = nameTokens(client);
  const others = new Set(clients.filter((c) => c !== client).flatMap((c) => [...nameTokens(c)]));
  const mine = new Set([...own].filter((t) => !others.has(t)));
  return mine.size ? mine : own;
}

/**
 * The client a piece of text names, among `clients`, or null.
 *
 * Matched on the words that tell the stores apart, so design's shorthand
 * works: "09 SEP - YPS Ogden - Winter Prep - Email - Hero.png" names Young
 * Powersports Ogden on a request that's also for Euro, though it never says
 * "Powersports". When two match, the one whose whole name is there and longer
 * wins; a tie is no answer.
 */
export function clientNamedIn(text: string, clients: string[]): string | null {
  const tokens = pathTokens(text);
  const fullMatch = (c: string) => (contains(tokens, nameTokens(c)) ? nameTokens(c).size : 0);
  const hits = clients
    .filter((c) => contains(tokens, distinguishing(c, clients)))
    .sort((a, b) => fullMatch(b) - fullMatch(a));
  if (hits.length === 0) return null;
  if (hits.length > 1 && fullMatch(hits[0]) === fullMatch(hits[1])) return null;
  return hits[0];
}

/**
 * The store a subitem is for. With one client on the request, that client; with
 * several, the one the subitem's name carries ("Email Blast 1 - Young
 * Powersports Euro"); else null.
 */
export function subitemClient(subitemName: string, clients: string[]): string | null {
  if (clients.length <= 1) return clients[0] ?? null;
  return clientNamedIn(subitemName, clients);
}

export type EmailPick<T> = { files: T[]; problem: null } | { files: []; problem: string };

/**
 * The approved email graphic(s) for one email subitem.
 *
 * `siblings` are the project's other subitems: two email deliverables for the
 * same store can't be told apart by store name, so that's reported too.
 */
export function pickEmailFiles<T extends ApprovedFile>(input: {
  subitem: { id: string; name: string };
  siblings: { id: string; name: string }[];
  clients: string[];
  files: T[];
  /** Every approved file's name, for the notice when none fits — files a person can recognize, PSDs included. */
  available?: string[];
}): EmailPick<T> {
  const { clients } = input;
  const store = subitemClient(input.subitem.name, clients);
  if (clients.length > 1 && !store) {
    return {
      files: [],
      problem: `The request is for ${clients.length} stores and the subitem's name doesn't say which one this is. Name it like "Email Blast 1 - ${clients[0]}".`,
    };
  }

  const email = input.files.filter((f) => isImagePath(f.path) && isEmailFile(f.path));
  const mine = clients.length > 1 ? email.filter((f) => clientNamedIn(f.path, clients) === store) : email;
  if (mine.length === 0) {
    const what = clients.length > 1 ? `email graphic for ${store}` : 'email graphic';
    const rule =
      clients.length > 1
        ? `Loomi looks for "Email" and "${store}" in the file name.`
        : 'Loomi looks for "Email" in the file name, on a PNG or JPG.';
    const names = input.available ?? input.files.map((f) => f.path);
    const seen = names.length ? ` It found: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ', …' : ''}.` : '';
    return { files: [], problem: `The approved graphics have no ${what}. ${rule}${seen}` };
  }

  const sameStore = [input.subitem, ...input.siblings]
    .filter((s, i, all) => all.findIndex((x) => x.id === s.id) === i)
    .filter((s) => /^\s*email/i.test(s.name) && subitemClient(s.name, clients) === store);
  if (sameStore.length > 1) {
    return {
      files: [],
      problem: `${store ?? 'This store'} has ${sameStore.length} email deliverables (${sameStore.map((s) => s.name).join(', ')}), and the approved graphics don't say which is which.`,
    };
  }
  return { files: mine, problem: null };
}

/** The email's main image: the one design named "Hero", else the first. */
export function pickHero<T extends { name: string }>(images: T[]): T | undefined {
  return images.find((a) => /(^|[^a-z0-9])hero([^a-z0-9]|$)/i.test(a.name)) ?? images[0];
}
