# Design language

The canonical reference for every visual decision in walletlink.social. If a value
is not here, it should not be in the code.

This exists because a colour system was mistaken for a design system. Colour was
swept onto tokens and enforced in CI, and the product still read as assembled
rather than designed, because radius, elevation, width, type, weight, spacing,
numerals, motion and affordance had never been specified at all.

**Related:** `CLAUDE.md` (house style, colour summary), `docs/DOCS-SITE.md` (the
published Mintlify site), `docs/AI-SEARCH.md` (the assistant).

---

## The one rule that generates the rest

**Every primitive has exactly one value.** Where a second is genuinely needed it is
named here as an exception, with its reason. An unnamed second value is drift.

---

## Colour

Two hues carry meaning. Everything else is `muted`, `border` or `foreground`.

| Token | Means |
|---|---|
| `accent-brand`, `accent-brand-tint` | **an affordance.** Anything you can act on: buttons, links, focus, selected, the logo |
| `attested`, `attested-tint` | **a measured fact.** An identity the owner published, a system that is live, a real outcome |
| `caution`, `caution-tint` | truncated results, stale records, approaching a limit |
| `destructive` | revoking a key, deleting a lookup |

**Green is a measured fact, violet is an affordance.** That single sentence covers
the row gutter dot (the owner published this), the live pulse (the system is
running), the hit rate (this lookup returned this) and the whitelist chip (this
account has access). What green must never mark is **an inference presented as
confirmation**, which is the distinction the product is sold on.

`attested` must be driven by `twitter_verified` / `farcaster_verified`, never by
`source` — that field holds pipeline stage markers like `graph` and `cache` on the
forward path.

**Exception, platform marks.** A selected platform in a segmented control takes
that platform's own colours: 𝕏 is white on `#0F1419`, Farcaster is white on
`#8A63D2`. In dark mode the 𝕏 pill inverts, because a black pill on a near-black
ground disappears. These identify a platform, not an affordance. A wrong-coloured
brand mark is a worse error than an inconsistent one.

Tokens live in `app/globals.css`. **Never a raw Tailwind palette class.** The guard
covers all 22 shaded families including the neutrals (`gray`, `slate`, `zinc`,
`neutral`, `stone`) — it originally listed only the 17 chromatic ones and reported
clean over 18 live violations.

**`primary` is not one of these tokens.** `--primary` is `oklch(0.205 0 0)`, a
shadcn default that nothing here ever adapted: near-black in light mode,
near-white in dark. It survived because its *name* reads like a brand token, and
because the palette guard is looking for raw families like `bg-gray-500` and this
is not one. It had spread to both drop targets, so dragging a file onto the page
lit the target **black** while the same component's resting state was violet; to
the admin period toggle and its stage bars; to six clickable cards; to the text
selection colour inside every input; and to the unused `Progress` primitive. The
`shadcn-primary` rule now rejects it in every utility position.

The general lesson is that **an unadapted library default is more dangerous than
an obviously wrong value**, because it is plausible. A guard that only knows the
library's *palette* cannot see the library's *semantics*.

---

## Type

Söhne, self-hosted in `public/fonts`. Geist Mono via `next/font`, already wired to
`--font-mono`.

### Weight — five, each with one job

| Weight | Cut | Used for |
|---|---|---|
| 200 | Extraleicht | display tier only: hero, page h1, share cards, hero figures |
| 300 | Leicht | section headings, ledes, standfirsts |
| 400 | Buch | body and UI |
| 500 | Kräftig | labels, buttons, table figures |
| 600 | Halbfett | headings h3, card titles, the emphasis span inside a display line |

**The emphasis span is the signature.** One 600-weight word inside a 200-weight
line. It costs nothing: both cuts are already loaded.

### Tracking — bound to size, four steps

| Token | Value | Applies at |
|---|---|---|
| `--t-display` | `-0.04em` | ≥32px |
| `--t-title` | `-0.028em` | 20–31px |
| `--t-lead` | `-0.012em` | 16–19px |
| `--t-body` | `-0.006em` | body and UI |

Checking that a value *is* a token is not the same as checking it is the *right*
token for its size. The wordmark passed every automated check while using
`--t-lead` at 34px.

### Uppercase labels — one tracking

`--track: 0.14em`, mono, 11px, uppercase. **This is the only uppercase text in the
product.** Any `uppercase` not accompanied by `font-mono` is a violation.

---

## Shape

### Radius — five values, all named

