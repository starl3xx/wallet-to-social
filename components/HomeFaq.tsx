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
        Questions people ask
      </h2>

      <dl className="space-y-8">
        {FAQ.map((entry) => (
          <div
            key={entry.id}
            id={entry.id}
            className="border-b border-border pb-8 last:border-0 last:pb-0"
          >
            <dt className="mb-2 max-w-[65ch] font-semibold">
              {entry.question}
            </dt>
            <dd className="space-y-3">
              {entry.answer.map((block, i) => (
                <AnswerBlock key={i} block={block} />
              ))}
            </dd>
          </div>
        ))}
      </dl>

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
