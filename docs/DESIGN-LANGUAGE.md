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

| Token                               | Means                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `accent-brand`, `accent-brand-tint` | **an affordance.** Anything you can act on: buttons, links, focus, selected, the logo       |
| `attested`, `attested-tint`         | **a measured fact.** An identity the owner published, a system that is live, a real outcome |
| `caution`, `caution-tint`           | truncated results, stale records, approaching a limit                                       |
| `destructive`                       | revoking a key, deleting a lookup                                                           |

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
near-white in dark. It survived because its _name_ reads like a brand token, and
because the palette guard is looking for raw families like `bg-gray-500` and this
is not one. It had spread to both drop targets, so dragging a file onto the page
lit the target **black** while the same component's resting state was violet; to
the admin period toggle and its stage bars; to six clickable cards; to the text
selection colour inside every input; and to the unused `Progress` primitive. The
`shadcn-primary` rule now rejects it in every utility position.

The general lesson is that **an unadapted library default is more dangerous than
an obviously wrong value**, because it is plausible. A guard that only knows the
library's _palette_ cannot see the library's _semantics_.

**Every token is `oklch()`. Never wrap one in `hsl()` or `rgb()`.**
`hsl(var(--primary))` expands to `hsl(oklch(...))`, which is not a colour, so
the browser drops the declaration. Nothing warns: it compiles, it lints, and it
looks like a theme-aware value. Two admin sparklines passed it as `stroke` and
`fill`. Measured in Chrome, `stroke` computed to **`none`** and `fill` to
**black**, so the trend line was never drawn at all and the area under it was a
grey wash that read as a deliberate style. **A wrong colour is visible; a
dropped one looks like a design.** The `colour-function-wrapper` rule rejects
it. Pass `var(--token)`, which works anywhere a colour is accepted, including an
SVG paint attribute.

### Contrast

Both themes clear WCAG AA, measured rather than asserted, and
`scripts/check-contrast.mjs` reads the tokens straight out of `globals.css` so
the numbers cannot drift from what ships.

|             | dark    | light   |
| ----------- | ------- | ------- |
| body text   | 18.97:1 | 19.80:1 |
| muted text  | 7.66:1  | 4.74:1  |
| brand       | 6.41:1  | 9.17:1  |
| attested    | 8.47:1  | 6.15:1  |
| destructive | 5.01:1  | —       |

**A control's edge is not decoration, and needs 3:1.** WCAG 1.4.11 asks for 3:1
on anything required to identify a component. `--input`, which draws the
boundary on text fields and on the outline button, was **1.26:1 in light and
1.48:1 in dark**: an empty field was a rectangle you had to already know was
there. It is now `oklch(0.64 0 0)` and `oklch(0.55 0 0)`, solved against the
worst surface each theme puts a control on rather than picked by eye.

**Decorative separation is exempt, and stays quiet.** A card border and a table
rule are not controls, so `--border` keeps its 1.26:1 and the hairline aesthetic
survives. This is the whole reason the fix is one token and not a re-tone: the
guard checks control edges and deliberately does not check `--border`.

**A control boundary must be opaque.** The dark value was `oklch(1 0 0 / 15%)`,
a white wash, so its contrast changed with whatever sat behind it: it met the
ratio on the page and missed it on a card. The guard rejects a translucent token
in that position by name rather than by number.

Two conventions this palette deliberately does not follow, recorded so the next
audit does not re-litigate them:

- **The page is `#0a0a0a`, darker than the `#121212` convention.** Near-black
  raises halation around light text and can smear on OLED during scroll.
- **Body text is `#fafafa`, effectively pure white**, where the convention
  softens high-emphasis text to about 87% for the same reason.

Both are legible by a wide margin and both are taste. They are listed as choices
rather than left to look like oversights.

### Selected text

One rule, in `globals.css`, on bare `::selection`. Selected text was the
operating system's blue on every surface except inside an input, which carried
its own `selection:` classes and so was the single place in the product that
highlighted in the brand hue. Two treatments, and the inconsistent one was the
only deliberate one.

It is global for the same reason the checkbox accent is: selection applies to
every surface and no primitive owns "text", so a per-component rule guarantees
the next component gets it wrong.

**The tint, not the solid accent.** Selection covers whole paragraphs at a time,
and a saturated violet behind running text fights the text it is meant to be
marking. `--foreground` stays on top, so contrast holds in both themes.

---

## Type

Söhne, self-hosted in `public/fonts`. Geist Mono via `next/font`, already wired to
`--font-mono`.

