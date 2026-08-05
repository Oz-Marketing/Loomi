# UI motion

**The rule: anything that changes what's on screen animates.** Expanding and
collapsing, panels and drawers opening, dropdowns, view switches inside a modal,
disclosure chevrons. Content that pops into existence reads as unfinished no
matter how correct the logic underneath it is, and it's the first thing anyone
notices in a demo.

This is a project-wide default, not a per-feature decision. If you're adding a
surface that appears, disappears, or resizes, it animates.

---

## Reach for the primitives

They live in [`src/app/globals.css`](../src/app/globals.css). Don't invent a
per-component transition when one of these fits — that's how a codebase ends up
with nine slightly different easings.

| What you're building | Use |
|---|---|
| Expand / collapse to unknown height | `<Collapse>` — [`src/components/ui/collapse.tsx`](../src/components/ui/collapse.tsx) |
| Modal panel | `animate-modal-in` |
| Modal backdrop | `animate-overlay-in` |
| Dropdown / popover | `animate-dropdown-in` |
| Drawer entering from the right | `animate-slide-in-right` |
| Drawer entering from the left | `animate-drawer-slide-in` |
| Content entrance, view switch | `animate-fade-in-up` (+ `animate-stagger-1…6` for lists) |
| Disclosure chevron | `transition-transform` + `rotate-90` |

**Chevrons rotate; they never swap glyphs.** Replacing a `ChevronRight` with a
`ChevronDown` on toggle reads as a flicker, because nothing moves — one icon
disappears and a different one appears in its place.

**`animate-modal-in` and `animate-dropdown-in` carry motion only, no styling.**
`.glass-modal` and `.glass-dropdown` also animate, but they impose their own
background, blur and border. On a surface that already styles itself — anything
using `frost-heavy` — you want the motion without the look.

## Height animation: why `<Collapse>` exists

You cannot transition `height: auto`. The workaround in `globals.css` is a CSS
grid whose row goes `0fr → 1fr`, which *is* transitionable and resolves to the
content's natural height. That's the `collapsible-wrapper` / `collapsible-inner`
pair.

The bare classes have one gap: they only animate a node that's **already
mounted**. The common React shape —

```tsx
{open && <Panel />}
```

— mounts straight into the open state, so the content just appears. `<Collapse>`
mounts closed and flips open on the next frame, and with `unmountOnClose` it
holds the node in the tree for the length of the closing transition so
collapsing animates too instead of vanishing.

It clips by default (`collapsible-clip`). Without clipping, `overflow` flips to
`visible` the instant the wrapper opens while the grid row is still growing, so
the content paints at full height over whatever sits below it. That's invisible
when the panel is the last thing on the page and obvious when it's an accordion
row in the middle of a table. Pass `clip={false}` only when something inside
needs to escape the box — a dropdown, a popover, a tooltip.

## Two-stage close

Animating *open* is free; animating *closed* is the part people skip. If the
close handler clears the state that renders the node, it unmounts mid-transition
and the panel disappears with no animation at all.

Either use `unmountOnClose` on `<Collapse>`, or flip a `closing` flag, wait the
transition duration, then clear. The budget hub's cell accordion does the
latter, because the row it lives in is conditionally rendered too:

```tsx
const closeCell = useCallback(() => {
  setClosingCell(true);
  setTimeout(() => {
    setOpenCell(null);
    setClosingCell(false);
  }, 250);
}, []);
```

## Reduced motion is not optional

Every animation utility is listed in the `prefers-reduced-motion: reduce` block
at the bottom of `globals.css`, which kills both `animation` and `transition`.
**Anything new must be added to that list.** Vestibular disorders are real and
a full-page slide is exactly the trigger.

## Duration and easing

Fast enough to feel responsive, slow enough to be seen: **150–250ms**. The house
easing is `cubic-bezier(0.16, 1, 0.3, 1)` — a hard decelerate, so motion arrives
quickly and settles. Use it unless you have a reason not to.

If you change `<Collapse>`'s `durationMs`, change the stylesheet transition to
match; they're two halves of the same number.
