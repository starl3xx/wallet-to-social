# Revenue outreach

Status: implemented for local evaluation; not connected, running, or sending.
The existing Resend welcome and nonbuyer campaigns remain live and unchanged.

Jake chose this policy on September 21, 2026: approve each initial message,
then automate follow-ups until a reply. This runner implements a bounded
sequence: the approved initial message, a follow-up four days later, and a
final follow-up seven days after that. The review shows all three messages.
Any change to recipient, sender, evidence, or copy invalidates the approval.

## What this automates

1. Inspect explicitly selected company and contact pages, preserving source
   URLs, observation date, page excerpts and published `mailto:` contacts.
2. Import researched prospects, normalize addresses, skip duplicates and
   exclusions, and score commercial fit.
3. Draft qualified prospects and generate a private review document with the
   exact copy and approval command for each sequence.
4. Send approved messages within the weekday window and volume cap, check
   for replies, and schedule the two follow-ups from actual send times.
5. Track campaign contacts, replies, customers, purchases and collected USD
   revenue. Payment references deduplicate revenue entries.

Research does not infer a named buyer, budget, intent, or an email address.
An operator or research agent qualifies the evidence before importing it.
Page content is untrusted evidence, never instructions. Research accepts at
most 20 explicitly supplied sources, refuses nonpublic resolved addresses,
does not follow redirects, and limits each page to 500 KB. This is a local
operator tool, not an internet-facing fetch endpoint.

The first cohort should be 20 agencies, 20 teams preparing campaigns and 10
workflow developers. Start with five initial drafts for review, not a large
send queue. These are experiment sizes, not revenue forecasts.

## Storage and runtime

Use Node 24 LTS (minimum 22.13) on one persistent machine. Native SQLite
provides durable local storage without a production migration. Runtime data
defaults to `~/.local/share/walletlink-outreach`, outside the public repo.
The directory is private, files are owner-readable, and every CLI command
takes the same exclusive lock. Do not put this database on shared storage or
an ephemeral serverless filesystem. Back up the private directory securely.

No recipient email or prospect ID appears in the tracking URL. Links carry
only campaign-level UTM attribution. The local state and generated review
documents contain business contact information and must not be committed,
published, or attached to public issues.

## Setup and review

Copy `scripts/outreach/config.example.json` to a private location. Set the
real receiving Gmail account, a verified sending address, sender name and
signature. `gm@walletlink.social` is a suggested alias, not a newly created
mailbox. Check the address's actual sending configuration before using it.

```sh
npm run outreach -- init /private/path/config.json
npm run outreach -- research /private/path/sources.json
npm run outreach -- import /private/path/qualified-prospects.json
npm run outreach -- plan
npm run outreach -- review
npm run outreach -- list
npm run outreach -- tick
```

The examples under `scripts/outreach/` use fictional companies. Research
writes `research.json` in the private directory. Turn verified findings into
the `prospects.example.json` shape. Each prospect requires recent evidence,
a published business contact source, and explicit qualification answers.
Do not guess addresses from naming conventions.

The qualification score gives agencies 30 points, campaign teams 25,
developers 20 and researchers 10. An existing wallet audience adds 30, a
near-term project adds 25, and a budget owner adds 15. Drafting requires at
least 70 and an existing wallet audience. These weights are initial
heuristics; report outcomes by segment before adjusting them.

`review` produces `review.md` and editable message JSON files. Review the
recipient and supporting URLs, check that the observation is accurate, and
edit any copy that is not appropriate for that company. Use `revise` to
load edits, then generate a fresh review. Run only the approval command
shown for a sequence you approve. Initial approval expires after 14 days
if it has not been sent. Imported evidence expires for drafting after 30
days. Use `refresh ID prospect.json` with newly verified evidence to redraft an
uncontacted prospect; it invalidates approval and cannot revive stopped sequences.
Reimporting an address never resets its history or suppression.

```sh
npm run outreach -- revise PROSPECT_ID /private/path/messages.json
npm run outreach -- review
npm run outreach -- approve PROSPECT_ID REVIEW_SHA256
```

## Sender and reply integration

The existing infrastructure uses Resend for customer lifecycle mail and
Cloudflare to forward incoming WalletLink mail to Gmail, as documented in
`docs/DOCS-SITE.md`. Cloudflare routing alone does not configure Gmail's
outbound sending identity.

