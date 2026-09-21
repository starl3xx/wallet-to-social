# Revenue outreach

Status as of September 21, 2026: the owner approved all three reviewed pilot
sequences and the live local worker is running. Each initial message has been
submitted; two prospects remain active and one is suppressed after a hard bounce.
Follow-ups remain bounded to two and stop on a reply. Gmail authorization and
account exclusions are verified. Owner-mailbox delivery, same-thread reply
detection, sender-based lookup without thread IDs and lost-response recovery
passed. A real separate-thread bounce was observed and the contact is stopped.
Jev research evaluation is a separate operator tool and does not change this queue.
The existing Resend welcome and nonbuyer campaigns remain live and unchanged.

starl3xx chose this policy on September 21, 2026: approve each initial message,
then automate follow-ups until a reply. This runner implements a bounded
sequence: the approved initial message, a follow-up four days later, and a
final follow-up seven days after that. The review shows all three messages.
Any change to recipient, sender, evidence, or copy invalidates the approval.

## Writing voice

Use short, casual notes from starl3xx: one concrete observation, a plain
explanation only when needed, and one useful question. Avoid sales jargon,
repeated feature lists, invented familiarity and claims about a prospect’s
budget or current plans. Personalize each follow-up with a useful detail;
the generated copy is a starting point that still requires review. Keep
match uncertainty and EVM scope clear.

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
signature. The selected identity is `starl3xx <starl3xx@walletlink.social>`,
with `gm@walletlink.social` as the primary Workspace mailbox. Confirm the
send-as identity is configured in Gmail before enabling the runner.

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
least 70 and an existing wallet audience. For a discovery experiment, an
operator can instead run `draft-discovery ID "evidence-based rationale"`
for one fresh, unsent, unsuppressed prospect. This records the reason for
contact without changing the score or claiming buying intent; the rationale
and all messages are bound to the subsequent approval. Existing suppressions
and sending limits still apply. These weights are initial
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

Resend continues to handle customer lifecycle mail. Google Workspace now
receives root-domain mail through Google's MX record. The primary mailbox
is `gm@walletlink.social`; `starl3xx@walletlink.social` is its verified,
default sending alias. Workspace routing retains incoming messages in the
mailbox and also forwards them to the existing personal Gmail destination.
Google SPF and DKIM are configured; live delivery checks remain outstanding.

