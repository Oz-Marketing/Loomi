# Brand source art

The five marks every derived brand asset is built from. **Edit these, then run
the build script** — never hand-edit anything under `public/brand/` or the
favicon files in `src/app/`, because the next rebuild overwrites them.

```bash
# after exporting new art
npx tsx scripts/build-brand-assets.ts ~/Downloads/new-logos

# or, if you edited the files here directly
npx tsx scripts/build-brand-assets.ts
```

Then review the diff and commit — the sources and the generated assets travel
together.

## The five sources

Named this way because the script identifies each mark by **filename**; it
cannot look at the art. Any of `.png` `.webp` `.svg` `.jpg` works.

| File | What it is |
| --- | --- |
| `loomi-favicon` | Square app mark (the circular gradient badge) |
| `loomi-logo-black` | "loomi" wordmark, dark ink — for light backgrounds |
| `loomi-logo-white` | "loomi" wordmark, light ink — for dark backgrounds |
| `loomi-studio-logo-black` | "loomi studio" lockup, dark ink |
| `loomi-studio-logo-white` | "loomi studio" lockup, light ink |

Export the wordmarks at **1200px wide or more** and the square mark at **512px
or more**, with transparency. The script downscales; it will not invent detail
that isn't there.

## What gets generated

| Output | Used by |
| --- | --- |
| `public/brand/loomi-studio-{black,white}.png` | `AppLogo` — Studio, login, onboarding, marketing, **and both email templates** |
| `public/brand/loomi-{black,white}.png` | `LoomiWordmark` — App sidebar, Docs shell |
| `src/app/icon.png` | Browser tab icon (256px) |
| `src/app/favicon.ico` | Direct `/favicon.ico` requests (16/32/48) |
| `src/app/apple-icon.png` | iOS home screen (180px, opaque) |

## Two things not to break

**`/brand/` must stay on the proxy's public passthrough list** (`src/proxy.ts`).
Two callers have no session by definition: the login page draws the wordmark
before anyone signs in, and transactional email draws it for a recipient
sitting in Gmail. Gate it and both become broken images.

**The wordmarks are PNG on purpose.** WebP is smaller in general, but on these
flat-colour marks a palette PNG measures within ~0.2KB of it — and Outlook
cannot render WebP at all. One asset serving both the app and email beats a
`<picture>` fallback that has to be kept in sync.

`scripts/build-brand-assets.ts` carries the reasoning behind every size and
encoding choice. `--check` verifies the committed assets still match these
sources and exits non-zero if not.
