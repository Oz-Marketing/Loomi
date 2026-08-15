import { describe, it, expect } from 'vitest';
import { classifyEntries, guessMime, isZip, stripCommonRoot } from './media-archive';

/**
 * The classifier is the part that matters. Getting it wrong in the "package"
 * direction leaves assets buried in a blob; getting it wrong in the
 * "collection" direction shreds a runnable template into fragments.
 */

/** An Audi DAG package, as described in the upload note. */
const gwdPackage = [
  'MY27_DAG_Static/index.html',
  'MY27_DAG_Static/animation/main.js',
  'MY27_DAG_Static/animation/styles.css',
  'MY27_DAG_Static/data/config.json',
  'MY27_DAG_Static/data/values.json',
  'MY27_DAG_Static/fonts/AudiType-Bold.woff2',
  'MY27_DAG_Static/fonts/AudiType-Normal.woff2',
  'MY27_DAG_Static/pages/300x250.jpg',
  'MY27_DAG_Static/pages/728x90.jpg',
];

/** A campaign photography drop. */
const photoCollection = [
  'Summer Campaign/hero-01.jpg',
  'Summer Campaign/hero-02.jpg',
  'Summer Campaign/lifestyle-01.jpg',
  'Summer Campaign/lifestyle-02.png',
  'Summer Campaign/logo.svg',
];

describe('classifyEntries', () => {
  it('calls a GWD template bundle a package', () => {
    const { kind, reason } = classifyEntries(gwdPackage);
    expect(kind).toBe('package');
    expect(reason).toContain('index.html');
  });

  it('calls a folder of photography a collection', () => {
    const { kind, reason } = classifyEntries(photoCollection);
    expect(kind).toBe('collection');
    expect(reason).toContain('5 media files');
  });

  it('does not condemn a collection over one stray readme', () => {
    // A single html file among eighty photos is documentation, not an entry point.
    const withReadme = [...photoCollection, 'Summer Campaign/docs/readme.html'];
    expect(classifyEntries(withReadme).kind).toBe('collection');
  });

  it('treats a root index.html as decisive even with media present', () => {
    // The GWD case: renders JPEGs, but they're the package's output, not
    // separate deliverables.
    expect(classifyEntries(['index.html', 'a.jpg', 'b.jpg', 'c.jpg']).kind).toBe('package');
  });

  it('flips to package once markup outweighs media', () => {
    expect(classifyEntries(['a.jpg', 'x.js', 'y.css', 'z.json']).kind).toBe('package');
  });

  it('treats a font-only brand drop as a collection', () => {
    // The Audi note asks for exactly this — fonts extracted once as their own
    // asset records, so fonts must not read as package markers.
    const fonts = [
      'Audi Type/AudiType-Bold.woff2',
      'Audi Type/AudiType-Normal.woff2',
      'Audi Type/AudiTypeV03-Light.otf',
    ];
    expect(classifyEntries(fonts).kind).toBe('collection');
  });

  it('calls an archive with no recognisable media a package', () => {
    expect(classifyEntries(['notes.txt', 'data.bin']).kind).toBe('package');
    expect(classifyEntries([]).kind).toBe('package');
  });

  it('handles mixed-case extensions', () => {
    expect(classifyEntries(['A.JPG', 'B.PNG', 'C.Jpeg']).kind).toBe('collection');
  });

  it('finds the entry point through the wrapper folder, with media outnumbering markup', () => {
    // The shape that would otherwise slip through: a real zipped directory
    // whose index.html sits one level down, alongside more images than code.
    const nested = [
      'Q7 Launch Animated/index.html',
      'Q7 Launch Animated/main.js',
      'Q7 Launch Animated/frame-01.jpg',
      'Q7 Launch Animated/frame-02.jpg',
      'Q7 Launch Animated/frame-03.jpg',
      'Q7 Launch Animated/frame-04.jpg',
    ];
    const { kind, reason } = classifyEntries(nested);
    expect(kind).toBe('package');
    expect(reason).toContain('index.html');
  });
});

describe('stripCommonRoot', () => {
  it('removes a wrapper folder every entry shares', () => {
    expect(stripCommonRoot(['Pack/a.jpg', 'Pack/sub/b.jpg'])).toEqual(['a.jpg', 'sub/b.jpg']);
  });

  it('leaves two real top-level folders alone', () => {
    // Structure that means something must not be flattened away.
    const paths = ['Static/a.jpg', 'Animated/b.jpg'];
    expect(stripCommonRoot(paths)).toEqual(paths);
  });

  it('leaves root-level entries alone', () => {
    expect(stripCommonRoot(['a.jpg', 'b.jpg'])).toEqual(['a.jpg', 'b.jpg']);
    expect(stripCommonRoot([])).toEqual([]);
  });
});

describe('isZip', () => {
  it('accepts by MIME or extension', () => {
    expect(isZip({ name: 'a.zip', type: 'application/zip' })).toBe(true);
    expect(isZip({ name: 'a.zip', type: '' })).toBe(true);
    expect(isZip({ name: 'a.ZIP', type: '' })).toBe(true);
    expect(isZip({ name: 'pack', type: 'application/x-zip-compressed' })).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isZip({ name: 'a.jpg', type: 'image/jpeg' })).toBe(false);
    expect(isZip({ name: 'zipper.txt', type: 'text/plain' })).toBe(false);
  });
});

describe('guessMime', () => {
  it('types the files a zip strips', () => {
    // Blobs out of a zip carry no MIME, and both the size limits and thumbnail
    // generation key off it.
    expect(guessMime('hero.jpg')).toBe('image/jpeg');
    expect(guessMime('master.psd')).toBe('image/vnd.adobe.photoshop');
    expect(guessMime('AudiType-Bold.woff2')).toBe('font/woff2');
  });

  it('falls back rather than guessing wrong', () => {
    expect(guessMime('weird.xyz')).toBe('application/octet-stream');
    expect(guessMime('noext')).toBe('application/octet-stream');
  });
});
