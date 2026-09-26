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
import Link from 'next/link';
import { PageShell } from '@/components/ui/page-shell';
import { Eyebrow } from '@/components/ui/eyebrow';
import { BACKUP_RETENTION_DAYS } from '@/lib/backup-retention';
import { CACHE_TTL_DAYS } from '@/lib/cache-constants';
import {
  ANALYTICS_RETENTION_DAYS,
  API_BUCKET_RETENTION_DAYS,
  API_USAGE_RETENTION_MONTHS,
  IP_BUCKET_RETENTION_HOURS,
  JOB_PAYLOAD_RETENTION_DAYS,
  OAUTH_TOKEN_RETENTION_DAYS,
  PAYMENT_RECORD_RETENTION_YEARS,
  PURCHASE_RECORD_PURGE_ENABLED,
  SANCTIONS_SCREENING_RETENTION_YEARS,
} from '@/app/api/cron/cleanup/route';
import { QUARANTINE_RETENTION_DAYS } from '@/lib/removal-admin';
import { NEGATIVE_RECHECK_DAYS } from '@/lib/social-graph';
import { IDEMPOTENCY_TTL_HOURS } from '@/lib/idempotency';
import { LEGAL_ENTITY } from '@/lib/site-url';
import {
  MAGIC_LINK_DURATION_MINUTES,
  MAGIC_LINK_RETENTION_HOURS,
  SESSION_DURATION_DAYS,
} from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description:
    'What walletlink.social collects, why, who else sees it, and how long it is kept.',
  alternates: { canonical: 'https://walletlink.social/privacy' },
};

const UPDATED = '26 September 2026';

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