| Token | Value | Applies to |
|---|---|---|
| `--r-container` | 14px | cards, panels, inputs, modals, dropzones |
| `--r-mark` | 9px | the brand mark, the one square-ish object |
| `--r-chip` | 6px | badges, inline code |
| `--r-control` | pill | buttons, segmented controls |
| — | 50% | dots and avatars only |

Banned: `rounded-md`, `rounded-xl`, `rounded-2xl`, bare `rounded`.

### Elevation

Separation is carried by **one hairline**: `border border-border` at full token
opacity. Shadows appear only on the floating layer (modals, dropdowns, popovers)
at `shadow-lg`, and on the segmented control's active thumb. Border opacity
modifiers (`/60`, `/50`, `/30`) are banned. `border-2` only with `border-dashed`,
on a dropzone.

That rule was stated here and broken in the one place it mattered most: `Card`,
the primitive nearly every surface is built from, carried `border-border/60`. In
dark mode `--border` is already `oklch(1 0 0 / 10%)`, so sixty percent of it is a
6% white line, which is to say no line at all. Six further faded borders sat
behind it. The `border-opacity` rule now enforces what this paragraph already
said, which is the useful shape of the lesson: **a rule nobody can check is a
preference.**

**One exemption, and it is about meaning rather than convenience.** A spinner
draws its track at half opacity and one edge at full, and that arc is not
separation, so the rule skips any line carrying `animate-spin`. Exempting the
line beats dropping `accent-brand` from the rule, which would have let a
genuinely faded card border through in order to keep one spinner.

**The segmented thumb takes two shadows, not one.** A wide soft shadow lifts it
off the track; a tight dark one directly beneath draws its bottom edge, which is
what makes a shape read as a physical control rather than as a lighter patch of
background. A hairline does the same job on the top and sides, where a shadow
cannot reach. Dropping either shadow is most of why a hand-rolled segmented
control looks flat. In dark mode the shadow under a light thumb is invisible, so
the lift comes from the edge instead.

**An unselected segment is not muted.** Muted is the colour of text you cannot
act on, and using it on the other half of a segmented control tells people that
half is disabled. Unselected sits at `text-foreground/75`; the selected one
carries weight and the accent.

**Segments are divided by hairlines that vanish beside the selection.** The
divider is what says "these are separate buttons" before anything is pressed,
and removing it on both sides of the thumb is what keeps the control reading as
one object rather than a row of tiles.

**A control carries its own edge.** A component that reads only because of what
happens to be behind it is broken the first time someone puts it somewhere else,
and nothing catches that: the CSS is token-compliant, the guards pass, and the
control is simply invisible on screen. The segmented control's track is
`bg-muted`; dropped onto the upload panel, which is also `bg-muted`, it painted
itself out, so the unselected half had no edge at all and the selected half read
as a white pill floating loose in the page. The fix belongs on the component, not
the call site, because the next `bg-muted` surface would break it again.

Before shipping a control, ask what it looks like on `--background`, on
`--muted`, and inside a card. If any of the three erases it, it needs a hairline.

### Control height

`--h-ctl: 34px`. **Every control in a row resolves to it** — button, segmented,
input, avatar. Heights derived from padding can never agree across different font
sizes, which is how three heights ended up in one header.

---

## Layout

One shell, owned by `PageShell`: `mx-auto w-full max-w-6xl px-6`. Pages declare no
container, no header, no footer and no `max-w-*` of their own.

Reading columns constrain **measure**, not the shell: prose is `max-w-[68ch]`.

Spacing comes from nine steps only: 4, 8, 12, 16, 24, 32, 48, 64, 96px. Page
padding `py-16`, section gap `space-y-16`, card padding `p-6`, stack inside a card
`space-y-4`.

**Flex `gap` and child `margin` both control spacing and silently add.** One or the
other owns it, never both.

---

## Dialogs

Behaviour comes from Radix (`@radix-ui/react-dialog`): focus trap, focus
restore, Escape, labelling, overlay. Appearance comes from here. Never
hand-roll a dialog out of `fixed inset-0`.

**A dialog is a flex column, never a grid.** It is bounded by
`max-h-[calc(100dvh-2rem)]`, and its body is `flex-1 min-h-0 overflow-y-auto`.

This is worth stating as a rule because the obvious repair does not work and
looks like it should. The dialog was a grid whose body had `min-h-0`, which is
the well-known fix for a grid item refusing to shrink, and it is genuinely
necessary. It is also not sufficient, and the difference is invisible in review:

