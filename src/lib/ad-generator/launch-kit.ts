import type { AdCopyVariation } from './copy-types';
import { GOOGLE_LIMITS, META_LIMITS } from './copy-types';
import type { ResolvedLaunch } from './launch-preset';
import type { ApprovalStatus } from './coop-approval';

/**
 * The Launch Kit's text files.
 *
 * Everything someone needs to assemble the campaign by hand, in the order they'll
 * need it, with the character counts already checked. This is Phase A's payoff:
 * the twenty minutes of tedium is the part worth automating, and it needs no
 * platform write access at all — so it works today, and it keeps working if the
 * one-click launch is ever unavailable.
 *
 * Pure text assembly, so it's testable and cheap.
 */

function line(label: string, value: string | number | null | undefined): string {
  return `${label}: ${value === null || value === undefined || value === '' ? '—' : value}`;
}

/** `text (12/40)` — the count is the thing a person actually needs when pasting
 *  into Ads Manager, which silently truncates. */
function counted(text: string, max: number): string {
  const over = text.length > max ? '  ⚠ OVER LIMIT' : '';
  return `${text}\n    (${text.length}/${max})${over}`;
}

export interface LaunchKitInput {
  adName: string;
  accountName: string;
  vehicle?: string | null;
  offerSummary?: string | null;
  copy: AdCopyVariation | null;
  copySource?: string | null;
  launch: ResolvedLaunch;
  approval?: ApprovalStatus | null;
  /** Rendered file names in the archive, so the text refers to real files. */
  imageFiles: string[];
  /**
   * MP4 file names, for an ad with a moving layer.
   *
   * Listed separately because they change what the person does with the kit: on a
   * video ad the images are the poster frame and the placements that don't take
   * video, and uploading only those would publish a still of an ad that was
   * designed to move.
   */
  videoFiles?: string[];
  expiresAt?: string | null;
  generatedAt: string;
}

/** `meta.txt` — paste-ready Meta fields. */
export function metaCopySheet(input: LaunchKitInput): string {
  const c = input.copy;
  const out: string[] = [
    `META — ${input.adName}`,
    '='.repeat(60),
    '',
    'PRIMARY TEXT',
    c ? `    ${counted(c.meta.primaryText, META_LIMITS.primaryText)}` : '    —',
    '',
    'HEADLINE',
    c ? `    ${counted(c.meta.headline, META_LIMITS.headline)}` : '    —',
    '',
    'DESCRIPTION',
    c ? `    ${counted(c.meta.description, META_LIMITS.description)}` : '    —',
    '',
    line('Destination URL', input.launch.destinationUrl),
    '',
  ];
  if (input.copySource) {
    out.push(
      input.copySource === 'ai'
        ? 'Copy was AI-drafted and passed the number-provenance and co-op content checks.'
        : 'Copy was assembled from the offer data (no AI).',
      '',
    );
  }
  return out.join('\n');
}

/** `google.txt` — asset lists at Google's limits. */
export function googleCopySheet(input: LaunchKitInput): string {
  const c = input.copy;
  const out: string[] = [`GOOGLE — ${input.adName}`, '='.repeat(60), '', 'HEADLINES'];
  if (c?.google.headlines.length) {
    c.google.headlines.forEach((h, i) => out.push(`  ${i + 1}. ${counted(h, GOOGLE_LIMITS.headline)}`));
  } else {
    out.push('  —');
  }
  out.push('', 'DESCRIPTIONS');
  if (c?.google.descriptions.length) {
    c.google.descriptions.forEach((d, i) => out.push(`  ${i + 1}. ${counted(d, GOOGLE_LIMITS.description)}`));
  } else {
    out.push('  —');
  }
  out.push(
    '',
    line('Final URL', input.launch.destinationUrl),
    '',
    // Said plainly because it's the most common wrong assumption about these
    // assets: they cannot go into a Search campaign.
    'NOTE: these creatives are static images, so Search is not an option. Use Demand',
    'Gen or Display, or add the images to an existing Performance Max asset group.',
    '',
  );
  return out.join('\n');
}

/** `targeting.txt` — the campaign shape, including what the platform overrode. */
export function targetingSheet(input: LaunchKitInput): string {
  const l = input.launch;
  const out: string[] = [
    `TARGETING — ${input.adName}`,
    '='.repeat(60),
    '',
    line('Account', input.accountName),
    line('Objective', l.objective),
    line('Bid strategy', l.bidStrategy),
    line('Daily budget', l.dailyBudget),
    line('Flight', `${l.flightDays} days`),
    '',
    line('Special ad categories', l.specialAdCategories.join(', ')),
  ];

  if (l.targetingFloor) {
    out.push(
      '',
      'REQUIRED BY META FOR THIS CATEGORY — these are not preferences:',
      `  · Location radius: at least ${l.targetingFloor.minRadiusMiles} miles. Zip/postal targeting unavailable.`,
      `  · Age: ${l.targetingFloor.minAge}–${l.targetingFloor.maxAge}+, cannot be narrowed.`,
      '  · Gender: all, cannot be narrowed.',
      '  · Detailed targeting restricted; exclusions not permitted at all.',
    );
  }

  out.push(
    '',
    line('Geo centre', l.geoZip),
    line('Radius (miles)', l.geoRadiusMiles),
    '',
    line('Vehicle', input.vehicle),
    line('Offer', input.offerSummary),
    line('Offer ends', input.expiresAt ? new Date(input.expiresAt).toLocaleDateString() : null),
    '',
    line('Co-op approval', input.approval ? input.approval.reason : 'Not checked'),
    '',
    'CREATIVE FILES',
    ...(input.imageFiles.length ? input.imageFiles.map((f) => `  · ${f}`) : ['  —']),
  );

  if (input.videoFiles?.length) {
    out.push(
      '',
      'VIDEO CREATIVE — upload these, not the stills',
      ...input.videoFiles.map((f) => `  · ${f}`),
      '  The images above are this ad\'s poster frame; use one as the video thumbnail.',
    );
  }

  if (l.notices.length) {
    out.push('', 'NOTES', ...l.notices.map((n) => `  · ${n}`));
  }
  out.push('', line('Kit generated', input.generatedAt), '');
  return out.join('\n');
}

/** `README.txt` — what this archive is and the order to use it in. */
export function readmeSheet(input: LaunchKitInput): string {
  return [
    `LAUNCH KIT — ${input.adName}`,
    '='.repeat(60),
    '',
    `Everything needed to build this campaign by hand, from ${input.accountName}.`,
    '',
    'CONTENTS',
    '  targeting.txt   campaign shape, plus anything the platform forces',
    '  meta.txt        Meta primary text / headline / description, with counts',
    '  google.txt      Google headlines + descriptions, with counts',
    '  images/         the rendered creative at each size',
    '',
    'ORDER',
    '  1. Read targeting.txt first — if a special ad category applies, it changes',
    '     what you are allowed to target before you build anything.',
    '  2. Create the campaign with that objective and category.',
    '  3. Upload images/, paste the copy, set the destination URL.',
    '',
    'The character counts are already checked against each platform\'s limits, so',
    'nothing here will be silently truncated when pasted.',
    '',
    line('Offer ends', input.expiresAt ? new Date(input.expiresAt).toLocaleDateString() : null),
    '',
  ].join('\n');
}
