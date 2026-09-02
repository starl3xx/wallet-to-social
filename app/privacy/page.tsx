/**
 * The privacy policy.
 *
 * Two rules were followed writing this, and both are worth keeping.
 *
 * **Every retention period here is one the code enforces.** Three cleanup
 * functions existed and nothing called any of them, so sessions, magic-link
 * tokens and IP buckets accumulated from the day each table was made. Rather
 * than describe that, `app/api/cron/cleanup/route.ts` was written and the
 * periods below are its constants. A policy naming a period no code enforces
 * is a claim with nothing able to contradict it, which is the exact shape of
 * defect this repository has shipped four times.
 *
 * **Processors are named by role, except the ones that are the moat.** CLAUDE.md
 * forbids naming a data provider on any public surface, and that rule is about
 * which sources feed the index. It does not extend to the payment processor or
 * the mail sender, and a policy that hid those would be hiding the thing a
 * reader actually needs. So: infrastructure, payments and mail are named;
 * identity sources are a category, which is what GDPR article 13(1)(e)
 * permits ("the recipients **or categories of recipients**").
 *
 * The one section a reviewer should read twice is "Addresses you look up". It
 * is the only place where this product does something a reader would not guess.
 */
import type { Metadata } from 'next';
import { PageShell } from '@/components/ui/page-shell';
import { Eyebrow } from '@/components/ui/eyebrow';
import { CACHE_TTL_DAYS } from '@/lib/cache-constants';
import {
  ANALYTICS_RETENTION_DAYS,
  JOB_PAYLOAD_RETENTION_DAYS,
} from '@/app/api/cron/cleanup/route';
import { QUARANTINE_RETENTION_DAYS } from '@/lib/removal-admin';
import { NEGATIVE_RECHECK_DAYS } from '@/lib/social-graph';
import { LEGAL_ENTITY } from '@/lib/site-url';
import {
  MAGIC_LINK_DURATION_MINUTES,
  MAGIC_LINK_RETENTION_HOURS,
  SESSION_DURATION_DAYS,
} from '@/lib/auth';
import { IP_BUCKET_RETENTION_HOURS } from '@/app/api/cron/cleanup/route';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description:
    'What walletlink.social collects, why, who else sees it, and how long it is kept.',
  alternates: { canonical: 'https://walletlink.social/privacy' },
};

const UPDATED = '2 September 2026';

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
      <h2 className="text-xl font-semibold tracking-[var(--tracking-title)]">
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

