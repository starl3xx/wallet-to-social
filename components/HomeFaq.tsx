import { CaretDown } from '@phosphor-icons/react/dist/ssr';
import { FOCUS_RING } from '@/components/ui/button';
import { FAQ, faqPageJsonLd, type FaqBlock } from '@/lib/faq';

/**
 * The answers, on the page a reader and an extractor can both see.
 *
 * ## Why this is a component and not JSX on the homepage
 *
 * `app/page.tsx` is 98KB of `use client` lookup UI. Pasting 675 words of prose
 * into it would put the site's best-written copy in the hardest file to find it
 * in, so the homepage composes this instead and the answers stay in
 * `lib/faq.ts`.
 *
 * There is no `use client` here, deliberately: this renders static markup from
 * constants and needs no browser. Today the homepage's own client boundary
 * still pulls it into that bundle, which is a property of `app/page.tsx` rather
 * than of this file, and it stops being true the moment that page's client body
 * is split out. Nothing here should acquire a hook in the meantime.
 *
 * ## Why `<details>` rather than state
 *
 * The answers collapse, and that is the whole reason this file still has no
 * hook: `<details>`/`<summary>` is the browser's own disclosure widget, so the
 * open state, the keyboard behaviour and the expanded/collapsed announcement
 * come from the platform rather than from an effect. Same pattern, classes and
 * caret as the holder-report accordion, so the two read as one control.
 *
 * It also keeps the answers where they have to be. A closed `<details>` is
 * collapsed, not absent: every word is still in the HTML for a crawler, for an
 * assistant reading the page, and for in-page find. Rendering the answers only
 * once opened would have moved 675 words of the site's best copy out of the
 * document, which is the opposite of why they were written.
 *
 * ## Why the FAQPage script is here
 *
 * It was in `app/layout.tsx`, so every URL on the site carried an FAQPage,
 * `/privacy` included, and none of them rendered a question. It ships with the
 * answers now, on the one page that has them, and it is built from the same
 * array the prose above it renders.
 */
export function HomeFaq() {
  return (
    <section
      aria-labelledby="faq-heading"
      className="mt-16 border-t border-border pt-12"
    >
      <h2
        id="faq-heading"
        className="mb-6 text-2xl font-light tracking-[var(--tracking-title)]"
      >
        Frequently asked questions
      </h2>

      {/* Not a `dl` any more. A `dl` may only hold `dt`, `dd` and a wrapping
          `div`, so a `details` cannot live inside one without inventing
          markup that validates as neither. The machine-readable pairing was
          never carried by the tags anyway: the FAQPage script below is built
          from the same array and says which answer belongs to which
          question. */}
      <div>
        {FAQ.map((entry) => (
          <details
            key={entry.id}
            id={entry.id}
            className="group border-b border-border last:border-0"
          >
            <summary
              className={`flex cursor-pointer list-none items-start justify-between gap-4 py-4 font-semibold transition-control hover:bg-fill-subtle [&::-webkit-details-marker]:hidden ${FOCUS_RING}`}
            >
              {/* The question wraps, so the row grows rather than sitting at
                  a fixed control height the way the one-line holder-report
                  questions can. The caret keeps its own line box so it stays
                  beside the first line instead of drifting to the middle of
                  a three-line question. */}
              <span className="max-w-[65ch]">{entry.question}</span>
              <CaretDown
                className="acc-caret mt-1 h-4 w-4 flex-none text-muted-foreground group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <div className="space-y-3 pb-6">
              {entry.answer.map((block, i) => (
                <AnswerBlock key={i} block={block} />
              ))}
            </div>
          </details>
        ))}
      </div>

      {/* Built from FAQ above, never typed twice. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPageJsonLd()) }}
      />
    </section>
  );
}

/**
 * One block of one answer.
 *
 * The table is a real `<table>` with a row header and a caption rather than a
 * grid of divs, because the whole point of the match-rate answer is that a
 * reader takes the row for their own chain. A screen reader and an extractor
 * both need the row label bound to its cells to do that.
 */
function AnswerBlock({ block }: { block: FaqBlock }) {
  if (block.kind === 'p')
    return <p className="max-w-[65ch] text-muted-foreground">{block.text}</p>;

  return (
    <div className="max-w-[65ch] overflow-x-auto">
      <table className="w-full caption-bottom text-sm">
        <caption className="mt-3 text-left text-sm text-muted-foreground">
          {block.caption}
        </caption>
        <thead>
          <tr className="border-b border-border">
            {block.columns.map((column, i) => (
              <th
                key={column}
                scope="col"
                className={`py-2 font-medium ${i === 0 ? 'text-left' : 'text-right'}`}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr key={row[0]} className="border-b border-border last:border-0">
              <th scope="row" className="py-2 text-left font-normal">
                {row[0]}
              </th>
              {row.slice(1).map((cell, i) => (
                <td
                  key={i}
                  className="py-2 text-right tabular-nums text-muted-foreground"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
