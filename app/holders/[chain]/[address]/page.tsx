import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageShell } from '@/components/ui/page-shell';
import { Figure } from '@/components/ui/figure';
import { Button, FOCUS_RING } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChainMark } from '@/components/ui/chain-marks';
import { CopyAddress } from '@/components/CopyAddress';
import { ArrowRight, CaretDown, Warning } from '@phosphor-icons/react/dist/ssr';
import { FREE_MATCHES_PER_WINDOW, FREE_WINDOW_DAYS } from '@/lib/packs';
import { PRODUCTION_URL } from '@/lib/site-url';
import {
  buildStarterHref,
  STARTER_WALLET_CAP,
} from '@/lib/starter-collections';
import {
  listHolderCollections,
  getHolderCollection,
  getHolderStats,
  getHolderOverlap,
  isNamed,
  measurementInProgress,
  chainLabel,
  standardLabel,
  holderBasis,
  holderBasisPhrase,
  holderBasisCaveat,
} from '@/lib/holder-pages';
import { breadcrumbJsonLd } from '@/lib/breadcrumbs';

/**
 * The per-collection holder reachability report.
 *
 * Every page ranking for "[collection] holders" today lists bare addresses;
 * this one answers the question those searches are actually asking: who are
 * the people behind the wallets, and how many can you reach? The numbers
 * come from the index at ISR time (hourly), so the page moves as the index
 * does, and none of them is a static literal the figure checker would need
 * to watch.
 *
 * Aggregates only, by rule: no wallet list, no handle list. The interactive
 * answer stays /check and the app.
 */
export const revalidate = 3600;

interface Props {
  params: Promise<{ chain: string; address: string }>;
}

