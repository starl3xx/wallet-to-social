/**
 * The terms of service, with the acceptable-use policy inside them.
 *
 * Written against the code rather than from a template, under the same two
 * rules as `app/privacy/page.tsx`, and one more.
 *
 * **Every figure is imported, never restated.** Prices, match counts, the
 * credit lifetime, the free allowance, the submission multiplier, the x402
 * pack and the rate-limit presets all come from the constants the product
 * enforces (`lib/packs.ts`, `lib/api-plans.ts`, `lib/match-gate.ts`,
 * `lib/ip-rate-limiter.ts`). A contract that states a number the code does
 * not enforce is the privacy page's defect with money attached. The credit
 * lifetime is stated in days, not months, for that reason: lots expire at
 * `CREDIT_LIFETIME_DAYS`, and twelve calendar months is a day longer when the
 * period holds 29 February.
 *
 * **The canonical sentences are quoted, never retyped.** What a match is, what
 * attested means, the four reachability states and "absent is not false" come
 * from `lib/canonical-sentences.ts`, so these terms cannot drift from the API,
 * llms.txt and the MCP server.
 *
 * **Promise only what the code can do.** There is no account suspension: the
 * enforcement section lists revoking keys and disconnecting applications,
 * which exist. An account block and deletion for a breach are Linear STA-47,
 * and the page names them only once they ship. The reverse lookups refuse a
 * key bought with USDC alone (`lib/x402-account.ts`), so the terms say so.
 * Who the product is not for is already published in `app/llms.txt/route.ts`;
 * the acceptable-use rules below are written to agree with it.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/ui/page-shell';
import { Eyebrow } from '@/components/ui/eyebrow';
import { LEGAL_ENTITY } from '@/lib/site-url';
import {
  PACKS,
  PACK_IDS,
  CREDIT_LIFETIME_DAYS,
  FREE_MATCHES_PER_WINDOW,
  FREE_WINDOW_DAYS,
  SUBMISSION_MULTIPLIER,
  GOODWILL_OVERAGE_RATE,
  X402_PACKS,
  X402_MAX_QUANTITY,
  LEGACY_UNLIMITED_DAILY_WALLETS,
} from '@/lib/packs';
import { API_PLANS, CREDIT_API_PLAN, PACK_API_PLAN } from '@/lib/api-plans';
import {
  MATCH_SENTENCE,
  ATTESTED_SENTENCE,
  REACHABILITY_SENTENCE,
  ABSENT_SENTENCE,
} from '@/lib/canonical-sentences';
import { ANON_MATCHES_PER_JOB, ANON_MATCHES_PER_DAY } from '@/lib/match-gate';
import { IP_RATE_LIMITS } from '@/lib/ip-rate-limiter';
import { TIER_LIMITS } from '@/lib/access';
import { QUARANTINE_RETENTION_DAYS } from '@/lib/removal-admin';

export const metadata: Metadata = {
  title: 'Terms of service',
  description:
    'What you agree to when you use walletlink.social: credits, refunds, rate limits, and what you may not do with what the service returns.',
  alternates: { canonical: 'https://walletlink.social/terms' },
};

const UPDATED = '25 September 2026';

const n = (x: number) => x.toLocaleString('en-US');

/** One rate-limit preset in words, read from the plan the limiter enforces. */
function planLimits(planId: string): string {
  const p = API_PLANS[planId];
  const ceilings =
    p.requestsPerDay === -1
      ? 'no daily or monthly ceiling'
      : `${n(p.requestsPerDay)} a day and ${n(p.requestsPerMonth)} a month`;
  return `${n(p.requestsPerMinute)} units a minute, ${ceilings}, and batches of up to ${n(p.maxBatchSize)} addresses`;
}

const AGENT = X402_PACKS.agent;

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-10 scroll-mt-24">
      <h2 className="text-2xl font-light tracking-[var(--tracking-title)]">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function Mail() {
  return (
    <a
      href="mailto:help@walletlink.social"
      className="text-accent-brand underline underline-offset-4"
    >
      help@walletlink.social
    </a>
  );
}

