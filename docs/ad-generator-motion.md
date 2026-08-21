# Motion and video backgrounds in the Ad Generator

Shipped 2026-08-20. What was built, why it's shaped this way, and what running it
costs.

## The idea in one line

A motion layer is not a new element type — it's an ordinary `image` or
`background` element whose resolved URL happens to point at a clip. Everything
that already worked for a photo (cover/contain fit, per-size focal point and
crop, corner radius, opacity, z-order, per-size hide) works unchanged, and every
template written before this keeps rendering identically.

The consequence worth stating: **"does this ad move?" is a question about DATA,
not about the document's shape.** A dealer dropping an `.mp4` into a vehicle-image
field makes a video ad out of a template nobody edited. `lib/ad-generator/motion.ts`
is the single place that answers it, by URL.

## Why plates, not frame capture

The obvious way to export video is to record the canvas. It's a trap: a per-frame
Chromium screenshot is minutes of CPU for six seconds of ad, and the fitted text
would be re-measured on every frame.

So the design is rasterised ONCE per **plate** — a flat PNG of a run of static
layers — and ffmpeg composites the real clip between the plates:

```
plate (canvas fill + layers below the clip)   ← opaque, from renderDoc
  clip  (scaled, cropped, looped, masked)     ← ffmpeg
plate (scrim, headline, offer, logo, …)       ← transparent, from renderDoc
  clip  (a second clip, if the design has one)
plate (…)
```

Two things follow. The MP4 is byte-identical to the PNG everywhere the video
isn't — same renderer, same fonts, same offer text. And a clip is a normal layer:
put a scrim over it, stack a second clip on top of that, and z-order is honoured
because the plan walks the same ordered layer list the renderer walks
(`visibleLayers`).

A moving `background` element is split three ways — its base fill under the clip,
its fade overlay over it — via `RenderDocOptions.plate.bgParts`.

## Fidelity: what matches the still, and what doesn't

Matches: crop and focal point, per-size framing, layer opacity, corner radii
(rounded via an alpha mask multiplied into the clip's own alpha — `alphamerge`
alone would turn a `contain` fit's transparent letterbox bars opaque), looping to
fill the ad's length, the poster frame.

Doesn't, and says so rather than differing quietly (`MotionPlan.warnings`, shown
as toasts and returned in `X-Loomi-Motion-Warnings`):

- **Blend modes** on a motion layer apply to stills only.
- **Tile** has no video form; the clip fills like Cover.
- **Audio** is always dropped (`-an`). Feeds autoplay muted, and a soundtrack
  means music licensing.

## Stills of a moving ad never touch a codec

`lib/ad-generator/posterize.ts` swaps every clip for a `data:` PNG of its poster
frame BEFORE Chromium sees the page. This isn't an optimisation, it's the fix for
a production-only failure: the droplets render through `@sparticuz/chromium`, a
stripped Chromium with no proprietary codecs, so an H.264 background would decode
to nothing and the PNG export — and the thumbnail Meta shows for the video ad —
would come back with a hole in it.

It runs on every still path (both export routes, `renderCreativeSizes`, and the
poster inside the MP4 export) and is a no-op for a still ad, for a caller with no
doc to inspect, and on a box with no ffmpeg. In that last case the in-page freeze
(`FREEZE_VIDEOS` in `render.ts`) remains the fallback — which is why both exist.

Plates are deliberately rendered from the ORIGINAL doc: a plate has to see a clip
in order to leave a hole for it.

## The poster frame

One number (`DocElement.trimStart`) drives both outputs: the MP4 starts there and
every still export freezes there. That's deliberate — Meta requires a thumbnail
alongside a video ad, and it comes from our own still render, so the thumbnail and
the video's first frame can never disagree.

Stills are deterministic because `renderAdBatch` pauses each `video[data-motion]`
and seeks it to `data-still-at` before capturing. Screenshotting whichever frame
the decoder happened to be on would make the same ad export a different PNG twice.

## Where video is (and isn't) produced

| Surface | Behaviour |
| --- | --- |
| Builder canvas / previews | The real `<video>`, autoplaying muted. No encoding. |
| PNG / ZIP export | Unchanged, frozen on the poster frame. |
| `POST /api/ad-generator/render-motion` | The MP4 (one size) or a ZIP of MP4s + posters. `GET` reports whether the server can encode at all. |
| Launch kit | Includes the MP4s, and the README says to upload those rather than the stills. |
| Meta launch | Uploads the video + poster and builds a `video_data` creative. Refused up front if the server has no encoder. |
| Unattended generation | Stills only, on purpose — see the note at the bottom of `render-motion.ts`. |

## Operations

**ffmpeg is required, and resolved in this order:** `FFMPEG_PATH` → the
`ffmpeg-static` npm binary → `ffmpeg` on `PATH`. It's an *optional* dependency, so
a failed binary download can't fail a deploy; the fallbacks cover it.

On the droplets, prefer the system package — apt's build is smaller through the
deploy and hardware-accelerated where the box supports it:

```
apt-get update && apt-get install -y ffmpeg
```

**Concurrency is capped at one encode per process** (`MOTION_MAX_CONCURRENT`).
Not caution: production is a single shared vCPU that also serves every request, so
two simultaneous exports don't take twice as long — they starve the web app.
Queueing is slower for the second person and survivable for everyone else.

**Measured cost** (`-preset veryfast -crf 21`, 1080×1080, 6s at 30fps): ~10s of
CPU per size, plus ~1–2s per plate rasterisation. On the current 1-vCPU prod box
that's roughly 12s per size — a four-size export saturates the only core for about
a minute.

**Sizing.** 1 vCPU / 2GB is under-specified for this (and already tight for the
on-box build — see the pm2 memory note). 2 vCPU / 4GB is the smallest box where an
export doesn't visibly stall the app; 4 vCPU / 8GB if video becomes routine, at
which point `MOTION_MAX_CONCURRENT=2` is reasonable.

**Caps.** Source clips over 120MB are refused (streamed to disk, never buffered).
Duration is clamped to 1–30s and frame rate to 12–60fps. Each ffmpeg call has a
duration-scaled timeout so a wedged encode can't hold the only slot.