- `min-h-0` lets the grid **item** shrink
- the implicit grid **row** is still `auto`, meaning max-content
- so the row grows past the container's `max-height`, the item fills the row it
  is given, and `overflow-y-auto` is never handed a box smaller than its content

The result is a dialog that clips nothing and shows no scrollbar. Measured in
headless Chrome at a 663px viewport: panel 631px, body **1298px**,
`scrollHeight === clientHeight`, and the primary button painted **644px below
the bottom edge of the panel**. The upgrade modal spilled its two buttons onto
the page for a full release *after* the fix that was supposed to stop it, and
all six dialogs had the same defect.

`flex-1` is `flex: 1 1 0%`: basis zero, then grow into the space that exists.
With `min-h-0` the body can be smaller than its content, which is the entire
mechanism. Same measurement after: body 629px, `scrollHeight` 1928px,
scrollable, button 25px inside the panel.

**`100dvh`, not `100vh`.** On mobile `vh` is the tallest the viewport ever gets,
so a dialog measured in it hides behind the address bar precisely when the bar
is showing.

### Keeping the actions reachable

A scrolling body is correct for almost every dialog. When the actions must stay
on screen regardless of height, the body is already a bounded flex column, so a
child marked `min-h-0 flex-1` resolves against it and can scroll its own inner
region while the buttons stay put. **This needs no prop.** A `scroll` prop was
written for it and then removed: it added API surface for something the layout
already expressed, and its `overflow-hidden` branch would have clipped content
outright on a viewport too short for even the pinned parts.

The upgrade modal is the case that cannot use a single pinned footer, because
each button belongs to its own plan card. There, the card is the flex column:
its feature list scrolls and its button is pinned to its bottom edge, so both
choices stay visible. Below `md` the cards stack and the body scrolls normally,
because a bounded column of stacked cards on a phone is worse than a scroll.

**`ModalFooter` is used by none of the six dialogs.** Like the `link` button
variant, a slot that nobody reaches for is usually a slot that does not do the
thing its name promises: it sits *inside* the scrolling body, so it never
pinned anything.

---

## Data

### Monospace

Mono is mandatory on machine data **when the value occupies its own element** — a
table cell, a stat tile, a chip, a form field, code. Never inside a running
sentence, on any surface.

That covers: hex addresses, tx hashes, contract addresses, ENS names, 𝕏 handles,
Farcaster usernames, FIDs, API keys, chain IDs, timestamps.

### Numerals

`tabular-nums` on every figure that stacks in a column, animates in place, or acts
as a hero stat.

**Söhne carries `tnum`.** All eight cuts substitute `.lt` glyphs at a uniform 608
units against defaults spanning 376–623. An audit claimed the feature was absent
and that the declarations were inert; parsing the shipped `woff2` files disproved
it. Removing them would have been a regression.

A live or counting figure is the clearest case: proportional digits make a ticking
number visibly wobble.

---

## Affordance

**Actions and labels may never share a treatment.** They differ on four axes at
once, so no single one has to carry it:

| | Action | Label | Badge |
|---|---|---|---|
| Case | sentence | upper | upper |
| Face | sans | mono | mono |
| Icon | leading | none | none |
| Shape | bordered/filled pill | none | tint, no border |

An icon **inside an enclosure** reads as a control. An icon **beside bare text**
reads as identification, so a section heading may carry one and a badge may not.

Further:

- **Label controls by function, never solely by current value.** A theme button
  reading "System" states its value and never its purpose.
- **A control with ≤4 states shows them all** rather than cycling.
- **Editable text carries its affordance at rest**, not only on hover — on touch
  there is no hover.
- **A default is never a generic noun** where a real one can be derived.
  `currentLookupName || 'Results'` is a fallback doing duty as a feature's entire
  self-explanation.
- **No element inside a fixed-height row may change that row's height.** Badges are
  `whitespace-nowrap`, capped at 12ch, and truncate, with the full value in a
  `title`. Any value from user or third-party data is unbounded until proven
  otherwise.
- **One primary action per view**, stated at a different scale. Alternates are
  pills beneath it, never siblings of equal size.
- **One filled button per action row**; the fourth control onward goes into an
  overflow menu. A row of buttons never wraps.