const LINK = 'text-accent-brand underline underline-offset-4';

export default function TermsPage() {
  return (
    <PageShell>
      <div className="mx-auto max-w-[68ch] py-12">
        <Eyebrow className="text-muted-foreground">Legal</Eyebrow>
        <h1 className="mt-3 text-4xl font-extralight leading-[1.02] tracking-[var(--tracking-display)]">
          Terms of service
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Last updated {UPDATED}. walletlink.social is operated by{' '}
          {LEGAL_ENTITY}. Write to <Mail /> about anything on this page; a
          person reads it.
        </p>

        <Section id="short" title="The short version">
          <p>
            These terms cover everything at walletlink.social: the website, the
            REST API, the MCP server and the onchain credit rail. They go with
            the{' '}
            <Link href="/privacy" className={LINK}>
              privacy policy
            </Link>
            , which says what we hold and why.
          </p>
          <p>
            Four sentences cover most of it. You buy credits once, and a credit
            is spent only on a match: a wallet resolved to an X or Farcaster
            account. Refunds are limited to the cases listed below, so try the
            free allowance first. You may use what you find to reach the holders
            of your own token or collection, and your own community. You may not
            use it to stalk, expose, track or profile anyone, and if you do, we
            may revoke your API keys and disconnect your applications.
          </p>
        </Section>

        <Section id="agreement" title="Who this agreement is with">
          <p>
            walletlink.social is operated by {LEGAL_ENTITY} (“we”, “us”), a
            limited liability company organized in Wyoming. These terms are an
            agreement between us and whoever uses the service (“you”). The
            service is for business and professional use only. You use it on
            behalf of a business, even when that business is you alone, so “you”
            also means that business, and you confirm that you can bind it to
            these terms. If a consumer protection law that cannot be waived
            applies to you anyway, nothing in these terms takes away a right it
            gives you.
          </p>
          <p>
            You accept these terms when you create an account, buy credits,
            create an API key, connect an application, pay for credits onchain,
            or use the service in any other way. When you buy credits, at
            checkout or onchain, you also confirm that you agree to them, and we
            record the time and the version of these terms with the purchase.
          </p>
          <p>You must be at least 18 years old to use the service.</p>
          <p>
            The privacy policy explains what we hold about you and about the
            people in the index, and for how long. Read it with these terms.
          </p>
        </Section>

        <Section id="service" title="What the service does">
          <p>
            We resolve wallet addresses on Ethereum and other EVM chains to the
            X and Farcaster accounts their owners published, and back again.
          </p>
          <ul className="ml-4 list-disc space-y-2">
            <li>
              A forward lookup takes one address or a list and returns the
              social accounts attached to each, with the evidence behind every
              match.
            </li>
            <li>
              A reverse lookup takes an X handle or a Farcaster username and
              returns the wallets attested to it, a page at a time. It returns
              only wallets whose recorded evidence is all attested, and it needs
              an account with an email address.
            </li>
            <li>
              The web app runs both, saves your lookups, exports results as a
              CSV file or an X list, and can send direct messages on Farcaster
              from your own account.
            </li>
            <li>
              The REST API and the MCP server do the same for your own software
              and for AI agents. They draw on the same balance as the app.
            </li>
            <li>
              The onchain rail lets software buy credits with USDC on Base and
              receive an API key, with no card and no email.
            </li>
          </ul>
          <p>
            {ATTESTED_SENTENCE} No link between a wallet and an account is
            inferred from a display name or a bio.
          </p>
          <p>
            Our answers come from public and third-party sources. We keep them
            in a permanent index, which also answers other customers’ lookups.
            The privacy policy explains what that means for you and for the
            people in it.
          </p>
          <p>
            We may change, add or remove features. Before we remove a paid
            feature, such as the API or reverse lookup, we will tell account
            holders by email at least 30 days ahead, and credits that have not
            expired stay usable on the rest of the service.
          </p>
        </Section>

        <Section
          id="accounts"
          title="Accounts, keys and connected applications"
        >
          <p>
            Your account is an email address. You sign in with a link we send to
            it, and there is no password, so anyone who can read that inbox can
            use your account. Keep it secure, and tell us at once if you think
            someone else has used it.
          </p>
          <p>
            <span className="text-foreground">API keys.</span> Any signed-in
            account can create keys under API keys in the account menu. We show
            a key once and store only a hash of it, so nobody can show it to you
            again, including us. If you lose a key, create a new one and revoke
            the old one. A key spends your whole balance, so keep it on a server
            and never in code a browser downloads. You are responsible for every
            call made with your keys, and by the applications or agents you
            connect, until you revoke or disconnect them. A key you revoke stops
            working at once.
          </p>
          <p>
            <span className="text-foreground">Connected applications.</span> An
            AI client can connect over OAuth instead of using a key. A
            connection can resolve wallets in both directions, run a background
            job and read your balance. It cannot see your saved lookups, your
            billing details or your email address, and it cannot buy credits or
            change anything about your account. Its access lasts an hour and
            renews itself. To end it, open the account menu, then API keys, then
            Connected applications, and choose Disconnect. It stops working on
            the next call, not at the end of the hour.
          </p>
          <p>
            <span className="text-foreground">Wallet accounts.</span> Credits
            bought onchain belong to an account tied to the wallet that paid.
            That account has no inbox and cannot sign in to the website. To
            recover or revoke its keys, you sign with the same wallet, as
            described under paying onchain.
          </p>
          <p>
            Each account is for one business. Do not share an account between
            businesses, and do not open more accounts to get more of the free
            allowance.
          </p>
        </Section>

        <Section id="credits" title="Credits and what they cost">
          <p>
            walletlink.social is sold as credit packs, each a one-time payment.
            There is no subscription, and nothing renews.
          </p>
          <ul className="ml-4 list-disc space-y-2">
            {PACK_IDS.map((id) => (
              <li key={id}>
                {PACKS[id].name}: ${n(PACKS[id].priceCents / 100)} for{' '}
                {n(PACKS[id].matches)} matches
              </li>
            ))}
          </ul>
          <p>
            The{' '}
            <Link href="/pricing" className={LINK}>
              pricing page
            </Link>{' '}
            always shows the current packs. A price change never changes a pack
            you have already bought. Prices exclude taxes, and you pay any tax
            that applies to your purchase. Any promotion, such as bonus credits,
            is described where we offer it. Stripe takes card payments on its
            own pages, and card numbers never reach us.
          </p>
          <p>
            <span className="text-foreground">What a credit buys.</span> One
            credit pays for one match. {MATCH_SENTENCE} Billing is per address,
            not per identity: an address carrying both an X handle and a
            Farcaster account costs one credit. A reverse lookup costs one
            credit per wallet it returns, and nothing when a handle has no
            wallets.
          </p>
          <p>
            <span className="text-foreground">How long credits last.</span>{' '}
            {CREDIT_LIFETIME_DAYS} days from the day you get them, whether you
            bought them or we granted them. We spend the credits that expire
            soonest first, and what is left at expiry is gone.
          </p>
          <p>
            <span className="text-foreground">The free allowance.</span> Every
            account created with an email gets {FREE_MATCHES_PER_WINDOW} matches
            in a rolling {FREE_WINDOW_DAYS}-day window: each match becomes free
            again {FREE_WINDOW_DAYS} days after you spent it. It is there to
            show you your real match rate before you pay. It does not apply
            while you hold any unexpired credits, bought or granted, and
            accounts created by paying onchain do not get it. Some features in
            the app, including reverse lookup, need a pack, and the free
            allowance does not unlock them.
          </p>
          <p>
            <span className="text-foreground">
              Plans bought before credit packs.
            </span>{' '}
            If you bought a plan before credit packs existed, it keeps what it
            was sold with, and nothing on this page reduces it. The old
            unlimited plan has one fair-use limit: at most{' '}
            {n(LEGACY_UNLIMITED_DAILY_WALLETS)} addresses submitted in any 24
            hours, a level that only bulk copying of the index reaches.
          </p>
          <p>Before you spend, know that:</p>
          <ul className="ml-4 list-disc space-y-2">
            <li>
              an API or tool call that resolves more addresses than you have
              left still returns them all, and we refuse the next metered call;
            </li>
            <li>
              a list may be at most {SUBMISSION_MULTIPLIER} times your remaining
              matches, which stops junk lists and does not touch real ones;
            </li>
            <li>
              when a lookup or a background job finds more matches than your
              balance covers, we deliver a margin of{' '}
              {Math.round(GOODWILL_OVERAGE_RATE * 100)}% of your remaining
              balance past it at no charge, and show the rest as locked rows,
              which you do not pay for;
            </li>
            <li>
              a retried API call or tool call is a new call and bills again,
              unless you send an idempotency key to the REST batch endpoint;
            </li>
            <li>
              an estimate is only an estimate, and you pay for what actually
              resolved.
            </li>
          </ul>
          <p>
            Credits have no cash value. You cannot sell them, transfer them to
            another account, or exchange them for money.
          </p>
        </Section>

        <Section id="agent-pack" title="Paying onchain">
          <p>
            Software can buy credits with no account, no card and no email. A
            POST to <code className="font-mono text-xs">/api/x402/buy</code>{' '}
            answers with a payment request. When you pay it in USDC on Base, the
            response contains an API key, unless the paying wallet already holds
            as many active keys as it may, in which case the credits are added
            to its account and no new key is issued.
          </p>
          <ul className="ml-4 list-disc space-y-2">
            <li>
              An {AGENT.name} pack is ${n(AGENT.priceCents / 100)} in USDC for{' '}
              {n(AGENT.matches)} matches. One payment can buy from 1 to{' '}
              {X402_MAX_QUANTITY} packs, at the same price per pack.
            </li>
            <li>
              The credits are the same credits a card buys. We meter them the
              same way, and they last {CREDIT_LIFETIME_DAYS} days.
            </li>
            <li>
              The account the payment creates does not get the free allowance.
            </li>
            <li>
              We show the key once. If you lose it, sign a challenge with the
              wallet that paid, and we issue a new key against the same credits.
              One signature can also revoke all of that wallet’s keys and issue
              a single new one.
            </li>
            <li>
              A payment that carries an existing key adds its credits to that
              key’s account and creates no new key.
            </li>
            <li>
              We cannot charge you twice for the same signed payment: if you
              replay it, the response shows the credits it already bought.
            </li>
            <li>An OAuth connection cannot buy credits.</li>
          </ul>
          <p>
            A key bought this way resolves addresses on the REST API and the MCP
            server: the single, batch and job lookups, the estimate, and the
            free reads. The reverse lookups, from a handle to the wallets behind
            it, need an account with an email address. They refuse this key,
            because that direction can find a person, so somebody has to answer
            for the search.
          </p>
          <p>
            Onchain payments are final. We cannot reverse a transaction on the
            chain, and the refund rule below applies to onchain payments as it
            does to card payments. If a payment settles and we do not record the
            credits, the error contains a settlement reference. Send it to{' '}
            <Mail /> and we will issue the pack by hand. We cannot issue it
            twice. A payment facilitator settles these payments. It sees the
            paying address and the amount, which are already public on the
            chain.
          </p>
        </Section>

        <Section id="refunds" title="Refunds">
          <p>
            We do not refund credits, used, unused or expired, except where the
            law requires it or this page says so. Check first instead: the free
            allowance shows your list’s real match rate before you spend
            anything, and a wallet that resolves to nothing costs nothing either
            way.
          </p>
          <p>
            A payment that went wrong is different, and we will put it right. If
            you paid and received no credits, write to <Mail /> with your
            receipt or the settlement reference, and we will issue them. If you
            were charged twice for one purchase, we refund the duplicate payment
            to the card or wallet it came from once we have confirmed it.
          </p>
          <p>
            If you dispute a card payment with your bank or card issuer, we
            remove the credits that payment bought, and we may revoke your API
            keys while the dispute is open.
          </p>
        </Section>

        <Section id="limits" title="Rate limits">
          <p>
            The API and the MCP server limit how fast you can call, in three
            windows at once: per minute, per day and per month. When you go over
            any one of them, we refuse calls until that window resets. The
            limits count units, not credits: one per single lookup, one per
            address in a batch or an estimate, two per reverse lookup, one per
            job submission, and none for a status poll. The daily and monthly
            limits count every key on the account together. All three follow the
            largest pack your account holds that has not expired:
          </p>
          <ul className="ml-4 list-disc space-y-2">
            <li>
              Free allowance, Trial, Campaign, Agent and granted credits:{' '}
              {planLimits(CREDIT_API_PLAN)}
            </li>
            <li>Scale: {planLimits(PACK_API_PLAN.scale)}</li>
            <li>Index: {planLimits(PACK_API_PLAN.index)}</li>
          </ul>
          <p>
            An account on a plan bought before credit packs existed keeps the
            limits that plan carries. Through the API and the MCP server, one
            background job may be active per account at a time, counting jobs
            started on the website.
          </p>
          <p>
            The website has its own limits. Without signing in, a lookup takes
            up to {n(TIER_LIMITS.free)} addresses and opens at most{' '}
            {ANON_MATCHES_PER_JOB} matches, each IP address can start{' '}
            {IP_RATE_LIMITS['/api/jobs'].limit} lookups an hour, and each IP
            address can open at most {ANON_MATCHES_PER_DAY} matches a day across
            all its lookups. The free tools on the website, such as the handle
            check and the single-address lookup, are capped per IP address, so
            they stay a lookup rather than a data feed.
          </p>
          <p>
            The limits are part of what you buy. If you need more, write to{' '}
            <Mail />. Do not work around them.
          </p>
        </Section>

        <Section id="acceptable-use" title="What you may not do">
          <p>
            walletlink.social exists to help projects reach their own community,
            the people who hold their own token or collection, to check whether
            an account holds your token (for example before a partnership, an
            allowlist or an airdrop), and to study wallets in aggregate. It is
            not for spam, or for targeting people who have no relationship to
            your token. It links wallets to people, so some uses of it would
            harm the people in the index. You may not use the service, or
            anything it returns, to:
          </p>
          <ul className="ml-4 list-disc space-y-2">
            <li>stalk, harass, threaten or intimidate anyone;</li>
            <li>
              target, rob, extort, threaten or physically locate anyone because
              of what they hold;
            </li>
            <li>
              dox or expose a person: publish or share a link between a wallet
              and a person, or what that person holds, to embarrass, endanger,
              pressure or shame them;
            </li>
            <li>
              monitor an individual: repeat lookups of the same person to follow
              what they hold, buy or sell over time, or alert on their wallets
              or accounts;
            </li>
            <li>
              build a profile or dossier of a private person, or combine our
              results with other data to identify someone who has not made the
              link public themselves;
            </li>
            <li>
              infer a person’s health, religion, politics, sexuality or any
              other sensitive trait from what they hold;
            </li>
            <li>
              find, contact or profile anyone below the minimum age above;
            </li>
            <li>
              send spam: bulk messages to people outside your own token,
              collection or community, messages to anyone who has asked you to
              stop, or anything the next section forbids;
            </li>
            <li>
              discriminate against anyone unlawfully, or use our results to
              decide a person’s eligibility for credit, employment, housing,
              insurance or any similar decision about them;
            </li>
            <li>
              defraud anyone: phishing, impersonation, fake airdrops or claims,
              or any message that tries to get a person to connect a wallet,
              sign something or send funds under false pretenses;
            </li>
            <li>
              get around a rate limit, the free allowance or a credit check, for
              example by rotating accounts, keys, wallets or IP addresses, or by
              splitting one job across several accounts;
            </li>
            <li>
              resell, sublicense, publish or redistribute our results in bulk,
              or use them to build or improve a competing dataset, index or
              service;
            </li>
            <li>
              scrape, crawl or systematically query the website, the API or the
              MCP server to copy the index, or reach it any way other than
              through the documented interfaces within their limits;
            </li>
            <li>
              probe, test or attack the service’s security, or interfere with
              its operation or with other customers;
            </li>
            <li>
              break any law or regulation, including privacy, data protection,
              anti-spam, consumer protection and sanctions law, or the rules of
              X, Farcaster or any other platform you use to act on our results.
            </li>
          </ul>
          <p>
            <span className="text-foreground">Sanctions.</span> You confirm that
            you are not a person or organization that the sanctions laws we are
            subject to forbid us to deal with, and that you will not pay us from
            a wallet or an account that belongs to one. We may refuse or end
            service to anyone we believe is.
          </p>
          <p>
            We check the paying address of every onchain payment against the US
            Treasury’s list of Specially Designated Nationals before we accept
            it, and we refuse the payment if the address is on the list or if we
            cannot check it. We do not sell to buyers whose connection comes
            from a country or region under comprehensive US sanctions. If an
            address that paid us is added to the list later, we suspend the
            account the payment was for: its keys stop working, its credits are
            held, and we deal with them as the law requires. If you believe a
            suspension is a mistake, write to <Mail />.
          </p>
          <p>
            If the law gives you duties for personal data you get from us, those
            duties are yours. You receive our results as an independent
            controller: you decide what to do with them, and you need your own
            lawful basis for doing it. We do not process personal data on your
            behalf, so there is no data processing agreement.
          </p>
          <p>
            Two purposes may go beyond these rules, and only after you write to{' '}
            <Mail /> first and tell us what you plan: security research and
            fraud investigation. There is no exception for law enforcement
            through an account. We answer the authorities only when a request
            comes through legal process.
          </p>
        </Section>

        <Section id="outreach" title="Messaging the people you find">
          <p>
            The product is for reaching your own holders, and this is also where
            it is easiest to do harm. When you contact anyone you found through
            us:
          </p>
          <ul className="ml-4 list-disc space-y-2">
            <li>
              write only to people who hold your own token or collection or
              belong to your own community, about your own project, and never to
              the holders of another project’s token;
            </li>
            <li>say who you are and who you speak for;</li>
            <li>
              stop when someone asks you to, and do not contact them again from
              another account;
            </li>
            <li>
              never ask anyone to send funds or approve a token transfer in a
              first message, and when you ask them to connect a wallet or sign
              something, link only to your project’s own domain;
            </li>
            <li>
              follow the rules of the platform you send on, including its limits
              on automated and bulk messages.
            </li>
          </ul>
          <p>
            Direct messages sent from the app, and X lists built from it, go out
            from your own Farcaster or X account, with your own credentials.
            They are your messages: you are responsible for what they say and
            who receives them, and the platform may act against your account.
          </p>
        </Section>

        <Section id="enforcement" title="What we do about misuse">
          <p>
            If we believe you have broken these terms, we may do any of the
            following:
          </p>
          <ul className="ml-4 list-disc space-y-2">
            <li>revoke some or all of your API keys;</li>
            <li>disconnect your connected applications;</li>
            <li>
              hand over data to the authorities where the law requires it, and
              tell you unless we are forbidden to.
            </li>
          </ul>
          <p>
            We will not wait to warn you when a person may be harmed. In other
            cases, where we can, we will tell you what we did and why. If the
            breach is serious, your remaining credits are forfeited. You can
            appeal any of this by writing to <Mail />, and a person will answer
            within 14 days.
          </p>
          <p>
            <span className="text-foreground">How to report misuse.</span> If
            someone is using walletlink.social to harass, track or expose you or
            anyone else, write to <Mail />. Tell us what happened, and include
            any handle, wallet address or message involved. A person reads every
            report. If you only want your own address or handle out of the
            index, you do not need to report anything or prove anything: see the
            section below on being in the index.
          </p>
        </Section>

        <Section id="accuracy" title="What the data is, and what it is not">
          <p>
            Every match carries the evidence behind it. An attested match is one
            the wallet owner published. A correlated match is weaker, and the
            evidence we return with it says so. A reverse lookup returns only
            wallets whose recorded evidence is all attested; a single-wallet
            lookup still shows correlated matches, with their evidence. An
            owner-published name record can name any X handle, and nobody checks
            that the handle’s owner agreed.
          </p>
          <p>
            A match records what was true when the owner made the link, and it
            can stop being true. An X handle can be renamed, suspended, or given
            up and taken by somebody else. {REACHABILITY_SENTENCE}{' '}
            {ABSENT_SENTENCE} Records can also go stale, and we flag the ones we
            have not confirmed again recently.
          </p>
          <p>
            So treat a match as evidence, not as proof of who someone is. Check
            it before you act on it in a way that matters. Never rely on a match
            alone to identify, accuse or make a decision about a person. A
            missing match means we found nothing, not that there is nothing.
          </p>
          <p>
            Match rates, coverage figures and cost estimates are measurements
            and forecasts. They change as the index grows, and your own list
            decides your own number. You pay for what actually resolved, never
            for an estimate.
          </p>
        </Section>

        <Section id="removal" title="If you are in the index">
          <p>
            You may be in the index without ever having used walletlink.social.
            The{' '}
            <Link href="/privacy#indexed" className={LINK}>
              privacy policy
            </Link>{' '}
            tells you how to get out of it, and these terms do not narrow it:
          </p>
          <ul className="ml-4 list-disc space-y-2">
            <li>
              Write to <Mail /> and name each address or handle you want
              removed. We do not ask you to prove ownership first. A person runs
              the removal by hand. We delete each identifier from the index and
              add it to a suppression list that every write path checks, so a
              later sweep cannot put it back. It stays there until you ask us to
              undo the removal, and we keep a copy for{' '}
              {QUARANTINE_RETENTION_DAYS} days only so a removal made in error
              can be undone, as the privacy policy explains. We complete a
              removal within 30 days.
            </li>
            <li>
              If you can sign for the address,{' '}
              <Link href="/claim" className={LINK}>
                Claim your address
              </Link>{' '}
              lets you fill in or confirm the X account we hold for it, or
              withdraw the address from the index and stop us collecting it
              again. You do it yourself. Confirming the account we hold, or
              withdrawing, takes effect at once. If we hold a different account,
              we record your disagreement and keep the old one until it stops
              reaching anyone. You can withdraw a claim later from the same
              page, with the same wallet.
            </li>
          </ul>
          <p>
            A customer who exported a result before you asked still has their
            copy, and we cannot reach it. These terms forbid them to use it
            against you. If they do, report it to us.
          </p>
        </Section>

        <Section id="your-data" title="Your lists and your results">
          <p>
            What you upload stays yours. We use it to run your lookups and keep
            it as the privacy policy describes, and no customer can see another
            customer’s lists.
          </p>
          <p>
            When you look up an address, we write what we learn about it to the
            index, and it answers other customers’ lookups of the same address.
            We share what the sources said about the address, as the privacy
            policy lists it. We never share that you ran the lookup, what else
            was on your list, or what it was for. The one exception is the
            anonymous count of large recent lookups on our home page, which the
            privacy policy describes.
          </p>
          <p>
            We license the results we return to you for your own use: outreach
            to your own community, research and running your project. You may
            share them inside your organization and with people who work for
            you. An agency may use results for a client, for outreach to that
            client’s own community, under these same rules. You may not resell
            or redistribute them in bulk. The license does not end when your
            credits expire. If we tell you that a person in your results has
            asked us to remove them, you must delete that person’s results from
            your copies.
          </p>
        </Section>

        <Section id="warranty" title="No warranty">
          <p>
            This page and our documentation say exactly how our data can be
            wrong. BEYOND THAT, WE PROVIDE THE SERVICE AND EVERYTHING IT RETURNS
            AS IS AND AS AVAILABLE. TO THE EXTENT THE LAW ALLOWS, WE MAKE NO
            PROMISE THAT THE SERVICE WILL BE UNINTERRUPTED, SECURE OR FREE OF
            ERRORS, THAT ANY MATCH IS CORRECT, COMPLETE OR CURRENT, OR THAT THE
            SERVICE FITS ANY PARTICULAR PURPOSE.
          </p>
        </Section>

        <Section id="liability" title="Limits on our liability">
          <p>To the extent the law allows:</p>
          <ul className="ml-4 list-disc space-y-2">
            <li>
              we are not liable for indirect, incidental, special, consequential
              or punitive losses, or for lost profits, revenue, data or
              goodwill;
            </li>
            <li>
              we are not liable for what you do with our results, or for how the
              people you contact respond to you;
            </li>
            <li>
              our total liability for all claims about the service is limited to
              what you paid us in the 12 months before the claim arose, or $100
              if that is greater.
            </li>
          </ul>
          <p>
            Nothing here limits a liability that the law does not let us limit.
          </p>
          <p>
            If someone brings a claim against us because you broke these terms,
            or because of how you used our results, you will cover what that
            claim costs us, including reasonable legal fees.
          </p>
        </Section>

        <Section id="ending" title="Ending this agreement">
          <p>
            You can stop using the service at any time. Revoke your keys and
            disconnect your applications from the account menu. To delete your
            account, write to <Mail />; the privacy policy says what we keep
            afterwards, such as payment records, and why. Your credits end with
            the account, and we do not refund them.
          </p>
          <p>
            We can act on a breach of these terms as described under what we do
            about misuse. We may also close your account for any other reason,
            with 30 days’ notice by email, and then we refund what you paid for
            the credits you have not used and that have not expired. If we stop
            offering the service altogether, we will give at least 60 days’
            notice, and then refund the unused part of any paid credits that
            have not expired, in proportion to what is left.
          </p>
          <p>
            These parts continue after this agreement ends: what you may not do
            with results you already hold, the disclaimers, the limits on
            liability and the indemnity.
          </p>
        </Section>

        <Section id="changes" title="Changes to these terms">
          <p>
            When these terms change, the date at the top changes with it, and we
            record the change in the public changelog. For a change that
            materially affects you, we will email every account holder at least
            30 days before it takes effect, including accounts that have turned
            off product email, because this is a legal notice and not marketing.
            Accounts created by paying onchain have no inbox, so for them the
            date at the top and the changelog are the notice. If you continue to
            use the service after a change takes effect, you accept the new
            terms.
          </p>
          <p>
            A change to these terms never takes away credits you have already
            bought or shortens their life.
          </p>
        </Section>

        <Section id="law" title="Governing law and disputes">
          <p>
            The laws of the State of Wyoming govern these terms, without regard
            to its rules on conflicts of law. Any dispute about these terms or
            the service is heard only in the state or federal courts located in
            Wyoming, and you and we both agree to their jurisdiction. Disputes
            go to court, not to arbitration.
          </p>
          <p>
            You and we each bring claims only on our own behalf, never as a
            plaintiff or a class member in a class or representative action.
          </p>
          <p>
            Before you start any formal dispute, write to <Mail /> and give us
            30 days to try to resolve it.
          </p>
        </Section>

        <Section id="general" title="The rest">
          <p>
            These terms and the privacy policy are the whole agreement between
            you and us about the service. If a court finds part of them
            unenforceable, the rest still applies. If we do not enforce a term
            at once, we have not given it up. You may not transfer this
            agreement without our written consent. If the business is sold, this
            agreement and what we hold go with it, as the privacy policy says.
          </p>
        </Section>

        <Section id="contact" title="Contact">
          <p>
            <Mail />, for a question about these terms, a report of misuse, a
            removal request or a billing problem. It reaches a person rather
            than a queue. walletlink.social is operated by {LEGAL_ENTITY}, a
            limited liability company organized in Wyoming.
          </p>
        </Section>
      </div>
    </PageShell>
  );
}