export async function generateStaticParams() {
  // A preview build prerenders no holder pages, so it never reads Neon at
  // build time (docs/CI.md, the Vercel row). A holder page visited on a
  // preview still renders on demand through the ordinary request path;
  // production and local builds prerender the full set unchanged. Exact
  // equality on purpose, asserted in `scripts/check-invariants.ts`.
  if (process.env.VERCEL_ENV === 'preview') return [];
  const collections = await listHolderCollections();
  return collections.map((c) => ({ chain: c.chain, address: c.address }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { chain, address } = await params;
  const collection = await getHolderCollection(chain, address);
  if (!collection) return {};
  const canonical = `https://walletlink.social/holders/${collection.chain}/${collection.address}`;
  const title = `${collection.name} holders on ${chainLabel(collection.chain)}: the reachable people`;
  const description = `How many ${collection.name} holders resolve to an X or Farcaster account the owner published, with reachability checked. Measured against the walletlink.social identity index, refreshed daily.`;
  return {
    title,
    description,
    alternates: { canonical },
    /**
     * A placeholder name is a failed read, so this page answers no query and
     * must not be indexed. Dropping it from listHolderCollections stops the
     * hub, the sitemap and prerendering pointing at it, and that is all it
     * stops: the page stays live at its own URL through getHolderCollection,
     * and a URL already submitted in a sitemap does not leave the index by
     * being withdrawn from one. So the directive rides on the page itself,
     * the shape /admin and /success already settled on: a page-level
     * noindex, deliberately not a robots.txt Disallow, because a disallowed
     * URL can still be indexed from a link and Google cannot read a noindex
     * on a page it may not fetch.
     *
     * `follow` is left at its default. The overlap section links real
     * reports, and those links should still be crawled.
     */
    // Spread rather than `robots: cond ? undefined : {...}`: an explicit
    // `robots: undefined` is still a present key, and Next merges metadata
    // key by key, so a present-but-undefined value overrides what an ancestor
    // set instead of inheriting it. The 123 real reports must keep whatever
    // the root layout gives them, so the key is absent for them entirely.
    ...(isNamed(collection.name) ? {} : { robots: { index: false } }),
    openGraph: {
      title,
      description,
      url: canonical,
      type: 'article',
      siteName: 'walletlink.social',
      // Declaring this block is what drops the root segment's
      // opengraph-image file, so the image is named here. Relative, resolved
      // against the apex metadataBase, never a host that redirects.
      images: ['/opengraph-image'],
    },
    // X reads twitter:* over og:*; a page without the block inherits the
    // root layout card (the /check lesson).
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/twitter-image'],
    },
  };
}

/**
 * The date this collection's holder set was last confirmed onchain, or null
 * when there is no date to state.
 *
 * `lastSeenAt` is null only for a seeded contract with no holdings rows at
 * all, which `getHolderStats` already answers with a 404, so a rendered
 * report has a date in practice. The parse guard covers the other case: an
 * unreadable value is not an error anywhere downstream, it is a Date that
 * quietly prints "Invalid Date" in the sentence and NaN into the schema.
 * Returning null instead drops the clause and publishes neither.
 */
function confirmationDate(lastSeenAt: string | null): Date | null {
  if (!lastSeenAt) return null;
  const at = new Date(lastSeenAt);
  return Number.isFinite(at.getTime()) ? at : null;
}

/**
 * The same calendar day the sentence above prints, as an ISO date.
 *
 * Built from the local components rather than `toISOString`, which converts to
 * UTC first: the column is a timestamp with no zone, so it parses as local
 * time, and on a build machine east or west of UTC the ISO conversion can land
 * on the day either side of the one the reader is shown. Production builds and
 * revalidations run in UTC, where the two agree, so this costs three lines and
 * removes the one way the schema could contradict the copy beside it. The
 * sitemap keeps publishing the full timestamp as `lastmod`; a day is all a
 * snapshot of a holder set can honestly claim here.
 */
function isoDay(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export default async function HolderPage({ params }: Props) {
  const { chain, address } = await params;
  const collection = await getHolderCollection(chain, address);
  if (!collection) notFound();
  const [stats, overlap] = await Promise.all([
    getHolderStats(chain, address),
    getHolderOverlap(chain, address),
  ]);
  if (!stats) notFound();

  // What the measured set is, decided once in lib/holder-pages.ts and used
  // by both the visible sentence and the Dataset node. They computed it
  // separately before and disagreed on the six contracts whose reported
  // total came back as exactly the cap: the prose claimed "all 2,000" while
  // the Dataset said the real base may be larger. CryptoPunks is one of
  // those, and reading punkIndexToAddress onchain finds well over 2,000
  // distinct owners, so the prose was the false half.
  const basis = holderBasis(collection);
  // Only a genuine total may be published as one. `unknownTotal` is the
  // seeder writing 0 because the source reported nothing, which is 44 of
  // the 177 named contracts.
  const totalHoldersIsKnown =
    basis.kind === 'sample' || basis.kind === 'complete';
  // The hedge the phrase deliberately leaves out, so both the sentence and
  // the Dataset description carry it as a sentence of its own.
  const basisCaveat = holderBasisCaveat(basis);
  const reachablePct =
    stats.holderCount > 0
      ? Math.round((stats.reachableAny / stats.holderCount) * 1000) / 10
      : 0;

  const canonical = `${PRODUCTION_URL}/holders/${collection.chain}/${collection.address}`;

  // The date the holder set was last confirmed onchain, which the sitemap has
  // published as this URL's lastmod all along while the report itself carried
  // no date anywhere a reader or a text extractor could find one.
  const confirmedAt = confirmationDate(collection.lastSeenAt);
  // Named rather than inlined: scripts/check-invariants.ts allowlists the
  // reads a structured-data date may come from, by identifier, so a clock
  // read cannot hide behind a local const. This one has to appear in that
  // list to be used, which is the point.
  const holderSetConfirmedIso = confirmedAt ? isoDay(confirmedAt) : null;
  const confirmedOn = confirmedAt?.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: `${collection.name} holders on ${chainLabel(collection.chain)}: the reachable people`,
    author: {
      '@type': 'Organization',
      name: 'walletlink.social',
      url: 'https://walletlink.social',
    },
    publisher: {
      '@type': 'Organization',
      name: 'walletlink.social',
      url: 'https://walletlink.social',
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': canonical,
    },
  };

  /**
   * The Dataset node, beside the Article rather than instead of it.
   *
   * The page is both things: a piece of writing about a collection, and the
   * only published measurement of that collection's reachable population.
   *
   * What it must never publish is a bare holder count. `holderCount` is the
   * capped sample the aggregate ran over, not the collection's holder base,
   * so the sample and the true total go out as two separately named
   * variables and the reachable count carries the denominator it was computed
   * against. A single number here would be read as the whole collection by
   * exactly the machine readers this node exists for.
   *
   * `license` and `temporalCoverage` are absent on purpose: no licence covers
   * these figures (the repository licence covers code, not measurements), and
   * a snapshot has no range. `dateModified` is the holder set's own
   * confirmation date, the same value the visible sentence and the sitemap
   * carry, so the three cannot contradict each other.
   */
  const measuredHolders = stats.holderCount.toLocaleString();
  const population = holderBasisPhrase(basis, {
    measuredNoun: 'addresses',
    ofCollection: ` holding ${collection.name}`,
  });
  const datasetLd = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: `${collection.name} holder reachability on ${chainLabel(collection.chain)}`,
    description: [
      `Reachability measured over ${population} on ${chainLabel(collection.chain)}: how many resolve to an X handle or a Farcaster account their owner published, and how many of those still reach somebody.`,
      // The same sentence the visible copy carries, from the same predicate,
      // so the node and the prose cannot say different things about what was
      // measured.
      basisCaveat,
      measurementInProgress(stats)
        ? `${stats.checked.toLocaleString()} of the ${measuredHolders} sampled addresses have been checked so far, so every rate here is a lower bound that rises as the rest are checked.`
        : null,
      confirmedOn
        ? `Holder set last confirmed onchain on ${confirmedOn}; the identity index behind these figures refreshes daily.`
        : null,
      'Aggregates only: no wallet list and no handle list is published.',
    ]
      .filter((sentence): sentence is string => sentence !== null)
      .join(' '),
    url: canonical,
    creator: {
      '@type': 'Organization',
      name: 'walletlink.social',
      url: PRODUCTION_URL,
    },
    isAccessibleForFree: true,
    ...(holderSetConfirmedIso ? { dateModified: holderSetConfirmedIso } : {}),
    variableMeasured: [
      {
        '@type': 'PropertyValue',
        name: 'measuredHolders',
        description:
          basis.kind === 'sample' || basis.kind === 'capped'
            ? 'Addresses sampled from the top of the holder list. Every rate here is measured over this sample, never over the full holder base.'
            : 'Addresses holding the collection that the index has imported. Every rate here is measured over these.',
        value: stats.holderCount,
      },
      ...(totalHoldersIsKnown
        ? [
            {
              '@type': 'PropertyValue',
              name: 'totalHolders',
              description:
                'Addresses holding the collection in total: the population the measured sample is drawn from.',
              value: collection.totalHolders,
            },
          ]
        : []),
      {
        '@type': 'PropertyValue',
        name: 'withXHandle',
        description:
          'Measured holders carrying an X handle their owner published. Carrying a handle and reaching it are different claims.',
        value: stats.withTwitter,
      },
      {
        '@type': 'PropertyValue',
        name: 'withFarcaster',
        description: 'Measured holders carrying a Farcaster account.',
        value: stats.withFarcaster,
      },
      {
        '@type': 'PropertyValue',
        name: 'reachableAny',
        description: `Measured holders with a live X handle or a Farcaster account, out of the ${measuredHolders} measured. The denominator is that sample, never the full holder base of the collection.`,
        value: stats.reachableAny,
      },
    ],
  };

  // The trail the page already draws above the headline. The chain rides in
  // the leaf name rather than becoming a crumb of its own, because there is
  // no /holders/<chain> route to point a middle crumb at (lib/breadcrumbs.ts).
  const breadcrumbJson = breadcrumbJsonLd([
    { name: 'Holder reports', path: '/holders' },
    {
      name: `${collection.name} on ${chainLabel(collection.chain)}`,
      path: `/holders/${collection.chain}/${collection.address}`,
    },
  ]);

  return (
    // `wide`, the admin exception's second caller, same reason: the report
    // carries a 384px action rail beside dense content, and inside the
    // default shell the rail would squeeze the column to 688px.
    <PageShell wide>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJson) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetLd) }}
      />
      {/* The data-page opening: an ENTITY, not a sentence. Marketing pages
          keep the 200-weight display h1 with its emphasis span; a report
          opens with the thing measured (30px/600 name at the title tracking,
          a muted qualifier, the machine row) and puts the four numbers a
          searcher came for directly beneath, in the operational figure tier.
          The prose that used to sit above them moves below the strip; the
          Dataset node and the dated sentence are unchanged.

          The report carries the action rail on the wide shell (the admin
          exception, second caller, same reason: 1232px splits into content +
          32px gap + a 384px rail). The grid places the rail in the right
          column from lg; below lg the DOM order IS the mobile order: header
          and strip, then the rail, then the evidence. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-x-8">
        <div className="lg:col-start-1 lg:row-start-1">
          <p className="mb-3 text-sm text-muted-foreground">
            {/* The link variant at inline size: the one treatment for a text
                link inside a sentence, with the underline affordance and focus
                ring a bare anchor lacked. Button renders the Link via Slot, so
                it works in a server component. */}
            <Button asChild variant="link" size="inline">
              <Link href="/holders">Holder reports</Link>
            </Button>{' '}
            / {chainLabel(collection.chain)}
          </p>
          {/* Wrapping is the phone pass: the qualifier and badge drop to
              their own lines under the name in wrap order, so no element
              changes a fixed row's height and nothing is joined into a
              string that could dangle a separator. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ChainMark chain={collection.chain} className="h-6 w-6 flex-none" />
            <h1 className="text-3xl font-semibold leading-[1.2] tracking-[var(--tracking-title)]">
              {collection.name} holders
            </h1>
            <span className="text-2xl font-normal tracking-[var(--tracking-title)] text-muted-foreground">
              {standardLabel(
                collection.contractType,
                collection.chain,
                collection.address
              )}
            </span>
            <span className="text-2xl font-normal tracking-[var(--tracking-title)] text-muted-foreground">
              {chainLabel(collection.chain)}
            </span>
            <Badge tone="attested" className="max-w-none">
              {reachablePct}% reachable
            </Badge>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <CopyAddress address={collection.address} />
          </div>

          <dl className="mt-7 flex flex-wrap gap-x-4 gap-y-4 sm:gap-x-8">
            <Figure
              variant="stat"
              value={stats.holderCount.toLocaleString()}
              label="holders measured"
            />
            <Figure
              variant="stat"
              value={stats.withTwitter.toLocaleString()}
              label="with an X handle"
            />
            <Figure
              variant="stat"
              value={stats.withFarcaster.toLocaleString()}
              label="on Farcaster"
            />
            <Figure
              variant="stat"
              value={`${stats.reachableAny.toLocaleString()} (${reachablePct}%)`}
              label="reachable people"
              attested
            />
          </dl>

          {/* A page whose holders are mostly unchecked is a measurement still
              running, not a measured rate, and must say so directly under the
              strip it qualifies. The caution panel is the app's one warning
              idiom. A fully checked page skips it. */}
          {measurementInProgress(stats) && (
            <div className="mt-6 flex max-w-[68ch] items-start gap-3 rounded-lg border border-caution bg-caution-tint p-4">
              <Warning
                className="mt-0.5 h-4 w-4 flex-none text-caution"
                aria-hidden
              />
              <p className="text-sm text-caution">
                Measurement in progress: {stats.checked.toLocaleString()} of{' '}
                {stats.holderCount.toLocaleString()} holders checked so far.
                Every reachable person shown was really found, so the numbers
                here are lower bounds; they rise as the remaining holders are
                checked.
              </p>
            </div>
          )}
        </div>

        {/* The action rail: the tool stays on screen while the evidence
            scrolls. One hero button, the view's only filled action; the
            free-allowance sentence rides with it so the price question is
            answered where the button is. */}
        <aside className="mt-10 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0">
          <div className="rounded-lg border border-border bg-card p-6 lg:sticky lg:top-8">
            <div className="flex items-center gap-2">
              <ChainMark
                chain={collection.chain}
                className="h-6 w-6 flex-none"
              />
              <span className="text-base font-semibold tracking-[var(--tracking-lead)]">
                {collection.name}
              </span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Runs {collection.name} itself, on up to {STARTER_WALLET_CAP} of
              the holders measured here: we hold the list, so there is nothing
              to upload. A wallet we cannot resolve costs nothing.
            </p>
            <p className="mb-4 mt-2 text-xs text-muted-foreground">
              Free covers {FREE_MATCHES_PER_WINDOW} matches in a rolling{' '}
              {FREE_WINDOW_DAYS}-day window.
            </p>
            {/* buildStarterHref, not buildContractDeepLink: that one targets
                the paid importer and would meet a reader without credits with
                a price. */}
            <Button asChild size="hero" className="w-full">
              <Link
                href={buildStarterHref(collection.chain, collection.address)}
              >
                Run these holders
                <ArrowRight aria-hidden />
              </Link>
            </Button>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="soft" asChild>
                <Link href="/pricing">Pricing</Link>
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Or bring your own wallets, by upload or paste, on the{' '}
              <Button asChild variant="link" size="inline">
                <Link href="/">homepage</Link>
              </Button>
              .
            </p>
          </div>
        </aside>

        <div className="mt-12 max-w-[68ch] lg:col-start-1 lg:row-start-2">
          <p className="text-sm text-muted-foreground">
            {/* Derived from the same predicate as the Dataset node, not
              restated. This sentence is the half an answer engine quotes,
              so when the two disagreed it was this one that shipped the
              over-claim. */}
            Measured over{' '}
            {holderBasisPhrase(basis, {
              measuredNoun: 'holders',
              ofCollection: '',
            })}
            , against the walletlink.social index.{' '}
            {/* Its own sentence, not a trailing clause: this is the half that
              says the measured count is not the holder base, and it has to
              survive being quoted on its own. */}
            {basisCaveat ? `${basisCaveat} ` : ''}
            {/* The one dated sentence on the page, and the half of the dating
              work that matters: the sitemap has published this date as
              lastmod for every report all along, and a date carried only in a
              header or a script tag does not survive the text extraction an
              answer engine quotes from. The refresh clause rides in the same
              sentence so a quote of one carries the other, because the two
              are different facts: the holder set is a snapshot taken on a
              date, the identity index measured against it is not. */}
            {confirmedOn
              ? `Holder set last confirmed onchain on ${confirmedOn}; the identity index behind these figures refreshes daily.`
              : 'The identity index behind these figures refreshes daily.'}
          </p>

          <section className="mt-12">
            <h2 className="mb-3 text-2xl font-light tracking-[var(--tracking-title)]">
              Having a handle and reaching it are different claims
            </h2>
            <p className="mb-4 text-muted-foreground">
              Each X handle here was published by the wallet&rsquo;s owner, and
              each carries a reachability state checked against X itself. A
              campaign sent to the full handle list would mail accounts that no
              longer reach anyone; the reachable number above already excludes
              them.
            </p>
            <dl className="grid grid-cols-2 items-start gap-x-8 gap-y-6 border-t border-border pt-6 sm:grid-cols-4">
              <Figure
                value={stats.xLive.toLocaleString()}
                label="X handles live"
                attested
              />
              <Figure
                value={stats.xSuspended.toLocaleString()}
                label="suspended"
              />
              <Figure
                value={stats.xUnclaimed.toLocaleString()}
                label="names nobody holds"
              />
              {/* No data is not a median of zero; n/a says which claim this is. */}
              <Figure
                value={
                  stats.medianFcFollowers !== null
                    ? stats.medianFcFollowers.toLocaleString()
                    : 'n/a'
                }
                label="median Farcaster followers"
              />
            </dl>
          </section>

          {overlap.length > 0 && (
            <section className="mt-12">
              <h2 className="mb-3 text-2xl font-light tracking-[var(--tracking-title)]">
                These holders also hold
              </h2>
              {/* The list is already on the page; this states its top row as a
                sentence, which is the form that survives extraction. Nothing
                new is disclosed: the counterparty is ordered first by the same
                query, and every row it can name already cleared the overlap
                floor in lib/holder-pages.ts. */}
              <p className="mb-4 text-muted-foreground">
                The strongest overlap is {overlap[0].name}, which{' '}
                {overlap[0].sharedHolders.toLocaleString()} of these holders
                also hold.
              </p>
              {/* A chip cloud, the named exception to "a row of buttons never
                wraps": a collection of equivalent navigational chips, not an
                action row, so it wraps by design and no member is filled.
                Each chip is a soft Button carrying the neighbouring report;
                the count stays muted and tabular beside the name. */}
              <div className="flex flex-wrap gap-2">
                {overlap.map((o) => (
                  <Button
                    key={`${o.chain}:${o.address}`}
                    variant="soft"
                    asChild
                  >
                    <Link
                      href={`/holders/${o.chain}/${o.address}`}
                      title={`${o.sharedHolders.toLocaleString()} shared holders on ${chainLabel(o.chain)}`}
                    >
                      {o.name}
                      <span className="font-normal tabular-nums text-muted-foreground">
                        {o.sharedHolders.toLocaleString()}
                      </span>
                    </Link>
                  </Button>
                ))}
              </div>
            </section>
          )}

          {/* The measurement, as questions a reader actually asks, each answer a
            complete quotable sentence: these pages exist for extraction, and
            details content is present in the extracted text whether open or
            closed. Native disclosure, no JS: the caret rotates (and under
            reduced motion arrives instantly, still rotated), the trigger is a
            real summary with the focus ring, and rows divide on hairlines
            inside one card. The 48px trigger is a list row, named beside the
            card footer row and the network tile as the ladder's list-row
            exceptions. */}
          <section className="mt-12">
            <h2 className="mb-3 text-2xl font-light tracking-[var(--tracking-title)]">
              About this measurement
            </h2>
            <div className="rounded-lg border border-border bg-card px-4">
              {[
                {
                  q: 'What does “reachable” mean here?',
                  a: 'A holder counts as reachable when the wallet resolves to an X handle that is live today, or to a Farcaster account. A handle that is suspended, or a name nobody holds any more, was really found but reaches nobody, so it is excluded from the reachable count above.',
                },
                {
                  q: `Why ${stats.holderCount.toLocaleString()} holders, and not the full holder base?`,
                  // The completeness sentence rides ONLY on the kinds that
                  // earned it: `holderBasisCaveat` is also null for a sample of
                  // a larger known total, and these answers are written to be
                  // quoted alone, so a fallback claim would over-claim exactly
                  // the way the old prose did.
                  a: `The measurement runs over ${holderBasisPhrase(basis, { measuredNoun: 'holders', ofCollection: '' })}.${basisCaveat ? ` ${basisCaveat}` : basis.kind === 'complete' ? ' That is the full imported holder set for this collection.' : ''}`,
                },
                {
                  q: 'When was this measured?',
                  a: confirmedOn
                    ? `Holder set last confirmed onchain on ${confirmedOn}; the identity index behind these figures refreshes daily.`
                    : 'The identity index behind these figures refreshes daily.',
                },
              ].map(({ q, a }) => (
                <details
                  key={q}
                  className="group border-t border-border first:border-t-0"
                >
                  <summary
                    className={`flex h-12 cursor-pointer list-none items-center justify-between gap-4 text-base font-medium tracking-[var(--tracking-lead)] transition-control hover:bg-fill-subtle [&::-webkit-details-marker]:hidden ${FOCUS_RING}`}
                  >
                    {q}
                    <CaretDown
                      className="acc-caret h-4 w-4 flex-none text-muted-foreground group-open:rotate-180"
                      aria-hidden
                    />
                  </summary>
                  <p className="max-w-[62ch] pb-4 text-sm text-muted-foreground">
                    {a}
                  </p>
                </details>
              ))}
            </div>
          </section>
        </div>
      </div>
    </PageShell>
  );
}
