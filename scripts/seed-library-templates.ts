/**
 * Seed script: populates the Template library with curated, ready-to-use designs.
 *
 * Inserts 10 drag-and-drop (v2 JSON) templates and 6 raw-HTML templates,
 * all published, covering a range of styles so there's plenty to pick from.
 *
 * Usage:
 *   npx tsx scripts/seed-library-templates.ts            # upsert (default)
 *   npx tsx scripts/seed-library-templates.ts --clean    # delete then re-create
 *
 * Idempotent: re-running updates content + metadata for existing slugs.
 */

import 'dotenv/config';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { Block, EmailTemplate } from '../src/lib/email/types';

const candidate =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:5432/loomi_studio?schema=public';
if (!/^postgres(ql)?:\/\//.test(candidate)) {
  throw new Error('DATABASE_URL must be a PostgreSQL URL (postgresql://...)');
}
const needsSsl = /[?&]sslmode=require/.test(candidate);
const cleanUrl = candidate
  .replace(/[?&]sslmode=require/, (m) => (m.startsWith('?') ? '?' : ''))
  .replace(/\?$/, '');
const pool = new pg.Pool({
  connectionString: cleanUrl,
  ...(needsSsl && { ssl: { rejectUnauthorized: false } }),
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const clean = process.argv.includes('--clean');

// ── helpers ──

let counter = 0;
function id(prefix: string): string {
  counter += 1;
  return `b-${prefix}-${counter.toString(36)}`;
}

function section(props: Record<string, unknown>, children: Block[]): Block {
  return { id: id('sec'), type: 'section', props, children };
}

function heading(text: string, props: Record<string, unknown> = {}): Block {
  return { id: id('h'), type: 'heading', props: { text, ...props } };
}

function text(t: string, props: Record<string, unknown> = {}): Block {
  return { id: id('t'), type: 'text', props: { text: t, ...props } };
}

function button(label: string, url: string, props: Record<string, unknown> = {}): Block {
  return { id: id('btn'), type: 'button', props: { text: label, url, ...props } };
}

function image(src: string, props: Record<string, unknown> = {}): Block {
  return { id: id('img'), type: 'image', props: { src, ...props } };
}

function logo(src: string, props: Record<string, unknown> = {}): Block {
  return { id: id('logo'), type: 'logo', props: { src, ...props } };
}

function divider(props: Record<string, unknown> = {}): Block {
  return { id: id('div'), type: 'divider', props };
}

function spacer(height: number): Block {
  return { id: id('sp'), type: 'spacer', props: { height } };
}

function social(
  links: { platform: string; url: string }[],
  props: Record<string, unknown> = {},
): Block {
  return { id: id('soc'), type: 'social', props: { links, ...props } };
}

const PLACEHOLDER_LOGO = 'https://placehold.co/180x44/0a0a0a/ffffff?text=Your+Logo';

// ─────────────────────────────────────────────────────────────────────
// Drag-and-drop templates (v2 JSON)
// ─────────────────────────────────────────────────────────────────────

/** 1. Modern Welcome — light, friendly, gradient-style hero */
function welcomeModern(): EmailTemplate {
  return {
    version: '2',
    subject: 'Welcome to the family, {{contact.first_name}}',
    preheader: 'A few good things to start with — picked just for you.',
    settings: {
      bodyBg: '#f6f4ef',
      contentBg: '#ffffff',
      contentWidth: 600,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
      textColor: '#1f1f1f',
    },
    blocks: [
      section(
        { paddingTop: 28, paddingBottom: 0, paddingLeft: 40, paddingRight: 40 },
        [logo(PLACEHOLDER_LOGO, { width: 120, align: 'left' })],
      ),
      section(
        {
          bgColor: '#fef3e6',
          paddingTop: 72,
          paddingBottom: 72,
          paddingLeft: 40,
          paddingRight: 40,
          align: 'center',
        },
        [
          text('A WARM HELLO', {
            color: '#b45309',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '2px',
            textTransform: 'uppercase',
            align: 'center',
            marginBottom: 16,
          }),
          heading('Welcome to the\nfamily.', {
            level: 1,
            fontSize: 44,
            lineHeight: 1.1,
            color: '#1a1a1a',
            align: 'center',
            marginBottom: 20,
          }),
          text(
            "We're so glad you're here. Take a look around — your first 10% off is already waiting for you below.",
            { fontSize: 16, color: '#52525b', align: 'center', marginBottom: 32, lineHeight: 1.6 },
          ),
          button('Start exploring', 'https://example.com/shop', {
            bgColor: '#1a1a1a',
            textColor: '#ffffff',
            paddingTop: 16,
            paddingBottom: 16,
            paddingLeft: 40,
            paddingRight: 40,
            borderRadiusTopLeft: 999,
            borderRadiusTopRight: 999,
            borderRadiusBottomRight: 999,
            borderRadiusBottomLeft: 999,
            fontSize: 15,
            fontWeight: 600,
            align: 'center',
          }),
        ],
      ),
      section({ paddingTop: 56, paddingBottom: 24, paddingLeft: 40, paddingRight: 40 }, [
        heading('What to do first', {
          level: 2,
          fontSize: 24,
          color: '#1a1a1a',
          marginBottom: 24,
        }),
        text(
          'Three quick steps to make the most of your account. None of them take more than a minute.',
          { color: '#52525b', marginBottom: 24 },
        ),
      ]),
      section({ paddingTop: 0, paddingBottom: 16, paddingLeft: 40, paddingRight: 40 }, [
        heading('1.  Set up your profile', { level: 3, fontSize: 17, marginBottom: 6 }),
        text('Tell us what you like so we can show you the good stuff first.', {
          color: '#71717a',
          fontSize: 14,
          marginBottom: 0,
        }),
      ]),
      section({ paddingTop: 16, paddingBottom: 16, paddingLeft: 40, paddingRight: 40 }, [
        divider({ color: '#f0eee8', marginTop: 0, marginBottom: 16 }),
        heading('2.  Browse the new arrivals', { level: 3, fontSize: 17, marginBottom: 6 }),
        text('Freshly added every Friday. The best things go fast.', {
          color: '#71717a',
          fontSize: 14,
          marginBottom: 0,
        }),
      ]),
      section({ paddingTop: 16, paddingBottom: 56, paddingLeft: 40, paddingRight: 40 }, [
        divider({ color: '#f0eee8', marginTop: 0, marginBottom: 16 }),
        heading('3.  Save 10% on your first order', { level: 3, fontSize: 17, marginBottom: 6 }),
        text('Use code WELCOME10 at checkout. Yours for the next 14 days.', {
          color: '#71717a',
          fontSize: 14,
          marginBottom: 0,
        }),
      ]),
      section(
        {
          bgColor: '#1a1a1a',
          paddingTop: 40,
          paddingBottom: 40,
          paddingLeft: 40,
          paddingRight: 40,
          align: 'center',
        },
        [
          text(
            'Questions? Just reply to this email — a real person will get back to you within a day.',
            { color: '#a3a3a3', fontSize: 13, align: 'center', marginBottom: 16 },
          ),
          social(
            [
              { platform: 'instagram', url: 'https://instagram.com' },
              { platform: 'facebook', url: 'https://facebook.com' },
              { platform: 'tiktok', url: 'https://tiktok.com' },
            ],
            { iconSize: 24, spacing: 14, align: 'center', variant: 'mono-light' },
          ),
          spacer(8),
          text('© {{location.name}}  ·  {{location.address}}', {
            color: '#71717a',
            fontSize: 11,
            align: 'center',
            marginBottom: 0,
          }),
        ],
      ),
    ],
  };
}

/** 2. Bold Brutalist Announcement — high-contrast yellow on black, oversized type */
function boldAnnouncement(): EmailTemplate {
  return {
    version: '2',
    subject: 'Something new. And it’s big.',
    preheader: 'You’re among the first to know. Read on.',
    settings: {
      bodyBg: '#0a0a0a',
      contentBg: '#0a0a0a',
      contentWidth: 600,
      fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      textColor: '#ffffff',
    },
    blocks: [
      section({ paddingTop: 32, paddingBottom: 32, paddingLeft: 40, paddingRight: 40 }, [
        text('{{location.name}}', {
          color: '#facc15',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '3px',
          textTransform: 'uppercase',
          marginBottom: 0,
        }),
      ]),
      section({ paddingTop: 24, paddingBottom: 24, paddingLeft: 40, paddingRight: 40 }, [
        heading('BIG NEWS,\nNO FLUFF.', {
          level: 1,
          fontSize: 64,
          lineHeight: 0.95,
          fontWeight: 800,
          color: '#facc15',
          letterSpacing: '-2px',
          marginBottom: 0,
        }),
      ]),
      section({ paddingTop: 8, paddingBottom: 48, paddingLeft: 40, paddingRight: 40 }, [
        heading('Read this in 30 seconds.', {
          level: 2,
          fontSize: 22,
          color: '#ffffff',
          fontWeight: 400,
          marginBottom: 0,
        }),
      ]),
      section(
        {
          bgColor: '#facc15',
          paddingTop: 40,
          paddingBottom: 40,
          paddingLeft: 40,
          paddingRight: 40,
        },
        [
          text(
            'We just shipped the thing we’ve been hinting at for months. It is faster, leaner, and — most importantly — yours starting today.',
            {
              color: '#0a0a0a',
              fontSize: 19,
              lineHeight: 1.45,
              fontWeight: 500,
              marginBottom: 32,
            },
          ),
          button('SEE WHAT’S NEW  →', 'https://example.com/announce', {
            bgColor: '#0a0a0a',
            textColor: '#facc15',
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '2px',
            textTransform: 'uppercase',
            paddingTop: 18,
            paddingBottom: 18,
            paddingLeft: 32,
            paddingRight: 32,
            borderRadiusTopLeft: 0,
            borderRadiusTopRight: 0,
            borderRadiusBottomRight: 0,
            borderRadiusBottomLeft: 0,
            align: 'left',
          }),
        ],
      ),
      section({ paddingTop: 48, paddingBottom: 24, paddingLeft: 40, paddingRight: 40 }, [
        heading('THREE THINGS\nTO KNOW.', {
          level: 2,
          fontSize: 36,
          fontWeight: 800,
          color: '#ffffff',
          lineHeight: 1,
          letterSpacing: '-1px',
          marginBottom: 32,
        }),
      ]),
      section({ paddingTop: 0, paddingBottom: 16, paddingLeft: 40, paddingRight: 40 }, [
        heading('01', {
          level: 3,
          fontSize: 14,
          color: '#facc15',
          letterSpacing: '3px',
          marginBottom: 8,
        }),
        heading('It’s faster.', { level: 3, fontSize: 22, color: '#ffffff', marginBottom: 8 }),
        text('Two-second load times across the board. No more spinners.', {
          color: '#a3a3a3',
          marginBottom: 0,
        }),
        divider({ color: '#262626', marginTop: 24, marginBottom: 0 }),
      ]),
      section({ paddingTop: 16, paddingBottom: 16, paddingLeft: 40, paddingRight: 40 }, [
        heading('02', {
          level: 3,
          fontSize: 14,
          color: '#facc15',
          letterSpacing: '3px',
          marginBottom: 8,
        }),
        heading('It’s simpler.', { level: 3, fontSize: 22, color: '#ffffff', marginBottom: 8 }),
        text('We removed half the buttons and the half that’s left is the half you actually use.', {
          color: '#a3a3a3',
          marginBottom: 0,
        }),
        divider({ color: '#262626', marginTop: 24, marginBottom: 0 }),
      ]),
      section({ paddingTop: 16, paddingBottom: 56, paddingLeft: 40, paddingRight: 40 }, [
        heading('03', {
          level: 3,
          fontSize: 14,
          color: '#facc15',
          letterSpacing: '3px',
          marginBottom: 8,
        }),
        heading('It’s included.', { level: 3, fontSize: 22, color: '#ffffff', marginBottom: 8 }),
        text('No price changes. You already have it.', { color: '#a3a3a3', marginBottom: 0 }),
      ]),
      section(
        {
          paddingTop: 32,
          paddingBottom: 32,
          paddingLeft: 40,
          paddingRight: 40,
          align: 'center',
        },
        [
          text('© {{location.name}}  ·  {{location.address}}', {
            color: '#525252',
            fontSize: 11,
            align: 'center',
            letterSpacing: '1px',
            textTransform: 'uppercase',
            marginBottom: 0,
          }),
        ],
      ),
    ],
  };
}

/** 3. Editorial Newsletter — minimal serif, white, lots of whitespace */
function editorialNewsletter(): EmailTemplate {
  return {
    version: '2',
    subject: 'The Weekly · Issue No. 47',
    preheader: 'Three stories worth your time.',
    settings: {
      bodyBg: '#fafaf9',
      contentBg: '#ffffff',
      contentWidth: 620,
      fontFamily: '"Georgia", "Times New Roman", serif',
      textColor: '#1c1917',
    },
    blocks: [
      section(
        { paddingTop: 56, paddingBottom: 24, paddingLeft: 56, paddingRight: 56, align: 'center' },
        [
          text('THE WEEKLY', {
            color: '#1c1917',
            fontSize: 13,
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            fontWeight: 700,
            letterSpacing: '6px',
            textTransform: 'uppercase',
            align: 'center',
            marginBottom: 8,
          }),
          text('Issue No. 47  ·  May 21, 2026', {
            color: '#78716c',
            fontSize: 12,
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            letterSpacing: '1px',
            align: 'center',
            marginBottom: 0,
          }),
        ],
      ),
      section({ paddingTop: 0, paddingBottom: 32, paddingLeft: 56, paddingRight: 56 }, [
        divider({ color: '#1c1917', thickness: 2, marginTop: 24, marginBottom: 0 }),
      ]),
      section({ paddingTop: 16, paddingBottom: 8, paddingLeft: 56, paddingRight: 56 }, [
        text('FROM THE EDITOR', {
          color: '#a8a29e',
          fontSize: 11,
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          letterSpacing: '2px',
          fontWeight: 600,
          textTransform: 'uppercase',
          marginBottom: 16,
        }),
        heading('A good week to be paying attention.', {
          level: 1,
          fontSize: 32,
          fontWeight: 400,
          color: '#1c1917',
          lineHeight: 1.25,
          marginBottom: 20,
        }),
        text(
          'A handful of stories made the week feel busier than it was — and the rest of them quietly mattered more. Here are the three I’d put in front of you if we were having coffee.',
          {
            fontSize: 17,
            lineHeight: 1.7,
            color: '#44403c',
            marginBottom: 24,
          },
        ),
        text('— Sam', { fontSize: 16, fontStyle: 'italic', color: '#78716c', marginBottom: 0 }),
      ]),
      section({ paddingTop: 32, paddingBottom: 0, paddingLeft: 56, paddingRight: 56 }, [
        divider({ color: '#e7e5e4', marginTop: 0, marginBottom: 32 }),
      ]),
      section({ paddingTop: 0, paddingBottom: 32, paddingLeft: 56, paddingRight: 56 }, [
        text('STORY 01', {
          color: '#a8a29e',
          fontSize: 11,
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          letterSpacing: '2px',
          fontWeight: 600,
          textTransform: 'uppercase',
          marginBottom: 12,
        }),
        heading('The new shape of the slow internet.', {
          level: 2,
          fontSize: 26,
          fontWeight: 400,
          lineHeight: 1.3,
          color: '#1c1917',
          marginBottom: 12,
        }),
        text(
          'Small communities are quietly outperforming the giants on the metrics that actually matter — attention, trust, and time spent. A look at why.',
          { fontSize: 16, lineHeight: 1.7, color: '#44403c', marginBottom: 16 },
        ),
        text(
          '<a href="https://example.com/story-1" style="color:#1c1917;text-decoration:underline;text-underline-offset:3px;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:13px;letter-spacing:1px;font-weight:600;text-transform:uppercase;">Read the piece →</a>',
          { allowHtml: true, marginBottom: 0 },
        ),
      ]),
      section({ paddingTop: 0, paddingBottom: 0, paddingLeft: 56, paddingRight: 56 }, [
        divider({ color: '#e7e5e4', marginTop: 0, marginBottom: 32 }),
      ]),
      section({ paddingTop: 0, paddingBottom: 32, paddingLeft: 56, paddingRight: 56 }, [
        text('STORY 02', {
          color: '#a8a29e',
          fontSize: 11,
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          letterSpacing: '2px',
          fontWeight: 600,
          textTransform: 'uppercase',
          marginBottom: 12,
        }),
        heading('What we keep when the machines write the rest.', {
          level: 2,
          fontSize: 26,
          fontWeight: 400,
          lineHeight: 1.3,
          color: '#1c1917',
          marginBottom: 12,
        }),
        text(
          'A working theory: the parts of writing that remain ours are the parts that were never about the words to begin with.',
          { fontSize: 16, lineHeight: 1.7, color: '#44403c', marginBottom: 16 },
        ),
        text(
          '<a href="https://example.com/story-2" style="color:#1c1917;text-decoration:underline;text-underline-offset:3px;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:13px;letter-spacing:1px;font-weight:600;text-transform:uppercase;">Read the piece →</a>',
          { allowHtml: true, marginBottom: 0 },
        ),
      ]),
      section({ paddingTop: 0, paddingBottom: 0, paddingLeft: 56, paddingRight: 56 }, [
        divider({ color: '#e7e5e4', marginTop: 0, marginBottom: 32 }),
      ]),
      section({ paddingTop: 0, paddingBottom: 56, paddingLeft: 56, paddingRight: 56 }, [
        text('STORY 03', {
          color: '#a8a29e',
          fontSize: 11,
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          letterSpacing: '2px',
          fontWeight: 600,
          textTransform: 'uppercase',
          marginBottom: 12,
        }),
        heading('A field guide to good taste.', {
          level: 2,
          fontSize: 26,
          fontWeight: 400,
          lineHeight: 1.3,
          color: '#1c1917',
          marginBottom: 12,
        }),
        text(
          'Taste is the long, slow accumulation of having seen a lot of bad things and still being interested. A short essay on noticing.',
          { fontSize: 16, lineHeight: 1.7, color: '#44403c', marginBottom: 16 },
        ),
        text(
          '<a href="https://example.com/story-3" style="color:#1c1917;text-decoration:underline;text-underline-offset:3px;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:13px;letter-spacing:1px;font-weight:600;text-transform:uppercase;">Read the piece →</a>',
          { allowHtml: true, marginBottom: 0 },
        ),
      ]),
      section(
        {
          bgColor: '#fafaf9',
          paddingTop: 32,
          paddingBottom: 32,
          paddingLeft: 56,
          paddingRight: 56,
          align: 'center',
        },
        [
          text(
            'The Weekly is a free newsletter. Forward it to someone who’d like it.',
            {
              color: '#78716c',
              fontSize: 13,
              fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
              align: 'center',
              marginBottom: 8,
            },
          ),
          text(
            '<a href="{{unsubscribe_url}}" style="color:#a8a29e;text-decoration:underline;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:11px;">Unsubscribe</a>',
            { allowHtml: true, align: 'center', marginBottom: 0 },
          ),
        ],
      ),
    ],
  };
}

/** 4. Product Launch (Dark Mode) — moody dark hero, neon accents */
function productLaunchDark(): EmailTemplate {
  return {
    version: '2',
    subject: 'Meet Atlas — finally.',
    preheader: 'Two years in the making. Available today.',
    settings: {
      bodyBg: '#000000',
      contentBg: '#0a0a0f',
      contentWidth: 600,
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif',
      textColor: '#e4e4e7',
    },
    blocks: [
      section({ paddingTop: 32, paddingBottom: 24, paddingLeft: 40, paddingRight: 40 }, [
        logo('https://placehold.co/120x32/0a0a0f/ffffff?text=ATLAS', {
          width: 110,
          align: 'left',
        }),
      ]),
      section(
        {
          paddingTop: 48,
          paddingBottom: 48,
          paddingLeft: 40,
          paddingRight: 40,
          align: 'center',
        },
        [
          text('NEW · MAY 2026', {
            color: '#a78bfa',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '3px',
            textTransform: 'uppercase',
            align: 'center',
            marginBottom: 24,
          }),
          heading('Atlas.', {
            level: 1,
            fontSize: 72,
            fontWeight: 800,
            color: '#ffffff',
            align: 'center',
            letterSpacing: '-3px',
            marginBottom: 16,
          }),
          text('The fastest way to ship anything you can imagine.', {
            color: '#a1a1aa',
            fontSize: 18,
            align: 'center',
            marginBottom: 32,
          }),
          button('Get Atlas →', 'https://example.com/atlas', {
            bgColor: '#a78bfa',
            textColor: '#0a0a0f',
            fontSize: 15,
            fontWeight: 700,
            paddingTop: 16,
            paddingBottom: 16,
            paddingLeft: 36,
            paddingRight: 36,
            borderRadiusTopLeft: 10,
            borderRadiusTopRight: 10,
            borderRadiusBottomRight: 10,
            borderRadiusBottomLeft: 10,
            align: 'center',
          }),
        ],
      ),
      section({ paddingTop: 0, paddingBottom: 48, paddingLeft: 40, paddingRight: 40 }, [
        image(
          'https://images.unsplash.com/photo-1607799279861-4dd421887fb3?w=1200&q=80&auto=format&fit=crop',
          {
            alt: 'Atlas product',
            align: 'center',
            borderRadiusTopLeft: 16,
            borderRadiusTopRight: 16,
            borderRadiusBottomRight: 16,
            borderRadiusBottomLeft: 16,
          },
        ),
      ]),
      section(
        {
          bgColor: '#13131a',
          paddingTop: 56,
          paddingBottom: 24,
          paddingLeft: 40,
          paddingRight: 40,
          borderRadiusTopLeft: 24,
          borderRadiusTopRight: 24,
        },
        [
          heading('Built for the way you work now.', {
            level: 2,
            fontSize: 28,
            color: '#ffffff',
            lineHeight: 1.25,
            marginBottom: 16,
          }),
          text(
            'Everything you’d expect. Nothing you wouldn’t. A small set of remarkable details, refined for two years until they felt obvious.',
            { color: '#a1a1aa', fontSize: 16, marginBottom: 0 },
          ),
        ],
      ),
      section(
        {
          bgColor: '#13131a',
          paddingTop: 32,
          paddingBottom: 32,
          paddingLeft: 40,
          paddingRight: 40,
        },
        [
          divider({ color: '#262633', marginTop: 0, marginBottom: 24 }),
          heading('60% faster startup', {
            level: 3,
            fontSize: 18,
            color: '#a78bfa',
            marginBottom: 6,
          }),
          text('Cold boot in under a second. Hot boot is instant.', {
            color: '#a1a1aa',
            marginBottom: 24,
          }),
          divider({ color: '#262633', marginTop: 0, marginBottom: 24 }),
          heading('Half the memory', {
            level: 3,
            fontSize: 18,
            color: '#a78bfa',
            marginBottom: 6,
          }),
          text('Open everything you want. We re-wrote the engine to never blink.', {
            color: '#a1a1aa',
            marginBottom: 24,
          }),
          divider({ color: '#262633', marginTop: 0, marginBottom: 24 }),
          heading('One clean keyboard layer', {
            level: 3,
            fontSize: 18,
            color: '#a78bfa',
            marginBottom: 6,
          }),
          text('Every shortcut you actually use, none of the ones you don’t.', {
            color: '#a1a1aa',
            marginBottom: 0,
          }),
        ],
      ),
      section(
        {
          bgColor: '#13131a',
          paddingTop: 8,
          paddingBottom: 56,
          paddingLeft: 40,
          paddingRight: 40,
          borderRadiusBottomRight: 24,
          borderRadiusBottomLeft: 24,
          align: 'center',
        },
        [
          spacer(16),
          button('Start your free trial', 'https://example.com/atlas/trial', {
            bgColor: 'transparent',
            textColor: '#a78bfa',
            borderColor: '#a78bfa',
            borderWidth: 1,
            fontSize: 14,
            fontWeight: 600,
            paddingTop: 14,
            paddingBottom: 14,
            paddingLeft: 28,
            paddingRight: 28,
            borderRadiusTopLeft: 10,
            borderRadiusTopRight: 10,
            borderRadiusBottomRight: 10,
            borderRadiusBottomLeft: 10,
            align: 'center',
          }),
        ],
      ),
      section(
        {
          paddingTop: 32,
          paddingBottom: 32,
          paddingLeft: 40,
          paddingRight: 40,
          align: 'center',
        },
        [
          social(
            [
              { platform: 'twitter', url: 'https://twitter.com' },
              { platform: 'youtube', url: 'https://youtube.com' },
              { platform: 'linkedin', url: 'https://linkedin.com' },
            ],
            { iconSize: 22, spacing: 14, align: 'center', variant: 'mono-light' },
          ),
          spacer(12),
          text('© Atlas Inc.  ·  {{location.address}}', {
            color: '#52525b',
            fontSize: 11,
            align: 'center',
            marginBottom: 0,
          }),
        ],
      ),
    ],
  };
}

/** 5. Flash Sale — bright e-commerce promo */
function flashSale(): EmailTemplate {
  return {
    version: '2',
    subject: '⚡ 48 hours only — 30% off everything',
    preheader: 'No code needed. Ends Sunday at midnight.',
    settings: {
      bodyBg: '#fff1f2',
      contentBg: '#ffffff',
      contentWidth: 600,
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif',
      textColor: '#1f1f1f',
    },
    blocks: [
      section(
        {
          bgColor: '#e11d48',
          paddingTop: 12,
          paddingBottom: 12,
          paddingLeft: 40,
          paddingRight: 40,
          align: 'center',
        },
        [
          text('FREE SHIPPING ON ORDERS OVER $75  ·  ENDS SUNDAY', {
            color: '#ffffff',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '2px',
            textTransform: 'uppercase',
            align: 'center',
            marginBottom: 0,
          }),
        ],
      ),
      section({ paddingTop: 24, paddingBottom: 0, paddingLeft: 40, paddingRight: 40 }, [
        logo(PLACEHOLDER_LOGO, { width: 120, align: 'center' }),
      ]),
      section(
        {
          paddingTop: 40,
          paddingBottom: 16,
          paddingLeft: 40,
          paddingRight: 40,
          align: 'center',
        },
        [
          text('FLASH SALE', {
            color: '#e11d48',
            fontSize: 14,
            fontWeight: 800,
            letterSpacing: '6px',
            textTransform: 'uppercase',
            align: 'center',
            marginBottom: 16,
          }),
          heading('30% OFF\nEVERYTHING.', {
            level: 1,
            fontSize: 64,
            fontWeight: 900,
            color: '#1f1f1f',
            lineHeight: 0.95,
            letterSpacing: '-2px',
            align: 'center',
            marginBottom: 16,
          }),
          text('48 hours only. No code needed — discount applied at checkout.', {
            color: '#525252',
            fontSize: 16,
            align: 'center',
            marginBottom: 28,
          }),
          button('SHOP THE SALE', 'https://example.com/sale', {
            bgColor: '#e11d48',
            textColor: '#ffffff',
            fontSize: 15,
            fontWeight: 800,
            letterSpacing: '2px',
            textTransform: 'uppercase',
            paddingTop: 18,
            paddingBottom: 18,
            paddingLeft: 44,
            paddingRight: 44,
            borderRadiusTopLeft: 4,
            borderRadiusTopRight: 4,
            borderRadiusBottomRight: 4,
            borderRadiusBottomLeft: 4,
            align: 'center',
          }),
        ],
      ),
      section({ paddingTop: 48, paddingBottom: 16, paddingLeft: 40, paddingRight: 40 }, [
        heading('Best sellers, now 30% off', {
          level: 2,
          fontSize: 22,
          color: '#1f1f1f',
          align: 'center',
          marginBottom: 24,
        }),
      ]),
      section({ paddingTop: 0, paddingBottom: 16, paddingLeft: 40, paddingRight: 40 }, [
        image(
          'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=1200&q=80&auto=format&fit=crop',
          {
            alt: 'Best seller',
            align: 'center',
            borderRadiusTopLeft: 12,
            borderRadiusTopRight: 12,
            borderRadiusBottomRight: 12,
            borderRadiusBottomLeft: 12,
          },
        ),
        spacer(12),
        heading('The Court Sneaker', {
          level: 3,
          fontSize: 18,
          color: '#1f1f1f',
          align: 'center',
          marginBottom: 4,
        }),
        text(
          '<span style="text-decoration:line-through;color:#a3a3a3;">$140</span>  &nbsp; <span style="color:#e11d48;font-weight:700;">$98</span>',
          { allowHtml: true, fontSize: 16, align: 'center', marginBottom: 0 },
        ),
      ]),
      section({ paddingTop: 32, paddingBottom: 16, paddingLeft: 40, paddingRight: 40 }, [
        image(
          'https://images.unsplash.com/photo-1556906781-9a412961c28c?w=1200&q=80&auto=format&fit=crop',
          {
            alt: 'Best seller',
            align: 'center',
            borderRadiusTopLeft: 12,
            borderRadiusTopRight: 12,
            borderRadiusBottomRight: 12,
            borderRadiusBottomLeft: 12,
          },
        ),
        spacer(12),
        heading('The Everyday Tote', {
          level: 3,
          fontSize: 18,
          color: '#1f1f1f',
          align: 'center',
          marginBottom: 4,
        }),
        text(
          '<span style="text-decoration:line-through;color:#a3a3a3;">$90</span>  &nbsp; <span style="color:#e11d48;font-weight:700;">$63</span>',
          { allowHtml: true, fontSize: 16, align: 'center', marginBottom: 0 },
        ),
      ]),
      section(
        { paddingTop: 40, paddingBottom: 56, paddingLeft: 40, paddingRight: 40, align: 'center' },
        [
          button('SHOP ALL ON SALE', 'https://example.com/sale', {
            bgColor: '#1f1f1f',
            textColor: '#ffffff',
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '2px',
            textTransform: 'uppercase',
            paddingTop: 16,
            paddingBottom: 16,
            paddingLeft: 36,
            paddingRight: 36,
            borderRadiusTopLeft: 4,
            borderRadiusTopRight: 4,
            borderRadiusBottomRight: 4,
            borderRadiusBottomLeft: 4,
            align: 'center',
          }),
        ],
      ),
      section(
        {
          bgColor: '#1f1f1f',
          paddingTop: 32,
          paddingBottom: 32,
          paddingLeft: 40,
          paddingRight: 40,
          align: 'center',
        },
        [
          social(
            [
              { platform: 'instagram', url: 'https://instagram.com' },
              { platform: 'tiktok', url: 'https://tiktok.com' },
              { platform: 'facebook', url: 'https://facebook.com' },
            ],
            { iconSize: 24, spacing: 14, align: 'center', variant: 'mono-light' },
          ),
          spacer(12),
          text('© {{location.name}}  ·  {{location.address}}', {
            color: '#a3a3a3',
            fontSize: 11,
            align: 'center',
            marginBottom: 0,
          }),
        ],
      ),
    ],
  };
}

/** 6. Event Invitation — elegant cream + gold serif */
function eventElegant(): EmailTemplate {
  return {
    version: '2',
    subject: 'You’re invited — Summer 2026',
    preheader: 'Save the date: Friday, June 14. Details inside.',
    settings: {
      bodyBg: '#f3eee5',
      contentBg: '#f8f3ea',
      contentWidth: 600,
      fontFamily: '"Cormorant Garamond", "Georgia", "Times New Roman", serif',
      textColor: '#3b2f1e',
    },
    blocks: [
      section(
        { paddingTop: 56, paddingBottom: 24, paddingLeft: 56, paddingRight: 56, align: 'center' },
        [
          text('THE PLEASURE OF YOUR COMPANY IS REQUESTED', {
            color: '#a08243',
            fontSize: 11,
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            fontWeight: 600,
            letterSpacing: '3px',
            textTransform: 'uppercase',
            align: 'center',
            marginBottom: 24,
          }),
          divider({
            color: '#a08243',
            thickness: 1,
            width: '60px',
            align: 'center',
            marginTop: 0,
            marginBottom: 32,
          }),
          heading('Summer\nin Bloom', {
            level: 1,
            fontSize: 64,
            fontWeight: 400,
            color: '#3b2f1e',
            lineHeight: 1,
            letterSpacing: '-1px',
            align: 'center',
            marginBottom: 24,
          }),
          text('— an evening of music, light fare, and good people —', {
            color: '#7a6448',
            fontSize: 18,
            align: 'center',
            marginBottom: 32,
          }),
          divider({
            color: '#a08243',
            thickness: 1,
            width: '60px',
            align: 'center',
            marginTop: 0,
            marginBottom: 32,
          }),
        ],
      ),
      section({ paddingTop: 0, paddingBottom: 32, paddingLeft: 56, paddingRight: 56 }, [
        image(
          'https://images.unsplash.com/photo-1519671482749-fd09be7ccebf?w=1200&q=80&auto=format&fit=crop',
          {
            alt: 'Garden gathering',
            align: 'center',
            borderRadiusTopLeft: 4,
            borderRadiusTopRight: 4,
            borderRadiusBottomRight: 4,
            borderRadiusBottomLeft: 4,
          },
        ),
      ]),
      section(
        { paddingTop: 16, paddingBottom: 16, paddingLeft: 56, paddingRight: 56, align: 'center' },
        [
          text('FRIDAY', {
            color: '#a08243',
            fontSize: 12,
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            fontWeight: 600,
            letterSpacing: '3px',
            align: 'center',
            marginBottom: 8,
          }),
          heading('the fourteenth of June\ntwo thousand twenty-six', {
            level: 2,
            fontSize: 26,
            fontWeight: 400,
            fontStyle: 'italic',
            color: '#3b2f1e',
            lineHeight: 1.3,
            align: 'center',
            marginBottom: 24,
          }),
          divider({
            color: '#d6c8ab',
            thickness: 1,
            width: '40px',
            align: 'center',
            marginTop: 0,
            marginBottom: 24,
          }),
          text('AT SEVEN O’CLOCK IN THE EVENING', {
            color: '#a08243',
            fontSize: 12,
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            fontWeight: 600,
            letterSpacing: '3px',
            align: 'center',
            marginBottom: 8,
          }),
          heading('The Garden Room\nat the Hayes', {
            level: 3,
            fontSize: 22,
            fontWeight: 400,
            fontStyle: 'italic',
            color: '#3b2f1e',
            lineHeight: 1.3,
            align: 'center',
            marginBottom: 8,
          }),
          text('421 Mulberry Lane  ·  San Francisco', {
            color: '#7a6448',
            fontSize: 16,
            align: 'center',
            marginBottom: 0,
          }),
        ],
      ),
      section(
        { paddingTop: 40, paddingBottom: 48, paddingLeft: 56, paddingRight: 56, align: 'center' },
        [
          button('RSVP', 'https://example.com/rsvp', {
            bgColor: '#3b2f1e',
            textColor: '#f8f3ea',
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '4px',
            textTransform: 'uppercase',
            paddingTop: 18,
            paddingBottom: 18,
            paddingLeft: 56,
            paddingRight: 56,
            borderRadiusTopLeft: 0,
            borderRadiusTopRight: 0,
            borderRadiusBottomRight: 0,
            borderRadiusBottomLeft: 0,
            align: 'center',
          }),
          spacer(16),
          text('Kindly respond by Friday, June 7th.', {
            color: '#7a6448',
            fontSize: 14,
            fontStyle: 'italic',
            align: 'center',
            marginBottom: 0,
          }),
        ],
      ),
      section(
        {
          paddingTop: 24,
          paddingBottom: 32,
          paddingLeft: 56,
          paddingRight: 56,
          align: 'center',
        },
        [
          divider({
            color: '#d6c8ab',
            thickness: 1,
            width: '40px',
            align: 'center',
            marginTop: 0,
            marginBottom: 16,
          }),
          text('{{location.name}}', {
            color: '#a08243',
            fontSize: 12,
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            fontWeight: 600,
            letterSpacing: '3px',
            textTransform: 'uppercase',
            align: 'center',
            marginBottom: 0,
          }),
        ],
      ),
    ],
  };
}

/** 7. Re-engagement / Winback — warm and personal */
function winbackWarm(): EmailTemplate {
  return {
    version: '2',
    subject: 'We miss seeing you around.',
    preheader: 'Come back for 20% off — and a small thank you.',
    settings: {
      bodyBg: '#fdf6f0',
      contentBg: '#ffffff',
      contentWidth: 600,
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif',
      textColor: '#1f1f1f',
    },
    blocks: [
      section({ paddingTop: 32, paddingBottom: 0, paddingLeft: 40, paddingRight: 40 }, [
        logo(PLACEHOLDER_LOGO, { width: 110, align: 'center' }),
      ]),
      section({ paddingTop: 24, paddingBottom: 0, paddingLeft: 40, paddingRight: 40 }, [
        image(
          'https://images.unsplash.com/photo-1493612276216-ee3925520721?w=1200&q=80&auto=format&fit=crop',
          {
            alt: 'A warm window',
            align: 'center',
            borderRadiusTopLeft: 16,
            borderRadiusTopRight: 16,
            borderRadiusBottomRight: 16,
            borderRadiusBottomLeft: 16,
          },
        ),
      ]),
      section(
        { paddingTop: 40, paddingBottom: 8, paddingLeft: 40, paddingRight: 40, align: 'center' },
        [
          heading('Hi {{contact.first_name}},\nwe’ve missed you.', {
            level: 1,
            fontSize: 36,
            fontWeight: 700,
            color: '#1f1f1f',
            lineHeight: 1.15,
            align: 'center',
            marginBottom: 20,
          }),
          text(
            'It has been a while since we last saw you, and we wanted to reach out the way a friend would — just to say hi.',
            { color: '#52525b', fontSize: 16, lineHeight: 1.7, align: 'center', marginBottom: 16 },
          ),
          text(
            'If anything in your inbox has been getting in the way, just hit reply. We read every one.',
            { color: '#52525b', fontSize: 16, lineHeight: 1.7, align: 'center', marginBottom: 0 },
          ),
        ],
      ),
      section({ paddingTop: 40, paddingBottom: 8, paddingLeft: 40, paddingRight: 40 }, [
        divider({ color: '#fde6d3', thickness: 1, marginTop: 0, marginBottom: 24 }),
      ]),
      section(
        {
          bgColor: '#fdf6f0',
          paddingTop: 40,
          paddingBottom: 40,
          paddingLeft: 40,
          paddingRight: 40,
          borderRadiusTopLeft: 20,
          borderRadiusTopRight: 20,
          borderRadiusBottomRight: 20,
          borderRadiusBottomLeft: 20,
          align: 'center',
        },
        [
          text('A SMALL THANK YOU', {
            color: '#c2410c',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '3px',
            textTransform: 'uppercase',
            align: 'center',
            marginBottom: 12,
          }),
          heading('20% off, on us.', {
            level: 2,
            fontSize: 28,
            fontWeight: 700,
            color: '#1f1f1f',
            align: 'center',
            marginBottom: 12,
          }),
          text('Use the code below at checkout. Good for the next 30 days.', {
            color: '#52525b',
            fontSize: 15,
            align: 'center',
            marginBottom: 24,
          }),
          text(
            '<span style="display:inline-block;border:2px dashed #c2410c;padding:14px 28px;font-family:monospace;font-size:18px;letter-spacing:3px;font-weight:700;color:#c2410c;border-radius:6px;">WELCOMEBACK20</span>',
            { allowHtml: true, align: 'center', marginBottom: 24 },
          ),
          button('Come back & shop', 'https://example.com/welcome-back', {
            bgColor: '#c2410c',
            textColor: '#ffffff',
            fontSize: 15,
            fontWeight: 600,
            paddingTop: 16,
            paddingBottom: 16,
            paddingLeft: 36,
            paddingRight: 36,
            borderRadiusTopLeft: 999,
            borderRadiusTopRight: 999,
            borderRadiusBottomRight: 999,
            borderRadiusBottomLeft: 999,
            align: 'center',
          }),
        ],
      ),
      section(
        { paddingTop: 40, paddingBottom: 8, paddingLeft: 40, paddingRight: 40, align: 'center' },
        [
          text('— from all of us at {{location.name}}', {
            color: '#78716c',
            fontSize: 14,
            fontStyle: 'italic',
            align: 'center',
            marginBottom: 0,
          }),
        ],
      ),
      section(
        {
          paddingTop: 32,
          paddingBottom: 32,
          paddingLeft: 40,
          paddingRight: 40,
          align: 'center',
        },
        [
          text(
            '<a href="{{unsubscribe_url}}" style="color:#a8a29e;text-decoration:underline;font-size:11px;">No longer interested? Unsubscribe here.</a>',
            { allowHtml: true, align: 'center', marginBottom: 0 },
          ),
        ],
      ),
    ],
  };
}

/** 8. Loyalty Program — premium navy + gold */
function loyaltyPremium(): EmailTemplate {
  return {
    version: '2',
    subject: 'You’ve earned Gold status.',
    preheader: 'New perks unlocked. A look at what comes next.',
    settings: {
      bodyBg: '#0f172a',
      contentBg: '#0f172a',
      contentWidth: 600,
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif',
      textColor: '#e2e8f0',
    },
    blocks: [
      section(
        { paddingTop: 36, paddingBottom: 16, paddingLeft: 40, paddingRight: 40, align: 'center' },
        [
          logo('https://placehold.co/140x36/0f172a/d4af37?text=MEMBERS', {
            width: 130,
            align: 'center',
          }),
        ],
      ),
      section(
        {
          paddingTop: 48,
          paddingBottom: 48,
          paddingLeft: 40,
          paddingRight: 40,
          align: 'center',
        },
        [
          text('CONGRATULATIONS, {{contact.first_name | upper}}', {
            color: '#d4af37',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '4px',
            textTransform: 'uppercase',
            align: 'center',
            marginBottom: 24,
          }),
          heading('GOLD', {
            level: 1,
            fontSize: 84,
            fontWeight: 800,
            color: '#d4af37',
            letterSpacing: '4px',
            lineHeight: 1,
            align: 'center',
            marginBottom: 12,
          }),
          text('STATUS · UNLOCKED', {
            color: '#94a3b8',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '6px',
            align: 'center',
            marginBottom: 32,
          }),
          divider({
            color: '#d4af37',
            thickness: 1,
            width: '60px',
            align: 'center',
            marginTop: 0,
            marginBottom: 32,
          }),
          text(
            'It’s our way of saying thank you for the past year of being a part of this. The perks below are yours, starting today.',
            { color: '#cbd5e1', fontSize: 16, lineHeight: 1.7, align: 'center', marginBottom: 0 },
          ),
        ],
      ),
      section(
        {
          bgColor: '#1e293b',
          paddingTop: 40,
          paddingBottom: 40,
          paddingLeft: 40,
          paddingRight: 40,
          borderRadiusTopLeft: 20,
          borderRadiusTopRight: 20,
          borderRadiusBottomRight: 20,
          borderRadiusBottomLeft: 20,
        },
        [
          heading('Your new perks', {
            level: 2,
            fontSize: 22,
            color: '#ffffff',
            marginBottom: 24,
          }),
          heading('Complimentary express shipping', {
            level: 3,
            fontSize: 16,
            color: '#d4af37',
            marginBottom: 6,
          }),
          text('On every order, with no minimum.', { color: '#94a3b8', marginBottom: 20 }),
          divider({ color: '#334155', marginTop: 0, marginBottom: 20 }),
          heading('Early access to new releases', {
            level: 3,
            fontSize: 16,
            color: '#d4af37',
            marginBottom: 6,
          }),
          text('Forty-eight hours before everyone else.', {
            color: '#94a3b8',
            marginBottom: 20,
          }),
          divider({ color: '#334155', marginTop: 0, marginBottom: 20 }),
          heading('A dedicated concierge', {
            level: 3,
            fontSize: 16,
            color: '#d4af37',
            marginBottom: 6,
          }),
          text('A real person, one email or call away. We’ll introduce you below.', {
            color: '#94a3b8',
            marginBottom: 20,
          }),
          divider({ color: '#334155', marginTop: 0, marginBottom: 20 }),
          heading('Two members-only events a year', {
            level: 3,
            fontSize: 16,
            color: '#d4af37',
            marginBottom: 6,
          }),
          text('Quiet evenings with the team. First one is in September.', {
            color: '#94a3b8',
            marginBottom: 0,
          }),
        ],
      ),
      section(
        { paddingTop: 40, paddingBottom: 40, paddingLeft: 40, paddingRight: 40, align: 'center' },
        [
          button('See all benefits', 'https://example.com/loyalty', {
            bgColor: '#d4af37',
            textColor: '#0f172a',
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '2px',
            textTransform: 'uppercase',
            paddingTop: 16,
            paddingBottom: 16,
            paddingLeft: 36,
            paddingRight: 36,
            borderRadiusTopLeft: 0,
            borderRadiusTopRight: 0,
            borderRadiusBottomRight: 0,
            borderRadiusBottomLeft: 0,
            align: 'center',
          }),
        ],
      ),
      section(
        {
          paddingTop: 24,
          paddingBottom: 40,
          paddingLeft: 40,
          paddingRight: 40,
          align: 'center',
        },
        [
          divider({
            color: '#1e293b',
            thickness: 1,
            width: '100%',
            marginTop: 0,
            marginBottom: 16,
          }),
          text('{{location.name}}  ·  Members since {{contact.created_year}}', {
            color: '#475569',
            fontSize: 11,
            letterSpacing: '2px',
            textTransform: 'uppercase',
            align: 'center',
            marginBottom: 0,
          }),
        ],
      ),
    ],
  };
}

/** 9. Holiday Greeting — warm seasonal */
function holidaySeasonal(): EmailTemplate {
  return {
    version: '2',
    subject: 'Warm wishes from all of us.',
    preheader: 'A short note, and a small gift to close out the year.',
    settings: {
      bodyBg: '#1c1917',
      contentBg: '#fff8ec',
      contentWidth: 600,
      fontFamily: '"Georgia", "Times New Roman", serif',
      textColor: '#3f2d1f',
    },
    blocks: [
      section({ paddingTop: 32, paddingBottom: 0, paddingLeft: 40, paddingRight: 40 }, [
        logo(PLACEHOLDER_LOGO, { width: 110, align: 'center' }),
      ]),
      section({ paddingTop: 32, paddingBottom: 0, paddingLeft: 40, paddingRight: 40 }, [
        image(
          'https://images.unsplash.com/photo-1543589077-47d81606c1bf?w=1200&q=80&auto=format&fit=crop',
          {
            alt: 'Holiday wreath',
            align: 'center',
            borderRadiusTopLeft: 4,
            borderRadiusTopRight: 4,
            borderRadiusBottomRight: 4,
            borderRadiusBottomLeft: 4,
          },
        ),
      ]),
      section(
        { paddingTop: 40, paddingBottom: 8, paddingLeft: 56, paddingRight: 56, align: 'center' },
        [
          text('FROM OUR FAMILY TO YOURS', {
            color: '#b45309',
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '3px',
            textTransform: 'uppercase',
            align: 'center',
            marginBottom: 16,
          }),
          heading('Happy\nHolidays.', {
            level: 1,
            fontSize: 56,
            fontWeight: 400,
            fontStyle: 'italic',
            color: '#3f2d1f',
            lineHeight: 1,
            align: 'center',
            marginBottom: 24,
          }),
          divider({
            color: '#d97706',
            thickness: 1,
            width: '60px',
            align: 'center',
            marginTop: 0,
            marginBottom: 24,
          }),
          text(
            'Whatever this season looks like for you — quiet, loud, near to family, far from it — we hope you find a small handful of moments worth keeping.',
            { color: '#5b4434', fontSize: 17, lineHeight: 1.75, align: 'center', marginBottom: 16 },
          ),
          text(
            'Thank you for being part of our year. We don’t take it for granted, and we’re very glad you’re here.',
            { color: '#5b4434', fontSize: 17, lineHeight: 1.75, align: 'center', marginBottom: 24 },
          ),
          text('— The team at {{location.name}}', {
            color: '#7c6651',
            fontSize: 16,
            fontStyle: 'italic',
            align: 'center',
            marginBottom: 0,
          }),
        ],
      ),
      section(
        {
          bgColor: '#fef3e6',
          paddingTop: 40,
          paddingBottom: 40,
          paddingLeft: 40,
          paddingRight: 40,
          align: 'center',
        },
        [
          text('OUR LITTLE GIFT TO YOU', {
            color: '#b45309',
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '3px',
            textTransform: 'uppercase',
            align: 'center',
            marginBottom: 12,
          }),
          heading('25% off, through the new year.', {
            level: 2,
            fontSize: 24,
            fontWeight: 400,
            color: '#3f2d1f',
            align: 'center',
            marginBottom: 20,
          }),
          text(
            '<span style="display:inline-block;border:1px solid #b45309;padding:14px 28px;font-family:monospace;font-size:18px;letter-spacing:3px;font-weight:700;color:#b45309;background:#ffffff;">HOLIDAY25</span>',
            { allowHtml: true, align: 'center', marginBottom: 24 },
          ),
          button('Browse the shop', 'https://example.com/holiday', {
            bgColor: '#3f2d1f',
            textColor: '#fff8ec',
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: '2px',
            textTransform: 'uppercase',
            paddingTop: 16,
            paddingBottom: 16,
            paddingLeft: 36,
            paddingRight: 36,
            borderRadiusTopLeft: 0,
            borderRadiusTopRight: 0,
            borderRadiusBottomRight: 0,
            borderRadiusBottomLeft: 0,
            align: 'center',
          }),
        ],
      ),
      section(
        { paddingTop: 32, paddingBottom: 40, paddingLeft: 40, paddingRight: 40, align: 'center' },
        [
          social(
            [
              { platform: 'instagram', url: 'https://instagram.com' },
              { platform: 'facebook', url: 'https://facebook.com' },
            ],
            { iconSize: 24, spacing: 16, align: 'center', variant: 'mono-dark' },
          ),
          spacer(12),
          text('© {{location.name}}  ·  {{location.address}}', {
            color: '#a8907a',
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            fontSize: 11,
            align: 'center',
            marginBottom: 0,
          }),
        ],
      ),
    ],
  };
}

/** 10. Service Reminder — clean automotive */
function serviceReminderAuto(): EmailTemplate {
  return {
    version: '2',
    subject: 'Time for your next service, {{contact.first_name}}',
    preheader: 'Book online in under a minute — and we’ll bring the loaner.',
    settings: {
      bodyBg: '#f5f5f5',
      contentBg: '#ffffff',
      contentWidth: 600,
      fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      textColor: '#1a1a1a',
    },
    blocks: [
      section({ paddingTop: 32, paddingBottom: 24, paddingLeft: 40, paddingRight: 40 }, [
        logo(PLACEHOLDER_LOGO, { width: 110, align: 'left' }),
      ]),
      section({ paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 }, [
        image(
          'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1200&q=80&auto=format&fit=crop',
          { alt: 'Vehicle service', align: 'center' },
        ),
      ]),
      section({ paddingTop: 48, paddingBottom: 16, paddingLeft: 40, paddingRight: 40 }, [
        text('SERVICE DUE', {
          color: '#737373',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '3px',
          textTransform: 'uppercase',
          marginBottom: 16,
        }),
        heading('Your {{vehicle.year}} {{vehicle.make}}\nis ready for its next visit.', {
          level: 1,
          fontSize: 32,
          fontWeight: 700,
          color: '#1a1a1a',
          lineHeight: 1.2,
          marginBottom: 16,
        }),
        text(
          'Based on your last visit, you’re right around the recommended interval. We’ll keep it quick — and you’re welcome to the loaner if you’d like one.',
          { color: '#525252', fontSize: 16, lineHeight: 1.65, marginBottom: 32 },
        ),
        button('Book Online', 'https://example.com/service', {
          bgColor: '#1a1a1a',
          textColor: '#ffffff',
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: '1px',
          textTransform: 'uppercase',
          paddingTop: 16,
          paddingBottom: 16,
          paddingLeft: 36,
          paddingRight: 36,
          borderRadiusTopLeft: 2,
          borderRadiusTopRight: 2,
          borderRadiusBottomRight: 2,
          borderRadiusBottomLeft: 2,
          align: 'left',
        }),
      ]),
      section({ paddingTop: 48, paddingBottom: 16, paddingLeft: 40, paddingRight: 40 }, [
        divider({ color: '#e5e5e5', marginTop: 0, marginBottom: 32 }),
        heading('What we’ll do', {
          level: 2,
          fontSize: 20,
          color: '#1a1a1a',
          marginBottom: 24,
        }),
      ]),
      section({ paddingTop: 0, paddingBottom: 16, paddingLeft: 40, paddingRight: 40 }, [
        heading('Full multi-point inspection', {
          level: 3,
          fontSize: 16,
          color: '#1a1a1a',
          marginBottom: 4,
        }),
        text(
          'Brakes, tires, fluids, suspension, lights, battery. A photo report sent to your phone before any work is done.',
          { color: '#737373', fontSize: 14, marginBottom: 20 },
        ),
        divider({ color: '#f5f5f5', marginTop: 0, marginBottom: 20 }),
        heading('Oil + filter service', {
          level: 3,
          fontSize: 16,
          color: '#1a1a1a',
          marginBottom: 4,
        }),
        text('Manufacturer-spec synthetic and a new filter.', {
          color: '#737373',
          fontSize: 14,
          marginBottom: 20,
        }),
        divider({ color: '#f5f5f5', marginTop: 0, marginBottom: 20 }),
        heading('Hand-washed before pickup', {
          level: 3,
          fontSize: 16,
          color: '#1a1a1a',
          marginBottom: 4,
        }),
        text('No fee. We just like returning the car nicer than we got it.', {
          color: '#737373',
          fontSize: 14,
          marginBottom: 0,
        }),
      ]),
      section(
        {
          bgColor: '#fafafa',
          paddingTop: 32,
          paddingBottom: 32,
          paddingLeft: 40,
          paddingRight: 40,
        },
        [
          heading('Need a loaner?', {
            level: 3,
            fontSize: 16,
            color: '#1a1a1a',
            marginBottom: 8,
          }),
          text(
            'Just ask when you book. We keep a few set aside for service guests every day.',
            { color: '#525252', fontSize: 14, marginBottom: 16 },
          ),
          text(
            '<a href="tel:+15555551212" style="color:#1a1a1a;font-weight:600;text-decoration:none;border-bottom:1px solid #1a1a1a;">Or call us at (555) 555-1212</a>',
            { allowHtml: true, fontSize: 14, marginBottom: 0 },
          ),
        ],
      ),
      section(
        {
          paddingTop: 32,
          paddingBottom: 32,
          paddingLeft: 40,
          paddingRight: 40,
          align: 'center',
        },
        [
          text('{{location.name}}  ·  {{location.phone}}', {
            color: '#a3a3a3',
            fontSize: 11,
            letterSpacing: '2px',
            textTransform: 'uppercase',
            align: 'center',
            marginBottom: 8,
          }),
          text('{{location.address}}', {
            color: '#a3a3a3',
            fontSize: 11,
            align: 'center',
            marginBottom: 0,
          }),
        ],
      ),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────
// HTML templates
// ─────────────────────────────────────────────────────────────────────

const HTML_PERSONAL_LETTER = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>A note from us</title>
</head>
<body style="margin:0; padding:0; background-color:#ffffff; font-family: 'Charter','Georgia',serif;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
    A short note — and a small ask.
    &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847;
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%; border-collapse:collapse; background-color:#ffffff;">
    <tr>
      <td align="center" style="padding:64px 24px 80px;">

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:100%; max-width:560px;">

          <tr>
            <td style="padding:0 0 40px; font-family:'Charter','Georgia',serif; font-size:17px; line-height:1.7; color:#1a1a1a;">
              Hi {{contact.first_name}},
            </td>
          </tr>

          <tr>
            <td style="padding:0 0 24px; font-family:'Charter','Georgia',serif; font-size:17px; line-height:1.7; color:#1a1a1a;">
              I’m writing this from my desk at the back of the shop — the one that catches the late afternoon light, which is the only reason I picked it.
            </td>
          </tr>

          <tr>
            <td style="padding:0 0 24px; font-family:'Charter','Georgia',serif; font-size:17px; line-height:1.7; color:#1a1a1a;">
              I wanted to send a quick note to say <em>thank you</em>. It has been a year of small, quiet decisions, and at the heart of most of them was a feeling that whatever we made, you’d be the one to use it. That made the decisions easier than they had any right to be.
            </td>
          </tr>

          <tr>
            <td style="padding:0 0 24px; font-family:'Charter','Georgia',serif; font-size:17px; line-height:1.7; color:#1a1a1a;">
              If you have a minute, I’d love to hear how it’s going. Not a survey. Just hit reply. Tell me one thing that worked and one thing that didn’t. I read every single one of them and I write back when I can.
            </td>
          </tr>

          <tr>
            <td style="padding:0 0 40px; font-family:'Charter','Georgia',serif; font-size:17px; line-height:1.7; color:#1a1a1a;">
              That’s the whole email. Take care of yourself out there.
            </td>
          </tr>

          <tr>
            <td style="padding:0 0 4px; font-family:'Charter','Georgia',serif; font-size:17px; line-height:1.7; color:#1a1a1a;">
              — Sam
            </td>
          </tr>
          <tr>
            <td style="padding:0; font-family:'Charter','Georgia',serif; font-size:14px; line-height:1.6; color:#737373; font-style:italic;">
              Founder, {{location.name}}
            </td>
          </tr>

          <tr>
            <td style="padding:64px 0 0;">
              <hr style="border:0; border-top:1px solid #e5e5e5; margin:0;">
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 0 0; font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif; font-size:11px; line-height:1.5; color:#a3a3a3; letter-spacing:1px; text-transform:uppercase;">
              {{location.name}} · {{location.address}}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 0 0; font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif; font-size:11px;">
              <a href="{{unsubscribe_url}}" style="color:#a3a3a3; text-decoration:underline;">Unsubscribe</a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

const HTML_DARK_SHOWCASE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark light">
  <meta name="supported-color-schemes" content="dark light">
  <title>Introducing the new Phantom</title>
  <style>
    @media only screen and (max-width: 480px) {
      .pad      { padding-left:24px !important; padding-right:24px !important; }
      .h1       { font-size: 38px !important; line-height: 42px !important; }
      .feat-col { display:block !important; width:100% !important; padding:0 0 24px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#000000; font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
    The new Phantom. Available today.
    &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847;
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#000000" style="width:100%; border-collapse:collapse; background-color:#000000;">
    <tr>
      <td align="center" style="padding:0;">

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="width:100%; max-width:640px;">

          <tr>
            <td class="pad" style="padding:32px 56px 24px;">
              <span style="font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif; font-size:12px; letter-spacing:4px; font-weight:700; color:#ffffff;">PHANTOM</span>
            </td>
          </tr>

          <tr>
            <td style="padding:0;">
              <img src="https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=1280&q=85&auto=format&fit=crop" width="640" alt="Phantom" style="display:block; width:100%; max-width:100%; height:auto; border:0;">
            </td>
          </tr>

          <tr>
            <td class="pad" align="center" style="padding:64px 56px 24px;">
              <p style="margin:0 0 16px; font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif; font-size:12px; font-weight:600; letter-spacing:3px; color:#a78bfa; text-transform:uppercase;">New · May 2026</p>
              <h1 class="h1" style="margin:0 0 16px; font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif; font-size:56px; line-height:60px; font-weight:800; letter-spacing:-2px; color:#ffffff;">
                Phantom.
              </h1>
              <p style="margin:0 0 32px; font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif; font-size:18px; line-height:28px; color:#a1a1aa;">
                Built quieter. Tuned darker. Made for the way you actually listen.
              </p>
              <a href="https://example.com/phantom" style="display:inline-block; background:#a78bfa; color:#0a0a0a; padding:16px 40px; font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size:14px; font-weight:700; letter-spacing:1px; text-decoration:none; border-radius:999px;">Shop Phantom →</a>
            </td>
          </tr>

          <tr>
            <td class="pad" style="padding:64px 56px 16px;">
              <hr style="border:0; border-top:1px solid #1a1a1a; margin:0 0 56px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td class="feat-col" valign="top" width="33%" style="padding-right:16px;">
                    <p style="margin:0 0 6px; font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size:12px; font-weight:700; letter-spacing:2px; color:#a78bfa; text-transform:uppercase;">01</p>
                    <p style="margin:0 0 8px; font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size:18px; font-weight:700; color:#ffffff;">38 hours</p>
                    <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size:14px; line-height:22px; color:#a1a1aa;">A full week of normal listening on a single charge.</p>
                  </td>
                  <td class="feat-col" valign="top" width="33%" style="padding-right:16px; padding-left:16px;">
                    <p style="margin:0 0 6px; font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size:12px; font-weight:700; letter-spacing:2px; color:#a78bfa; text-transform:uppercase;">02</p>
                    <p style="margin:0 0 8px; font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size:18px; font-weight:700; color:#ffffff;">Active dampening</p>
                    <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size:14px; line-height:22px; color:#a1a1aa;">The noise drops out without the music going with it.</p>
                  </td>
                  <td class="feat-col" valign="top" width="33%" style="padding-left:16px;">
                    <p style="margin:0 0 6px; font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size:12px; font-weight:700; letter-spacing:2px; color:#a78bfa; text-transform:uppercase;">03</p>
                    <p style="margin:0 0 8px; font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size:18px; font-weight:700; color:#ffffff;">Aluminum frame</p>
                    <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size:14px; line-height:22px; color:#a1a1aa;">Machined from a single block, finished by hand.</p>
                  </td>
                </tr>
              </table>
              <hr style="border:0; border-top:1px solid #1a1a1a; margin:56px 0 0;">
            </td>
          </tr>

          <tr>
            <td class="pad" align="center" style="padding:48px 56px 64px;">
              <p style="margin:0 0 16px; font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size:14px; color:#a1a1aa; line-height:22px;">
                Free engraving through May.<br>
                Free returns, always.
              </p>
              <a href="https://example.com/phantom" style="font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size:13px; font-weight:600; color:#a78bfa; text-decoration:none; letter-spacing:2px; text-transform:uppercase; border-bottom:1px solid #a78bfa; padding-bottom:2px;">Learn more</a>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:24px 56px 48px;">
              <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size:11px; color:#52525b; letter-spacing:1px;">
                © {{location.name}} · <a href="{{unsubscribe_url}}" style="color:#52525b; text-decoration:underline;">Unsubscribe</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

const HTML_ORDER_RECEIPT = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Order #{{order.number}} confirmed</title>
</head>
<body style="margin:0; padding:0; background-color:#f5f5f4; font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
    Your order is confirmed. Here’s the receipt.
    &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847;
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#f5f5f4" style="width:100%; border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%; max-width:600px;">

          <tr>
            <td align="center" style="padding:0 0 24px;">
              <img src="https://placehold.co/120x32/0a0a0a/ffffff?text=Your+Logo" width="120" alt="{{location.name}}" style="display:block; border:0; max-width:120px; height:auto;">
            </td>
          </tr>

          <tr>
            <td bgcolor="#ffffff" style="background-color:#ffffff; border-radius:12px; border:1px solid #e7e5e4;">

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
                <tr>
                  <td style="padding:32px 40px 8px;">
                    <p style="margin:0 0 8px; font-size:12px; font-weight:700; letter-spacing:2px; color:#16a34a; text-transform:uppercase;">Order Confirmed</p>
                    <h1 style="margin:0 0 8px; font-size:24px; line-height:30px; font-weight:700; color:#1c1917;">Thanks, {{contact.first_name}}.</h1>
                    <p style="margin:0; font-size:15px; line-height:22px; color:#57534e;">We’ve received your order and we’re putting it together now. You’ll get tracking the moment it ships.</p>
                  </td>
                </tr>

                <tr>
                  <td style="padding:24px 40px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="font-size:12px; font-weight:600; letter-spacing:1px; color:#a8a29e; text-transform:uppercase; padding:0 0 4px;">Order</td>
                        <td align="right" style="font-size:12px; font-weight:600; letter-spacing:1px; color:#a8a29e; text-transform:uppercase; padding:0 0 4px;">Placed</td>
                      </tr>
                      <tr>
                        <td style="font-size:14px; font-weight:700; color:#1c1917; padding:0 0 16px;">#{{order.number}}</td>
                        <td align="right" style="font-size:14px; font-weight:700; color:#1c1917; padding:0 0 16px;">{{order.date}}</td>
                      </tr>
                    </table>
                    <hr style="border:0; border-top:1px solid #f5f5f4; margin:0;">
                  </td>
                </tr>

                <tr>
                  <td style="padding:24px 40px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td valign="top" width="80" style="padding:0 16px 0 0;">
                          <img src="https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=200&q=80&auto=format&fit=crop" width="64" height="64" alt="" style="display:block; border-radius:8px; width:64px; height:64px; object-fit:cover;">
                        </td>
                        <td valign="top" style="padding:0 0 16px;">
                          <p style="margin:0 0 4px; font-size:15px; font-weight:600; color:#1c1917;">The Court Sneaker · White</p>
                          <p style="margin:0; font-size:13px; color:#78716c;">Size 10  ·  Qty 1</p>
                        </td>
                        <td valign="top" align="right" style="padding:0 0 16px;">
                          <p style="margin:0; font-size:15px; font-weight:600; color:#1c1917;">$98.00</p>
                        </td>
                      </tr>
                      <tr>
                        <td valign="top" width="80" style="padding:0 16px 0 0;">
                          <img src="https://images.unsplash.com/photo-1556906781-9a412961c28c?w=200&q=80&auto=format&fit=crop" width="64" height="64" alt="" style="display:block; border-radius:8px; width:64px; height:64px; object-fit:cover;">
                        </td>
                        <td valign="top" style="padding:0 0 16px;">
                          <p style="margin:0 0 4px; font-size:15px; font-weight:600; color:#1c1917;">The Everyday Tote · Olive</p>
                          <p style="margin:0; font-size:13px; color:#78716c;">Qty 1</p>
                        </td>
                        <td valign="top" align="right" style="padding:0 0 16px;">
                          <p style="margin:0; font-size:15px; font-weight:600; color:#1c1917;">$63.00</p>
                        </td>
                      </tr>
                    </table>
                    <hr style="border:0; border-top:1px solid #f5f5f4; margin:8px 0 0;">
                  </td>
                </tr>

                <tr>
                  <td style="padding:24px 40px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="font-size:14px; color:#57534e; padding:0 0 6px;">Subtotal</td>
                        <td align="right" style="font-size:14px; color:#1c1917; padding:0 0 6px;">$161.00</td>
                      </tr>
                      <tr>
                        <td style="font-size:14px; color:#57534e; padding:0 0 6px;">Shipping</td>
                        <td align="right" style="font-size:14px; color:#16a34a; padding:0 0 6px;">Free</td>
                      </tr>
                      <tr>
                        <td style="font-size:14px; color:#57534e; padding:0 0 16px;">Tax</td>
                        <td align="right" style="font-size:14px; color:#1c1917; padding:0 0 16px;">$13.69</td>
                      </tr>
                      <tr>
                        <td style="font-size:16px; font-weight:700; color:#1c1917; padding:8px 0 0; border-top:1px solid #f5f5f4;">Total</td>
                        <td align="right" style="font-size:16px; font-weight:700; color:#1c1917; padding:8px 0 0; border-top:1px solid #f5f5f4;">$174.69</td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td align="center" style="padding:32px 40px 32px;">
                    <a href="https://example.com/orders/{{order.number}}" style="display:inline-block; background:#1c1917; color:#ffffff; padding:14px 32px; font-size:14px; font-weight:600; text-decoration:none; border-radius:6px;">Track your order</a>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 40px 32px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#fafaf9" style="background:#fafaf9; border-radius:8px;">
                      <tr>
                        <td style="padding:20px 24px;">
                          <p style="margin:0 0 4px; font-size:12px; font-weight:700; letter-spacing:1px; color:#a8a29e; text-transform:uppercase;">Shipping to</p>
                          <p style="margin:0; font-size:14px; line-height:22px; color:#1c1917;">
                            {{contact.first_name}} {{contact.last_name}}<br>
                            {{contact.address1}}<br>
                            {{contact.city}}, {{contact.state}} {{contact.postal_code}}
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:24px 0 0; font-size:12px; color:#a8a29e;">
              Questions? <a href="mailto:hi@example.com" style="color:#57534e;">hi@example.com</a> · {{location.phone}}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 0 0; font-size:11px; color:#a8a29e;">
              {{location.name}} · {{location.address}}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

const HTML_MAGAZINE_EDITORIAL = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>The Issue · May 2026</title>
  <style>
    @media only screen and (max-width: 480px) {
      .pad     { padding-left:24px !important; padding-right:24px !important; }
      .display { font-size:48px !important; line-height:48px !important; }
      .col     { display:block !important; width:100% !important; padding:0 0 32px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#faf8f4; font-family:'Georgia','Times New Roman',serif;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
    The Issue, May 2026 — three things worth your slow attention.
    &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847;
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#faf8f4" style="width:100%; border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:0;">

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="680" style="width:100%; max-width:680px;">

          <tr>
            <td class="pad" style="padding:48px 64px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; letter-spacing:4px; text-transform:uppercase; color:#1c1917;">The Issue</td>
                  <td align="right" style="font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:11px; font-weight:600; letter-spacing:1px; color:#78716c;">No. 18 · May 2026</td>
                </tr>
              </table>
              <hr style="border:0; border-top:2px solid #1c1917; margin:16px 0 0;">
            </td>
          </tr>

          <tr>
            <td class="pad" style="padding:48px 64px 16px;">
              <p style="margin:0 0 16px; font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:11px; font-weight:600; letter-spacing:2px; text-transform:uppercase; color:#a8a29e;">Cover Story</p>
              <h1 class="display" style="margin:0 0 24px; font-family:'Playfair Display','Georgia',serif; font-size:64px; line-height:64px; font-weight:400; color:#1c1917; letter-spacing:-1px;">
                The quiet revolution of doing less.
              </h1>
              <p style="margin:0 0 16px; font-size:17px; line-height:30px; color:#44403c;">
                In a year defined by speed, the people who shipped the most also slept the most. We talked to ten of them about how they reorganized their weeks, what they stopped doing, and the spreadsheet one of them keeps of everything she said no to.
              </p>
              <p style="margin:0 0 32px; font-size:14px; font-style:italic; color:#78716c;">By Maya Quintero · 12 min read</p>
            </td>
          </tr>

          <tr>
            <td style="padding:0;">
              <img src="https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?w=1280&q=85&auto=format&fit=crop" width="680" alt="Quiet morning" style="display:block; width:100%; max-width:100%; height:auto;">
            </td>
          </tr>

          <tr>
            <td class="pad" align="center" style="padding:32px 64px 64px;">
              <a href="https://example.com/issue-18" style="font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:13px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:#1c1917; text-decoration:none; border-bottom:2px solid #1c1917; padding-bottom:4px;">Continue Reading →</a>
            </td>
          </tr>

          <tr>
            <td class="pad" style="padding:0 64px 64px;">
              <hr style="border:0; border-top:1px solid #e7e5e4; margin:0 0 56px;">
              <p style="margin:0 0 32px; font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#1c1917; text-align:center;">— Also in this issue —</p>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td class="col" valign="top" width="50%" style="padding-right:24px;">
                    <img src="https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=600&q=85&auto=format&fit=crop" alt="" style="display:block; width:100%; max-width:100%; height:auto; margin-bottom:16px;">
                    <p style="margin:0 0 8px; font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:11px; font-weight:600; letter-spacing:1px; text-transform:uppercase; color:#a8a29e;">Notes</p>
                    <h2 style="margin:0 0 8px; font-family:'Playfair Display','Georgia',serif; font-size:22px; line-height:26px; font-weight:400; color:#1c1917;">On reading something twice.</h2>
                    <p style="margin:0; font-size:15px; line-height:24px; color:#57534e;">A short essay on the books we keep going back to, and what they keep giving us.</p>
                  </td>
                  <td class="col" valign="top" width="50%" style="padding-left:24px;">
                    <img src="https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=600&q=85&auto=format&fit=crop" alt="" style="display:block; width:100%; max-width:100%; height:auto; margin-bottom:16px;">
                    <p style="margin:0 0 8px; font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:11px; font-weight:600; letter-spacing:1px; text-transform:uppercase; color:#a8a29e;">Interview</p>
                    <h2 style="margin:0 0 8px; font-family:'Playfair Display','Georgia',serif; font-size:22px; line-height:26px; font-weight:400; color:#1c1917;">A morning with a chef who quit.</h2>
                    <p style="margin:0; font-size:15px; line-height:24px; color:#57534e;">She closed her two-Michelin restaurant. What she does now is harder, and she’s never been happier.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td bgcolor="#1c1917" style="background:#1c1917; padding:48px 64px;">
              <p style="margin:0 0 8px; font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:11px; font-weight:600; letter-spacing:3px; text-transform:uppercase; color:#a8a29e;">The Issue</p>
              <p style="margin:0 0 16px; font-family:'Playfair Display','Georgia',serif; font-size:22px; line-height:28px; color:#faf8f4;">A monthly read from {{location.name}}.</p>
              <p style="margin:0; font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:13px; color:#78716c;">
                <a href="{{unsubscribe_url}}" style="color:#78716c; text-decoration:underline;">Unsubscribe</a> · <a href="https://example.com" style="color:#78716c; text-decoration:underline;">View in browser</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

const HTML_LUXURY_LISTING = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Listing · 1247 Bay View</title>
  <style>
    @media only screen and (max-width: 480px) {
      .pad   { padding-left:24px !important; padding-right:24px !important; }
      .stat  { display:block !important; width:100% !important; padding:8px 0 !important; border-right:0 !important; }
      .h1    { font-size:36px !important; line-height:40px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#f5f3ef; font-family:'Cormorant Garamond','Georgia',serif;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
    A new listing, presented privately first.
    &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847;
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#f5f3ef" style="width:100%; border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:32px 0;">

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" bgcolor="#ffffff" style="width:100%; max-width:640px; background:#ffffff;">

          <tr>
            <td class="pad" align="center" style="padding:32px 56px 24px;">
              <p style="margin:0; font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; letter-spacing:6px; color:#8a7853; text-transform:uppercase;">CRESCENT &amp; HALL</p>
            </td>
          </tr>

          <tr>
            <td style="padding:0;">
              <img src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1280&q=85&auto=format&fit=crop" width="640" alt="1247 Bay View" style="display:block; width:100%; max-width:100%; height:auto;">
            </td>
          </tr>

          <tr>
            <td class="pad" align="center" style="padding:56px 64px 24px;">
              <p style="margin:0 0 16px; font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:11px; font-weight:600; letter-spacing:3px; color:#8a7853; text-transform:uppercase;">Presented Privately</p>
              <h1 class="h1" style="margin:0 0 16px; font-family:'Cormorant Garamond','Georgia',serif; font-size:48px; line-height:52px; font-weight:400; color:#1f1b14; letter-spacing:-0.5px;">
                1247 Bay View
              </h1>
              <p style="margin:0 0 32px; font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:13px; letter-spacing:2px; color:#5b4f3a; text-transform:uppercase;">Sausalito, California</p>
              <p style="margin:0 0 32px; font-family:'Cormorant Garamond','Georgia',serif; font-size:20px; line-height:32px; font-style:italic; color:#3b3528;">
                A four-bedroom modern set into the hillside, with floor-to-ceiling glass on the bay side and a quiet garden on the other.
              </p>
            </td>
          </tr>

          <tr>
            <td class="pad" style="padding:0 64px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #e6dfd1; border-bottom:1px solid #e6dfd1;">
                <tr>
                  <td class="stat" align="center" width="25%" style="padding:24px 12px; border-right:1px solid #e6dfd1;">
                    <p style="margin:0 0 4px; font-family:'Cormorant Garamond',serif; font-size:30px; font-weight:400; color:#1f1b14;">4</p>
                    <p style="margin:0; font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:11px; letter-spacing:2px; color:#8a7853; text-transform:uppercase;">Bedrooms</p>
                  </td>
                  <td class="stat" align="center" width="25%" style="padding:24px 12px; border-right:1px solid #e6dfd1;">
                    <p style="margin:0 0 4px; font-family:'Cormorant Garamond',serif; font-size:30px; font-weight:400; color:#1f1b14;">3.5</p>
                    <p style="margin:0; font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:11px; letter-spacing:2px; color:#8a7853; text-transform:uppercase;">Baths</p>
                  </td>
                  <td class="stat" align="center" width="25%" style="padding:24px 12px; border-right:1px solid #e6dfd1;">
                    <p style="margin:0 0 4px; font-family:'Cormorant Garamond',serif; font-size:30px; font-weight:400; color:#1f1b14;">3,840</p>
                    <p style="margin:0; font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:11px; letter-spacing:2px; color:#8a7853; text-transform:uppercase;">Sq Ft</p>
                  </td>
                  <td class="stat" align="center" width="25%" style="padding:24px 12px;">
                    <p style="margin:0 0 4px; font-family:'Cormorant Garamond',serif; font-size:30px; font-weight:400; color:#1f1b14;">0.42</p>
                    <p style="margin:0; font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:11px; letter-spacing:2px; color:#8a7853; text-transform:uppercase;">Acres</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="pad" align="center" style="padding:8px 64px 56px;">
              <p style="margin:0 0 4px; font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:11px; letter-spacing:2px; color:#8a7853; text-transform:uppercase;">Offered at</p>
              <p style="margin:0 0 40px; font-family:'Cormorant Garamond',serif; font-size:36px; font-weight:400; color:#1f1b14;">$4,895,000</p>
              <a href="https://example.com/1247-bay-view" style="display:inline-block; background:#1f1b14; color:#f5f3ef; padding:18px 56px; font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:12px; font-weight:600; letter-spacing:4px; text-transform:uppercase; text-decoration:none;">View the Listing</a>
            </td>
          </tr>

          <tr>
            <td class="pad" bgcolor="#1f1b14" style="background:#1f1b14; padding:48px 64px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td valign="top" width="64" style="padding:0 16px 0 0;">
                    <img src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&q=85&auto=format&fit=crop" width="64" height="64" alt="" style="display:block; border-radius:50%; width:64px; height:64px;">
                  </td>
                  <td valign="middle">
                    <p style="margin:0 0 4px; font-family:'Cormorant Garamond',serif; font-size:20px; color:#f5f3ef;">Eliza Hall</p>
                    <p style="margin:0 0 4px; font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:12px; letter-spacing:2px; color:#8a7853; text-transform:uppercase;">Senior Partner · DRE 02141871</p>
                    <p style="margin:0; font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:13px; color:#bdb09a;">eliza@crescentandhall.com · (415) 555-0148</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:24px; background:#f5f3ef;">
              <p style="margin:0; font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:10px; letter-spacing:1px; color:#8a7853;">
                CRESCENT &amp; HALL · {{location.address}} · <a href="{{unsubscribe_url}}" style="color:#8a7853; text-decoration:underline;">Unsubscribe</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

const HTML_SAAS_UPDATE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>What’s new this month</title>
  <style>
    @media only screen and (max-width: 480px) {
      .pad    { padding-left:24px !important; padding-right:24px !important; }
      .h1     { font-size:32px !important; line-height:36px !important; }
      .feat   { display:block !important; width:100% !important; padding:16px 0 !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#fafafa; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
    May product update: three new things in your account today.
    &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847;
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#fafafa" style="width:100%; border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:32px 16px 48px;">

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%; max-width:600px;">

          <tr>
            <td class="pad" style="padding:0 8px 32px;">
              <img src="https://placehold.co/120x32/4f46e5/ffffff?text=Loomi" width="100" alt="Loomi" style="display:block; border:0; max-width:100px;">
            </td>
          </tr>

          <tr>
            <td bgcolor="#ffffff" style="background:#ffffff; border:1px solid #e5e5e5; border-radius:16px;">

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">

                <tr>
                  <td class="pad" style="padding:48px 48px 8px;">
                    <p style="margin:0 0 16px; font-size:12px; font-weight:600; letter-spacing:2px; text-transform:uppercase; color:#4f46e5;">May Release · v4.6</p>
                    <h1 class="h1" style="margin:0 0 16px; font-size:40px; line-height:44px; font-weight:700; color:#0a0a0a; letter-spacing:-1px;">
                      Three new things, all in your account today.
                    </h1>
                    <p style="margin:0; font-size:16px; line-height:26px; color:#525252;">
                      A short tour. Most of these came from things you wrote us about — keep them coming.
                    </p>
                  </td>
                </tr>

                <tr>
                  <td class="pad" style="padding:32px 48px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#f5f5f5" style="background:#f5f5f5; border-radius:12px;">
                      <tr>
                        <td style="padding:0;">
                          <img src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1100&q=85&auto=format&fit=crop" width="100%" alt="Feature" style="display:block; width:100%; max-width:100%; height:auto; border-radius:12px 12px 0 0;">
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:24px 28px 28px;">
                          <p style="margin:0 0 8px; font-size:11px; font-weight:700; letter-spacing:2px; color:#4f46e5; text-transform:uppercase;">01 · New</p>
                          <h2 style="margin:0 0 8px; font-size:20px; font-weight:700; color:#0a0a0a;">Live dashboards</h2>
                          <p style="margin:0; font-size:15px; line-height:24px; color:#525252;">Build any view you want without leaving the page. They update in real time and stay shared with your team.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td class="pad" style="padding:24px 48px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td class="feat" valign="top" width="50%" style="padding:24px 12px 24px 0;">
                          <p style="margin:0 0 8px; font-size:11px; font-weight:700; letter-spacing:2px; color:#4f46e5; text-transform:uppercase;">02 · Improved</p>
                          <h3 style="margin:0 0 6px; font-size:17px; font-weight:700; color:#0a0a0a;">Faster CSV imports</h3>
                          <p style="margin:0; font-size:14px; line-height:22px; color:#525252;">5–10× faster on big files. We stream them now instead of buffering.</p>
                        </td>
                        <td class="feat" valign="top" width="50%" style="padding:24px 0 24px 12px;">
                          <p style="margin:0 0 8px; font-size:11px; font-weight:700; letter-spacing:2px; color:#4f46e5; text-transform:uppercase;">03 · New</p>
                          <h3 style="margin:0 0 6px; font-size:17px; font-weight:700; color:#0a0a0a;">Webhook retries</h3>
                          <p style="margin:0; font-size:14px; line-height:22px; color:#525252;">Auto-retry with exponential backoff, plus a clear log of what failed and why.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td class="pad" style="padding:8px 48px 24px;">
                    <hr style="border:0; border-top:1px solid #f5f5f5; margin:0;">
                  </td>
                </tr>

                <tr>
                  <td class="pad" style="padding:0 48px 32px;">
                    <p style="margin:0 0 12px; font-size:11px; font-weight:700; letter-spacing:2px; color:#a3a3a3; text-transform:uppercase;">Small fixes</p>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr><td style="padding:6px 0; font-size:14px; line-height:22px; color:#525252;">→ Keyboard shortcuts for the inbox view (press <code style="background:#f5f5f5;padding:1px 5px;border-radius:3px;font-size:12px;">?</code> to see all)</td></tr>
                      <tr><td style="padding:6px 0; font-size:14px; line-height:22px; color:#525252;">→ Cleaner empty states across the app</td></tr>
                      <tr><td style="padding:6px 0; font-size:14px; line-height:22px; color:#525252;">→ A long list of small render fixes you’ll never see — that’s the point</td></tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td class="pad" align="center" style="padding:8px 48px 48px;">
                    <a href="https://example.com/changelog" style="display:inline-block; background:#0a0a0a; color:#ffffff; padding:14px 32px; font-size:14px; font-weight:600; text-decoration:none; border-radius:8px;">See the full changelog →</a>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <tr>
            <td class="pad" align="center" style="padding:32px 8px 0;">
              <p style="margin:0; font-size:12px; color:#a3a3a3;">
                Loomi · <a href="mailto:hi@loomi.com" style="color:#525252; text-decoration:underline;">hi@loomi.com</a> · <a href="{{unsubscribe_url}}" style="color:#a3a3a3; text-decoration:underline;">Unsubscribe</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

// ─────────────────────────────────────────────────────────────────────
// Manifest
// ─────────────────────────────────────────────────────────────────────

interface TemplateRecord {
  slug: string;
  title: string;
  type: 'design' | 'lifecycle';
  category: string;
  preheader: string;
  content: string;
}

const v2 = (t: EmailTemplate): string => JSON.stringify(t, null, 2);

const TEMPLATES: TemplateRecord[] = [
  // Drag-and-drop (v2 JSON)
  {
    slug: 'library-welcome-modern',
    title: 'Welcome — Modern & Friendly',
    type: 'lifecycle',
    category: 'welcome',
    preheader: 'A few good things to start with — picked just for you.',
    content: v2(welcomeModern()),
  },
  {
    slug: 'library-bold-announcement',
    title: 'Announcement — Bold & Brutalist',
    type: 'design',
    category: 'announcement',
    preheader: 'You’re among the first to know.',
    content: v2(boldAnnouncement()),
  },
  {
    slug: 'library-editorial-newsletter',
    title: 'Newsletter — Editorial Serif',
    type: 'design',
    category: 'newsletter',
    preheader: 'Three stories worth your time.',
    content: v2(editorialNewsletter()),
  },
  {
    slug: 'library-product-launch-dark',
    title: 'Product Launch — Dark Mode',
    type: 'design',
    category: 'product',
    preheader: 'Two years in the making. Available today.',
    content: v2(productLaunchDark()),
  },
  {
    slug: 'library-flash-sale',
    title: 'Flash Sale — E-commerce Promo',
    type: 'design',
    category: 'promo',
    preheader: 'No code needed. Ends Sunday at midnight.',
    content: v2(flashSale()),
  },
  {
    slug: 'library-event-elegant',
    title: 'Event Invitation — Elegant',
    type: 'design',
    category: 'event',
    preheader: 'Save the date: Friday, June 14.',
    content: v2(eventElegant()),
  },
  {
    slug: 'library-winback-warm',
    title: 'Win-back — Warm Personal',
    type: 'lifecycle',
    category: 'winback',
    preheader: 'Come back for 20% off — and a small thank you.',
    content: v2(winbackWarm()),
  },
  {
    slug: 'library-loyalty-premium',
    title: 'Loyalty — Premium Gold',
    type: 'lifecycle',
    category: 'loyalty',
    preheader: 'New perks unlocked.',
    content: v2(loyaltyPremium()),
  },
  {
    slug: 'library-holiday-seasonal',
    title: 'Holiday — Warm Seasonal',
    type: 'design',
    category: 'holiday',
    preheader: 'A short note, and a small gift to close out the year.',
    content: v2(holidaySeasonal()),
  },
  {
    slug: 'library-service-reminder-auto',
    title: 'Service Reminder — Automotive',
    type: 'lifecycle',
    category: 'service',
    preheader: 'Book online in under a minute.',
    content: v2(serviceReminderAuto()),
  },

  // HTML
  {
    slug: 'library-html-personal-letter',
    title: 'Personal Letter — Plain Style (HTML)',
    type: 'design',
    category: 'newsletter',
    preheader: 'A short note — and a small ask.',
    content: HTML_PERSONAL_LETTER,
  },
  {
    slug: 'library-html-dark-showcase',
    title: 'Product Showcase — Dark (HTML)',
    type: 'design',
    category: 'product',
    preheader: 'The new Phantom. Available today.',
    content: HTML_DARK_SHOWCASE,
  },
  {
    slug: 'library-html-order-receipt',
    title: 'Order Receipt — Transactional (HTML)',
    type: 'lifecycle',
    category: 'transactional',
    preheader: 'Your order is confirmed. Here’s the receipt.',
    content: HTML_ORDER_RECEIPT,
  },
  {
    slug: 'library-html-magazine-editorial',
    title: 'Magazine — Editorial (HTML)',
    type: 'design',
    category: 'newsletter',
    preheader: 'The Issue, May 2026 — three things worth your slow attention.',
    content: HTML_MAGAZINE_EDITORIAL,
  },
  {
    slug: 'library-html-luxury-listing',
    title: 'Luxury Real Estate — Listing (HTML)',
    type: 'design',
    category: 'real-estate',
    preheader: 'A new listing, presented privately first.',
    content: HTML_LUXURY_LISTING,
  },
  {
    slug: 'library-html-saas-update',
    title: 'SaaS Product Update (HTML)',
    type: 'design',
    category: 'announcement',
    preheader: 'May product update: three new things in your account today.',
    content: HTML_SAAS_UPDATE,
  },
];

// ─────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────

async function main() {
  if (clean) {
    const slugs = TEMPLATES.map((t) => t.slug);
    const removed = await prisma.template.deleteMany({ where: { slug: { in: slugs } } });
    console.log(`Removed ${removed.count} existing library templates.`);
  }

  let created = 0;
  let updated = 0;

  for (const t of TEMPLATES) {
    const existing = await prisma.template.findUnique({ where: { slug: t.slug } });
    if (existing) {
      await prisma.template.update({
        where: { slug: t.slug },
        data: {
          title: t.title,
          type: t.type,
          category: t.category,
          content: t.content,
          preheader: t.preheader,
          published: true,
          publishedAt: existing.publishedAt ?? new Date(),
        },
      });
      updated += 1;
      console.log(`  ↻ updated  ${t.slug}`);
    } else {
      await prisma.template.create({
        data: {
          slug: t.slug,
          title: t.title,
          type: t.type,
          category: t.category,
          content: t.content,
          preheader: t.preheader,
          published: true,
          publishedAt: new Date(),
        },
      });
      created += 1;
      console.log(`  + created  ${t.slug}`);
    }
  }

  console.log(`\nDone. ${created} created, ${updated} updated. (${TEMPLATES.length} total)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