### Weight — five, each with one job

| Weight | Cut         | Used for                                                          |
| ------ | ----------- | ----------------------------------------------------------------- |
| 200    | Extraleicht | display tier only: hero, page h1, share cards, hero figures       |
| 300    | Leicht      | section headings, ledes, standfirsts                              |
| 400    | Buch        | body and UI                                                       |
| 500    | Kräftig     | labels, buttons, table figures                                    |
| 600    | Halbfett    | headings h3, card titles, the emphasis span inside a display line |

**The emphasis span is the signature.** One 600-weight word inside a 200-weight
line. It costs nothing: both cuts are already loaded.

**Every page opens the same way.** An h1 at the display tier
(`text-4xl font-extralight tracking-[var(--tracking-display)]`, `sm:text-5xl`
on the marketing pages only) carrying one emphasis span, then a 300 lede
(`text-lg font-light tracking-[var(--tracking-lead)] text-muted-foreground`),
then a `Figure` row where figures exist. Section h2 is
`text-2xl font-light tracking-[var(--tracking-title)]`; a card title is
`text-lg font-semibold`. Home, /check, the blog and admin were each opening
differently; now only the words differ.

### Tracking — bound to size, four steps

| Token                | Value      | Applies at  |
| -------------------- | ---------- | ----------- |
| `--tracking-display` | `-0.04em`  | ≥32px       |
| `--tracking-title`   | `-0.028em` | 20–31px     |
| `--tracking-lead`    | `-0.012em` | 16–19px     |
| `--tracking-body`    | `-0.006em` | body and UI |

Checking that a value _is_ a token is not the same as checking it is the _right_
token for its size. The wordmark passed every automated check while using
`--tracking-lead` at 34px.

### Uppercase labels — one tracking

`--tracking-label: 0.14em`, mono, 11px, uppercase. **This is the only uppercase text in the
product.** Any `uppercase` not accompanied by `font-mono` is a violation.

---

## Shape

### Radius — five values, all named

| Token           | Value | Applies to                                            |
| --------------- | ----- | ----------------------------------------------------- |
| `--radius-lg`   | 14px  | cards, panels, inputs, modals, dropzones              |
| `--radius-mark` | 9px   | the brand mark, the one square-ish object             |
| `--radius-sm`   | 6px   | badges, inline code                                   |
| _(none)_        | pill  | buttons, segmented controls: `rounded-full`, no token |
| —               | 50%   | dots and avatars only                                 |

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

`--height-control: 34px`. **Every control in a row resolves to it** — button, segmented,
input, avatar. Heights derived from padding can never agree across different font
sizes, which is how three heights ended up in one header.

**It is a width as much as a height.** `size-control` takes both from the same
token, so raising it moves the header row, not just the control. The phone
header fits 320px with 4px to spare, and two of its parts are 34px squares: the
avatar and the collapsed Buy credits. At 44px that row is 336px, which is 16px
over the screen the whole "header on a phone" section exists to fit. That is the
argument against raising the token, and it is arithmetic rather than taste.

34px is under Apple's 44pt recommendation and above the WCAG 2.2 AA floor, which
is 24px. Every control on the homepage meets AA. Where 44 is genuinely wanted it
is bought as a **hit area, not as a height**: `::after { content:''; position:absolute; inset:-5px }`
on a `relative` control, which reaches 44 without moving a pixel of layout and
keeps the token at one value. Measure the `gap-2` runs first: a −5px inset eats
10px of an 8px gap.

**A control may not be a flex item on the axis that carries its height.**

`flex-1` is `flex: 1 1 0%`, and on a flex item the basis supplies the main size,
so `height` is never consulted. In a `flex-col` container the main axis is
vertical, so `flex-1` silently discards `h-control`; the container has no free
space to grow into, and `min-height: auto` drops the control to its content
height.

Measured at 390px, before this was fixed: the two homepage alternates rendered
**22px** and the reverse-lookup field **35.5px**, beside a Segmented and a button
at 34px. Three heights in one control row, which is the failure this token was
created to end, reappearing three panes below the header where it was first
fixed. Both were 34px at `sm` and above, which is why no desktop review ever saw
either.

Write `sm:flex-1`, or put `flex-1` on a wrapper `div` and leave the control
alone. `ReachabilityChecker.tsx` already had the second spelling while two other
call sites had the first: one idea, three spellings, one correct.