- **A text link inside a table cell or a sentence is `Button variant="link"
  size="inline"`.** The `link` variant existed and was used nowhere, because the
  default 34px control height would have opened up the row; two call sites had
  independently hand-copied its four classes to escape that. `size="inline"` is
  `h-auto p-0`, which names the escape once. Type comes from the cell: `cn` runs
  tailwind-merge, so a caller's `font-mono text-xs` beats the variant's base.
  **When a variant is unused and its classes appear inline nearby, the variant is
  missing a size, not unwanted.**
- **Stat groups state the outcome once at display scale**, with components
  subordinate.
- **No horizontal scrollbar on a content strip, ever.** Strips reflow as a
  responsive grid. `overflow-x-auto` belongs only to a genuine data table.

---

## Motion

Three durations, two curves.

| Token | Value | For |
|---|---|---|
| `--d-press` | 80ms | the press itself |
| `--d-fast` | 120ms | hover, colour, borders |
| `--d-base` | 220ms | state changes |
| `--d-stagger` | 40ms | one step, never past the fourth item |
| `--e-out` | `cubic-bezier(.2,0,0,1)` | anything arriving |
| `--e-inout` | `cubic-bezier(.4,0,.2,1)` | between two on-screen states |

- **Hover changes colour only.** Never size, never shadow: a control that grows
  shifts every neighbour, and this product is mostly dense rows.
- Hover styles sit behind `@media (hover: hover)` so touch devices never latch a
  hover state.
- **Press is the only transform**: `scale(0.97)`. It is also the only feedback that
  works on touch.
- **Focus never animates.** A ring that fades in is a ring that is not there yet.
- **Never animate `width`, `height`, `top`, `left`** — they force layout every
  frame. Use `transform` and `opacity`.
- **Never animate a virtualised row** beyond `background-color`.
- Exits run shorter than entrances.
- **A selected state moves; it does not teleport.** Any control with a visible
  selection — segmented controls, tabs, toggles — animates the selection between
  options rather than repainting it in place. The movement carries the one thing a
  swap throws away: which option you just left. Use `components/ui/segmented.tsx`;
  a second implementation of a moving selection is a second thing to get wrong,
  and the two that existed had already drifted on height, keyboard handling and
  whether the thumb moved at all. A **third** was later found in the admin lookup
  dashboard, and it had drifted further than either: a padding-derived height that
  disagreed with the refresh button beside it, no arrow-key handling, no thumb,
  and a selected state painted in `bg-primary`, so the one control in the product
  whose selection was black sat two panes away from the ones whose selection was
  violet. Consolidation is not a one-time task; a second implementation is worth
  looking for whenever a surface is opened.
- Under `prefers-reduced-motion` the thumb still **moves**, it just arrives
  immediately. Removing the transform would strand it under the wrong option,
  which is a correctness bug rather than a motion preference.

Delight is budgeted to two places: figures counting up when results land, and a
periodic sweep across the Upgrade button (9s cycle, ~24% travel, `rgba(255,255,255,.20)`).

Under `prefers-reduced-motion` every animation and transform stops, including both
of those. **Colour transitions stay** — they carry no movement, so removing them
would take away feedback for no benefit.

---

## Icons

Phosphor (`@phosphor-icons/react`), 1,512 icons, six weights. The weight axis
parallels Söhne's.

- **duotone** at display scale, for illustrative moments
- **regular** at 16px for UI
- **fill** for status dots

Sizes stay in `className` (`h-4 w-4`), not the `size` prop. Phosphor offers both,
and `size` was the original plan here, but a second sizing mechanism alongside
Tailwind classes is one more thing to be inconsistent about: every other dimension
in this codebase is a utility class. One mechanism, and the values are what the
scale constrains — `h-4 w-4` for UI, `h-5 w-5` for controls, `h-10 w-10` for
display.

### Three entrypoints, by render context

| Context | Import | Why |
|---|---|---|
| Client component | `@phosphor-icons/react` | the barrel; context is fine |
| Server component | `@phosphor-icons/react/dist/ssr` | no `useContext`; RSC-safe |
| Share images | prerendered data-URI SVG | Satori cannot render the component |

The barrel resolves through `IconBase`, which calls `useContext`, so a Phosphor
icon in a server component fails the build with `createContext is not a function`.
`/vs/*` and `/blog` are server components.

**Satori renders a Phosphor component as a blank image** — HTTP 200, valid PNG,
correct dimensions, nothing drawn. Prerender to markup with
`renderToStaticMarkup` at build time and emit data URIs.

