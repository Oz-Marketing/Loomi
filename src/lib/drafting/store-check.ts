import type Anthropic from '@anthropic-ai/sdk';
import type { ApprovedCreative } from './assets';
import { prepareImage } from './extract';
import { structuredCall } from './model';
import type { ShownStore } from './approved-files';

/**
 * Whose graphic is this, when its file name doesn't say? (docs/email-drafting.md §3.1)
 *
 * Design often makes one creative per store from one master and names every
 * copy alike — the CDJR Layton/Riverdale military offer came as four files all
 * named "CDJR Riverdale-Layton …", the store printed only under the Young logo.
 * So the image is the next resort: one model call over every such image,
 * asking which of the request's stores it names. Read-only, image-only.
 */
export async function storesShownIn(images: ApprovedCreative[], clients: string[]): Promise<Record<string, ShownStore>> {
  if (images.length === 0) return {};
  const content: Anthropic.ContentBlockParam[] = [];
  for (const [i, img] of images.entries()) {
    const { overview } = await prepareImage(img.bytes);
    content.push(
      { type: 'text', text: `Image ${i + 1}:` },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: overview.toString('base64') } },
    );
  }
  content.push({ type: 'text', text: `Stores:\n${clients.map((c) => `- ${c}`).join('\n')}\n\nFor each image, which store is it for?` });

  const answers = ['several', 'none', ...clients];
  const reply = await structuredCall<{ images: { image: number; store: string }[] }>({
    system:
      'You identify which car dealership store a marketing graphic is for, from what is printed on it. ' +
      'The store branding decides: the location name under or beside the dealer logo, or the store name in the headline or footer. ' +
      'Fine print that lists several stores where an offer is valid does not make a graphic shared; if its branding names one store, answer that store. ' +
      'Answer exactly one of the store names given; "several" only when the branding itself names more than one of them; ' +
      '"none" when the image names no store at all (a photo with no text, for example). Never guess from anything not printed on the image.',
    content,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['images'],
      properties: {
        images: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['image', 'store'],
            properties: { image: { type: 'integer' }, store: { type: 'string', enum: answers } },
          },
        },
      },
    },
    effort: 'medium',
    task: 'telling which store each graphic is for',
  });
  const out: Record<string, ShownStore> = {};
  for (const a of reply.images ?? []) {
    const img = images[a.image - 1];
    if (img && answers.includes(a.store)) out[img.path] = a.store;
  }
  return out;
}
