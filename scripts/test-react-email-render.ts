/**
 * Smoke test for the new react-email renderer.
 * Builds a sample v2 template and prints the rendered HTML.
 *
 *   npx tsx scripts/test-react-email-render.ts
 */

import { renderEmailTemplate } from '../src/lib/email/render';
import type { EmailTemplate } from '../src/lib/email/types';

const sample: EmailTemplate = {
  version: '2',
  subject: 'Welcome to Loomi',
  preheader: 'Quick smoke test of the new renderer',
  settings: {
    bodyBg: '#f5f5f5',
    contentBg: '#ffffff',
    contentWidth: 600,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    textColor: '#1a1a1a',
  },
  blocks: [
    {
      id: 'logo-1',
      type: 'logo',
      props: {
        src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/Audi-Logo_2016.svg/400px-Audi-Logo_2016.svg.png',
        alt: 'Loomi',
        width: 120,
        align: 'center',
        linkUrl: 'https://example.com',
      },
    },
    {
      id: 'spacer-1',
      type: 'spacer',
      props: { height: 24 },
    },
    {
      id: 'section-1',
      type: 'section',
      props: { bgColor: '#0a0a0a', paddingTop: 64, paddingBottom: 64, paddingLeft: 40, paddingRight: 40, align: 'left' },
      children: [
        {
          id: 'heading-1',
          type: 'heading',
          props: { text: 'Welcome aboard.', level: 1, color: '#ffffff', fontSize: 36, fontWeight: 700, marginBottom: 12 },
        },
        {
          id: 'text-1',
          type: 'text',
          props: { text: 'A new chapter starts now.', color: '#d9d9d9', fontSize: 16, marginBottom: 0 },
        },
      ],
    },
    {
      id: 'section-2',
      type: 'section',
      props: { paddingTop: 40, paddingBottom: 40, paddingLeft: 40, paddingRight: 40 },
      children: [
        {
          id: 'heading-2',
          type: 'heading',
          props: { text: 'Hi {{contact.first_name}},', level: 2, color: '#1a1a1a', fontSize: 22, marginBottom: 16 },
        },
        {
          id: 'text-2',
          type: 'text',
          props: {
            text: 'Thanks for joining. Click below to set up your account and explore what is possible.',
            fontSize: 15,
            lineHeight: 1.65,
            marginBottom: 24,
          },
        },
        {
          id: 'button-1',
          type: 'button',
          props: { text: 'Get Started', url: 'https://example.com/start', bgColor: '#1a1a1a', textColor: '#ffffff', align: 'left', borderRadius: 4 },
        },
      ],
    },
    { id: 'divider-1', type: 'divider', props: { marginTop: 0, marginBottom: 0 } },
    {
      id: 'cols-1',
      type: 'columns',
      props: { columnCount: 2, gap: 16, paddingTop: 24, paddingBottom: 24, paddingLeft: 32, paddingRight: 32 },
      children: [
        {
          id: 'col-1',
          type: 'section',
          props: { paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 },
          children: [
            { id: 'h-l', type: 'heading', props: { text: 'Left col', level: 3, fontSize: 18, marginBottom: 8 } },
            { id: 't-l', type: 'text', props: { text: 'This is the left column.', fontSize: 14 } },
          ],
        },
        {
          id: 'col-2',
          type: 'section',
          props: { paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 },
          children: [
            { id: 'h-r', type: 'heading', props: { text: 'Right col', level: 3, fontSize: 18, marginBottom: 8 } },
            { id: 't-r', type: 'text', props: { text: 'This is the right column.', fontSize: 14 } },
          ],
        },
      ],
    },
    {
      id: 'section-3',
      type: 'section',
      props: { bgColor: '#fafafa', paddingTop: 32, paddingBottom: 32, paddingLeft: 40, paddingRight: 40, align: 'center' },
      children: [
        {
          id: 'social-1',
          type: 'social',
          props: {
            links: [
              { platform: 'facebook', url: 'https://facebook.com/loomi' },
              { platform: 'instagram', url: 'https://instagram.com/loomi' },
              { platform: 'youtube', url: 'https://youtube.com/loomi' },
            ],
            iconSize: 24,
            spacing: 12,
            align: 'center',
            variant: 'mono-dark',
          },
        },
        {
          id: 'text-3',
          type: 'text',
          props: { text: '© Loomi Studio · Unsubscribe', fontSize: 12, color: '#888', align: 'center', marginTop: 16, marginBottom: 0 },
        },
      ],
    },
  ],
};

async function main() {
  const html = await renderEmailTemplate(sample, { pretty: true });
  console.log(html);
  console.log('\n---');
  console.log(`Rendered HTML length: ${html.length} chars`);
}

main().catch((err) => {
  console.error('Render failed:', err);
  process.exit(1);
});