export default function PrivacyPage() {
  return (
    <PageShell>
      <div className="mx-auto max-w-[68ch] py-12">
        <Eyebrow className="text-muted-foreground">Legal</Eyebrow>
        <h1 className="mt-3 text-4xl font-extralight leading-[1.02] tracking-[var(--tracking-display)]">
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
            show your lookups to other customers. The addresses you look up can
            go to the companies that resolve them for us, described below, and a
            strip on our home page shows the size and match rate of some large
            lookups, with nothing that identifies them. We do keep the
            wallet-to-identity mappings a lookup discovers, and the section on
            addresses you look up explains exactly what that means, because it
            is the one thing here a reader would not guess.
          </p>
          <p>
            Our{' '}
            <Link
              href="/terms"
              className="text-accent-brand underline underline-offset-4"
            >
              terms of service
            </Link>{' '}
            say what customers may do with what we return, and what they may not
            do to the people in the index.
          </p>
        </Section>

        <Section id="collect" title="What we hold, and why">
          <p>
            <span className="text-foreground">Your account.</span> An email
            address, which is the whole account: there is no password and no
            profile. It exists so a sign-in link can reach you and so credits
            can belong to somebody. An account created by paying onchain has a
            wallet address instead, and no working inbox behind it. A new
            account also gets up to five welcome emails over its first two
            weeks, the last of which asks you to buy a pack, and an account that
            has not bought may get one plain check-in email, sent automatically
            in a person’s name. Every one carries an unsubscribe link. We keep a
            record of which ones we sent, and a copy of each check-in in our
            support inbox.
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
            <span className="text-foreground">Sanctions checks.</span> Before we
            accept an onchain payment, we check the paying address against the
            US Treasury’s list of Specially Designated Nationals, and we keep a
            record of the check: the address, the date of the list, the result
            and when it was made. If an address that paid us is added to that
            list later, we suspend the account the payment was for and note on
            the account why. At checkout we also read the country and region
            your connection comes from, as our host reports it, so that we can
            refuse a sale where sanctions law forbids one. We do not store it.
          </p>
          <p>
            <span className="text-foreground">What you looked up.</span> The
            addresses you submitted, any other columns in your file, the name
            you gave the list and, if you imported it from a contract, which
            contract, the results, and a count. Saved lookups keep the full
            result set, your columns included, so you can open them again.
            Saving is on by default, and you can turn it off before a list runs.
            When you look up the wallets behind an account, we save the handle
            you searched for with the results, under a name that includes it. If
            you are not signed in, a lookup is tied to an identifier your
            browser keeps rather than to an account.
          </p>
          <p>
            <span className="text-foreground">How the service is used.</span>{' '}
            Page views and product events (an upload started, a checkout
            reached, a limit hit), each carrying a browser identifier and
            sometimes your email address. Also a record of each request an API
            key makes: the endpoint, how many addresses it carried, the response
            status, the credits and the time, never the addresses themselves, so
            rate limits and credits can be counted.
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
            <span className="text-foreground">If you use X from here.</span>{' '}
            Building an X list from your results asks you to sign in to X. We
            hold a sealed token that can write lists on your account, and the
            accounts you chose to add, only until the list is built; then both
            are deleted. The job’s record (the list name and description, your X
            account name and id, the list’s id on X and the counts) stays. A
            list you never authorize is emptied at the next daily cleanup.
            Claiming an address also asks you to sign in to X, and the section
            on the index below says what a claim keeps.
          </p>
          <p>
            <span className="text-foreground">Technical data.</span> Your IP
            address, held only as a counter: against an hourly bucket, so an
            endpoint cannot be scraped, and against a daily one, so the free
            allowance for visitors who are not signed in can be counted. We do
            not store the browser string of the device you sign in on. Our host
            keeps request logs for no longer than 30 days. They record the web
            address of each request and the browser that sent it, and for a
            single-address or reverse lookup through the API that web address
            contains the address or the handle. The messages our own code writes
            to those logs mask email addresses and wallet addresses.
          </p>
        </Section>

        <Section id="lookups" title="Addresses you look up">
          <p>
            This is the part worth reading twice, because it is how the product
            works rather than an aside.
          </p>
          <p>
            When you run a list, on this site or as a job through the API, every
            address we hold no fresh answer for is sent to the third-party
            identity data providers described under “Who else sees it”. A deep
            scan on an account with credits also reads onchain ENS records,
            which sends the address to a blockchain data provider. This happens
            whether or not you are signed in, and the other columns of your file
            are never sent to them. A fast scan answers from our index and our
            cache of recent results alone and sends nothing, whatever the size
            of the list, and so does a single-address or batch lookup through
            the API.
          </p>
          <p>
            What comes back is written to a permanent index, and that index then
            answers other people’s lookups of the same address. Each record also
            keeps a counter that goes up whenever a lookup, or one of our own
            refresh jobs, writes to it. It never records who ran the lookup.
            When a list finds that an address resolves to nobody, we record that
            too, and a later list does not re-ask about it for{' '}
            {NEGATIVE_RECHECK_DAYS} days.
          </p>
          <p>
            <span className="text-foreground">What is shared this way</span> is
            what the sources said about the address: which X handle, Farcaster
            account, ENS name, Lens profile or GitHub account it belongs to, a
            second X account the owner also published, the follower counts of
            those accounts, whether the X account still reaches anyone, whether
            the wallet appears to belong to an AI agent and what kind, the kind
            of evidence behind the link, and when we last checked. For an
            address that resolves to nobody, other customers can see when we
            last checked it. Those facts came from public sources, and they are
            what we sell.
          </p>
          <p>
            <span className="text-foreground">What is never shared</span> is
            anything about you: that you ran the lookup, which addresses you
            submitted together, what your list was for, or what any of it told
            you. Your lists are yours, and no customer can see another
            customer’s. The one exception is a strip on our home page of recent
            large lookups: how many addresses a list had, how many matched, and
            when it finished, with no name, account or address attached. Any
            completed list of 25 or more addresses from the last seven days with
            a match rate above 8% can appear there, our own imports of
            collections included. If you would rather yours did not, write to{' '}
            <Mail /> and we will hide it by hand.
          </p>
          <p>
            Raw results are also cached for {CACHE_TTL_DAYS} days, so a repeated
            lookup of an address we found something for does not ask the outside
            sources again in that window. It is still billed like any other
            lookup.
          </p>
        </Section>

        <Section id="indexed" title="If you are in the index">
          <p>
            You may be in it without ever having used the service. Every mapping
            we hold came from a public source, and most links were published by
            the wallet’s owner: a Farcaster verification, an ENS or similar name
            record, a profile set by signing with the wallet, or a record we
            checked by hand. A name record or profile can name any X handle, and
            nobody checks that the handle’s owner agreed, so your handle can
            appear beside a wallet you have never used. Some links come from a
            third-party index that pairs a wallet with an account when nothing
            shows the owner made the link. We label those as aggregated wherever
            we return them, never as attested by the owner, and a search for the
            wallets behind an account never returns them.
          </p>
          <p>
            We collect nothing from a private source. The index itself holds no
            wallet balances, no amounts and no transaction history, and no email
            address, phone number or postal address for anyone in it. Beside the
            mapping it does hold: which token and NFT collections some wallets
            have held; whether a wallet carries a public onchain attestation
            that an exchange verified its owner; an X account’s display name,
            follower count and whether it still reaches anyone; a Farcaster
            follower count; whether a wallet appears to belong to an AI agent,
            from a curated list or from words in its Farcaster bio; and the
            history of handle changes we have seen. A customer’s own file can
            carry other columns about the addresses in it, such as a balance,
            and a customer’s saved results keep the Farcaster bio we found; we
            keep those only in that customer’s lookups, as described above. A
            handful of well-known people appear on our home page as examples, by
            name and with their profile photos, X and Farcaster accounts and the
            wallets we have indexed for them.
          </p>
          <p>
            Write to <Mail /> with the address or handle and we will remove it.
            We do not require you to prove ownership first, because the
            alternative is asking a stranger for more information than we
            already hold about them. Name every identifier you want gone. We act
            only on the ones you name, and we do not search the index for others
            that might be yours. The suppression list stores each identifier on
            its own row, with nothing that ties the ones in your request
            together. We keep the email thread, your message and our replies,
            for {BACKUP_RETENTION_DAYS} days after the removal is done, so that
            we can apply the removal again if we ever restore our database from
            a backup, and then delete it.
          </p>
          <p>
            <span className="text-foreground">What happens next.</span> A person
            reads your email and runs the removal by hand; there is no form and
            no automation between you and it. Each identifier you name is
            deleted from the index and added to a suppression list that every
            write path checks, so an automated sweep that finds the same public
            record later cannot put it back. A removal lasts until you ask us to
            undo it, with the same proof that the address or account is yours
            that we ask for before sending a copy of what we hold (see “Your
            rights”). In the first {QUARANTINE_RETENTION_DAYS} days we can also
            undo a removal made in error, as described below. Where a customer’s
            saved lookup that we still hold carries the link, the link is
            removed from it: everything we resolved for the identifier is
            stripped, so the entry reads as if nothing was found. An address
            that was part of the customer’s own uploaded list stays in that
            list, carrying nothing. A saved lookup whose subject is the
            identifier itself (a search for the wallets behind your handle) is
            deleted whole. We complete this within 30 days, the same period as
            every other request on this page.
          </p>
          <p>
            A few copies survive, on purpose or for a limited time. For{' '}
            {QUARANTINE_RETENTION_DAYS} days after a removal we keep what was
            deleted in a table read only by the removal tooling itself, kept so
            a removal made in error (a mistyped address, somebody else’s handle)
            can be undone. After {QUARANTINE_RETENTION_DAYS} days that copy is
            deleted automatically. Our encrypted nightly backups include saved
            lookups and our list of AI agent wallets, and each is kept for{' '}
            {BACKUP_RETENTION_DAYS} days, so a removed link can survive in a
            backup until then. If we ever restore one, we keep today’s
            suppression list rather than the backup’s, so nothing removed since
            that night comes back. An API batch answer kept for a retry is
            amended or deleted in a removal, and a replayed answer is filtered,
            so a retry never brings the link back. If the address was ever
            claimed on our claim page, the removal clears the claim record too,
            as a withdrawal on the claim page does. And the identifier you named
            stays on the suppression list, and on internal do-not-recheck lists
            that hold the identifier on its own, never the link.
          </p>
          <p>
            <span className="text-foreground">
              If you can sign for the address, you do not have to wait for us.
            </span>{' '}
            <Link
              href="/claim"
              className="text-accent-brand underline underline-offset-4"
            >
              Claim your address
            </Link>{' '}
            works without a person in the middle, for an X account. You sign in
            with your email, sign a message with the wallet and sign in to X.
            Where we hold nothing for the address, your claim fills it, and
            where we hold the same account, it confirms it. Where we hold a
            different account, we record that you disagree and keep serving ours
            until the handle we hold stops reaching anyone, because a signature
            proves control of a key, and keys are lost and sold. A claim is tied
            to your walletlink account and keeps the address, your X account
            name and its numeric id, your signature, and a record of which
            version of the consent text you agreed to.
          </p>
          <p>
            Once you have claimed an address, you can withdraw it from the same
            page. Withdrawing deletes what the index holds for the address and
            adds it to the same suppression list, so a later sweep cannot put it
            back. We keep a record on your account that you claimed the address
            and withdrew it: the address and a one-way hash of the X account id,
            so the same account cannot claim the free matches twice. A
            withdrawal also sends our support inbox a short email naming the
            address, a reference to your claim and the time, so that we can
            apply the withdrawal again if we ever have to restore our database
            from a backup; we delete that email after {BACKUP_RETENTION_DAYS}{' '}
            days, when no backup older than it is left. Email stays the route
            that asks nothing of you, and it is the only route for a handle, for
            an address whose key you no longer have, and for asking to be
            removed from the index entirely.
          </p>
          <p>
            Two things are beyond our reach whatever we build. A customer who
            exported a result before you asked still has their copy, and we
            cannot reach it. And a search engine may hold a cached copy of a
            page for a while after we change it.
          </p>
          <p>
            The copies we hold ourselves we amend, except the ones listed above.
            Every list a customer runs keeps its addresses for{' '}
            {JOB_PAYLOAD_RETENTION_DAYS} days in its job record, and a saved
            lookup keeps them until its owner deletes it, so for those copies we
            do know which account held the link. We do not tell those account
            holders that a removal changed their results, for three reasons.
            Telling them would reveal that the person behind the link asked to
            be removed. Tracing everyone who ever received a link takes effort
            out of proportion to what it would achieve, and a list run while
            signed out is tied only to a browser, so there is nobody to tell.
            And the removal reaches them anyway: every job result and saved
            lookup we hold is checked against the suppression list each time it
            is opened, so the link is gone the next time its owner looks. A
            single-address or batch lookup through the API leaves no address in
            our database: our record of API calls keeps the endpoint and the
            number of addresses.
          </p>
        </Section>

        <Section id="processors" title="Who else sees it">
          <p>
            We use other companies to run the service. Each receives only what
            its job needs, and each company’s own terms and privacy policy
            govern what it does with it.
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
              <span className="text-foreground">Inngest</span> ran lists of more
              than ten addresses in the background until 25 September 2026, and
              no longer processes anything for us. It kept a history of each of
              those runs that includes what the job held: the addresses, the
              other columns of your file, the results, and the account or
              browser that ran it. Neither our {JOB_PAYLOAD_RETENTION_DAYS}-day
              limit nor a removal reaches that history, which Inngest keeps
              under its own terms.
            </li>
            <li>
              <span className="text-foreground">GitHub</span> runs our scheduled
              jobs and stores our nightly database backups. The backups are
              encrypted before they leave the job, with a key GitHub never
              holds, and each is kept for {BACKUP_RETENTION_DAYS} days.
            </li>
            <li>
              <span className="text-foreground">Stripe</span> takes card
              payments, holds the card details we never see, and receives your
              email address so the payment belongs to your account.
            </li>
            <li>
              <span className="text-foreground">Resend</span> sends sign-in
              links, account mail, and the welcome and check-in emails.
            </li>
            <li>
              <span className="text-foreground">Cloudflare</span> serves the
              domain, forwards mail sent to us, and runs the assistant on this
              site and on the documentation site, which sees the questions typed
              into it.
            </li>
            <li>
              <span className="text-foreground">Mintlify</span> hosts the
              documentation site.
            </li>
            <li>
              <span className="text-foreground">X</span> receives the accounts
              you add to a list you build here, through your own X account, and
              tells us your account name and id when you build a list or claim
              an address.
            </li>
            <li>
              <span className="text-foreground">Warpcast</span> receives the
              direct messages you send to Farcaster accounts from your results,
              sent with your own Warpcast API key. The key and the message pass
              through our server on the way and are not stored there. If you
              choose to save it, the key stays in your browser until you remove
              it.
            </li>
            <li>
              <span className="text-foreground">PayAI</span>, a payment
              facilitator, settles onchain payments. It sees the paying address
              and the amount, both already public on the chain.
            </li>
            <li>
              <span className="text-foreground">
                Third-party identity data providers
              </span>{' '}
              receive the addresses in the lists you run that we have not
              answered recently, the Farcaster usernames in your results when we
              look up their account numbers, and the X handles whose status we
              check. A blockchain data provider receives addresses when a deep
              scan reads onchain ENS records. They are named by category rather
              than individually, which is what a controller is permitted to do
              and what keeps our sourcing from being a public price list for
              anyone copying the product.
            </li>
          </ul>
          <p>
            We will also hand over data where the law requires it, and we would
            tell you unless we were forbidden to. If the business is ever sold,
            what we hold moves with it and this policy travels with it too.
          </p>
        </Section>

        <Section id="basis" title="Why we are allowed to use it">
          <p>
            For your account, your payments and the lookups you run, we use your
            data because you asked for the service and it cannot run without it.
            We keep payment records because tax law requires them, and we check
            onchain payments against the sanctions list and keep a record of
            each check because sanctions law requires us not to deal with the
            people on it. We keep IP counters and product analytics because we
            have a legitimate interest in keeping the service standing. We send
            the welcome and check-in emails to account holders on the same
            basis, a legitimate interest in telling a new account what it can
            do, and every one of them carries a one-click unsubscribe.
          </p>
          <p>
            For people in the index, who never signed up, we rely on legitimate
            interests. We help projects reach people who publicly linked a
            wallet to a social account themselves, and we show how each link was
            established. You can object at any time. Write to <Mail /> and we
            will remove what you name, as described above.
          </p>
        </Section>

        <Section id="retention" title="How long we keep it">
          <p>
            A cleanup job runs once a day and deletes what has passed its
            period, so an item usually outlasts its period by up to a day, and a
            large backlog can take a few days more. Items kept until you act, or
            kept indefinitely, say so rather than implying an expiry.
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
                {(
                  [
                    [
                      'Your account and credits',
                      'Until you ask us to delete it',
                    ],
                    ['Saved lookups', 'Until you delete them, or the account'],
                    [
                      'Background job payloads',
                      `The addresses, the other columns of your file and the raw results a job carries: ${JOB_PAYLOAD_RETENTION_DAYS} days. The job’s record (its counts, dates, name and settings) stays`,
                    ],
                    [
                      'Retry copies of API batch answers',
                      `A batch sent with a retry key keeps its answer, addresses and results included, for ${IDEMPOTENCY_TTL_HOURS} hours, so a retry is not billed twice`,
                    ],
                    [
                      'Wallet-to-identity mappings',
                      'Indefinitely. This is the index',
                    ],
                    [
                      'Other facts in the index (holdings, X account status, exchange verification, handle history)',
                      'Indefinitely, except an exchange verification, which goes at the next complete weekly resync after it is revoked',
                    ],
                    [
                      'Removal quarantine copies',
                      `${QUARANTINE_RETENTION_DAYS} days, so a mistaken removal can be undone`,
                    ],
                    [
                      'Removal suppression list',
                      'One identifier per row, with no account attached, until you ask us to undo the removal or we undo one made in error. A withdrawal made on the claim page is also recorded on the claimant’s account',
                    ],
                    [
                      'Removal emails in our support inbox',
                      `A removal request with our replies, and the email a withdrawal on the claim page sends us: ${BACKUP_RETENTION_DAYS} days after the removal is done, so that we can apply it again after restoring a backup, then deleted`,
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
                      'API key rate-limit counters',
                      `Counts only, with no addresses: ${API_BUCKET_RETENTION_DAYS} days after the minute, day or month they count has ended`,
                    ],
                    [
                      'API request records',
                      `${API_USAGE_RETENTION_MONTHS} months`,
                    ],
                    [
                      'Records of welcome and check-in emails sent',
                      'Until the account is deleted',
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
                    [
                      'Expired connection tokens',
                      `Deleted ${OAUTH_TOKEN_RETENTION_DAYS} days after they stop working, with the usage records they carried`,
                    ],
                    [
                      'API keys',
                      `Usable until you revoke them, and stored only as a hash. A revoked key’s record (its name, prefix and dates) stays with the account, and its request records go after ${API_USAGE_RETENTION_MONTHS} months, like all the others`,
                    ],
                    [
                      'Encrypted backups',
                      `Accounts, API keys, credits, payments, saved lookups, our list of AI agent wallets, the list of accounts we have given free access and the suppression list: ${BACKUP_RETENTION_DAYS} days from each nightly copy`,
                    ],
                    [
                      'Sanctions checks on onchain payments',
                      `${SANCTIONS_SCREENING_RETENTION_YEARS} years, then deleted. A suspension stays on the account until it is lifted`,
                    ],
                    [
                      'Payment records',
                      PURCHASE_RECORD_PURGE_ENABLED
                        ? `${PAYMENT_RECORD_RETENTION_YEARS} years, for tax and accounting, then deleted once no unexpired credits or open lookup depend on them`
                        : `At least ${PAYMENT_RECORD_RETENTION_YEARS} years, for tax and accounting. A record of credits spent is then deleted once no unexpired credits or open lookup depend on it. Purchase records (the credit packs bought, and the Stripe ids on an account) are not yet deleted after that period`,
                    ],
                  ] as [string, React.ReactNode][]
                ).map(([what, kept]) => (
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
            Your browser also keeps a few things for this site in its storage:
            an identifier that tells one visit from the next and ties lookups
            you run while signed out to this browser, a per-tab identifier used
            to group events from a single visit, where you first arrived from,
            your email address while you are signed in, the lookup in progress,
            your theme, a few interface settings and, if you chose to save it,
            your Warpcast API key. Clearing your browser storage clears all of
            them. You lose access to lookups you ran while signed out, and
            nothing else breaks.
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
            If you are in the index rather than a customer, we will ask you to
            show that the address or account is yours before we send a copy of
            what we hold for it, because the same answer sent to a stranger
            would hand them the link you may want hidden. We accept either of
            two proofs: a message signed with the wallet, or a public post from
            the social account that names your request. With that proof, you get
            a full answer. Removal never needs that proof, and our reply to a
            removal request never confirms whether we held anything.
          </p>
          <p>
            Write to <Mail />. We answer within 30 days, and we do not charge
            for it. If you are in the UK or the EU and we have not resolved
            something, you can complain to your data protection authority.
          </p>
          <p>
            Some things we cannot delete on request. Payment records are kept
            for at least {PAYMENT_RECORD_RETENTION_YEARS} years, for tax and
            accounting, and records of sanctions checks for{' '}
            {SANCTIONS_SCREENING_RETENTION_YEARS} years, to show that we
            complied with sanctions law. Deleting your account does not remove a
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
            moment. Our scheduled GitHub workflows and the nightly backup reach
            the database through limited roles. The site itself, including the
            jobs it runs on a timer, connects with full access, and the removal
            quarantine is closed to every other role.
          </p>
          <p>
            No system is perfect. If something goes wrong that affects you, we
            will tell you, and we will tell the relevant authority where we are
            required to.
          </p>
        </Section>

        <Section id="children" title="Children">
          <p>
            This is a product for business and professional use, and it is not
            for anyone under 18. We do not knowingly hold data about a child. If
            you believe we do, write to <Mail /> and it will be removed.
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
            person rather than a queue. walletlink.social is operated by{' '}
            {LEGAL_ENTITY}, a limited liability company organized in Wyoming.
          </p>
        </Section>
      </div>
    </PageShell>
  );
}