export default function PrivacyPage() {
  return (
    <PageShell>
      <div className="mx-auto max-w-[68ch] py-12">
        <Eyebrow className="text-muted-foreground">Legal</Eyebrow>
        <h1 className="mt-3 text-3xl font-semibold tracking-[var(--tracking-title)]">
          Privacy policy
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Last updated {UPDATED}. walletlink.social is operated by{' '}
          {LEGAL_ENTITY}. Write to <Mail /> about anything on this page; a
          person reads it.
        </p>

        <Section id="short" title="The short version">
          <p>
            We resolve wallet addresses to the social accounts attached to them.
            To do that we hold your email address, what you have paid, what you
            have looked up, and enough technical data to keep the service
            standing up.
          </p>
          <p>
            We do not sell your data, we do not run advertising, and we do not
            share your lookups with anyone. We do keep the wallet-to-identity
            mappings a lookup discovers, and the section on addresses you look
            up explains exactly what that means, because it is the one thing
            here a reader would not guess.
          </p>
        </Section>

        <Section id="collect" title="What we hold, and why">
          <p>
            <span className="text-foreground">Your account.</span> An email
            address, which is the whole account: there is no password and no
            profile. It exists so a sign-in link can reach you and so credits
            can belong to somebody. An account created by paying onchain has a
            wallet address instead, and no working inbox behind it.
          </p>
          <p>
            <span className="text-foreground">What you paid.</span> For a card
            payment, the customer and payment references our payment processor
            returns, and the date. Card numbers never reach us: the payment
            happens on the processor’s own pages. For an onchain payment, the
            paying address and the settlement reference, both of which are
            already public on the chain.
          </p>
          <p>
            <span className="text-foreground">What you looked up.</span> The
            addresses you submitted, the results, and a count. Saved lookups
            keep the full result set so you can open them again.
          </p>
          <p>
            <span className="text-foreground">How the service is used.</span>{' '}
            Page views and product events (an upload started, a checkout
            reached, a limit hit), each carrying a browser identifier and
            sometimes your email address. Also the number of requests an API key
            made, so rate limits and credits can be counted.
          </p>
          <p>
            <span className="text-foreground">Where you arrived from.</span>{' '}
            Recorded once per browser, the first time you land: the{' '}
            <em>domain</em> of the site that linked you, and any campaign tag on
            the address you followed. Never the full web address you came from,
            because those routinely carry other people&rsquo;s search terms and
            session tokens, which we do not want and do not keep. If you create
            an account, that one short value is stored with it so we can tell
            which campaigns brought people. It is never updated afterwards.
          </p>
          <p>
            <span className="text-foreground">Technical data.</span> Your IP
            address, held only as a counter against an hourly bucket so an
            endpoint cannot be scraped, and the browser string attached to a
            sign-in session so you can recognise your own sessions. Our host
            keeps its own request logs, which we do not control.
          </p>
        </Section>

        <Section id="lookups" title="Addresses you look up">
          <p>
            This is the part worth reading twice, because it is how the product
            works rather than an aside.
          </p>
          <p>
            When you look up an address, we ask several public and third-party
            sources who is behind it. The answer is written to a permanent
            index, and that index then answers other people’s lookups of the
            same address. An address that resolves to nobody is recorded as such
            too, so we do not re-ask about it for {NEGATIVE_RECHECK_DAYS} days.
          </p>
          <p>
            <span className="text-foreground">What is shared this way</span> is
            the mapping only: this address belongs to this X handle or this
            Farcaster account. Those facts came from public sources, and they
            are what we sell.
          </p>
          <p>
            <span className="text-foreground">What is never shared</span> is
            anything about you: that you ran the lookup, which addresses you
            submitted together, what your list was for, or what any of it told
            you. Your lists are yours, and no customer can see another
            customer’s.
          </p>
          <p>
            Raw results are also cached for {CACHE_TTL_DAYS} days so a repeated
            lookup costs you nothing.
          </p>
        </Section>

        <Section id="indexed" title="If you are in the index">
          <p>
            You may be in it without ever having used the service. Every mapping
            we hold came from somewhere public: a profile you attested onchain,
            a record you published against your own name, a link you made
            yourself between an account and a wallet. We collect nothing from a
            private source and we hold no wallet balances, no transaction
            history and no contact details for anyone in the index.
          </p>
          <p>
            Write to <Mail /> with the address or handle and we will remove it.
            We do not require you to prove ownership first, because the
            alternative is asking a stranger for more information than we
            already hold about them. Name every identifier you want gone: we
            deliberately keep nothing that would let us work out which wallets
            and which handles belong to the same person, so we cannot find the
            others for you.
          </p>
          <p>
            <span className="text-foreground">What happens next.</span> A person
            reads your email and runs the removal by hand; there is no form and
            no automation between you and it. Each identifier you name is
            deleted from the index and added to a suppression list that every
            write path checks, so an automated sweep that finds the same public
            record later cannot put it back. The removal is permanent. Where a
            customer’s saved lookup that we still hold carries the link, the
            link is removed from it: everything we resolved for the identifier
            is stripped, so the entry reads as if nothing was found. An address
            that was part of the customer’s own uploaded list stays in that
            list, carrying nothing. A saved lookup whose subject is the
            identifier itself (a search for the wallets behind your handle) is
            deleted whole. We complete this within 30 days, the same period as
            every other request on this page.
          </p>
          <p>
            One copy survives, briefly and on purpose. For{' '}
            {QUARANTINE_RETENTION_DAYS} days after a removal we keep what was
            deleted in a table read only by the removal tooling itself, kept so
            a removal made in error (a mistyped address, somebody else’s handle)
            can be undone. After {QUARANTINE_RETENTION_DAYS} days that copy is
            deleted automatically.
          </p>
          <p>
            Two things are beyond our reach whatever we build. A customer who
            exported a result before you asked still has their copy, and we
            cannot reach it: we record which endpoint a customer called and
            never which address they asked about, so we do not know who to tell.
            And a search engine may hold a cached copy of a page for a while
            after we change it.
          </p>
        </Section>

        <Section id="processors" title="Who else sees it">
          <p>
            We use other companies to run the service. Each holds only what its
            job needs, and none of them may use it for anything else.
          </p>
          <ul className="ml-4 list-disc space-y-2">
            <li>
              <span className="text-foreground">Vercel</span> hosts the site and
              provides its page-view analytics.
            </li>
            <li>
              <span className="text-foreground">Neon</span> hosts the database.
            </li>
            <li>
              <span className="text-foreground">Stripe</span> takes card
              payments and holds the card details we never see.
            </li>
            <li>
              <span className="text-foreground">Resend</span> sends sign-in
              links and account mail.
            </li>
            <li>
              <span className="text-foreground">Cloudflare</span> serves the
              domain, forwards mail sent to us, and runs the assistant on the
              documentation site, which sees the questions typed into it.
            </li>
            <li>
              <span className="text-foreground">Mintlify</span> hosts the
              documentation site.
            </li>
            <li>
              A <span className="text-foreground">payment facilitator</span>{' '}
              settles onchain payments. It sees the paying address and the
              amount, both already public on the chain.
            </li>
            <li>
              <span className="text-foreground">
                Third-party identity data providers
              </span>{' '}
              receive the addresses and handles we resolve. They are named by
              category rather than individually, which is what a controller is
              permitted to do and what keeps our sourcing from being a public
              price list for anyone copying the product.
            </li>
          </ul>
          <p>
            We will also hand over data where the law requires it, and we would
            tell you unless we were forbidden to. If the business is ever sold,
            what we hold moves with it and this policy travels with it too.
          </p>
        </Section>

        <Section id="retention" title="How long we keep it">
          <p>
            A cleanup job runs daily and enforces every period in this table.
            Where something has no expiry, it says so rather than implying one.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-4 font-medium text-foreground">
                    What
                  </th>
                  <th className="py-2 font-medium text-foreground">Kept for</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Your account and credits', 'Until you ask us to delete it'],
                  ['Saved lookups', 'Until you delete them, or the account'],
                  [
                    'Background job payloads',
                    `The addresses and raw results a job carries: ${JOB_PAYLOAD_RETENTION_DAYS} days`,
                  ],
                  [
                    'Wallet-to-identity mappings',
                    'Indefinitely. This is the index',
                  ],
                  [
                    'Removal quarantine copies',
                    `${QUARANTINE_RETENTION_DAYS} days, so a mistaken removal can be undone`,
                  ],
                  ['Cached raw results', `${CACHE_TTL_DAYS} days`],
                  [
                    'Product and page-view events',
                    `${ANALYTICS_RETENTION_DAYS} days`,
                  ],
                  [
                    'IP rate-limit counters',
                    `${IP_BUCKET_RETENTION_HOURS} hours`,
                  ],
                  [
                    'Sign-in links',
                    `Usable for ${MAGIC_LINK_DURATION_MINUTES} minutes, once. The record goes after ${MAGIC_LINK_RETENTION_HOURS} hours`,
                  ],
                  [
                    'Sign-in sessions',
                    `${SESSION_DURATION_DAYS} days, or until you sign out`,
                  ],
                  [
                    'Connected applications',
                    'Until you disconnect them. Their access renews hourly',
                  ],
                  ['API keys', 'Until you revoke them. Stored only as a hash'],
                  ['Payment records', 'Seven years, for tax and accounting'],
                ].map(([what, kept]) => (
                  <tr key={what} className="border-b last:border-0">
                    <td className="py-2 pr-4 align-top text-foreground">
                      {what}
                    </td>
                    <td className="py-2 align-top">{kept}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="cookies" title="Cookies and what your browser keeps">
          <p>
            One cookie, <code className="font-mono text-xs">wts_session</code>,
            set when you sign in and readable only by the server. It is what
            keeps you signed in, it lasts {SESSION_DURATION_DAYS} days, and
            signing out deletes it. There is no advertising cookie and nothing
            here tracks you across other sites.
          </p>
          <p>
            Your browser also keeps an identifier so the product can tell one
            visit from the next, and a per-tab identifier used to group events
            from a single visit. Clearing your browser storage clears both, and
            nothing breaks.
          </p>
        </Section>

        <Section id="rights" title="Your rights">
          <p>
            Wherever you are, you can ask us for a copy of what we hold about
            you, ask us to correct it, ask us to delete it, ask us to stop using
            it, or ask for it in a portable form. Depending on where you live,
            some of those are rights rather than requests; we do not
            distinguish, because answering everyone the same way is simpler than
            deciding who is entitled to what.
          </p>
          <p>
            Write to <Mail />. We answer within 30 days, and we do not charge
            for it. If you are in the UK or the EU and we have not resolved
            something, you can complain to your data protection authority.
          </p>
          <p>
            Some things we cannot delete. Payment records are kept for the
            period tax law requires. Deleting your account does not remove a
            wallet-to-identity mapping from the index, because that mapping is
            not about you unless the wallet is yours, in which case the section
            above is the one that applies.
          </p>
        </Section>

        <Section id="security" title="How it is protected">
          <p>
            Everything travels over HTTPS. API keys and sign-in tokens are
            stored as SHA-256 hashes, never as the value itself, which is why a
            key is shown exactly once and cannot be recovered afterwards. An
            application connected through OAuth holds an access token that
            expires every hour and can be cut off from your account at any
            moment. The database is reached by roles with only the access each
            one needs.
          </p>
          <p>
            No system is perfect. If something goes wrong that affects you, we
            will tell you, and we will tell the relevant authority where we are
            required to.
          </p>
        </Section>

        <Section id="children" title="Children">
          <p>
            This is a product for businesses and developers, and it is not for
            anyone under 16. We do not knowingly hold data about a child. If you
            believe we do, write to <Mail /> and it will be removed.
          </p>
        </Section>

        <Section id="changes" title="Changes">
          <p>
            When this changes, the date at the top changes with it, and the
            change is recorded in the public changelog like everything else. For
            anything that materially affects what we do with data we already
            hold, we will email account holders before it takes effect.
          </p>
        </Section>

        <Section id="contact" title="Contact">
          <p>
            <Mail />, for a question, a request, or a complaint. It reaches a
            person rather than a queue.
          </p>
        </Section>
      </div>
    </PageShell>
  );
}
