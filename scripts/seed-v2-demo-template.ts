/**
 * Seed a single v2 demo template into the DB so you can view it in the UI
 * and verify the new react-email renderer is wired up correctly.
 *
 *   npx tsx scripts/seed-v2-demo-template.ts
 */

import 'dotenv/config';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { EmailTemplate } from '../src/lib/email/types';

const candidate = process.env.DATABASE_URL;
if (!candidate) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: candidate });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const demo: EmailTemplate = {
  version: '2',
  subject: 'V2 demo — react-email renderer',
  preheader: 'A demo of the new generic component library',
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
        alt: 'Logo',
        width: 120,
        align: 'center',
        linkUrl: '{{custom_values.website_url}}',
      },
    },
    { id: 'spacer-0', type: 'spacer', props: { height: 24 } },
    {
      id: 'section-hero',
      type: 'section',
      props: { bgColor: '#0a0a0a', paddingTop: 72, paddingBottom: 72, paddingLeft: 48, paddingRight: 48, align: 'left' },
      children: [
        {
          id: 'h1-hero',
          type: 'heading',
          props: { text: 'Welcome aboard.', level: 1, color: '#ffffff', fontSize: 38, fontWeight: 700, marginBottom: 12 },
        },
        {
          id: 'text-hero',
          type: 'text',
          props: { text: 'A new chapter starts now.', color: '#d9d9d9', fontSize: 16, marginBottom: 0 },
        },
      ],
    },
    {
      id: 'section-body',
      type: 'section',
      props: { paddingTop: 48, paddingBottom: 32, paddingLeft: 48, paddingRight: 48 },
      children: [
        {
          id: 'h2-greeting',
          type: 'heading',
          props: { text: 'Hi {{contact.first_name}},', level: 2, color: '#1a1a1a', fontSize: 22, marginBottom: 16 },
        },
        {
          id: 'text-body',
          type: 'text',
          props: {
            text: 'Thanks for joining {{location.name}}. Click below to get started — we will guide you through everything in the next couple of emails.',
            fontSize: 15,
            lineHeight: 1.65,
            marginBottom: 24,
          },
        },
        {
          id: 'btn-cta',
          type: 'button',
          props: { text: 'Get Started', url: '{{custom_values.website_url}}', bgColor: '#1a1a1a', textColor: '#ffffff', align: 'left', borderRadius: 4, paddingX: 28, paddingY: 14 },
        },
      ],
    },
    { id: 'divider-1', type: 'divider', props: { marginTop: 16, marginBottom: 0 } },
    {
      id: 'section-footer',
      type: 'section',
      props: { bgColor: '#fafafa', paddingTop: 32, paddingBottom: 32, paddingLeft: 48, paddingRight: 48, align: 'center' },
      children: [
        {
          id: 'social-1',
          type: 'social',
          props: {
            links: [
              { platform: 'facebook', url: '{{custom_values.facebook_url}}' },
              { platform: 'instagram', url: '{{custom_values.instagram_url}}' },
              { platform: 'youtube', url: '{{custom_values.youtube_url}}' },
            ],
            iconSize: 24,
            spacing: 14,
            align: 'center',
            variant: 'mono-dark',
          },
        },
        {
          id: 'text-legal',
          type: 'text',
          props: {
            text: '© {{location.name}} · <a href="{{unsubscribe_link}}" style="color:#888;text-decoration:underline;">Unsubscribe</a>',
            allowHtml: true,
            fontSize: 12,
            color: '#888',
            align: 'center',
            marginTop: 16,
            marginBottom: 0,
          },
        },
      ],
    },
  ],
};

async function main() {
  const slug = 'v2-demo-react-email';
  const content = JSON.stringify(demo);

  await prisma.template.upsert({
    where: { slug },
    update: { content, title: 'V2 Demo — react-email renderer', type: 'design', category: 'general', preheader: demo.preheader ?? null },
    create: { slug, title: 'V2 Demo — react-email renderer', type: 'design', category: 'general', content, preheader: demo.preheader ?? null },
  });

  console.log(`Seeded v2 demo template: ${slug}`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