**No grep can catch this.** Every class involved is on-system, and all twelve
rules in `check-design-language.mjs` pass over it. It is the defect this document
predicts under Enforcement: a guard that reads class strings answers "is this
value on-system?" and cannot answer "what height did this render at?". The rule
that catches it opens a browser.

---

## Layout

One shell, owned by `PageShell`: `mx-auto w-full max-w-6xl px-6`. Pages declare no
container, no header, no footer and no `max-w-*` of their own. The shell renders
the whole header row itself on every page: lockup, tier or balance chip, Buy
credits, the theme control, the account control, and one viewport-wide hairline
beneath. **One exception, named:** admin passes `wide` for `max-w-7xl`, because
dense tables genuinely need more than 1152px.

Reading columns constrain **measure**, not the shell: prose sits in a
`max-w-[68ch]` column, left-aligned inside the shell on every page. (/vs and
the blog post centred it while /check and the blog index did not; one rule.) On a blog post the column is a `text-lg` wrapper around
the header, the prose, the back link and the CTA, so all four share one left
edge; `ch` is computed from the wrapper's size, not the prose's.

### The header on a phone

A row of `flex-none`, `whitespace-nowrap` parts has one width, and it is the
same width on a phone as on a desktop. The header measured **606px and never
shrank**, so it overflowed every phone made: by 231px at 375, by 286px at 320.
Nothing caught it, because nothing overflowed _its own_ box; the row simply
pushed past the viewport.

The 606px, measured with Söhne loaded: 48 padding, 36 mark, 162 wordmark, 30
gaps, and **338 of actions**. Actions are always the problem, because the brand
is one object and the actions are four.

What gives, below `sm`, and why each is defensible on its own and not only for
space:

| Part                    | Below `sm`          | Why                                                                   |
| ----------------------- | ------------------- | --------------------------------------------------------------------- |
| `.social`               | hidden              | the address, not the name; 46px                                       |
| Theme toggle            | moves to the footer | 132px, and the footer is on every page                                |
| "Free · N matches" chip | hidden              | a visitor with no account does not need a badge saying so; 61px       |
| Mark and wordmark       | 28px / 20px         | steps down as one lockup, not a shrunken word beside a full-size mark |

An account holding credits keeps its balance chip at every width, for the same
reason the free chip goes: the chip is the only thing saying the account is
paid, and the balance is the one number a buyer came back to check. The row can
afford it because a signed-in row carries an avatar instead of "Sign in" and the
Buy credits button collapses to the icon control (`size="icon"`, named by
`aria-label`) below `sm`; measure it anyway. Legacy Pro
and Unlimited keep their chip too: those rows are shorter still, with no Buy
credits button at all.

That brings it to **316px**, which clears 320 by 4px and 375 by 59. Desktop is
untouched at 606px.

**Measure a header before trusting it.** Every part here was individually
on-system, and the row was unusable on the most common screen size the product
has.

### The page on a phone

The section above is a measured pass over one row. For a long time nothing
comparable existed for the body, and the sentence that closes it turned out to
describe the homepage exactly: every element below the header was individually
on-system, and the column still read as incoherent at 390px.

What was found there, measured at 390px against the 342px the shell leaves:

|                            | before     | after        |
| -------------------------- | ---------- | ------------ |
| Opening block              | 263px      | **195px**    |
| Proof row (three `Figure`) | 137px      | **69px**     |
| Dropzone top edge          | 394px      | **326px**    |
| The two alternates         | 22px       | **34px**     |
| Reverse-lookup row         | 34/35.5/34 | **34/34/34** |

Two lessons, both of which generalise:

**A gap that fits on a desktop is a wrap on a phone, and a wrap costs double.**
The proof row's three figures need 273px of content; two 48px gaps ask for 369px
against 342px, so the row broke 2 + 1 and doubled its height. It was larger than
the h1 and the lede combined, and it was most of why the opening read as
oversized. The fix is a responsive gap, not a smaller figure: `gap-x-4` below
`sm`, the row's own value above it. 16px is the only step on the scale that still
fits at 360.

**A separator joined into a string dangles when the string wraps.** Any list
built with `.join(' · ')` ends a wrapped line on the middot. Lay the items out as
flex children and let the gap separate them; the separator then has nothing to
dangle from, at any width.

**A desktop layout narrowed is not a phone layout.** Every defect here came from
a value chosen at one width and never measured at another. The h1, the lede and
the shell were fine. What failed was three gaps and two flex declarations.

### Breakpoints

Tailwind's own, plus **one**: `xs` at 360px.

