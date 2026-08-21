---
title: The asset library
summary: Where images, logos, and creative live — and how sharing works across accounts.
sector: studio
category: Assets
audience: everyone
order: 150
covers:
  - src/app/media/**
  - src/app/api/media/**
  - src/lib/media-categories.ts
  - docs/asset-management.md
---

Every image used in an email, a landing page, or an ad comes from the asset
library. Uploading once and reusing beats re-uploading, because a reused asset
is one you can replace everywhere at once.

# Categories and folders

Assets are filed by **category** — general, brand, texture, ad creative, OEM —
and organized in **folders** you create and nest.

Categories drive what shows up where. The ad builder's texture picker only
offers textures, which is why filing a background as a texture makes it findable
by the person who needs it.

Deleting a folder never deletes assets. Its contents move up a level.

# Branding assets are read-only here

The account's logos appear as a **Branding** folder. Selectable anywhere,
editable only in the account's branding settings.

That is on purpose: the logo has one source of truth, and a copy edited in the
library would drift from it silently.

# Video files

Video uploads sit in the library alongside images, and the tile shows a frame from
about a second in rather than a generic icon — so you can tell one clip from
another without opening anything. Tiles are labelled **Video**, because a poster
frame looks exactly like a photograph.

Clips are what the Ad Generator uses for a motion background, and they're offered
in the ad builder's picker for that. Everywhere else — emails, landing pages — the
picker still offers images only, since those surfaces show a still.

:::note
A clip uploaded before this existed has no poster yet, and shows a film icon
until someone regenerates it. New uploads get one automatically.
:::

# Sharing across accounts

Three scopes:

| Scope | Appears in |
| --- | --- |
| **This account** | Only here |
| **All accounts of one brand** | Every rooftop of that manufacturer |
| **Loomi library** | Every account |

A shared asset shows up *inside* each account's own library. There is no
separate cross-account browser — you find shared assets where you already are,
filtered and searched alongside everything else.

When an account needs its own version of a shared asset — to crop it, to swap
the plate — use **Copy to…**. That makes an independent copy owned by that
account.

# Rights and expiry

Assets can carry usage rights and an expiry date. Stock photography and OEM
imagery are frequently licensed for a period, and an ad running on an expired
image is a real problem.

Admins get a **Rights & Activity** view showing what is expiring. It reads
across every account wherever you open it, because a license problem is not
confined to the rooftop you happen to be standing in.

# Bulk download

Select any number of assets and download them as one zip. Large selections
stream as they build.
