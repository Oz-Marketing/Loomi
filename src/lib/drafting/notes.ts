import type { CopyOption } from './compliance/types';
import type { CreativeReading } from './reading';

/**
 * The updates Loomi posts on a monday subitem.
 *
 * monday renders an update body as HTML, so every value that came off a
 * creative or out of a request is escaped here: a disclaimer containing "<"
 * would otherwise lose text silently — the same class of loss the help desk
 * hit with "Name <email>" in long text. Only the tags written below are markup.
 *
 * Pure.
 */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function list(items: string[]): string {
  return `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
}

const CHECK = ' <strong>— low confidence: check this against the creative</strong>';

/** A draft is in Draft Files and the template is linked. */
export function draftReadyUpdate(input: {
  templateUrl: string;
  versionNumber: number;
  subjects: CopyOption[];
  previews: CopyOption[];
  reading: CreativeReading | null;
  /** Things the drafter couldn't satisfy — co-op requirements, a disclosure the creative lacks. */
  notes: string[];
  /** Rule warnings: they didn't block the draft, but a person should look. */
  warnings: string[];
}): string {
  const parts: string[] = [
    `<p><strong>Loomi drafted this email</strong>${input.versionNumber > 1 ? ` (version ${input.versionNumber})` : ''}. ` +
      `<a href="${escapeHtml(input.templateUrl)}">Open the template in Loomi</a>. ` +
      `The PNG and HTML are in Draft Files, ready for a proof.</p>`,
  ];

  const options = (label: string, items: CopyOption[]) =>
    items.length
      ? [`<p><strong>${label}</strong></p>`, list(items.map((o) => `${o.kind === 'urgent' ? 'Urgent' : 'Initial'}: ${escapeHtml(o.text)}`))]
      : [];
  parts.push(...options('Subject lines', input.subjects), ...options('Preview text', input.previews));

  const reading = input.reading;
  if (reading) {
    parts.push('<p><strong>What Loomi read off the creative</strong> — compare it with the image before approving:</p>');
    if (reading.fields.length) {
      parts.push(
        list(
          reading.fields.map(
            (f) => `${escapeHtml(f.label)}: ${escapeHtml(f.value)}${f.confidence === 'low' ? CHECK : ''}`,
          ),
        ),
      );
    }
    if (reading.disclaimer) {
      parts.push(
        `<p><strong>Disclaimer, as read</strong>${reading.disclaimer.confidence === 'low' ? CHECK : ''}</p>`,
        `<p>${escapeHtml(reading.disclaimer.text).replace(/\r?\n/g, '<br>')}</p>`,
      );
    } else {
      parts.push('<p><strong>Disclaimer:</strong> none read off the creative.</p>');
    }
  }

  if (input.notes.length) parts.push('<p><strong>Notes</strong></p>', list(input.notes.map(escapeHtml)));
  if (input.warnings.length) parts.push('<p><strong>Warnings</strong></p>', list(input.warnings.map(escapeHtml)));
  return parts.join('');
}

/** Drafting stopped; nothing was written to Draft Files. */
export function cantDraftUpdate(reason: string): string {
  return (
    `<p><strong>Loomi couldn't draft this email.</strong> ${escapeHtml(reason)}</p>` +
    '<p>Fix it here on monday and Loomi tries again on its own within a few minutes.</p>'
  );
}
