import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { clientNamedIn, isEmailFile, pickEmailFiles, pickHero, subitemClient } from './approved-files';
import { imagesInZip } from './assets';

const f = (path: string) => ({ path });
const YPS = ['Young Powersports Ogden', 'Young Powersports Euro'];

describe('isEmailFile', () => {
  it('reads the type from the file name, as design writes it', () => {
    expect(isEmailFile('08) _ Email _ Text.png')).toBe(true);
    expect(isEmailFile('Emails/hero.jpg')).toBe(true);
    expect(isEmailFile('E-mail header.png')).toBe(true);
    expect(isEmailFile('30) _ Digital.png')).toBe(false);
    expect(isEmailFile('Text Blast.png')).toBe(false);
    expect(isEmailFile('Emailer flyer.png')).toBe(false);
  });
});

describe('clientNamedIn / subitemClient', () => {
  it('finds the store a file or subitem names, without needing "Young"', () => {
    expect(clientNamedIn('Email - Powersports Euro.png', YPS)).toBe('Young Powersports Euro');
    expect(clientNamedIn('Email.png', YPS)).toBeNull();
    expect(subitemClient('Email Blast 1 - Young Powersports Ogden', YPS)).toBe('Young Powersports Ogden');
    expect(subitemClient('Email Blast 1', ['Young Mazda of Missoula'])).toBe('Young Mazda of Missoula');
  });

  it("reads design's real file names, shorthand and all", () => {
    const name = '09 SEP - YPS Ogden - Winter Prep - Emailpng_Email - Hero.png';
    expect(isEmailFile(name)).toBe(true);
    expect(clientNamedIn(name, YPS)).toBe('Young Powersports Ogden');
    expect(clientNamedIn('09 SEP - YPS Euro - Winter Prep - Emailpng_Email - Hero.png', YPS)).toBe('Young Powersports Euro');
    expect(subitemClient('Email Blast 1 - YPS Ogden', YPS)).toBe('Young Powersports Ogden');
    // A word both stores share tells them apart from nothing.
    expect(clientNamedIn('09 SEP - YPS - Winter Prep - Email - Hero.png', YPS)).toBeNull();
  });

  it('prefers the longer name, and gives no answer on a tie', () => {
    expect(clientNamedIn('Email Young Powersports Euro.png', ['Young Powersports', 'Young Powersports Euro'])).toBe('Young Powersports Euro');
    expect(clientNamedIn('Email Powersports.png', ['Young Powersports', 'Powersports'])).toBeNull();
  });
});

describe('pickEmailFiles', () => {
  const one = { id: '1', name: 'Email Blast 1' };

  it('takes the email graphics for a one-store request, ignoring the other channels', () => {
    const r = pickEmailFiles({
      subitem: one,
      siblings: [one, { id: '2', name: 'Text Blast 1' }],
      clients: ['Young Mazda of Missoula'],
      files: [f('08) _ Email _ Text.png'), f('08) _ Digital.png'), f('08) _ Email.pdf')],
    });
    expect(r).toEqual({ files: [f('08) _ Email _ Text.png')], problem: null });
  });

  it("takes only this store's graphics when the request is for several", () => {
    const euro = { id: '1', name: 'Email Blast 1 - Young Powersports Euro' };
    const ogden = { id: '2', name: 'Email Blast 1 - Young Powersports Ogden' };
    const r = pickEmailFiles({
      subitem: euro,
      siblings: [euro, ogden],
      clients: YPS,
      files: [f('Email/Powersports Euro.png'), f('Email/Powersports Ogden.png'), f('Email/both stores.png')],
    });
    expect(r.files).toEqual([f('Email/Powersports Euro.png')]);
  });

  it('reports, rather than guesses, every case it can\'t place', () => {
    // The subitem doesn't say which store.
    expect(pickEmailFiles({ subitem: one, siblings: [], clients: YPS, files: [f('Email.png')] }).problem).toContain(
      '"Email Blast 1 - Young Powersports Ogden"',
    );
    // A two-store request names the word that picks the store, not the full name.
    const cdjr = ['Young Chrysler Jeep Dodge Ram of Layton', 'Young Chrysler Jeep Dodge Ram in Riverdale'];
    const layton = { id: '7', name: 'Email Blast 1 - Young Chrysler Jeep Dodge Ram of Layton' };
    expect(pickEmailFiles({ subitem: layton, siblings: [layton], clients: cdjr, files: [f('Digital.png')] }).problem).toContain(
      'Loomi looks for "Email" and "Layton" in the file name',
    );
    // No email graphic at all — and it says what it found.
    const none = pickEmailFiles({ subitem: one, siblings: [], clients: ['Young Kia'], files: [f('Digital.png')] });
    expect(none.problem).toContain('It found: Digital.png');
    // Two email deliverables for one store.
    const two = pickEmailFiles({
      subitem: one,
      siblings: [one, { id: '2', name: 'Email Blast 2' }],
      clients: ['Young Kia'],
      files: [f('Email.png')],
    });
    expect(two.problem).toContain('2 email deliverables');
  });
});

describe('pickHero', () => {
  it('takes the image design named Hero, else the first', () => {
    const banner = { name: '09 SEP - YPS Ogden - Winter Prep - Email - Banner.png' };
    const hero = { name: '09 SEP - YPS Ogden - Winter Prep - Emailpng_Email - Hero.png' };
    expect(pickHero([banner, hero])).toBe(hero);
    expect(pickHero([banner])).toBe(banner);
    expect(pickHero([banner, { name: 'Superhero sale.png' }])).toBe(banner);
  });
});

describe('imagesInZip', () => {
  it('unpacks the images at their paths, skipping folders, macOS metadata and other files', async () => {
    const zip = new JSZip();
    zip.file('Email/Young Kia.png', 'png-bytes');
    zip.file('Print/flyer.pdf', 'pdf');
    zip.file('__MACOSX/Email/._Young Kia.png', 'junk');
    zip.file('.DS_Store', 'junk');
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    const images = await imagesInZip('900', bytes);
    expect(images.map((i) => [i.id, i.path, i.bytes.toString()])).toEqual([['900#Email/Young Kia.png', 'Email/Young Kia.png', 'png-bytes']]);
  });
});