It exists because a two-across grid of _controls_ fails earlier than a grid of
tiles, and the difference is `whitespace-nowrap`. A tile's label wraps and the
tile grows; a button's label cannot, so it spills out of the pill and over its
neighbour. Measured with Söhne loaded: the admin nav's longest label needs
138px, a 320px screen gives its cell 132px, and at 360px the cell is 152px and
every label fits.

The step is at the measured failure, not at a round number, and 360px is also
the narrowest phone still in general use. **A grid of buttons needs one more
step than a grid of text.**

**One named exception to the control height: the network picker tile.** The
importer's chain tiles are 64px, not `h-control`'s 34px, because they carry the
network's mark above its name and 34px has room for neither. That height is what
let "Robinhood Chain" wrap out of its own box and, for one release, be shortened
to "Robinhood" to fit. The exception is the tile only; every other control in
that modal is still 34px.

Spacing comes from nine steps only: 4, 8, 12, 16, 24, 32, 48, 64, 96px. Page
padding `py-16`, section gap `space-y-16`, card padding `p-6`, stack inside a card
`space-y-4`.

**Flex `gap` and child `margin` both control spacing and silently add.** One or the
other owns it, never both.

`spacing-scale` in `check-design-language.mjs` enforces this on `gap`, `gap-x`,
`gap-y`, `space-x` and `space-y`, integers and half steps alike. The half steps
are the point: the first version of the rule matched integers only, reported
clean, and was missing nineteen live values (`gap-1.5` fourteen times,
`space-y-0.5` three, `gap-2.5` twice). Those are now on the scale, mostly at 8px,
which is what the majority of icon-to-label gaps in the tree already use.

**Padding and margin are not covered, deliberately.** They carry 95 fractional
values of which 82 are `mt-0.5`, a 2px nudge that sits an icon on a text
baseline. That is optical alignment rather than layout spacing, and it wants its
own answer rather than being swept up by a rule written for gaps.

Name a class inside a comment in backticks. The guard keeps backtick out of its
lead-in set precisely so prose can quote the class it explains; an unquoted one
is read as markup, which is how the footer's own note about this cleanup ended
up failing the rule it was describing.

---

## Dialogs

Behaviour comes from Radix (`@radix-ui/react-dialog`): focus trap, focus
restore, Escape, labelling, overlay. Appearance comes from here. Never
hand-roll a dialog out of `fixed inset-0`.

**A dialog is a flex column, never a grid.** It is bounded by
`max-h-[calc(100dvh-2rem)]`, and its body is `flex-1 min-h-0 overflow-y-auto`.

**Six dialogs, one anatomy.** Title at 18px/600 with no leading icon (Buy
credits keeps a display-size title as the one named exception: the purchase
moment earns display type; decided 2026-08-22); actions in `ModalFooter`,
which has one layout; inset panels on
`bg-muted` at `p-4`; an error beside a control is `InlineError`
(`components/ui/inline-error.tsx`): a 14px destructive line with the 16px
warning glyph, announced as an alert, never a box. The panel arrives by fade
and `scale(0.97)` over `--duration-base` and leaves over `--duration-fast`; the close is a
ghost icon button named "Close". Below `sm` the panel keeps its radius and
inset.

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
the page for a full release _after_ the fix that was supposed to stop it, and
all six dialogs had the same defect.

`flex-1` is `flex: 1 1 0%`: basis zero, then grow into the space that exists.
With `min-h-0` the body can be smaller than its content, which is the entire
mechanism. Same measurement after: body 629px, `scrollHeight` 1928px,
scrollable, button 25px inside the panel.

**`100dvh`, not `100vh`.** On mobile `vh` is the tallest the viewport ever gets,
so a dialog measured in it hides behind the address bar precisely when the bar
is showing.

### The distinction that makes grid look guilty

A grid row shrinks when its container has a **definite** height. It does not
when the container is merely capped by `max-height`.

That is the whole difference, and it puts two nearly identical pieces of markup
on opposite sides of the bug:

| Grid              | Height from                        | Auto row         | Result                      |
| ----------------- | ---------------------------------- | ---------------- | --------------------------- |
| the dialog        | `max-height` only                  | max-content      | overflows, nothing clips    |
| the upgrade cards | `flex: 1 1 0%` on a bounded parent | stretched to fit | shrinks, inner list scrolls |

A review of the second one will find the same implicit `auto` row as the first
and reasonably call it the same defect. Measured across 713px, 533px and 413px,
with and without an explicit row, Chrome behaves identically: the list scrolls
and the button stays 42px inside the panel.

