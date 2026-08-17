---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications (examples include websites, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI). Generates creative, polished code and UI design that avoids generic AI aesthetics.
license: Complete terms in LICENSE.txt
---

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. There are so many flavors to choose from. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics; unexpected, characterful font choices. Pair a distinctive display font with a refined body font.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays.

NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices (Space Grotesk, for example) across generations.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

Remember: Claude is capable of extraordinary creative work. Don't hold back, show what can truly be created when thinking outside the box and committing fully to a distinctive vision.

---

## Project-specific: read the design language first

**`docs/DESIGN-LANGUAGE.md` is authoritative and it overrides everything above.**
Radius, elevation, type scale, weight, tracking, spacing, control height, mono
policy, numerals, affordance, motion and icons are all fixed there. The guidance
above is written for greenfield work; this project is not greenfield. Preserve
the existing aesthetic rather than reinventing it, and never pick a font,
a radius or a colour that the design language has already decided.

### Before writing a new component

Ask these in order and stop at the first yes. Most UI work in this project stops
at the second one.

1. **Does it need to exist at all?** A pattern used once is not a component.
2. **Does it already exist?** Look in `components/ui/` before writing anything.
   One canonical component per pattern is the rule. A documented variant on the
   existing component always beats a second implementation of the same idea.
3. **Does a token or an existing utility already cover it?** Colour, radius,
   elevation, type scale and control height all have names. A new raw value is
   nearly always a value that already has one.
4. **Can it be a prop on what is already there?**
5. Only then write something new.

When you do skip something, say so in one line and say when it would be worth
adding. Never skip accessibility, error states, input validation, or anything
the user asked for by name.

### Aesthetic preference: Stripe-inspired

**The user prefers a Stripe-like design language for this project.** Reference these characteristics:

### Visual Language
- **Clean minimalism**: Generous whitespace, uncluttered layouts, clear visual hierarchy
- **Soft rounded corners**: five named values, no others. `rounded-lg` for cards,
  panels, inputs and modals (14px); `rounded-full` for buttons and segmented
  controls; `rounded-sm` for badges and inline code (6px); `rounded-mark` for the
  brand mark; 50% for dots and avatars. `rounded-md`, `rounded-xl`, `rounded-2xl`
  and bare `rounded` are banned and CI rejects them.
- **Subtle borders**: Very light grey borders on cards and inputs, always `border-border`
- **Refined shadows**: Minimal, soft box-shadows for elevation when needed

### Color Palette
**Write the token, never the hex.** `app/globals.css` already holds the values
below, an ESLint rule and `.github/workflows/design-tokens.yml` both reject a raw
colour, and the tokens are theme-aware so a `dark:` variant restating the same
token is redundant. This section names the intent; the token is the value.

- **Primary accent**: soft indigo/violet for anything actionable, `accent-brand`
  and `accent-brand-tint`. Affordance only: buttons, links, focus, selected.
- **Status colours**: `attested` for a measured fact, `caution` for stale or
  truncated, `destructive` for revoking and deleting. Each has a `-tint` for the
  badge background. `attested` must never mark an inference.
- **Text hierarchy**: `foreground` for headings, `muted-foreground` for body and
  helper text.
- **Backgrounds**: `background`, with `muted` for the occasional lighter section.

### Typography
- **Bold, confident headings**: Large, heavy-weight titles that anchor the page
- **Clear hierarchy**: Distinct sizing between headings, subheadings, body, and captions
- **Comfortable line-height**: Readable, well-spaced text blocks

### Components
- **Cards**: Light border, white background, comfortable padding (24px+)
- **Buttons**: Solid primary color, white text, subtle hover states
- **Form elements**: Clean radio buttons, select dropdowns with subtle styling
- **Badges/Pills**: Colored text on matching light backgrounds (e.g., green text on light green)
- **Links**: Colored text (indigo/blue), no underline by default

### Interaction
- **Subtle hover states**: Gentle background color shifts, not dramatic transforms
- **Professional feel**: Trustworthy, refined, never playful or gimmicky
