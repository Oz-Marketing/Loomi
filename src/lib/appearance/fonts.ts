import {
  Inter,
  Space_Grotesk,
  Rubik,
  Lexend,
  Syne,
  Bricolage_Grotesque,
  Quicksand,
} from 'next/font/google';

/**
 * The webfonts offered by the Appearance tab's font picker.
 *
 * `next/font/google` downloads these at BUILD time and serves them from our own
 * origin — there is no runtime request to Google, no extra CSP origin to allow,
 * and no layout shift from a late-arriving stylesheet. The tradeoff is that the
 * build now needs network access to fonts.googleapis.com.
 *
 * Chosen for CONTRAST with each other, not just quality: a neutral workhorse,
 * a technical grotesk, a rounded face, a reading-optimized face, an editorial
 * one and a characterful one. Faces that read as near-duplicates of Inter
 * (Manrope, DM Sans, Plus Jakarta) were deliberately dropped — if the picker's
 * options are indistinguishable, it isn't a choice.
 *
 * Every face here is a VARIABLE font, which matters: Loomi's UI leans on
 * `font-medium` (500) and `font-semibold` (600), and a static 400/700-only
 * family would leave the browser to synthesize those weights badly.
 *
 * This module must stay OUT of any `'use client'` file — `next/font` only runs
 * in server components. The client-side catalog (labels, preview stacks) lives
 * in `./presets.ts`, which deliberately does not import this file.
 */

// Options are spelled out per font rather than spread from a shared object:
// each loader narrows `subsets` to the subsets that font actually publishes, so
// a single shared literal can't satisfy all six signatures.
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-space-grotesk',
});
const rubik = Rubik({ subsets: ['latin'], display: 'swap', variable: '--font-rubik' });
const lexend = Lexend({ subsets: ['latin'], display: 'swap', variable: '--font-lexend' });
const syne = Syne({ subsets: ['latin'], display: 'swap', variable: '--font-syne' });
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-bricolage',
});

/**
 * Quicksand is NOT in the picker — it is the brand face, used only by the
 * `loomi <sector>` wordmark in each sidebar. It is loaded the same way so the
 * mark never depends on a runtime request to Google, and it is deliberately
 * excluded from `FONTS` in ./presets.ts: the wordmark must read the same no
 * matter which interface font the user has chosen.
 */
const quicksand = Quicksand({ subsets: ['latin'], display: 'swap', variable: '--font-quicksand' });

/**
 * Every font's CSS-variable class, to be applied once on `<html>`. Declaring
 * them all up front (rather than swapping the loaded font per preference) is
 * what makes switching instant and lets the settings cards preview each face
 * in its own typeface before it's applied.
 */
export const appearanceFontVariables = [
  inter.variable,
  spaceGrotesk.variable,
  rubik.variable,
  lexend.variable,
  syne.variable,
  bricolage.variable,
  quicksand.variable,
].join(' ');
