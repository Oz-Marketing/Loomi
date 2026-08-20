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