`XLogo` replaces the 𝕏 character everywhere. Söhne has no U+1D54F, so the glyph
was falling back to another typeface in the app and rendering as tofu on share
cards. Farcaster is the one mark Phosphor lacks; it stays a local SVG.

---

## Surfaces

Ten, and two can only receive this partially. Saying so is better than claiming
coverage.

| Surface | Receives | Notes |
|---|---|---|
| App UI | everything | the reference implementation |
| Marketing `/vs` ×5 | everything | server components; SSR icon entrypoint |
| Blog | everything | plus the prose scale and 68ch measure |
| Admin | everything | 9 components, 2,595 lines |
| Share images ×3 | type, colour, icons, numerals | icons as data URIs; no CSS, no fallback chain |
| Sign-in email | colour, radius, copy | no webfonts, and SVG is unreliable, so no icons |
| Favicon, app icon | the mark | static 512px PNGs |
| Docs | colour, face, logo | **partial** — Mintlify: `docs.json` plus custom CSS |
| AI chat bubble | colour, copy | **partial** — third-party shadow DOM via `adoptedStyleSheets` |
| CSV export | nothing | listed so the count is honest |

---

## Adding a shadcn component

`components.json` is the machine that keeps regenerating whatever this document
has just finished removing, so it is configured to generate as little wrong
material as possible:

| Field | Value | Why |
|---|---|---|
| `iconLibrary` | `phosphor` | was `lucide`, which is not the icon system here |
| `baseColor` | `neutral` | this is what produced `--primary` |
| `style` | `new-york` | left alone; it only affects the initial paste |

**`lucide-react` is uninstalled.** It was a direct dependency, imported by
nothing, sitting in the tree purely because the generator had been pointed at
it. A second icon library that nobody imports is still a second icon library the
next person can reach for. The `icon-library` rule rejects the import, so the
failure names itself rather than arriving as a module-not-found.

`baseColor` has no honest setting. Every value generates the same shadcn
semantic set, `--primary` included, because that set is what the components are
written against. It stays as it is, and the `shadcn-primary` rule catches the
output instead. **Configure the generator where you can, and guard its output
where you cannot.**

### A generated component is a starting point

`npx shadcn add <x>` writes a file that compiles, renders, and is wrong. It
carries the library's radius, its elevation, its control height, its colour
semantics and its idea of a hover. Every one of those is specified in this
document, and none of them survives the paste. Both of the following shipped
exactly that way: `Card` at `border-border/60`, and a `Progress` that no code
ever imported and that painted itself near-black.

So after `add`, before the commit:

1. Replace `primary` / `secondary` / `accent` with the semantic token that
   states what the thing **means**: `accent-brand` for an affordance,
   `attested` for a measured fact.
2. Radius to the five. Height to `--h-ctl` if it is a control.
3. Hairline at full opacity. Shadow only if it floats.
4. `transition-control`, not `transition-colors`: the tokens carry the durations.
5. Icons to Phosphor, sized in `className`. Note that shadcn's own Phosphor
   template emits `strokeWidth`, which Phosphor does not have: it takes `weight`.
   Even a correctly configured generator produces a prop that does nothing.
6. Check it on `--background`, on `--muted`, and inside a card.

**If the component duplicates one that exists, the answer is a variant on the
existing one, not the new file.** `Button` had a `link` variant that nothing
used while two call sites hand-copied its classes; what was missing was a size,
and the second implementation would have hidden that.

---

## Enforcement

Two CI jobs and an ESLint rule guard what a grep can see:

| Guard | Covers |
|---|---|
| `scripts/check-palette-guard.mjs` | raw palette classes, all 22 shaded families |
| `scripts/check-design-language.mjs` | radius, elevation, arbitrary type sizes, the uppercase label, hairline opacity, the unadapted `primary` token, the wrong icon library |
| `eslint.config.mjs` | the palette rule, in the editor |

Both scripts run their **own fixtures first**, so a guard that has stopped working
fails before it can report a clean codebase. They must be tested against fixtures,
not against the code they are meant to bless — the palette guard passed clean twice over live violations, once because
its regex required whitespace before the class, once because it omitted six colour
families.

A grep answers "is this value on-system?" It cannot answer "does this render?" or
"is this the right token for this size?" Two components sharing a class name
produce perfectly token-compliant CSS and a destroyed layout.

**Scope styles to components.** Three bugs in one afternoon came from one
component's styles reaching another: a duplicated class name, a reused class name,
and one rule serving three call sites.