Write `grid-rows-[minmax(0,1fr)]` anyway wherever a row must be allowed to
shrink. It costs one class, it is the same courtesy `min-h-0` performs for flex,
and depending on which of the two cases you are in is what produced the release
this section exists to explain.

### Keeping the actions reachable

A scrolling body is correct for almost every dialog. When the actions must stay
on screen regardless of height, the body is already a bounded flex column, so a
child marked `min-h-0 flex-1` resolves against it and can scroll its own inner
region while the buttons stay put. **This needs no prop.** A `scroll` prop was
written for it and then removed: it added API surface for something the layout
already expressed, and its `overflow-hidden` branch would have clipped content
outright on a viewport too short for even the pinned parts.

The upgrade modal is the case that cannot use a single pinned footer, because
each button belongs to its own pack card. There, the card is the flex column:
its feature list scrolls and its button is pinned to its bottom edge, so both
choices stay visible. Below `md` the cards stack and the body scrolls normally,
because a bounded column of stacked cards on a phone is worse than a scroll.

**`ModalFooter` was used by none of the six dialogs**, which was the tell. Like
the `link` button variant, a slot nobody reaches for is usually a slot that does
not do what its name promises: it sat _inside_ the scrolling body, so it pinned
nothing.

It is now passed as `ModalContent`'s `footer` prop rather than as a child,
because **a child cannot escape the scroller it is inside.** The prop renders it
below the body, `flex-none`, with a top hairline so the row reads as separate
from content that has scrolled up behind it.

Most dialogs should still pass nothing. A body that scrolls as one block is the
better default, and a footer costs vertical space on the screens that have least
of it. Pass one when the step is tall _and_ its actions are the reason it
exists: the contract import preview carries a chain picker, a holder count, a
truncation warning and a sample of addresses above two buttons, so the buttons
are held below. Its other two steps are short and pass nothing.

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

|       | Action               | Label | Badge           |
| ----- | -------------------- | ----- | --------------- |
| Case  | sentence             | upper | upper           |
| Face  | sans                 | mono  | mono            |
| Icon  | leading              | none  | none            |
| Shape | bordered/filled pill | none  | tint, no border |

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
- **A card you can click is a control, and must be reachable by keyboard.** The
  six tiles on the admin Pulse pane carried `onClick` on the card `div` and
  nothing else: no role, no tab stop, no Enter or Space. They _looked_ like
  controls, with `cursor-pointer` and a hover border, and no keyboard could
  reach any of them. Use `CardActivator`, which stretches a real `<button>` over
  the card. A real button rather than `role="button"` plus a `keydown` handler,
  because it brings the whole contract at once, and an overlay rather than
  wrapping the card, because `<button>` takes phrasing content and these tiles
  are built from `div`s. **A hover state is not an affordance if only a mouse
  can find it.**
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
  responsive grid. `overflow-x-auto` belongs only to a genuine data table. The
  admin panel broke this in the most costly place available: its own navigation,
  twelve destinations in two `flex ... overflow-x-auto` strips. A sideways
  scrollbar hides things behind a gesture people do not know is offered, and on
  a narrow screen it hid half the panel. `AdminNav` reflows two, three or six
  across, matching the tile grid directly beneath it so the two read as one
  rhythm.
- **Navigation is `nav` with a name, not a fake tablist.** The temptation with
  twelve buttons is `role="tablist"`, but two separately labelled groups
  pointing at one content region is navigation, and the role would promise
  arrow-key roving that the shape does not want. A landmark per group gives a
  screen reader a way _past_ twelve controls, which a tablist would not.
  `aria-current="page"` states which destination you are on: the filled variant
  already says it, but only to people who can see the fill.

---

## Motion

Three durations, two curves.

| Token                | Value                     | For                                  |
| -------------------- | ------------------------- | ------------------------------------ |
| `--duration-press`   | 80ms                      | the press itself                     |
| `--duration-fast`    | 120ms                     | hover, colour, borders               |
| `--duration-base`    | 220ms                     | state changes                        |
| `--duration-stagger` | 40ms                      | one step, never past the fourth item |
| `--ease-out-soft`    | `cubic-bezier(.2,0,0,1)`  | anything arriving                    |
| `--ease-in-out-soft` | `cubic-bezier(.4,0,.2,1)` | between two on-screen states         |

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
periodic sweep across the Buy credits button (9s cycle, ~24% travel, `rgba(255,255,255,.20)`).

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