The new adapter uses Gmail's API for both sending and reply checks. It checks
the connected primary mailbox and verifies that the configured sender is an
accepted Gmail send-as alias. It refuses a known Resend SMTP alias because
[Resend explicitly prohibits cold outreach](https://resend.com/legal/acceptable-use).
The actual outbound service behind any alias still needs to support the
intended use. No DNS, routing rule, mailbox, or sending alias was changed by
this implementation.

Configure a Google OAuth client for the receiving mailbox with these scopes:

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.send`

Gmail's read-only scope also permits listing send-as aliases. Use a refresh
token suitable for unattended operation. A temporary OAuth test grant may
expire; an expired grant stops sends rather than bypassing the reply check.
The Codex Gmail connection is separate from credentials used by this runner.

Put these values in a private environment file, never in chat or git:

```text
OUTREACH_GOOGLE_CLIENT_ID=
OUTREACH_GOOGLE_CLIENT_SECRET=
OUTREACH_GOOGLE_REFRESH_TOKEN=
OUTREACH_DATABASE_URL=
OUTREACH_DATA_DIR=
```

`OUTREACH_DATABASE_URL` should use a dedicated role with only `SELECT(email)`
on `users`. Before every live tick, the runner excludes all existing
WalletLink accounts, including opted-out accounts, to avoid overlapping the
welcome and nonbuyer campaigns. A failed query stops that tick. This is a
read-only query; no owner credentials or schema changes are needed. Manual
exclusions can also be imported as a JSON array of addresses.

```sh
node --env-file=/private/path/outreach.env scripts/outreach/cli.mjs doctor
node --env-file=/private/path/outreach.env scripts/outreach/cli.mjs sync-existing
npm run outreach -- exclude /private/path/excluded-emails.json
```

`doctor` makes read-only mailbox requests and sends nothing. Before enabling
real prospects, verify sending, reply detection, a separate-thread reply and
a bounce using an operator-owned test recipient. Automated tests mock Gmail;
they do not establish live delivery or forwarding correctness.

## Running and stopping

The workspace starts paused. The default cap is five messages per weekday,
including follow-ups, with at least 15 minutes between sends. Sending hours
are 09:00 through 16:59 in the configured timezone. Daily limits use that
timezone, including daylight-saving changes. Each tick sends at most one
message. The worker polls every five minutes and survives individual tick
failures, logging their exit codes.

```sh
npm run outreach -- resume
node --env-file=/private/path/outreach.env scripts/outreach/worker.mjs --send
```

Without `--send`, the worker only previews due messages and makes no network
requests. It does not install itself as a service. To run unattended, use
one persistent host with process supervision and the same private data
directory. No background process or schedule has been installed yet.

```sh
npm run outreach -- pause
npm run outreach -- stop PROSPECT_ID unsubscribed
npm run outreach -- stop PROSPECT_ID replied
npm run outreach -- revenue PROSPECT_ID PAYMENT_REFERENCE 9900
npm run outreach -- report
```

Pausing prevents new live ticks. It cannot retract a message already being
submitted; commands serialize behind the running tick. Stop the worker with
Ctrl+C or SIGTERM; it lets an in-flight tick finish, then exits. A reply,
bounce or unsubscribe is terminal for the sequence. Opt-out and bounce
states survive later sales-status updates and reimports.

The first version conservatively stops on any prior incoming mail from a
prospect, including correspondence predating import. It also checks original
threads for another sender and searches for delivery-failure mail. Automated
replies stop the sequence too. It reads message metadata, not private message
bodies. A reply arriving between the final check and provider acceptance is
an unavoidable race; the next tick will stop further messages.

## Delivery recovery

The stable RFC Message-ID and `sending` state are committed before Gmail is
called. A timeout or a crash leaves an uncertain attempt. Later ticks search
Sent Mail for that exact ID and reconcile a matching receipt. Until then,
all sending remains blocked. There is no blind retry, including after a
provider error; this favors avoiding duplicate outreach.

If a receipt never appears, investigate the provider and mailbox before
manually recovering the state. Do not clear an uncertain record just to
unblock the queue. This version has no automatic reset for an uncertain send.

After an abrupt process crash, `runner.lock` may remain. Inspect its PID,
verify the process has ended, then remove only that lock file. Do not remove
a live runner's lock. The SQLite state and its journal must remain intact.

## Validation and remaining integration work

```sh
npm run check:outreach
npm run preflight
```

The outreach CI job uses mocked providers and temporary databases. It tests
approval invalidation, exclusions, replies, follow-up timing, daily limits,
crash reconciliation, duplicate prevention, revenue deduplication and file
locking. It never sends email or reads production customer data.

Still required before production operation: connect the correct Gmail
mailbox and outbound alias, provide the restricted account-exclusion
connection, verify the live mail loop, approve the first real messages, and
start the worker on a persistent host. Discovery currently gathers evidence
from supplied company URLs; open-web prospect sourcing and qualification
remain operator or research-agent work. Revenue recording is manual until
payment attribution is validated; it is not inferred from a link click.
