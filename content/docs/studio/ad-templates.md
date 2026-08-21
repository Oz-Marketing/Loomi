---
title: Building ad templates
summary: For designers — authoring the templates everyone else fills in, across every size at once.
sector: studio
category: Templates & creative
audience: staff
order: 110
covers:
  - src/app/ad-generator/builder/**
  - src/app/ad-generator/sizes/**
  - src/lib/ad-generator/renderer/**
  - src/lib/ad-generator/fonts.ts
---

The ad builder is where a designer authors the templates the rest of the team
fills in. The output is not one ad — it is a layout that produces a correct ad
for any offer, any vehicle, and every size.

# The canvas

Pan and zoom like any design tool: space or middle-mouse to pan, modifier-scroll
to zoom at the cursor.

**All sizes** mode lays every size out together. The active size stays editable
in place while the others render live beside it, so you can see the consequence
of a change everywhere at once.

# Elements

Text, image, button, and shape. Each is color-coded consistently — in the insert
panel, on the canvas outline, in the layer list — so you can tell what you have
selected without reading a label.

Backgrounds are just layers. A full-bleed shape with a gradient, a texture image
tiled over it, a scrim to knock it back: composed in the builder rather than
pre-baked in Illustrator, which is what lets a background reflow across sizes.

# Motion and video backgrounds

A layer moves when the file behind it moves. Pick an `.mp4`, `.webm`, `.mov` or
an animated GIF from the media library the same way you'd pick a photo — into a
Background layer's texture, or into any Image layer — and it plays right on the
canvas. There is no "make this a video" switch to remember, and no separate video
template: everything else about the layer works as before, including cover/contain
fit, the per-size focal point and crop, corner radius, and opacity.

Selecting a moving layer adds a **Motion** section:

- **Poster frame** — how many seconds into the clip it starts. This one number
  does two jobs: it's where playback begins in the MP4, and it's the frame every
  still export freezes on. So the poster and the video's first frame can never
  disagree.
- **Length** and **Frame rate** — properties of the whole ad, not of the layer.
  Two clips in one design share them, each looping to fill the length.

What to know when designing one:

- **Video is a normal layer.** Put a scrim over it, put a second clip over that;
  stacking order is honoured on export exactly as on the canvas.
- **Tile has no video form.** A clip set to Tile fills its box like Cover.
- **Blend modes apply to stills only.** A multiply on a clip shows in the PNG and
  not in the MP4, and the export tells you so rather than differing quietly.
- **Keep the source small.** The clip is re-encoded per size. A 4K master makes a
  slow export and no better ad; something near the largest size you're rendering
  is plenty.

The MP4 itself is produced from the ad, not from the builder — whoever fills the
template in gets an **Export video** button, and launching to Meta uploads the
video as a video ad.

# Fields

The Fields panel defines what the person filling this template in will be asked
for. Fields live in named sections you create, name, and reorder.

Two things per field are worth getting right:

- **Type.** A date field gets a date picker and formats consistently. A text
  field gets whatever someone types.
- **Filled by.** Client or internal. Internal fields are hidden from client
  users, so a template can carry both the questions a dealer answers and the
  ones your team does.

**Presets** are saved field sets. Apply one to seed a template's fields without
overwriting anything already there. The Vehicle Offer preset ships ready to use,
and applying it is what turns on the offer engine and its generated disclaimers.

# Working across sizes

:::warning
An element's width is a fraction of the artboard's width and its height a
fraction of its height. Copying both to a differently-shaped size therefore
distorts it — a circle becomes an oval.

Use **Re-fit other sizes** after a change rather than copying geometry across by
hand.
:::

By default an edit applies to the size you are on. The **This size / All sizes**
switch changes that, and font sizes travel proportionally rather than literally.

# Brand assets

Color pickers offer the account's brand colors as one-click swatches. Uploaded
brand fonts render in the editor and survive export.

Fonts uploaded to any account roll up for admins, so an OEM font uploaded once
is available everywhere — but a client only ever sees their own account's fonts.

# Publishing

Draft, publish now, or publish for a date range. Scheduled templates disappear
from the library outside their window, which is how seasonal creative retires
itself.

Deploy pushes a published copy into selected accounts.