| Context          | Import                           | Why                                |
| ---------------- | -------------------------------- | ---------------------------------- |
| Client component | `@phosphor-icons/react`          | the barrel; context is fine        |
| Server component | `@phosphor-icons/react/dist/ssr` | no `useContext`; RSC-safe          |
| Share images     | prerendered data-URI SVG         | Satori cannot render the component |

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

| Surface            | Receives                      | Notes                                                         |
| ------------------ | ----------------------------- | ------------------------------------------------------------- |
| App UI             | everything                    | the reference implementation                                  |
| Marketing `/vs` ×5 | everything                    | server components; SSR icon entrypoint                        |
| Blog               | everything                    | plus the prose scale and 68ch measure                         |
| Admin              | everything                    | 9 components, 2,595 lines                                     |
| Share images ×3    | type, colour, icons, numerals | icons as data URIs; no CSS, no fallback chain                 |
| Sign-in email      | colour, radius, copy          | no webfonts, and SVG is unreliable, so no icons               |
| Favicon, app icon  | the mark                      | static 512px PNGs                                             |
| Docs               | colour, face, logo            | **partial** — Mintlify: `docs.json` plus custom CSS           |
| AI chat bubble     | colour, copy                  | **partial** — third-party shadow DOM via `adoptedStyleSheets` |
| CSV export         | nothing                       | listed so the count is honest                                 |

---

## Adding a shadcn component

`components.json` is the machine that keeps regenerating whatever this document
has just finished removing, so it is configured to generate as little wrong
material as possible:

| Field         | Value      | Why                                             |
| ------------- | ---------- | ----------------------------------------------- |
| `iconLibrary` | `phosphor` | was `lucide`, which is not the icon system here |
| `baseColor`   | `neutral`  | this is what produced `--primary`               |
| `style`       | `new-york` | left alone; it only affects the initial paste   |

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
2. Radius to the five. Height to `--height-control` if it is a control.
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

Four CI jobs and an ESLint rule. Three of them guard what a grep can see; the
fourth opens a browser, because the other three cannot see a rendered box:

| Guard                               | Covers                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/check-palette-guard.mjs`   | raw palette classes, all 22 shaded families                                                                                                                                                                                                                                                                                              |
| `scripts/check-design-language.mjs` | radius, elevation, arbitrary type sizes (px and rem; the 11px label may be written only inside `Eyebrow` and `Badge`), the uppercase label, hairline opacity (every tint included), the unadapted `primary` token, the wrong icon library, `transition-colors` and `transition-all`, a `/NN` wash on a surface token, a tracking literal |
| `scripts/check-contrast.mjs`        | WCAG AA in both themes: 4.5:1 text, 3:1 control edges                                                                                                                                                                                                                                                                                    |
| `scripts/check-control-height.mjs`  | **rendered** height: every visible element carrying `h-control` or `size-control` measures the token, on three pages at six widths, plus no sideways scroll                                                                                                                                                                              |
| `eslint.config.mjs`                 | the palette rule, in the editor                                                                                                                                                                                                                                                                                                          |

Every guard runs its **own fixtures first**, so one that has stopped working
fails before it can report a clean codebase. They must be tested against fixtures,
not against the code they are meant to bless — the palette guard passed clean twice over live violations, once because
its regex required whitespace before the class, once because it omitted six colour
families.

A grep answers "is this value on-system?" It cannot answer "does this render?" or
"is this the right token for this size?" Two components sharing a class name
produce perfectly token-compliant CSS and a destroyed layout.

**That paragraph described a real defect for as long as it stood unenforced.** On
2026-08-23 a Button carrying `h-control` was given `flex-1` inside a `flex-col`
row; a flex basis replaced its height and it rendered 22px on every phone and
34px from `sm` up. Every class was on-system, all twelve rules passed over it,
ESLint was quiet, the build was green, and it shipped. `check-control-height.mjs`
is the answer: it drives the runner's own Chrome over the DevTools protocol,
installs nothing, needs no secrets, and asserts only what a browser knows.

It checks only elements that **declare** the contract, so there is no exception
list and no judgment about what counts as a control: an element that never asks
for the control height is not one. Its fixture is the 2026-08-23 bug itself,
which matters more here than elsewhere, because a browser guard has more ways to
succeed silently than a grep does. A detached browser, a selector matching
nothing, or a settle that fires before the font loads all produce an empty
violation list, and an empty violation list reads exactly like a healthy page.

**Scope styles to components.** Three bugs in one afternoon came from one
component's styles reaching another: a duplicated class name, a reused class name,
and one rule serving three call sites.