The new adapter uses Gmail's API for both sending and reply checks. It checks
the connected primary mailbox and verifies that the configured sender is an
accepted Gmail send-as alias. It refuses a known Resend SMTP alias because
[Resend explicitly prohibits cold outreach](https://resend.com/legal/acceptable-use).
The actual outbound service behind any alias still needs to support the
intended use. Mailbox setup was performed separately from the code changes;
the OAuth client credentials and refresh token are stored only in the private
local runtime directory. The read-only `doctor` check passed for the configured
mailbox and sender.

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
on `public.users`. The dedicated outreach role is connected; live privilege
checks confirmed email-column access without full-table reads or user-table
writes. The query names the schema explicitly so pooled connection search
paths cannot select a different table. Before every live tick, the runner excludes all existing
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
directory. The pilot now runs under a macOS LaunchAgent using a private snapshot of the
reviewed runner. It restarts after process failure and at user login. This is
a local service: sleep, shutdown or loss of connectivity delays delivery.
A new runner release requires deliberately updating the service snapshot.

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

The RFC Message-ID, separate delivery marker, attempt timestamp and `sending`
state are committed before Gmail is called. MIME includes a Date header.
Gmail can rewrite Message-ID, so recovery must not assume it survives.
When a provider ID is available, recovery reads and verifies that exact Sent
message. Otherwise it searches the original Message-ID and scans Sent Mail
around the attempt for the exact `X-WalletLink-Delivery-ID` header, validating
the sender and recipient. The scan is bounded to 500 messages; duplicate
matches or an incomplete scan require manual reconciliation. Metadata is
read, not message bodies. A missing match leaves all sending blocked.

Follow-ups fetch the verified canonical IDs from Gmail before constructing
References and In-Reply-To. No uncertain attempt is automatically resubmitted,
including after an empty search result or provider error.

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

## Jev prospect qualification pilot

The standalone `scripts/outreach/qualify.mjs` command evaluates **selected public
research excerpts** in shadow mode. It does not open the outreach database,
import leads, generate approvals, read Gmail, or alter the running worker.
Run an offline preview first to inspect exactly what will be submitted:

```sh
node scripts/outreach/qualify.mjs /private/path/research.json /private/path/jev-preview.json
node --env-file=/private/path/outreach.env scripts/outreach/qualify.mjs /private/path/research.json /private/path/jev-results.json --run
```

Live execution requires `TYPESAFE_API_KEY` in that private environment file.
Do not commit keys or research reports. Output files are created with mode 0600
and must not already exist. Each invocation accepts 1–20 records; records use
the existing research output fields `company`, `sourceUrl`, `observedAt`, and
`excerpt`. Only these allowlisted fields and optional public-source claims are
submitted. URLs must omit query strings and fragments. Input is operator-selected
public material; the tool cannot determine whether arbitrary pasted text is private.
Research currently keeps only the first 5,000 characters of a page, so missing
signals mean insufficient supplied evidence, not proof a company lacks a service.

Optional `claims` contains up to ten `{ "text": "proposed factual claim",
"quote": "exact supporting excerpt" }` objects per record. Split a personalized
opening into individual factual claims; the tool does not check an entire email
unless its claims are supplied. A quote absent from the excerpt is rejected locally.
The model checks present quotes for full support, contradiction, or missing evidence.

The pinned model is `jev-1.13.0`, rubric `walletlink-prospect-v1`. The first call
selects exact source spans for three signals: relevant services, explicit EVM work,
and a wallet-audience use case. A second call checks selected passages and supplied
claims in full excerpt context. Both calls use the same model, so this is not
independent corroboration. Every result remains `human-review-required`.
`SupportedSignals` (serialized as `supportedSignals`) counts model-supported
signals for review, not buying probability or production qualification.
Confidence is retained for evaluation, not treated as correctness or an approval
threshold. No claim of mailbox deliverability is made. Source text can contain
prompt injections; constrained output and human review do not make the model immune.

Evidence older than 30 days, future dates, failed research, and malformed provider
responses fail closed. Observation dates reflect retrieval, not when an activity
occurred. Reports preserve excerpt, URL, dates, model/rubric, input hash, distributions,
and reported token usage. Provider failure stops the batch without automatic retries
and preserves completed results. Run remaining records into a new output file.

Before using results operationally, label 100–200 real public records with expected
signal and claim verdicts. Reserve 20–30% before adjusting the rubric. Include vague
web3 descriptions, non-EVM work, historical cases, missing evidence, and injected
instructions. Compare against manual review and existing rules: supported shortlist
precision, unsupported claims missed, abstentions, and review minutes. Synthetic
unit tests validate mechanics only; they do not establish model accuracy. Keep send
approval and existing exclusion/bounce checks in their current deterministic flow.

API contract: https://docs.typesafe.ai/api
Confidence: https://docs.typesafe.ai/confidence
Limitations: https://docs.typesafe.ai/model-jaggedness/jev-1.13

### Reproducible labeled evaluation

Use `scripts/outreach/evaluate.mjs` for frozen, pre-labeled datasets. It validates
labels before any API call, keeps each company group in one split, and never sends
expected labels, split names, or annotation rationale to Jev. Public examples,
extraction-limited pages, and synthetic challenges have separate metrics.

```sh
node scripts/outreach/evaluate.mjs /private/path/labeled.json /private/path/results.json --preview
node --env-file=/private/path/outreach.env scripts/outreach/evaluate.mjs /private/path/labeled.json /private/path/results.json --run
node --env-file=/private/path/outreach.env scripts/outreach/evaluate.mjs /private/path/labeled.json /private/path/results.json --resume
```

The dataset shape is `{version: 1, annotationMethod, cases: [...]}`. Each case has
`id`, `group` (company or synthetic scenario family), `split` (`development` or
`holdout`), `kind` (`public`, `extraction-limited`, or `synthetic`), `rationale`,
`record` (the research/claims input), and `expected`. Expected labels contain
`signals: {services, evm, useCase}` with `supported` or `unsupported` values, plus
`claims`, an ordered array of `supported`, `unsupported`, `contradicted`, or
`missing-quote` labels corresponding exactly to the input claims. Supported means
established by the supplied excerpt, not an independently proven company fact.

A dataset hash binds the labels and source snapshots; a checkpoint also binds the
model and rubric. Resume skips completed evaluations and refuses a different
dataset. Atomic private checkpoint writes preserve completed work; a sidecar lock
prevents simultaneous writers. After a crash, remove a leftover `.lock` only after
confirming its recorded process is no longer running. Provider failure stops the
batch. Explicit resume retries only the unfinished case (which may incur another
API charge), not previously completed cases. The generated `results.json.md` is a
review companion and is regenerated on resume.

Reports include per-signal precision and recall, false positives and negatives,
a simple lexical baseline, binary claim acceptance accuracy, exact verdict
agreement, and disagreements. Missing results are explicitly counted and excluded
from accuracy denominators. The keyword baseline is deliberately simple and does
not represent the existing outreach commercial-fit scorer. Do not equate signal
accuracy with sales qualification, time saved, revenue lift, or mailbox validity.

The September 21 expansion used 20 company examples (three with only extracted
titles) and ten separate synthetic challenges, totaling 150 labeled judgments.
Six company groups were held out before model calls. Labels were authored by
Codex before evaluation, not independent human ground truth. Public cases were
convenience sampled; eight needed reader-recovered excerpts rather than the basic
collector. This is not a 100–200-company validation set. The rubric was not tuned
on holdout outcomes. Preserve those outcomes if revising the rubric; evaluated
holdout cases become diagnostic material and a later version needs a fresh holdout.

All 40 public-company claim acceptance/rejection decisions matched the labels,
with two differences between `unsupported` and `contradicted`. Held-out company
signal decisions matched 15/18 labels (eight true positives, three false negatives,
seven true negatives). The lexical baseline matched 12/18. One development example
accepted a sample UI chain label as proof of EVM work. Some disagreements expose
rubric ambiguity: historical work versus current services, chain support versus
client delivery, and holder datasets versus audience-analysis use cases. Keep
qualification advisory; do not auto-reject leads based on missing signals. Private
source snapshots, labels, results, and research priorities remain outside Git.

A live API response exposed a floating-point validation boundary: rounded
probabilities summing to 0.99 could be rejected by the intended 1% tolerance.
Validation now permits floating-point noise at that boundary, while rejecting
larger normalization errors. A regression test covers both cases.
