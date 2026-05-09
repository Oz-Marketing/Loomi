/**
 * Verify v2 template round-trips through parser -> serializer cleanly.
 */

import { parseTemplate } from '../src/lib/template-parser';
import { serializeTemplate } from '../src/lib/template-serializer';
import type { EmailTemplate } from '../src/lib/email/types';

const sample: EmailTemplate = {
  version: '2',
  subject: 'Round-trip test',
  preheader: 'Testing parser/serializer symmetry',
  settings: {
    bodyBg: '#f5f5f5',
    contentBg: '#ffffff',
    contentWidth: 600,
    fontFamily: 'Helvetica, Arial, sans-serif',
    textColor: '#1a1a1a',
  },
  blocks: [
    { id: 'b1', type: 'heading', props: { text: 'Hello', level: 1, fontSize: 32, fontWeight: 700, color: '#000', align: 'left' } },
    { id: 'b2', type: 'text', props: { text: 'A paragraph.', fontSize: 15, lineHeight: 1.6, allowHtml: false } },
    {
      id: 'b3',
      type: 'section',
      props: { bgColor: '#000', paddingTop: 24, paddingBottom: 24, paddingLeft: 32, paddingRight: 32 },
      children: [
        { id: 'b3-1', type: 'button', props: { text: 'Click', url: 'https://x.com', bgColor: '#fff', textColor: '#000', borderRadius: 4 } },
      ],
    },
    {
      id: 'b4',
      type: 'social',
      props: {
        links: [
          { platform: 'facebook', url: 'https://fb.com/a' },
          { platform: 'instagram', url: 'https://ig.com/a' },
        ],
        iconSize: 24,
      },
    },
  ],
};

const original = JSON.stringify(sample);
console.log('---- original ----');
console.log(original);

const parsed = parseTemplate(original);
console.log('\n---- parsed (ParsedTemplate) ----');
console.log(JSON.stringify(parsed, null, 2));

const reserialized = serializeTemplate(parsed);
console.log('\n---- reserialized ----');
console.log(reserialized);

// Round-trip check: parse the reserialized, compare to parsed
const parsed2 = parseTemplate(reserialized);
const a = JSON.stringify(parsed.components);
const b = JSON.stringify(parsed2.components);
console.log('\n---- equality ----');
console.log('components match:', a === b);
console.log('frontmatter match:', JSON.stringify(parsed.frontmatter) === JSON.stringify(parsed2.frontmatter));
console.log('baseProps match:', JSON.stringify(parsed.baseProps) === JSON.stringify(parsed2.baseProps));

if (a !== b) {
  console.log('\nDIFF:');
  console.log('a:', a);
  console.log('b:', b);
  process.exit(1);
}
