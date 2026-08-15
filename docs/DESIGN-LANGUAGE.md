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

## Enforcement

Two CI jobs and an ESLint rule guard what a grep can see:

| Guard | Covers |
|---|---|
| `scripts/check-palette-guard.mjs` | raw palette classes, all 22 shaded families |
| `scripts/check-design-language.mjs` | radius, elevation, arbitrary type sizes, the uppercase label |
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
