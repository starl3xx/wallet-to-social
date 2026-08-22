/**
 * Truncation, written once for the admin panel.
 *
 * Before this, the same cut was made by hand in seven places: five used three
 * periods and two used the ellipsis character, and a wallet was cut to
 * `6…4` in two panes and `10…6` in a third. One helper is the only way the
 * length stays single.
 *
 * `…` (U+2026), never `...`. The three-period spelling is three glyphs in a
 * monospace cell and spaces unevenly in a proportional one; the character is
 * one glyph and the same typographic rule as the curly apostrophe in
 * CLAUDE.md.
 */

/** A hex wallet cut to its first six and last four characters. */
export const shortWallet = (wallet: string) =>
  `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;

/** A uuid or similar opaque id cut to its first eight characters. */
export const shortId = (id: string) => `${id.slice(0, 8)}…`;
