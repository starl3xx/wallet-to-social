# Changelog

All notable changes to walletlink.social. Newest first.

### 2026-09-20 (every attested ingest records its disagreements, finally)

- **`lib/conflict-resolution.ts` said conflict rows "are written by every
  attested ingest" and PROJECT_OVERVIEW said the same. Both were false**, and
  false in the flattering direction: only the `ingestLinks` callers wrote them.
- **`lib/ens-harvest.ts` now records conflicts.** It is fill-only and always
  was, which is right, but it meant an onchain text record naming a different
  account than the one we serve was dropped: no fill, no row, nothing for the
  resolver, the admin queue or `twitter.also` to see. That is the strongest
  attested class in the product (`ens_onchain` is `onchain`, settable only by
  the name's owner) losing the thing it is best placed to tell us.
- **`lib/farcaster-sweep.ts` stops overwriting attested evidence.** It was the
  one X-handle writer that was not fill-only: it replaced any non-`manual`
  handle, including one an owner had just signed for through `/claim` minutes
  earlier, and left `owner_attested` sitting in `sources` beside a handle that
  owner never gave. It now yields to attested sources it does not speak for and
  records the disagreement instead.
- The guard is **derived** from the evidence classification through a new
  `ATTESTED_SOURCE_IDS`, not hand-listed, because a hand-copied list is how two
  reachability queries in this repo already came to disagree. Farcaster's own
  two ids are excluded from it, since guarding against those would stop the
  sweep ever updating a handle it wrote itself.
- **`isTwitterVerified` was missing `neynar` and `farcaster_sweep`.** The sweep
  writes `twitter_verified = true` directly, so the same Farcaster-verified
  handle stored `true` when the sweep wrote the row and `false` when a live
  lookup merged it: provenance decided by which code path arrived last.
- Deriving that list wholesale was tried and reverted. The column does not mean
  "attested class": it means a source that writes `verified = true` ingested
  the row, which is why `zora_profile` belongs in it and is deliberately absent
  from the published attested-share figure. The invariant block pinning that
  divergence is what caught the attempt.
- The new assertion is written for **every** attested writer rather than the two
  that were found, because the claim in those two files is repo-wide.

### 2026-09-20 (the page could not tell you what it holds)

- **`GET /api/claim/mine`**, and a panel on `/claim` that shows the addresses
  you have claimed. There were three routes (challenge, start, withdraw) and
  none of them could answer "have I claimed", so the page showed an identical
  card to somebody who had claimed an hour earlier and somebody who never had.
- It was promising otherwise in two places: "control of your own row", and
  twice that a claim can be withdrawn "from this same page with the same
  wallet" — an instruction naming a wallet the page declined to tell you.
- **The only confirmation that ever existed was one-shot.** `ClaimOutcome`
  reads `?claim=completed` and strips it with `replaceState` in the same
  effect, which is right for a banner and wrong as the only record: one reload
  and there was no way to learn what happened, while the row sat in the
  database saying `completed`. Found by claiming an address in production and
  seeing nothing afterwards.
- Completed rows only. `awaiting_x` is a claim in flight and would report a
  pairing that does not exist yet; `withdrawn` is the case whose whole point is
  that the answer became nothing.
- Scoped by the session cookie and never by a parameter, because an endpoint
  taking a user id would let anybody enumerate which wallets belong to which
  account. It returns no signature, verifier or nonce: the panel needs none of
  them, and the callback's argument for keeping no access token applies here.
- A withdrawal refetches the panel, so the removed pairing cannot stay on
  screen beside the sentence saying it was removed.

### 2026-09-20 (Unstoppable Domains profile harvest)

- **New attested source `ud_profile`** (`scripts/harvest-ud-profiles.ts`):
  reverse-resolves graph wallets missing an X handle to their Unstoppable
  domain, reads the domain profile, and ingests the X entry only where the
  registry marks it `verified` AND `public` (wallet sign-in plus platform
  OAuth, both halves owner-established). Unverified owner-typed text is
  counted and skipped at the adapter, so the source id never labels a weaker
  claim. Fill-only through `lib/attested-links.ts`, quality 45, public class
  `attested-social`.
- Both endpoints are keyless and carry no published terms or limits: the
  provider is mid-rebrand and its partner program is gone (the old dashboard
  answers 410). Harvested now, deliberately, while the endpoints answer;
  checkpointed in `ingest_state` (`ud_profile_harvest`) and budgeted per run
  so an endpoint change mid-walk loses nothing. Daily workflow
  `ud-profile-harvest.yml` (07:45 UTC) walks missing-X wallets; a targeted
  mode (`--limit`/`--wallets`) mirrors the marketplace enrichment's
  most-followed-first default.
- The walk is address-side (up to two requests per wallet), and the probe
  measured that arithmetic before the schedule was set: 300 of the graph's
  most-followed missing-X wallets resolved to 1 domain (0.33%) and 0 verified
  handles. This graph's population and the registry's barely overlap, so the
  workflow runs weekly as a cheap incremental, and the corpus path is
  domain-side enumeration off the registry contracts (the ENS harvest shape),
  where every request lands on a real domain and unseen wallets arrive with
  their handles. That is the follow-up, not this change.

### 2026-09-20 (a pack stops being worth 2.37 times what it sold for)

- **A paid job is now metered.** The match gate armed only when
  `paidFrom === 'free'`, so a pack job was billed for every match it found,
  `drawDown` collected what the lots held, and the remainder was given away.
- The size of that was not incidental. `canSubmit` allows ten times the balance
  in **wallets**, and ten times the wallets is **2.37 times the matches** at the
  measured 23.7% rate, so a 250-match Trial could be shown about 593. The
  anti-enumeration headroom and the overspend ceiling were the same number read
  twice, and `lib/packs.ts` already said the multiplier was chosen so it "cannot
  bite anyone whose list resembles a real one".
- **The contract importer asked for exactly that ceiling**, so every import
  landed on the worst case by construction rather than by accident. It now sizes
  on `walletsCoveredBy(balance)` — what the credits can pay for — and says so in
  the truncation notice, because a cut somebody cannot explain is the surprise
  this is meant to avoid.
- **A near miss is still free.** Both meters bill what the balance holds and
  deliver a margin of 10% past it, because a match rate cannot be known before a
  job runs and locking the 251st match on a 250-match pack punishes somebody for
  arithmetic they could not have done. The margin is a fraction of the
  _remaining_ balance, so it shrinks as a pack empties and an exhausted account
  cannot pull a list through on it.
- **`credit_ledger.goodwill_matches`** records what each job was shown and not
  charged for. It was previously inferable from nothing: the ledger held the
  full count, the lots paid what they had, `getBalance` floors at zero and the
  draw clamps with `LEAST`, so the difference was invisible by construction.
  `drawDown` returns its shortfall now instead of dropping it.
- **The preflight card says what a list will cost**, not just how long it will
  take. The arithmetic already existed in the buy modal, applied to packs for
  sale and never to the pack already owned. It warns and never blocks: the
  estimate can be wrong in both directions, and refusing a list somebody wanted
  run partially is the angrier mistake. First real use of `caution` for
  "approaching a limit", which CLAUDE.md defines and nothing implemented.
- The results banner said "Your free allowance covered N" to everybody, which
  could never be true of a buyer until this change made a buyer gateable.
- **Published behavior changed**, so `docs-site` changed with it:
  `api-reference/jobs.mdx` said "Jobs run on pack credits are never gated" and
  now carries the dated note that they are, and `app/lookups.mdx` is scoped to
  both meters rather than to the free allowance alone.

### 2026-09-20 (holder walks resume instead of repeating)

- **`seeded_contracts.resume_state` bookmarks an unfinished ERC-20 holder
  walk** (`{source, cursor, walked}`). Every source returns holders sorted by
  balance descending, so before this a re-seed after the novelty window
  re-imported the same top 2,000 whales and exchanges forever, and a
  1.7M-holder token's tail — the slice most likely to be real people — was
  unreachable at any cadence. Now each slice passes the last slice's cursor
  and continues down the list.
- The cursor is the second index's keyset (base64 of [balance, address]), so
  it survives across days; balance drift near the boundary can repeat or skip
  a few wallets, which the wallet-keyed upserts absorb. It is source-tagged
  and only the index that minted it may consume it: a revived first index
  starts a fresh top slice rather than misreading a foreign cursor.
- **Selection is breadth first, then depth.** Never-seeded contracts keep
  their rank order and their priority; contracts with an unfinished walk
  become eligible after `CONTINUE_AFTER_HOURS` (20, under a 24-hour cadence
  so cron jitter cannot make walks skip alternate days) and fill the days a chain
  has nothing new, oldest walk first, where the slot used to idle on "no
  novel candidates". A finished walk clears its bookmark and refreshes on the
  normal 30-day cadence, restarting from the top.
- The squeeze path was the trap: `unmarkSeedAttempt` deletes a zero-holder
  attempt row to restore next-day eligibility, and that DELETE would have
  erased a walk's entire accumulated progress. Walk rows are backdated out of
  the retry window instead. Five new invariants cover the ways a bookmark can
  lie (wrong index, deleted progress, outranking new contracts, surviving a
  finished walk, bookmarking an empty page); 1,017 now pass.
- Migration: `scripts/migrate-seed-resume.ts` (idempotent, verified), and the
  canonical DDL in `scripts/migrate-seed-tables.ts` carries the column for
  fresh environments. `scripts/backfill-seed-resume.ts` reconstructs bookmarks
  for walks seeded before the column existed, so yesterday's six token seeds
  continue tomorrow instead of waiting out the novelty window.

### 2026-09-20 (the page said the wrong thing about money)

- **`/claim` described a grant condition nothing implements.** It said credits
  are paid when a claim "adds something we did not already hold", and offered
  the matching reassurance that confirming something we have right "earns
  nothing". Neither is what the code does: `ingestLinks`' result is discarded
  and `maybeGrant` gates on `walletPredatesCutoff`, the budget and one grant
  per X account. Somebody confirming a handle we already held correctly, on a
  pre-cutoff address, was paid while the page told them it was not.
- The page now states the condition that exists, with the date read through a
  new `ATTESTATION_CUTOFF_HUMAN` derived from the frozen literal rather than
  written out a second time. A date written twice is a date that eventually
  disagrees, and the page is the half nobody runs.
- It also contradicted itself, which is the part worth remembering: two
  paragraphs above, the same page says confirming "adds the account id, which
  is the part that survives a rename". Confirming does add something, so the
  reassurance was the wrong half rather than the grant being wrong.
- **The per-address answer now reaches the person.** `/api/claim/challenge`
  computes `earns_credits` and `grant_matches` and says in its own comment that
  it does so before anyone signs; both fields arrived and nothing read them, so
  the one moment the answer was useful passed in silence. The flow shows it on
  connect, before there is anything to approve, in `muted` rather than
  `attested`: it is what a claim would be worth, not a measured outcome.
- It says the address **qualifies**, never that the claim credits.
  `earns_credits` is `walletPredatesCutoff` and nothing else, while
  `maybeGrant` can still refuse on the per-account unique index or the budget,
  so the first version of that line promised money to a second pre-cutoff
  address claimed with an X account that had already been paid: a false
  statement about a grant, written inside the change whose whole subject was a
  false statement about a grant.
- The mode now changes through one function that clears what belonged to the
  old one. `worth` was cleared at the start of a run and nowhere else, so a
  cancelled claim left its credit sentence above a withdrawal that pays
  nothing, which the setter's own comment already forbade.

### 2026-09-20 (signing in from a claim comes back to the claim)

- **`/claim` is the second path a sign-in link may return to.** The card above
  offers a Sign in, and sign-in is a magic link, so it always leaves the page
  and `/api/auth/verify` decides where the person lands. Without a return path
  that is the home page, which abandons the claim they were part-way through.
- `isAllowedReturnPath` now accepts two shapes rather than one. The new one is
  a **literal compared with `===`**, carrying no query, which is what keeps it
  from widening the allowlist: the danger it exists for is caller-supplied data
  surviving a mailbox with our own authenticity attached, and a fixed literal
  supplies none. Tampering produces either that exact page or a refusal.
- Eight near misses are asserted as refusals (`/claim?next=…`, `/claim/../admin`,
  `/claimants`, `/claim.evil.example.com`, `//claim`, a fragment, a trailing
  space, and the path with no leading slash), because each is a real way a
  `startsWith` test fails. Verified by making it a prefix test: six of them fire.
- The comment that prompted this said the session refreshed in place and the
  wallet buttons simply replaced the card. That was never true of a mailbox
  round trip, and it was written in the same change that introduced the card.

### 2026-09-20 (the wallet stops being asked first)

- **`/claim` says an account is needed before it asks for a wallet.** Both
  routes behind the page require a session and the challenge answers 401
  without one, correctly, but that refusal arrived after the wallet prompt:
  somebody signed out pressed their wallet, approved a connection, and only
  then learned an account was required. A connection approval is a real thing
  to ask of a person, and the page spent one delivering a fact it already held.
- The signed-out state offers a Sign in that opens the modal in place, on the
  `LookupHistory` precedent and at `soft` weight rather than filled, because
  the header already carries one. `AuthProvider` refreshes the session without
  a navigation, so the wallet buttons replace the card and nothing read on the
  way down is lost.
- **The session-loading state gets its own branch**, for the reason
  `providers === null` has one: "not answered yet" is not "answered no", and
  rendering the signed-out card during the session fetch would tell a signed-in
  person to sign in.
- The withdraw switch is behind the session too. It sits outside the branch
  chain and stayed reachable, which would have offered a second action ending
  at the same 401 as the first.

### 2026-09-20 (the claim page had no way in)

- **`/claim` is linked from the footer, the sitemap and the privacy policy.** It
  shipped with a canonical URL and nothing pointing at it anywhere on the site,
  so every route in went through already knowing the URL. Declaring a canonical
  asks to be indexed and the sitemap is where that request is made; the two
  disagreed.
- In the footer it sits under Project beside Privacy rather than under Product,
  because it is not something to buy: it is the other half of what the privacy
  page offers. That page tells somebody in the index to write in and wait for a
  person to run the removal by hand, and this is the same control exercised by
  themselves for an address they can sign for.
- The privacy policy's removal section now says so, **beside the email route
  and not instead of it.** Email asks nothing of the person and stays the only
  route for a handle, for an address whose key is gone, and for leaving the
  index entirely.
- All three links are asserted, and the first version of that check was itself
  the defect it exists to catch: `footer.includes('/claim')` passed with the
  link deleted, because the comment explaining the link also contains the path.
  It was reading its own justification. Found by deleting the link rather than
  by rereading the assertion.
- `PROJECT_OVERVIEW.md` gains the claim page and its files, which the systems
  map had never mentioned: the table row existed and the page did not.

### 2026-09-20 (withdrawal, which the page had been promising)

- **`POST /api/claim/withdraw`**, reachable from `/claim` itself. The page
  promised twice that a claim could be taken back and nothing could take one
  back; a promise whose control lives elsewhere is barely a promise, so the
  control is on the page that makes it.
- **Every row for the wallet, not the most recent one.** `start` inserts
  unconditionally and nothing unique-constrains a completed pair, so one wallet
  can carry several. Withdrawing the newest left the earlier ones holding the
  handle, the account id and the signature. `awaiting_x` rows are cancelled in
  the same statement: a claim opened before the withdrawal could otherwise come
  back through the callback afterwards and re-complete the pairing.
- **Suppress, then erase**, the order the operator endpoint uses. The triggers
  have to stop the pair LANDING before the rows go, or the next ingest writes
  it straight back. The wallet only: suppressing the handle would remove that
  account from every other wallet's record, and a withdrawal is one pairing
  rather than a request to be erased from the index.
- **A claim and a withdrawal stop proving each other.** Both were proved by
  signing identical bytes, so a signature gathered for either satisfied the
  other, and somebody withdrawing was shown the claim text in their wallet:
  asked to approve that the record "can name the account you choose" in order
  to remove an account. A challenge now carries an intent, in the signed text
  and in the HMAC prefix, and each route states its own rather than reading it
  from the request body.
- **The suppression refusal is claim-only**, which is what makes a
  half-finished withdrawal finishable. Suppress-then-erase means a failure
  between the two left the wallet suppressed with the pairing still served, and
  the retry was told the address "has been removed from the index at its owner
  request": success language for a withdrawal that had removed nothing.
- **An abandoned claim stops keeping a signature for ever.** A row is born
  holding the wallet signature and the PKCE verifier, and only a completed
  callback or a withdrawal cleared either, so closing the X consent tab left
  both indefinitely. The cleanup cron now clears the payload at thirty minutes,
  matching what the callback already enforces at read time, and keeps the row:
  "started and did not finish" is true and harmless once the payload is gone.
- The withdrawal control is a mode rather than a second row of buttons, so both
  actions get the same wallet choice. It passed `providers[0]` first, which is
  whichever extension announced first rather than one anybody picked, and the
  heading and body went on describing a trip to X that a withdrawal never
  makes.

### 2026-09-20 (the table a claim lands in, and the boundary it is argued into)

- `identity_attestations`: one row per `/claim`, and the pending state for the
  X round trip, the same shape as `x_list_jobs` and for the same reason. It is
  born holding a verifier and a nonce and no proof of anything.
- **No access token column**, unlike its neighbour. That table keeps one
  because it spends sixteen minutes adding members; this flow reads the account
  once and drops the credential in the same request, so storing one would be
  storing it for no reason.
- **The account id is hashed and the wallet is not.** One grant per account,
  ever, has to keep holding after a withdrawal erases the plaintext, and
  removal is the entire point of a withdrawal, so the uniqueness key cannot be
  the identity. The wallet stays clear because it is the join key into
  `social_graph`, which already holds it that way.
- Added to `READ_ONLY_TABLES` in the same change rather than printed as a
  follow-up, and deliberately **not** to the backup list: a restore would
  resurrect an attestation somebody has since withdrawn.
- **Argued into `SUPPRESSION_EXCLUDED_TABLES`, not silently omitted.** The
  deciding reason is the `x_list_jobs` reason with a different victim:
  `suppression_guard_skip` discards every later UPDATE to a guarded row, and
  the important UPDATE here is the withdrawal. A guard would make the one
  action a person takes to undo their own attestation the one action that
  silently does nothing.
- Declared in `db/schema.ts` before anything reads it, which is usually wrong
  and is right here: the invariant derives identity-carrying tables by parsing
  that file, so a table holding a wallet and a handle that it does not declare
  is a table the boundary check cannot see. Verified by renaming the table so
  it fell outside the argument, and confirming the check names it as uncovered.

### 2026-09-20 (the claim challenge, and the gate that cannot be bought)

- `lib/attestation.ts`: the wallet-signature half of `/claim`. The shape is
  copied from `lib/x402-recovery.ts` because the hard parts were solved there
  the expensive way: the HMAC is checked before the expiry so timing leaks
  nothing, and `issuedAt` is a parameter so a check can exercise the real
  function rather than reimplementing it.
- **The secret and the message text are its own, and that is the point.** Two
  flows now ask a wallet to sign, and they authorise different things: one
  hands out an API key, the other writes an identity into the index. The text
  differs so a person approving it in a wallet can tell them apart, and the
  HMAC input is prefixed so the signed bytes differ even if both secrets
  leaked. Both halves are asserted, because either alone is a single point of
  failure.
- **The eligibility cutoff is a committed literal, never the clock.** A
  signed-in free account can put a thousand addresses into the graph every
  thirty days at no cost, so graph membership is abundant going forward and
  scarce only retroactively. A cutoff that moved with the clock would make
  every wallet eligible once it had aged, which is the same as having no gate
  while looking like one.
- Stated plainly in the module, because it would be easy to oversell: this gate
  cannot be bought and cannot be moved by the feature that reads it, and it
  still does nothing against somebody who already controls pre-cutoff wallets.
  It is the cheap first filter in front of the per-account limit and the
  budget, not the security story.
- A failed eligibility read **throws rather than answering false**. The two are
  not the same: false denies a grant somebody earned, silently, on the one path
  where the person is watching.
- Four of these assertions were silently skipping on the first run, because
  `ATTESTATION_SECRET` was unset and the challenge issuer returns null without
  it. That is how a check reports clean over code it never ran, so the checker
  now stubs it, with a different value from the recovery secret so the HMAC
  prefix is actually exercised.

### 2026-09-20 (the owner-attested source exists before anything writes it)

- Declares `owner_attested`, the source a wallet signature plus an account
  sign-in taken on our own page will write. Nothing writes it yet and no row
  carries it, which is the point: the declaration is four coordinated edits
  and an existing invariant already forces them into one change, so landing it
  alone means the flow that follows is only a flow.
- **Quality 45, the same as its peers, and that is arguable.** Every other
  source in that group is a vendor's report of the same two proofs, while this
  one is the proofs themselves and the only route yielding an account id we
  control rather than one we were handed. That is a case for scoring it higher.
  It gets 45 anyway: inventing a second trust tier for one source splits the
  band the public class derives from, and the claim being made is identical.
  Provenance and durability are not strength.
- Named in `isTwitterVerified` for the reason every entry there exists:
  `lib/attested-links.ts` writes `twitter_verified = true` for what it ingests,
  so a source missing from that list is silently unverified by the next live
  lookup that merges the row. That is the ethos defect, and it replays once per
  source that forgets the line.
- Public class `attested-social`, not a class of its own. The class names the
  mechanism, and the mechanism is the same one every other entry with that
  class describes. That we took the proofs ourselves is provenance, which the
  class deliberately does not carry.
- Carries `no-docs-needed`, which the docs-freshness gate's own message
  sanctions for a change invisible to API consumers. Checked rather than
  assumed: `docs-site/openapi.yaml` publishes an enum of evidence **classes**
  and contains no raw source id at all, the class this maps to already exists
  in it, and no row carries the source.

### 2026-09-20 (the docs said we never pick a winner, and we do)

- **`docs-site/concepts/data-quality.mdx` claimed "we do not overwrite one with
  the other and we do not silently pick a winner".** `lib/conflict-resolution.ts`
  has been doing exactly that on a daily cron since 2026-08-22, with no human in
  it. The docs are a contract with paying customers and they fail silently:
  nothing breaks when they drift, they just start lying.
- Corrected to the rule the code actually implements, which is narrower than
  the sentence it replaces and worth stating precisely. Where both accounts
  still reach someone, nothing is settled, because measured on real cases the
  handle we hold usually belongs to somebody who does not claim the wallet.
  Where ours reaches nobody, the other is live, and both were checked recently,
  the rename is followed and the replaced handle is kept.
- Found while planning `/claim`, whose whole premise is owner attestation, so
  this sentence would have been the first thing an attestation contradicted.

### 2026-09-20 (a settled rename finally says so)

- **`twitter_renamed_from` has been written since 2026-08-22, carries 2,208
  rows, and was rendered nowhere.** A customer who exported a list last week
  and saw a different handle today had no way to tell a correction from a
  mistake, which is the one thing that column can explain.
- The row modal's Evidence panel now says it, with the attested mark: we held
  the old handle, it stopped reaching anyone, and a source the owner published
  named the new one. That is a measured fact rather than an inference, which
  is what earns the green.
- Carried through the whole trip, not just mapped. `mergeGraphRow` rebuilds a
  result from `...existing` plus an explicit field list, so a field left off
  that list is read out of the database and dropped one function later. That
  is not hypothetical: `agent_detection_source` failed in exactly that shape
  earlier the same day, with three writers filling it and all four readers
  dropping it. The assertion covers the read, the merge and the panel
  together, and was verified by removing the merge line.
- **A previous handle is still a handle**, so the match gate withholds it on a
  row the customer has not paid for, and the suppression scrub erases it when
  it is itself removed. Adding a field to the result type is the cheap half:
  each strip path carries its own list, and a field absent from one of them is
  served.
- **The previous handle and the live one stay uncoupled**, in both directions,
  and that is the opposite of what the first version of this change did. The
  `suppression_guard_row` trigger states the rule in its own words: "a match on
  it must not clear the live handle beside it, and a match on the live handle
  must not clear it." The reason is that the two strings are frequently
  different people. The conflict resolver swaps when OUR handle reaches nobody
  and another source names a live account for the wallet, so the replaced
  string often never belonged to that wallet's owner at all. Coupling them
  would erase a stranger's handle on somebody else's removal, and would put the
  serve path at odds with the trigger it is documented to mirror.
- That is asserted as the refusal rather than the behaviour, because the
  tempting change is the one that looks more private: coupling reads as
  "erase more". It was written once and removed.
- **Deliberately not on `/v1`.** Publishing it is a response-shape change
  across every reverse and lookup route, and `docs-site` and `openapi.yaml`
  would move with it. A second assertion keeps it off the public shape so it
  cannot get there by accident.

### 2026-09-20 (every X list the tool builds carries where it came from)

- **@walletlinketh is added to every list**, first rather than last. First for a
  reason measured on a live job the same day: a list of 290 stalled at member
  103 on an account X refused, and a member added last is a member a stalled
  list never reaches. Appending would have left us out of exactly the lists
  that went wrong.
- Added **by numeric id**, never by handle. A handle is a string its owner can
  change, which is the thing this codebase keeps rediscovering, and building
  the member from a hardcoded handle would mean our own rename quietly adding
  a stranger to every customer list.
- It takes one of X's 5,000 slots rather than sitting on top of them, so a list
  can never exceed the cap by carrying us. Skipped when the account is already
  a holder, because X refuses a duplicate and the refusal would be counted
  against the customer's own numbers.
- **Disclosed in the dialog before anyone authorizes**, in the description
  rather than on the confirmation screen, because that screen only appears when
  something was dropped and a clean list would never have shown it. It is the
  customer's list, and a guest they did not ask for is something to be told
  about while they can still decide.
- Our account is **filtered out and unconditionally prepended**, not skipped
  when already present, and the difference is a real hole rather than a style
  choice: testing membership against the full resolved list and truncating
  afterwards leaves an account that is a holder but sits past the 5,000 cap
  with neither the prepend nor a place in the slice, so the list would carry
  nobody. Filtering first makes position irrelevant.
- Two assertions: that we go in first and by id and never twice, and that the
  counts returned to the caller still exclude us. The second one matters more
  than it looks, because `capped` now holds a member the caller did not ask
  for: reporting its length as theirs makes `dropped` read -1 on any list under
  the cap, which is the kind of number that survives review because it reads as
  a rounding artefact rather than a miscount. Both verified against the real
  defect.

### 2026-09-20 (the footer stops linking to this file)

- The Project column linked Changelog straight at `CHANGELOG.md` on GitHub.
  It is an engineering log, written for whoever works on this next, and it was
  sitting one click from the footer of every page beside Privacy and the
  support address. Removed; the file stays exactly where it is and is still
  linked from the repository itself.
- The module comment listing which footer links carry the external arrow was
  updated in the same change, since it named Changelog as one of them.

### 2026-09-20 (the batched resolve gets a timeout, a pure parser and one home)

- **The by-id resolve had no request timeout.** `lib/clanker.ts` passed only
  headers, so it inherited undici's default 300s header timeout, which equals
  the cron route's entire `maxDuration`. One provider socket that accepts and
  never answers would consume a whole run. The by-handle `resolve()` next door
  has carried a 15s ceiling for exactly this reason since it was written.
- Moved to `lib/x-accounts.ts`, beside the `resolve()` that already guards this
  provider's habit of reporting its own failures as HTTP 200 with
  `status: "error"`. One implementation rather than two: a second spelling of
  that parse is how one copy keeps the status check and the other quietly
  loses it.
- `parseBatchByIds` is pure and exported, so the refusal can be asserted by
  feeding it a body rather than by mocking a socket. Three assertions: an
  error body carrying a plausible user is not evidence about any id, a success
  body with no `users` array is an unrecognised shape rather than an empty
  answer, and a real answer resolves only what passes the handle rule.
- **`CREDITS_PER_BATCHED_LOOKUP` stops being a dead constant.** It was exported
  and referenced by nothing while its own doc comment asserted that "the second
  pass and every pass after it goes by id". No pass did. The comment now says
  what is true, and `resolveByIds` charges against the constant, so the batched
  price is finally spent by something.
- `isHandle` moved with the resolve rather than being duplicated, so the caller
  and the validator cannot disagree about what a handle is.
- No behaviour change to what Clanker ingests: same endpoint, same chunk size,
  same `answered` semantics, which remain the load-bearing half.

### 2026-09-20 (a handle ENS never supplied stops being labeled as attested)

- **The ENS harvest stamped rows for writes it had just refused.** The handle
  is written fill-if-empty, so when a row already holds a handle that is not
  what the ENS record says, `COALESCE` keeps ours and the ENS handle is never
  written. The `sources` and `dataQualityScore` CASEs had a branch for the
  refused-rename case and none for that one, so the row was appended
  `ens_onchain` and carried through `GREATEST` anyway.
- **It is not a cosmetic label.** `isTwitterVerified` counts `ens_onchain` as
  owner-attested, so the unearned source read downstream as the owner having
  published a handle they did not publish, and inflated
  `data_quality_score` with it. That is the evidence class the product is sold
  on, which is what makes this a defect rather than a tidy-up.
- The fix is the branch the neighbouring case already had, applied to the
  commoner refusal, and it keeps the github carve-out that branch carries: a
  record that also fills github performed a real write and earns both. It is
  deliberately not a verbatim copy of `lib/attested-links.ts`, which has no
  github column and so needs no such clause.
- Scope stated rather than implied: this covers a disagreeing twitter handle
  only. A github-only record landing on a row whose github is already set still
  appends the label. That case is unmeasured and was left alone rather than
  widened blind.
- One assertion, counted across both columns, because fixing `sources` and
  leaving `dataQualityScore` still inflates the score of a write that did not
  happen. Verified by making exactly that half-fix and confirming it fails.
- Existing rows already carrying the label are not repaired here. Nothing
  recorded whether a given `ens_onchain` came from a real fill or a refused
  one, so it needs a re-derivation pass rather than a repair rule.

### 2026-09-20 (one member X will not accept stops costing the list everyone behind them)

- **A live list of 290 stopped at 103 and sat there.** The resume cursor is
  `added + skipped + failed`, and a transient failure deliberately leaves it in
  place so a network blip cannot silently drop somebody. Member 103 was an
  account X refused every time, so every tick retried the same account, added
  nothing, and moved nothing. The job was about fifteen minutes from `failed`
  with 187 members never attempted.
- The existing counter could not see this, and the reason is worth stating:
  "twenty ticks in a row added nothing" is equally true when X is down and when
  exactly one member is unacceptable, and the correct response is opposite in
  each case. Wait, or step over.
- The step-over is **positional**, which is the whole content of the fix. A
  bare counter cannot distinguish three failures at member 103 from one failure
  each at 103, 104 and 105, and only the first is evidence about a member
  rather than about the service. `stuck_cursor` records where attempts are
  accumulating; `member_attempts` counts them there. After three, that member
  is counted `failed`, which already means "attempted and could not be added",
  and the list continues.
- Three rather than one, because 403 is treated as transient precisely because
  X uses it for an app-level refusal as well as a member-level one. One refusal
  cannot tell those apart; three at the same position, while the service is
  otherwise answering, can.
- **A step-over deliberately does not reset `transient_failures`.** That is the
  half a happy-path test would miss: if X were down rather than one member
  being bad, every position would fail, and a counter cleared on each step-over
  would walk the whole list marking real people permanently unaddable. Leaving
  it running bounds the damage at `MAX_TRANSIENT_FAILURES / MAX_MEMBER_ATTEMPTS`
  members before the job stops and says so.
- Two assertions, each broken against the real defect before being kept. The
  outage one also tripped the pre-existing give-up assertion, which is the
  correct blast radius for that change.

### 2026-09-19 (the figure columns stop being sized by their own headers)

- **"FARCASTER FOLLOWERS" is 169px on one line, which made a column of
  four-digit numbers 220px wide.** The widest thing in that column was never
  the data, and the priority score was pushed off the right edge as a result.
- The header row wraps to two lines (34px to 58px, still fixed, because the
  virtualiser is told where the list starts and that number has to be the one
  the header actually renders at). A locked column stacks its Unlock control
  **under** the label rather than beside it, so a locked column is no longer
  wider than the same column unlocked: it was being sized by a control instead
  of by its figures. The row is sized by that stacked header, which is the
  tallest of them: measured in a browser at 53px, where a sort header is 34px.
- Figure columns are now the widest realistic value plus padding: 128px for X
  followers, 128px for Farcaster followers, 124px for priority. The minimum
  table width drops from 1,192px to 1,098px, and those ~94px go to the columns
  with no length bound, which also take the wallet track from 140px to 176px.
- Two lines is a ceiling (`line-clamp-2`), not wrapping-as-it-falls. A label
  needing three lines is a label to shorten. Every header label was measured
  against its own track to confirm none of them hits that ceiling and clips.
- Note for anyone reading an older saved lookup: **X followers will be blank
  on any lookup run before that column existed.** The value is stamped at job
  time and stored with the results, so it cannot appear retroactively. Re-run
  the lookup to populate it.

### 2026-09-19 (three things the agent classification said but did not do)

- **The gate withheld what the counter called free.** `result-counts.ts` says
  of its agent tally "Never gated: agent detection is free", and all six agent
  fields were in `LOCKED_FIELDS`. `gateResults` runs server-side and
  `countResults` runs in the browser afterwards, so on any gated lookup the
  "AI agents" tile, the "Agents only" filter and the CSV all read a locked
  agent row as a non-agent. The fields are ungated: what the gate withholds is
  an identity somebody has not paid for, and "this address is an agent" is a
  fact about the address rather than an identity belonging to a person.
- **`/v1/reverse/*` returned no agent object**, while the internal
  `/api/reverse` returned all six fields, so the same question answered
  differently through the browser and the API, and the MCP reverse tools (which
  sit on the public route) could never report an agent at all. Worth being
  precise about the direction: `ReverseTwitterRecord` is `allOf: IdentityCore`
  and `IdentityCore` declares `agent`, so **the published spec had been
  promising this field all along**. The docs were right and the code was wrong.
- **`agent_detection_source` was a dead column.** It exists on `wallet_cache`
  and `social_graph`, documents a four-value vocabulary, is carried on
  `AgentDetectionResult`, and nothing ever wrote it: the job processor dropped
  it, the cache wrote `null` with a comment saying so, and the graph only ever
  preserved a previous value that was always `null`. A catalog match and a
  regex over a Farcaster bio were indistinguishable on a stored row, and the
  only hint was `agent_verified`, which is `true` for every catalog match
  whether or not anything verified anything. All three writers now write it,
  and all four readers now return it: `getCachedWallets` and
  `socialGraphToResult` each mapped the six `agent_*` fields and stopped, and
  both merge helpers copied the same six, so the first fix filled a column
  that no cache or graph hit could ever read back. A value that is stored and
  never returned is indistinguishable from one that was never stored, which is
  the confusion this was meant to end rather than relocate.
- Three assertions, each verified against the real defect. The reverse one was
  weak on the first pass and the adversarial run is what showed it: asserting
  that `item.agent = {` appears is satisfied by `if (false) { item.agent = {`.
  It checks the guard together with the body now.

### 2026-09-19 (an attested identity outranks a scraped agent claim)

- **Wallets belonging to people were labeled AI agents**, and the badge was
  asserting an inference over the top of the strongest evidence the index
  holds. `known_agents` is scraped from a launch protocol's own API, whose
  per-agent `walletAddress` is frequently the **creator's** wallet rather than
  an autonomous one.
- Measured against production: of 13,622 agent wallets, 1,037 appear in the
  graph and 536 resolve to an X handle. **492 of those carry an owner-attested
  identity that is not the agent's own**, and 168 `social_graph` rows had the
  label stored. Only 31 agree. The clearest case: agent `AGGENT`, whose own
  account is `@AGGENT_ai`, filed against a wallet attested to `@avocato31`.
- `lib/agent-claim.ts` withdraws the agent fields where an attested identity
  contradicts the claim, keeps them where the agent's own account **is** the
  attested one, and keeps them where nothing attested exists, because then the
  claim is the only evidence there is.
- **Withdrawn, not denied.** The fields are deleted rather than set false, on
  the same absent-is-not-false rule the rest of the row follows: false is a
  claim that we checked and it is not an agent, and that is not what happened.
- It runs **after** the graph read. STEP 0 detects agents before any social
  identity is known, so a reconciliation placed beside the detection would
  compare against empty fields, withdraw nothing, and look exactly like a rule
  that works. Asserted by position.
- `known_agents` is never edited. It is an L0 fact with provenance, and the
  claim is still true of the agent; it is just not true of that address.
- `scripts/backfill-agent-claims.ts` clears the 168 rows already written.
  Saved lookups are left alone: they record what a customer was shown on a
  date, and rewriting them would make an old export disagree with the file
  already downloaded.
- **A published figure was wrong by twentyfold.** The agent blog post claimed
  agent wallets resolve to a social identity "under 0.3%" of the time. The
  measured rate is **6.2%**, and the gap is the whole finding: an agent list
  that resolves to people is a list holding creators' wallets. The passage now
  says the measured number, explains why it is high, and the figure is
  registered so it cannot drift again.
- Reflected in the README, `PROJECT_OVERVIEW.md`, `llms.txt` and the public
  API field description in `docs-site`.

### 2026-09-19 (pr:status stops passing PRs with unread findings)

- **"No issues found" is not the same as "nothing to read."** Bugbot's summary
  distinguishes what it found on THIS run from what remains open from an
  earlier one, and a re-review of an unchanged finding reports the first as
  zero while the second stays non-zero.
- A PR reading _"no issues found. 2 previously reported issues remain
  unresolved"_ passed `npm run pr:status` on the day that command was written,
  and both of those were regressions introduced by the change under review:
  figure column headers clipping at the new widths, and the priority score
  disappearing under the sticky details column.
- An unresolved count now refuses on its own, independent of whether the
  current run found anything, and the output says which of the two it is
  rather than collapsing both into one sentence.

### 2026-09-19 (Create X list did nothing at all)

- **The menu row opened a dialog that the same click destroyed.**
  `OverflowMenu` renders its panel as `{open && …}` and closes on any click
  inside it; its own comment says "activating a row unmounts the row". The X
  list dialog was owned by the menu row, so it was unmounted in the same tick
  it was opened. Nothing threw, nothing logged, and the row looked correctly
  wired at every line you would read.
- The dialog is now a separate component the page renders **outside** the
  menu, with its open state on the page, which outlives both. The row owns
  nothing worth losing, because the row does not survive its own click.
- Asserted per component rather than per file: a component that renders a
  `MenuItem` must not also render a `Modal`. Per file would have called the
  fix a violation, since the row and the dialog deliberately share a module.
  A second assertion pins the menu's unmount-on-activate behaviour, so if that
  ever changes the first rule is known to be merely tidy rather than load
  bearing.

### 2026-09-19 (a result set becomes an X list)

- **"Create X list" turns the reachable handles of a lookup into a real X list
  in the customer's own account.** walletlink is now an OAuth client of X, which
  is the first time it has been a client of anything rather than a resource
  other clients connect to.
- **No connection is kept, and that is the design.** `offline_access` is not
  requested, so there is no refresh token to store, rotate or leak. An X access
  token lives two hours and a list takes about sixteen minutes, so the sealed
  token rides the job row and is nulled when the job ends. The visible cost is a
  second authorization for a second list; the thing bought is that we never hold
  a standing ability to act as everyone who ever connected.
- **It is a job, not a button, because X allows 300 member additions per 15
  minutes** and takes one member per request. A 319-handle list is 319 requests
  across two windows. `added_count` is the resume cursor, so a rate limit or a
  restart costs the time to the next tick rather than the work already done, and
  the modal says how long the list will take before the click.
- **Suppression is re-read before every batch**, not once at the start. A
  removal landing at minute three has to stop the addition at minute four; the
  alternative notices after the list is public, where the only remedy is a
  public list with a visible removal in it.
- The member ids come from our own index, restricted to `status = live`. That
  does the work of three refusals at once: a suspended or vacated handle has no
  account to add, and a reassigned handle's id belongs to whoever took the name,
  which is exactly the account that must not appear in a list described as this
  community.
- **Not metered**, deliberately. Building a list spends our own prepaid X
  credits at roughly half a cent per member. Gated on `hasPaidAccess`, size
  capped at X's 5,000, and a list above that is truncated with the dropped count
  returned rather than silently shortened.
- `reachableHandlesFrom` moved from `ExportButton` into `lib/`, so the count on
  the menu item, the count in the exported file and the members of the list are
  one derivation and cannot disagree.
- New: `x_list_jobs` (migration, suppression guard, `READ_ONLY_TABLES`, not
  backed up), `lib/x-oauth.ts`, `lib/x-list-worker.ts`, `/api/x/lists`,
  `/api/x/callback`, `/api/x/lists/[id]`, `/api/cron/x-list` every minute.
  Requires `X_OAUTH_CLIENT_ID` and `X_OAUTH_CLIENT_SECRET`; without them the
  route answers 503 and the cron reports `disabled` rather than failing every
  minute.

### 2026-09-19 (the PR checkmarks get a command that reads them properly)

- **`npm run pr:status <n>`**, because a green row of checkmarks was reassuring
  and wrong twice in one day, in two different ways, and both are invisible
  unless a specific question is asked.
- **Bugbot's `neutral` renders as `skipping`**, and it is emitted both when it
  found nothing and when it found plenty. The count lives only in the check
  run's own summary, which the PR page does not show. Eleven real defects
  arrived behind that label today across four PRs, two of them serious: a
  follower count left on the row of somebody who had asked to be removed, and
  a suppression trigger that would have preserved a live third-party token for
  exactly that person.
- **A conflicting PR runs no workflows at all.** GitHub builds a
  `pull_request` run against the computed merge commit, so when that merge
  cannot be computed nothing triggers: no queued run, no failed run, and the
  checks still shown are whatever ran on an older head, green and describing
  code that is no longer there. It presents convincingly as an Actions outage,
  because these workflows are `pull_request`-triggered so merges to `main`
  correctly produce no runs either, and with one open conflicting PR the whole
  repository looks dead including its schedules. The first call is
  `gh pr view <n> --json mergeable`.
- The conflict check runs before anything is said about the checks: a conflict
  explains a missing check, and no amount of staring at the check list
  explains a conflict.
- `docs/OPERATIONS.md`'s PR protocol now carries both, and says to resolve a
  conflict by merging the base branch **in** rather than rebasing, since a
  rebase can only be published with a force-push.

### 2026-09-19 (the results table gets X followers, and stops overflowing)

- **X followers is a new column, from data the index already held.** Every
  sweep writes `x_accounts.followers`, and nothing had ever read it back:
  `reachabilityFor` selected `handle, status, checked_at` and stopped there.
  Widening that projection is the whole data change. 332,593 of the 473,051
  swept handles carry a count, which is exactly the set that is currently live.
- It sits **beside the X handle** rather than next to the Farcaster count, so
  each identity is followed by its own reach. Paid field, like the Farcaster
  count and the priority score, and stripped for a free job.
- **A reassigned handle never carries the count**, and that is the one case
  worth stating. The other unreachable states are safe by accident, because a
  suspended or vacated handle has no profile left to count. A reassigned handle
  resolves to a live account with a real follower count belonging to the
  stranger who took the name, so publishing it beside the wallet would be the
  "stale string into a confident wrong answer" failure `lib/x-accounts.ts`
  opens by naming, with a figure attached to make it persuasive.
- **The X handle and Farcaster cells overflowed into the column beside them.**
  A grid item's `min-width` resolves to its content, so neither cell could
  shrink below the handle inside it: `@thedojieth.base.eth` painted over the
  follower count. The ENS cell never showed it only because `truncate` carries
  `overflow-hidden`, which resolves the same auto minimum to zero. Both cells
  now declare `min-w-0` and clamp the text inside, with the full handle in the
  title.
- **The bag column was as wide as a column of handles.** Every track grew at
  `1fr`, which shares slack equally, so two-digit figures took the same share
  of a wide viewport as the columns with no length bound. Tracks now carry a
  growth factor: a figure column is as wide as its header needs, and the
  identity columns divide what is left.
- **Priority's tooltip said what it was made of, not how.** "Based on holdings
  × follower reach" hides the part worth knowing, that the follower term is
  logarithmic, and never said which followers. The sentence now lives beside
  `calculatePriorityScore` because it is a claim about that arithmetic, and the
  header and the cell both read it.
- Seven new invariants, each verified against a deliberately reintroduced
  defect. The ordering one is asserted **by position**: stripping `x_followers`
  beside the other two paid fields looks correct and is a no-op, because
  nothing has set the field at that point, and the stamp would undo it a few
  hundred lines later.
- **A removed handle takes its count with it**, found in review before merge.
  `scrubResultRow` deleted a suppressed `twitter_handle` and left
  `x_followers` beside it, and `LOCKED_FIELDS` listed `fc_followers` without
  its new sibling. A person who asked to be removed would have lost their
  handle and kept a number precise enough to identify them, whose presence
  proves an account was there at all. The pattern was already right one field
  over; the new one simply was not added to either list, which is the failure
  mode of a delete list nobody can see the whole of. Both are asserted now,
  the suppression one against the real `scrubResultRow` with a positive
  control.
- **Reverse lookups were never stamped at all**, found in review. That route
  assembles the same rows out of the graph by hand and called only
  `stampAlsoOnX`, so the new column came back empty there and, more to the
  point, a reverse lookup had never shown a dead-handle warning either: on
  exactly the rows most likely to need one, because a handle somebody searched
  for is a handle somebody is about to act on. `stampReachability`'s own
  docstring says a path nothing fails without is a path somebody forgets, and
  concluded "both paths call it". There were three. Now asserted as a pairing,
  since the failure is one stamp present without the other, which reads as
  complete.
- No public API change. `/v1` builds its response from a field allowlist, so
  the new field cannot reach it.

### 2026-09-19 (the first secret this system has to be able to read back)

- **`lib/secret-box.ts`, AES-256-GCM, for storing an outbound OAuth token.**
  Every credential this repo holds is a SHA-256 digest of something handed out
  once: API keys, sessions, magic links, the x402 redemption token, and our own
  OAuth access and refresh tokens. That works because the caller presents the
  secret and we only have to recognize it, and it is why a leak of those tables
  leaks nothing usable. Before this change, `createCipheriv`, `AES` and `scrypt`
  had zero hits repo-wide.
- **An outbound token breaks that shape.** Acting on somebody's behalf means
  sending their actual token to the provider, so hashing is not available and
  what we hold is a recoverable secret belonging to someone else. That is a real
  reduction in this database's safety and the module states it: the key is in
  the environment and the ciphertext in Postgres, so a database dump alone
  yields nothing, and nothing about it helps against something that can read the
  environment.
- Authenticated rather than merely encrypted, because an attacker with write
  access to the column must not be able to swap a stored token for one they
  control. The `v1.` prefix is load-bearing: `open()` refuses a version it does
  not know instead of feeding it to the current decipher, where a future format
  would present as tampering rather than as a rollback.
- **`seal()` returns null rather than throwing** when unconfigured, so a caller
  cannot read a thrown error as "encryption is off" and write the plaintext
  token into the column. That is the worst outcome available here, because
  nothing downstream looks wrong afterwards.
- `SECRET_BOX_KEY` is its own variable, not a reuse of `X402_RECOVERY_SECRET` or
  `EMAIL_UNSUBSCRIBE_SECRET`, on the reasoning `.env.example` already gives for
  those two: rotating a secret should invalidate exactly one thing.
  `npm run gen:secret-box-key` prints one.
- Fifteen invariants, each verified against a deliberately reintroduced defect,
  including the whole construction swapped to unauthenticated CTR. The
  round-trip control is asserted first, because every other assertion says
  something does **not** open and all of them pass against a module that returns
  null for everything.
- No consumer yet. This is the foundation for holding an X OAuth token.

### 2026-09-19 (decision 16 is deferred, and the reason is written down)

- **The watch surface (`docs/AGENT-SYSTEM.md` decision 16) is deferred for want
  of anyone to sell it to, not for want of a blocker.** Its blocker cleared on
  2026-09-02 with #237, and the doc has said "startable" since. Measured
  before deferring: 24 credit-ledger rows all time, 371 matches, 10 accounts,
  73 matches outside the free window, and every credit lot a relaunch grant
  rather than a purchase. A per-customer watch surface is worth building when
  there is a customer to watch for.
- **Its "scope strictly to wallets previously billed for" clause is
  unenforceable as written**, and that is the finding worth keeping. Nothing
  records which wallets a job billed: `credit_ledger` holds a count,
  `lookup_jobs.wallets` is element-nulled by the retention cleanup, and 608 of
  866 job rows have already been stripped. The scoping rule was written
  against data the system does not keep.
- The three hazards found while designing it are recorded with the entry: a
  removal leaks through absence on a watchlist, two paths double-bill, and
  `last_updated_at` is not monotonic so a diff can repeat. So is the
  `billed_wallets` table that would unblock the clause, which has to start
  recording at the first billed job after it exists and cannot be
  backfilled from stripped rows.
- Documentation only. No schema, no endpoint, no behavior change.

### 2026-09-18 (the scope refusal stops contradicting the metadata)

- **A client asking for `offline_access` alone was told "the only scope this
  server grants is wallet:read", which is untrue.** `SUPPORTED_SCOPES` holds
  both, the authorization server metadata advertises both, and
  `issueInitialTokens` returns a refresh token precisely when `offline_access`
  was granted. A client that read the metadata and then read the error learned
  only that one of the two was lying.
- **The refusal itself is correct and stays.** The rule beside it is that a
  client cannot receive a scope it did not ask for, so a request naming only
  `offline_access` cannot quietly be upgraded to include the read scope. What
  it is asking for is a refresh token and no access, which is not a thing to
  grant. Only the sentence was wrong.
- It now names the scope that is required and how to ask for the other, which
  is what an implementer needs: ask for `wallet:read`, or
  `wallet:read offline_access` for a refresh token, or omit the parameter.
- Asserted against the constants rather than the strings, so adding a third
  scope cannot leave a message claiming there is one. Found while diagnosing
  why no OAuth grant had ever been issued; it was not the cause, and no
  ordinary client sends `offline_access` on its own.

### 2026-09-18 (the skill file tells a chat host the truth about OAuth)

- **`/skill.md` led with OAuth, and the first thing publicly promoting it was a
  demo running in Grok**, which cannot do OAuth at all. The docs were corrected
  earlier the same day; the skill file, which is the more prominent surface and
  the one in the announcement, was not. Anyone following that link into a chat
  host met the loop the correction exists to prevent, with the file telling
  them a consent screen was coming.
- The API key entry now says to use it inside a chat host, names the symptom
  precisely (every tool listed, because discovery needs no credential, then
  every call reporting a sign-in is still needed however often the user
  authorizes) and says what it means: a host that cannot start a sign-in, not
  a sign-in that failed.
- Written as an instruction to the agent rather than a note to a reader, since
  the audience for this file is the agent: **ask the user for a key instead of
  retrying the connection.** An agent that reads it can now resolve this
  without the user diagnosing anything.

### 2026-09-19 (a second ERC-20 holder index, and seeding un-retires)

- **OpenSea's OS2.0 token API is a second metered ERC-20 holder index**, slotted
  into `getContractHolders` between Moralis and the public explorer. Verified
  live before wiring: Toshi on Base returned 1,088,243 holders with a correct
  total (Base was the chain the explorer fallback served worst), Chainlink on
  Ethereum 912,096, PURR on HyperEVM 11,362. The key was already in the repo
  for the weekly profile-enrichment cron.
- **Yesterday's retirement narrows instead of reversing.** The discovery gate
  becomes `usesMeteredHolderIndex(chain) && !hasSecondHolderIndex(chain)`: the
  five metered chains OpenSea serves seed again, **BSC stays retired** (OpenSea
  does not serve it, verified against the live `/chains` listing), and a deploy
  missing the key refuses exactly as yesterday's gate did. The
  `allowPublicFallback: false` policy stands untouched, because the second
  index is our own key on our own plan, not free public infrastructure.
- **HyperEVM gains token import and token seeding**, the first ERC-20 source
  that chain has ever had. `ERC20_SUPPORTED_CHAINS` includes it, the modal
  warning disappears by derivation, and the GeckoTerminal `hyperevm` network id
  was confirmed against real pools (its `hyperliquid` sibling carries
  HyperCore's 16-byte internal ids, which are not EVM contracts).
- Two traps recorded in the fetcher for whoever touches it next: the provider's
  `quantity` arrives in **display units** (a `balancesAreDisplayUnits` marker
  keeps `toBagSizes` from dividing again, and the Bag now survives a failed
  `decimals()` read on this path), and the pagination parameter is `cursor`
  while the response field is named `next`; passing it back as `next` is
  silently ignored and returns the first page forever.
- `scripts/check-holder-fallback.ts` now unsets `OPENSEA_API_KEY` beside
  `MORALIS_API_KEY`, or every probe would be answered by the second index and
  the explorer canary would report green for coverage it never tested.
- Docs: `docs-site/app/lookups.mdx` drops the HyperEVM token exclusion and
  describes the three-source ladder; `docs/GROWTH.md` records the supersession
  of the 2026-09-18 option-3 decision; the chain table in PROJECT_OVERVIEW.md
  was rebuilt from the code (it still said Robinhood had no ERC-20 source).

### 2026-09-18 (ERC-20 seeding is retired, and stops failing daily)

- **The seed cron stops attempting a call that cannot succeed.** Moralis has
  answered `401 "Your Moralis Free usage is paused"` since 2026-08-31, and we
  are not paying to restore it, so every ERC-20 seed on a metered chain for
  three weeks has spent a slot per chain per day to receive a 401 and write a
  `holders_imported = 0` row that nothing counted. That is the same silent-zero
  shape the Farcaster sweep was carrying until this week: a job failing every
  day with nobody told.
- **Option 3 of the three recorded in `docs/GROWTH.md`**: drop ERC-20 seeding,
  concentrate on NFTs and Robinhood. The 11 of 42 tokens that the public
  explorer would have recovered are declined knowingly, because a partial fix
  is not worth reversing the `allowPublicFallback: false` policy that keeps
  speculative background work off free infrastructure.
- Refused at **discovery** rather than inside `seedContract`, which is the part
  that matters. A candidate never selected spends no slot, writes no attempt
  marker, and cannot leave a zero-holder row that locks a healthy token out of
  the pool for `FAILURE_RETRY_DAYS`. The old behavior punished the token for
  the provider's outage.
- The gate reads `usesMeteredHolderIndex(chain)`, deliberately not the
  `ERC20_SUPPORTED_CHAINS` list immediately above it. The two answer different
  questions: the list says an ERC-20 index exists for a chain, the predicate
  says whether that index is the dead one. Six of the seven listed chains are
  metered and now skip; **Robinhood keeps seeding**, because its explorer is
  its own index rather than a fallback. NFT seeding runs on a different
  provider and is untouched.
- Two assertions, verified by removing the gate and watching them fail. One
  holds the refusal and its position before any slot is spent; the other goes
  through the predicate to confirm Robinhood survives, so a chain added to
  `MORALIS_CHAIN_IDS` by mistake cannot retire it silently.

### 2026-09-18 (the skill file is findable, and Grok needs a key)

- **`/skill.md` had exactly one reference anywhere: `llms.txt`.** The homepage,
  `/mcp`, `/api-docs`, the README, all of `docs-site/` and the published docs
  had none, so the only way to learn the URL existed was to be told it. A URL
  nobody can discover is worth nothing, and shipping it with a single pointer
  on a file only crawlers read was not the same as shipping it.
- It is now on `/mcp` (the page whose own title is "connect an AI agent to
  walletlink.social"), in the API keys modal at the moment somebody is wiring
  an agent up, in the README, and on the docs site. The URL lives in
  `lib/mcp-install.ts` beside `MCP_URL`, so every surface reads one constant
  rather than typing it.
- **Grok and X cannot do OAuth, and the docs said they could.** A connector
  inside those chat hosts has no way to open a consent screen and reports
  `no_auth_link`, so an OAuth connection can never complete there however many
  times it is retried. The "From Grok" section said to connect "with OAuth or
  an API key exactly as any other client does", which sent people into a loop
  that cannot terminate. It now says to use a key.
- The symptom is worth recognizing, so it is written down beside the auth
  comparison: a connector that lists all eight tools happily, because discovery
  needs no credential, and then reports it still needs to sign in however many
  times you authorize. That is not a failed sign-in, it is a host that cannot
  start one.

### 2026-09-18 (a skill file at a URL you can paste)

- **`https://walletlink.social/skill.md` serves the agent skill**, because the
  shape people actually use is a URL handed to an agent: "install the
  walletlink skill: <url>". `llms.txt` tells a crawler what the site is; this
  tells an agent how to operate it, and the YAML frontmatter is what lets a
  skill runtime load it by name. Listed in `llms.txt` so an agent that starts
  there can find it.
- **Generated, not stored.** Every figure comes from `lib/public-figures.ts` or
  `lib/packs.ts`, and the four sentences defining a match, an attested
  identity, absence and reachability come from `lib/canonical-sentences.ts`,
  the same source the UI, the docs and the welcome emails read. A static file
  would have been a fifth copy of all of it, and
  `check-published-figures.ts` cannot see a literal it was never told about.
  This is not hypothetical: the plugin's static copy of the same content
  drifted, spelling "labelled" for months after the house style settled on
  American English.
- The tool table is the one hand-kept part, since a cost sentence is editorial
  and nothing on a tool definition states a price. An assertion holds it to
  exactly the set the MCP server registers, the same way the `/mcp` page is
  held, so a ninth tool fails in CI rather than being found missing by whoever
  pasted the URL into their agent. Verified by removing a tool and watching it
  fail.
- Named in `docs/AGENT-SYSTEM.md` as an L4 projection before it was built,
  which is the rule for anything on the agent surface.

### 2026-09-18 (the house-style guard can see template literals)

- **Every backtick string in the repo was unchecked.** `copySpans` matched `'`
  and `"` only, so the guard walked `lib/` and `app/` and read none of their
  template literals. That is where the interpolated copy lives: every
  `throw new Error` with a count in it, every console line naming a value, a
  `document.title`, a placeholder built from a variable. The gap shipped an em
  dash into an operator-facing error in #276 and had been carrying an older one
  beside it, in a file the guard already walked.
- **Nine real violations were sitting in the blind spot**, all fixed here: a
  browser tab title reading `Lookup complete - walletlink.social` (the spaced
  hyphen the house style names explicitly), three periods in the Farcaster DM
  placeholder, straight apostrophes through the check-in campaign's email copy
  and two budget refusal messages, and two em dashes in sweep errors. The repo
  is cleaned and the gate widened in the same change, on the precedent the
  Prettier rollout set: drift cannot accumulate behind a rule that now exists.
- Two decisions keep this from becoming noise, which is the failure mode that
  gets a guard switched off. **A tagged template is skipped outright**: `sql`
  and friends are DSLs, and the tag is a far better signal than keyword-matching
  contents that are full of English in `--` comments. And **the `].`/`).`/`=>`
  exclusion is deliberately not applied to backticks**, because it exists to
  undo an artifact of naive `'` matching (the closing quote of one string
  pairing with the opening quote of the next) and backticks have no such failure
  mode. Its documented cost, skipping a sentence that ends in a parenthetical
  full stop, would otherwise have been paid for nothing: error messages end in
  parentheticals constantly, and `(table kept for the corrective pass)` is
  exactly the shape that was getting through.
- **Untagged SQL is recognised by statement shape, not by a loose keyword.**
  The first version of this widened the shared keyword list with `UPDATE`,
  `DELETE`, `DROP` and `ALTER`, which quietly stopped the guard checking any
  copy containing those very ordinary words: "Drop your CSV here", "Failed to
  delete", "Update your settings". Nothing in the tree says that today, but a
  product with a CSV drop zone is one string away from it, and a guard that
  silently checks less is the exact failure this file exists to prevent. Caught
  by Bugbot. The shared list is back to its original five keywords byte for
  byte, so quoted strings behave precisely as they did before, and untagged SQL
  is recognised for templates only.
- **A leading verb is not statement shape either, and the first correction used
  one.** UI copy is imperative constantly, so "Drop your CSV here" and "Delete
  this lookup" open with a SQL verb and are prose, which put the same silent
  miss back one layer down. What identifies a statement is the verb together
  with the keyword it requires: `DELETE` needs `FROM`, `UPDATE` needs `SET`,
  `ALTER` needs an object type. No English sentence carries the pair by
  accident.
- **The fixture for that first correction proved nothing**, which is worth
  recording separately because it is the failure this repo keeps finding in its
  own guards. It put the drop-zone sentence in a JSX node, so the JSX branch
  read it and the SQL test was never consulted at all. Both fixtures are
  templates now, and they were verified by restoring the loose test and
  watching the guard report that it does not do what it claims.
- The guard's own fixtures cover every case now, since it is tested harder than
  its regexes are: an interpolated message ending in a parenthetical is read,
  tagged SQL is not, a path built from a variable is not, and copy that merely
  contains a SQL verb still is. Verified end to end as well, by putting a fresh
  em dash in a template and watching it fail.

### 2026-09-18 (reachability transitions, before the wave that would erase them)

- **`x_accounts` now records when a handle's reachability changed, and what it
  changed from.** Until today nothing did. `persist()` overwrote `status` in
  place and stamped `checked_at` on every check whether anything moved or not,
  and `social_graph_history` does not cover this table (its `change_source`
  values are web3bio, graph, ens, neynar, cache and manual, and reachability is
  none of them). So "when did this handle stop being reachable" had no answer
  anywhere in the product.
- **It landed against a deadline.** Rechecks begin **2026-10-01**, and 409 of
  474,140 rows had been checked in the last seven days: the first wave would
  have rewritten `status` for every handle that moved since the first pass,
  unrecoverably. This is the same shape as the `last_live_user_id` fix already
  recorded in that upsert's comments, on the same deadline, in a different
  column. The current split is 332,908 live, 94,117 unavailable, 47,115
  not_found.
- `status_changed_at` and `previous_status` advance only on a real transition,
  through `IS DISTINCT FROM` rather than an inequality: the two agree only while
  `status` is NOT NULL, and a nullable state added later would make inequality
  yield NULL, drop to the CASE's ELSE, and discard the transition silently. That
  is the exact bug these columns exist to prevent, so it should not be
  reintroduced by a comparison operator. `checked_at` stays unconditional,
  because it answers a different question and the recheck scheduler reads it;
  making it conditional would freeze an unchanging handle into permanent
  staleness and it would be rechecked forever.
- **Deliberately not backfilled.** Stamping `status_changed_at = checked_at` on
  existing rows would have been convenient and false: `checked_at` is when a
  handle was looked at, and every current row was written by a pass that
  observed no transition at all, so it would have invented 474,140 transitions
  on the one table whose job is to say when something moved. NULL reads
  correctly as "no transition seen yet", and the migration asserts that it
  stamped nothing.
- **This also corrects `docs/AGENT-SYSTEM.md`.** Decision 16's entry said the
  change feed "has to read those transitions explicitly", which reads like a
  query to write; there were none to read. A feed built on `checked_at` would
  have reported a change for every rechecked account, a billing surface
  charging for nothing happening, which is the inverse of the decided policy
  two paragraphs above it in the same document.
- Four assertions, each verified by reintroducing its defect. One of them had to
  be fixed first: `lib/x-accounts.ts` holds **two** `ON CONFLICT (handle)`
  statements, and the first version anchored on the wrong one. It failed loudly
  this time; the same mistake on a passing anchor is an assertion that guards
  nothing. The assertions are scoped to `persist` now, with a fourth asserting
  that scoping. The Postgres semantics they rest on (every `SET` expression
  reads the pre-UPDATE row) were verified on a throwaway table rather than
  assumed, because if that were false the columns would record the new status
  and never advance, silently.
- `PROJECT_OVERVIEW.md` gains the `x_accounts` row it never had, and its
  Farcaster sweep description is corrected: it has swept one sixth of the
  network per month since #223, not the whole network.

### 2026-09-18 (the sweep says what happened)

- **A 200 with no `users` array is a failure now, not zero users.** The sweep
  read `json.users ?? []`, which turned an unrecognized response into a
  successful empty batch: no `failedCalls`, no retry, nothing anywhere to
  notice. That is the worst possible shape for this particular call, because
  the seen set it feeds is what revocation cleanup clears _against_: wallets
  missing from it are read as "checked, and the account is gone", so a
  response-shape change over a stretch of batches would clear live identities
  in proportion to how much of the sweep it swallowed. The outcome ceiling
  added on 2026-09-17 is the backstop for that; this is the cause.
- Measured against the live endpoint rather than assumed: existing FIDs answer
  200 with `users`, a **mixed** batch answers 200 with `users` holding only the
  ones that exist, and a batch where none exist answers 404. So a 200 always
  carries the key in normal operation and that fallback was unreachable except
  when the contract moved, which is the only case it mattered in. The 404
  branch stays exactly as it was, separately and deliberately:
  `getNetworkMaxFid` binary-searches the network frontier on "does this FID
  exist" and reads that from the 404, so turning it into a failure would break
  the probe.
- **The sweep publishes its own posture.** Nothing reported the 2026-09-02
  failure for fifteen days, and neither reason was the failure itself: the
  workflow has no notification step, and `farcaster_sweep_resume` was the only
  row the operator readout had for this pipeline, which a slice never writes.
  The one signal an operator is told to read was incapable of showing this
  failure, and said "cleared (no resume pending)" throughout.
- So `posture:farcaster_sweep` is written on every ending, not just the happy
  one: `cleaned` with what it cleared, `cleanup-failed` with the reason and the
  seen table a corrective pass will need, `cleanup-skipped` when a partial seen
  set made cleanup unsafe, and `checkpointed` when the budget ran out. The
  `posture:` prefix has been reserved in `scripts/ops-status.ts` since it was
  written, for a pipeline that states its outcome rather than leaving one
  inferred from a cursor's age. This is its first user, and the readout now
  renders a failure as `CLEANUP FAILED` naming the table to keep.
- The writer is best-effort by design. It is called on the failure path, where
  the database may be exactly what is broken, so it swallows its own errors and
  re-throws the original: an incident must not lose its cause to the thing
  reporting it. Asserted, along with the re-throw that keeps a failed sweep
  exiting non-zero.
- A resumed sweep that reaches the end of its range records `range-complete`
  too. Bugbot caught that the first version cleared `farcaster_sweep_resume`
  and wrote no posture, so the earlier segment's `checkpointed` row outlived
  what it described and the readout kept saying the last run budget-stopped
  after the range had finished. Stale but plausible is the exact failure this
  row exists to remove, so it would have been an unusually poor place to leave
  one. `--incremental` and `--range` still record nothing, deliberately: they
  cannot clean up, and writing here would overwrite a monthly slice's outcome
  with an unrelated activity's.
- Five assertions, each verified by reintroducing its defect. One of them had
  to be rewritten to earn that: it first compared totals, `records >= clears +
1`, and passed over the very defect it was written for, because removing one
  record still left four against two clears. A count cannot say which branch
  reports. It is scoped to the resumed-range branch now.
- Verified end to end as well, not only against the source: the row was written
  through `recordSweepPosture`, rendered through `ops-status.ts`, and removed
  again.

### 2026-09-17 (slice 3 settled)

- **The revocations the 2026-09-02 sweep found and never cleared are cleared.**
  383 wallets in slice 3's FID span had been serving a Farcaster account their
  owner had removed, for fifteen days. 372 of those rows held nothing else once
  the sweep's data came off them and were deleted as husks, which is the
  documented behavior for a row with no handle, no sources and no full-pipeline
  check: it carries no information about anybody. The 127 MB seen table was
  dropped, which is what cleanup does on success.
- **It ran through the fixed code path, not around it.** `cleanupRevokedWallets`
  was called with the recorded `sweepStartedAt`, seen table, `walletsUpserted`
  and FID span from run 33621049583, so every guard applied: the 100,000-row
  floor, the 90% seen-against-upserted ratio (804,916 against 805,709, or
  99.9%), and the 1% outcome ceiling (383 against 8,050). Hand-rolled SQL would
  have bypassed all three, and a corrective script that recomputes what it is
  correcting verifies only itself.
- **Running it fifteen days late was safe by construction.** Cleanup only
  touches rows with `last_updated_at < sweepStartedAt`, and every writer sets
  `last_updated_at = now()`, so any row another pipeline had refreshed in the
  meantime excluded itself. The set can only shrink with age, never grow. The
  cutoff used was the workflow's start rather than the script's, which is
  fractionally early on purpose: too early only skips rows, while too late can
  clear one that has since been refreshed.
- `countRevocationCandidates` is now the single place the revocation predicate
  is written, and the outcome ceiling reads it rather than keeping its own copy,
  so a count cannot report one number while the write does another. The
  assertion that forbids `NOT IN` now covers the whole module rather than one
  function, since the predicate lives in two places and a check scoped to one
  would have passed while the other spelling came back.

### 2026-09-17 (one keyword, four orders of magnitude)

- **The monthly sweep's revocation cleanup was never going to finish, and
  the driver timeout that killed it was the symptom rather than the cause.**
  The statement tested the seen table with `wallet NOT IN (SELECT wallet FROM
<seen table>)`. Postgres does not read that as an anti-join: it builds a
  correlated SubPlan with a Materialize of all ~805k seen wallets and rescans
  it for every candidate row, over a sequential scan of `social_graph`,
  because no index covers `sources`, `fc_fid` or `last_updated_at`. Planned
  against the real slice-3 data, estimated cost **74,563,713,792**, roughly
  5.1M x 805k comparisons. The 2026-09-02 run died at 32 minutes on the
  neon-http headers timeout; a longer timeout would have changed nothing.
- The same predicate written as `NOT EXISTS` with a correlated equality plans
  as a Parallel Hash Right Anti Join against the seen table's primary key:
  estimated cost **337,774**, measured execution **2.8 seconds** over the
  identical data. That is the whole fix. No driver change, no chunking, no new
  index, and none of the blast radius any of those carried: flipping
  `USE_CONNECTION_POOLING` would also have handed the sweep transaction
  support it branches on through `isTransactionCapable()`, and chunking would
  have multiplied a full table scan by the number of chunks.
- Both spellings are valid SQL and both are semantically identical here, since
  `wallet` is the primary key of both tables so no NULL can arise. Only one of
  them completes. That is why the assertion states the refusal: cleanup never
  tests the seen table with `NOT IN`. A happy-path test passes on either.
- **A second, quieter bug in the same statement.** `last_updated_at` is
  `timestamp` with no time zone holding UTC, and the cutoff was a bound JS
  `Date`, which sends its local wall-clock reading instead. Planned from a
  UTC-5 machine, `2026-09-02T10:44:50Z` arrived as `2026-09-02 05:44:50`. The
  scheduled runner is UTC, so this has never shown up in production, which is
  what makes it worth naming: west of UTC it under-clears, and east of UTC it
  moves the cutoff later and clears rows another pipeline legitimately
  refreshed after the sweep began. Now bound through an explicit UTC
  wall-clock helper, and asserted. The first version of that fix wrote a local
  helper and dropped the `::timestamp` cast; Bugbot caught both. `utcBound` in
  `lib/analytics.ts` had already found, measured and solved this on 2026-08-26,
  and its docblock says the cast is load-bearing rather than decoration,
  because without it the parameter arrives untyped and the coercion depends on
  context. The cutoff now goes through that helper, with the cast, at both the
  ceiling count and the UPDATE it guards: a ceiling computed over a different
  window than the write it authorizes would be worse than no ceiling.
- **An outcome ceiling ships in the same change as the speed-up, deliberately.**
  Making the statement finish is what turns its latent failure modes live, and
  it had never once finished: the only `--slice` run died in it, and every run
  that succeeded was `--incremental`, which tracks no seen set and never cleans
  up. Every existing guard compares the sweep with itself, so none of them
  catch a deficient seen set: `expectedSeenCount` is the same run's
  `walletsUpserted`, so the 90% ratio is seen against upserted and both shrink
  together, `coveredRange` counts FIDs requested rather than found, and
  `fetchUserBatch` turns a 404 or a response with no `users` key into an empty
  array, which raises `failedCalls` by nothing. Nothing upstream can tell
  "checked, and gone" from "never really looked".
- So cleanup now counts what it would clear, and refuses above 1% of the seen
  set without writing anything, keeping the seen table. Argued from the
  measurement rather than picked: revocations ran 383 of 803,529 candidates on
  slice 3, or 0.048%, while a deficient seen set clears roughly the fraction of
  the sweep that went missing. On the real numbers the ceiling is 8,050 against
  383 actual, twenty times headroom, and it refuses the 24,147 that 3% of
  batches returning empty would produce. Counting first is sound without a
  transaction, which matters because the HTTP driver has none: the predicate is
  monotone, since every writer sets `last_updated_at = now()` and the filter
  wants `last_updated_at < sweepStartedAt`, so a concurrent write can only
  remove a row from the set. The count is a guaranteed upper bound and a race
  makes it safer, not wrong.
- **Still owed, and recorded in the posture table:** cleanup is bounded to its
  own slice, so the 2026-10-02 run cleans slice 4, not slice 3, whose next
  turn is about 2027-03. 383 rows in slice 3's range still carry a Farcaster
  account the sweep found revoked (0 husk rows). Clearing them needs a
  deliberate pass over the surviving seen table, so
  `farcaster_sweep_seen_1788345941996` must be kept until it runs.

### 2026-09-17 (the posture readout tells the truth, and one pipeline was not fine)

- **The monthly Farcaster sweep has been half-failing since 2026-09-02 and
  the operations doc said it was "running".** The slice-3 run ingested
  cleanly, 558k FIDs requested and 806k wallets upserted with zero failed
  calls, then exited 1: the revocation `UPDATE` at
  `lib/farcaster-sweep.ts:622` hit the Neon HTTP driver's headers timeout
  about 32 minutes in. For fifteen days the index has been taking new
  verifications in that FID range while possibly never clearing revocations
  in it. Whether that statement committed is unknown rather than no, because
  the HTTP driver autocommits one statement per request and a client-side
  timeout is not a rollback. The cause is structural, so 2026-10-02 fails
  the same way. The seen table outlived the run by the same throw and is
  still there: `farcaster_sweep_seen_1788345941996`, 127 MB, fifteen days on.
  It must be kept rather than tidied away. Cleanup clears rows by wallet not
  in that table, so it is the only surviving record of what slice 3 saw and
  the input any corrective pass needs.
  Recorded in the posture table with the run id; the fix (pooled connection,
  or bounded chunks) is not in this change. Worth knowing for whoever takes
  it: `USE_CONNECTION_POOLING` is set in no workflow and no `vercel.json`
  entry, so the sweep runs on the HTTP driver by default, and flipping it
  would also hand the sweep transaction support it currently branches on
  through `isTransactionCapable()`. That is a wider change than it looks.
- **Nothing was going to report it.** The workflow has no notification step,
  and a slice writes no checkpoint by design, so `farcaster_sweep_resume` is
  inert under `--slice`: neither its age nor its cleared state says anything
  about whether the monthly run worked. The one live signal an operator is
  told to trust was blind to this failure by construction.
- **`scripts/ops-status.ts` was lying three ways, and the output still looked
  like a clean report.** It is the script `docs/OPERATIONS.md` sends a fresh
  session to for live posture, which makes each of these operational rather
  than cosmetic. It under-reported every age by the operator's UTC offset,
  because `ingest_state.updated_at` is a zone-less `timestamp` and
  `new Date()` parses one as local time: exactly five hours out on a UTC-5
  machine, printing a row written an hour earlier as `-4h ago`. The error
  ran in the dangerous direction, making a cron that died yesterday read as
  inside tolerance, and it never shows up for an operator sitting at UTC.
  Ages are now computed by `now() - updated_at` in SQL and nothing in the
  file parses a timestamp.
- It also could not see three of the eleven rows it is meant to cover
  (`basename_record_harvest`, `zora_profile_explore`, `daily_cast_state`),
  because it selected `posture:%` plus three literal names and that list had
  gone out of date with no failing run. A hand-maintained allowlist inside a
  staleness tool is itself a thing that goes stale. It now reads every row,
  so a new pipeline appears the day it first writes.
- And the one sentence written specifically for the one pipeline with no
  heartbeat rendered a literal question mark: it read `as_of` out of the
  row's value, and `CoverageStats` has no such key. The as-of moment is the
  row's `updated_at`, which the age column already carries.
- **Five assertions in `scripts/check-invariants.ts` cover the above**, each
  verified by reintroducing its defect and watching it fail, per the rule
  that a guard checked only against passing code proves nothing. They assert
  refusals: no timestamp parsing, no name allowlist, no `as_of` read, no
  unbounded value print, and no write statement in a reader an operator runs
  against the pooler while diagnosing.
- **The posture table lost its table-wide "as of" date.** It read
  2026-09-02 while the table already carried a row dated 2026-09-09, and no
  guard could notice, because the docs-freshness gate watches `docs-site/`
  and never looks at `docs/`. No single change re-verifies every row, so one
  date at the top is a claim nothing keeps true. Each row now carries its
  own.
- **Two rows were stale in the direction that wastes someone's afternoon.**
  Basenames read "backfill first" when the backfill had run and the daily
  incremental was advancing the checkpoint, so the instruction was to redo a
  completed one-time job; a red cron there now means a real failure rather
  than the design working. Right-to-removal read "stage 1 in review" when
  #237 merged on 2026-09-02, and that cell was the only thing still reading
  as a blocker on the change feed. `docs/AGENT-SYSTEM.md` said the same in
  two places and now records the ship, with the reachability-watermark trap
  that item 16 has to handle.

### 2026-09-17 (the empty screens say what happened)

- **A lookup that matched nothing rendered the ordinary results screen**: a
  hero reading "0 found of 500 wallets · 0.0%" over a table of dashes, and
  nothing else. Every word accurate, and the only conclusion available to
  the reader was that the product does not work. It is the worst moment in
  the funnel to say nothing, because it is the one where somebody decides
  whether to come back.
- It leads with the chain, because that is the answer and it is measured
  rather than reassuring: on the 2026-08-17 sample, 46.2% of 35,294 Base
  holders had an X or Farcaster account against 16.6% of 17,462 Ethereum
  holders. A list from a low-attestation community can legitimately come
  back empty, and being told the list was the wrong shape is more useful
  than being told to try again.
- Every figure in it is derived from `lib/public-figures.ts`, never typed.
  A rate typed into a component survives the next re-measure, and the
  check that compares published figures against the database cannot see a
  literal it was never told about. Asserted.
- It offers the two actions that can actually return something different,
  both free, and deliberately does not suggest a retry: the same list run
  again returns the same answer, and proving that would spend somebody's
  free allowance.
- The collections action is a callback, not `/#starter-collections`. That
  anchor lives inside the homepage's `upload` block and this panel renders
  under `complete`, so the target did not exist when somebody clicked: the
  hash changed, the page scrolled nowhere, and nothing errored, because a
  dead in-page anchor has no 404 behind it.
- **The table's empty state told two situations apart.** "No results
  found" was what it said whether the lookup returned nothing or the
  reader had left "attested only" on three scrolls earlier. Those want
  opposite responses and only one is fixable from that screen. It now
  names the filters that are narrowing the view, says how many wallets are
  actually in the lookup, and clears them in one control.

### 2026-09-17 (a withheld match is a match)

`locked` means the row matched and the free allowance had nothing left
to bill it against, so the identities were stripped on the way out. It
means found and withheld. Every count in the product read it as not
found, because every count was its own filter on `twitter_handle ||
farcaster`, and those are exactly the fields the gate removes.

- A gated lookup showed **two different answers on one screen**: the gate
  banner said "found 220 matches", the figures four hundred pixels below
  said 100, both rendered from the same array.
- **The share text used the stripped figure.** Somebody who ran a list
  and hit the gate posted a match rate lower than the product actually
  achieved, to the one surface that brings other people here. The gate
  was quietly cutting the product's own social proof.
- **The CSV had no column for it**, so a locked row left the building
  byte-for-byte identical to a wallet that never published anything. The
  file was telling the customer something untrue about their own list,
  and the lost sale is the smaller half of that.
- `lib/result-counts.ts` is the single authority now, the same treatment
  `lib/packs.ts` gives prices. Four surfaces derived these counts by hand
  and three were wrong the same way.
- `found` counts each row once, with one predicate. The first version of
  it was `reachable + locked`, under a comment asserting the two sets are
  disjoint "by construction". They are not, and `lib/match-gate.ts` says
  so in plain English at the top: it strips the **billable** identities,
  so a locked row keeps its Lens profile or GitHub account and sits in
  both sets. The sum published it twice, in the header and in the share
  text. The overclaim this work removes, briefly reintroduced while
  removing it, because the comment stated the premise instead of checking
  the file next door.
- Its assertion was `const found = reachable + locked`, so the assertion
  was defending the defect: the third time that shape has appeared here.
  Replaced with three that run through the function, whose counterexample
  is a withheld row still showing a Lens profile.
- The unload guard reads what was actually sent, not what could be sent
  now. `/?collection=…` submits on mount while auth is still loading, so
  a signed-in visitor on such a link stored nothing and then had the
  warning silenced the moment auth resolved: it removed itself in exactly
  the case it exists for. Signing in after a signed-out run did the same
  to the run on screen.
- The results header leads with `found` and states the locked count
  beside it in `caution`. That pairing is the condition the figure comes
  with: a number that counts withheld rows must say some are withheld, or
  it is the same dishonesty pointing the other way. Asserted.
- The X-list export names the locked rows in its tooltip, where it used
  to say "Export X list (40)" ten pixels under a banner saying 220.
- **The match gate stopped wearing error clothes.** It was
  `border-caution` + `bg-caution-tint` + a warning triangle with every
  word in amber: the anatomy used for a truncated import and a stale
  record. Nothing went wrong. It is the one screen where somebody decides
  to pay. Card treatment now, with only the locked figure in caution,
  which is what caution is for. A failed unlock became its own
  `InlineError`, since that genuinely is a fault.

**"Save this lookup" could not save anything signed out**, and the
second half of that cost people work.

- The box was checked by default. The job wrote a `lookup_history` row
  keyed to the anonymous browser uuid; `/api/history` answers 401 without
  a session and filters by the session's user id when it has one; no path
  adopts the row on sign-up. It was unreachable the moment it was written.
- The `beforeunload` guard stays quiet when a forward lookup is saved,
  which is right, so a checked box that saved nothing **also switched off
  the warning** that this was the last chance to export. Run a lookup,
  be told it is kept, get no warning, close the tab, lose everything.
- Signed out the box is gone rather than unchecked: an unchecked box
  invites a click that would still do nothing. A sentence saying results
  are not kept, and the account that would keep them. It is also the one
  moment in the flow where an account is obviously worth having.
- The job no longer sends `saveToHistory: true` without a session, so the
  unreadable row is not written at all.

### 2026-09-17 (the house style is a rule now, not a habit)

Third interface-craft pass: typography, and the enforcement the house
style never had.

- **`npm run check:style` is new**, with a CI job behind it. CLAUDE.md
  has declared the house style since the repo had a CLAUDE.md and
  nothing checked any of it, which is how the product came to spell its
  own signature phrase two ways: "labelled" in 23 published places
  against "labeled" in the two written most recently. Also 15 three-dot
  ellipses in loading copy, and a hyphen where a colon belonged in the
  message every job shows on submit.
- Scope is the whole design of that guard. It reads JSX text nodes,
  prose-shaped string literals and Markdown outside code fences. It does
  not read comments, identifiers or data values, because `'cancelled'`
  is a persisted job status, `aria-labelledby` is an attribute and
  `Optimism` is a chain, and a guard that cannot tell prose from code
  teaches people to skip its output.
- Its extractor is tested harder than its rules are, since the extractor
  decides what gets read at all. The first draft let the `>` of an arrow
  function open a text span, so `[...prev, ...next]` looked like copy
  with an ellipsis in it; the second hit an unbalanced quote pair on
  `[headers.join(','), ...rows].join('\n')`. Both are fixtures now.
- **The failed-job badge was 3.75:1 in dark mode.** Every contrast pair
  the guard measured put a coloured foreground on a neutral surface, and
  a badge does not: it paints `text-destructive` on
  `bg-destructive-tint`, so both sides carry the same hue and the ratio
  is only the lightness gap. That pair was not in the table. All four
  tint-backed badges are now, and the other three passed.
- Fixed by lightening `--destructive` in dark from 0.62 to 0.68, not by
  darkening the tint: the tint already sits at 1.21:1 against the card,
  and taking it to 1.07:1 would have left the badge invisible. 0.67 is
  where it crosses; 0.68 is the step taken, because a token parked on
  4.50 fails the next time a surface moves.
- **Underlines now miss descenders.** `text-underline-position: from-font`
  plus `text-decoration-skip-ink: auto`, declared once on the root
  because both inherit and most of the 39 underlines in the product are
  the Tailwind utility on a span or a button, not an `<a>`. The product
  underlines handles, which are full of g and y.
- `text-wrap: balance` on every heading, `text-pretty` on the card and
  dialog description primitives. Headings get balance and descriptions
  get pretty because browsers cap balance at a few lines, so it is the
  wrong tool for the thing it would silently skip.
- 18 three-dot ellipses replaced with the character, and every spaced
  hyphen standing in for a dash replaced with a colon, across API error
  messages, the blog page title and PROJECT_OVERVIEW.
- **Considered and rejected: `-webkit-font-smoothing: antialiased`.** The
  cheat sheet asks for it on the root. This product sets figures in
  Söhne extralight and has a CI guard measuring text contrast, and
  grayscale antialiasing makes thin type visually lighter without moving
  a single measured ratio. The weight ladder in
  `docs/DESIGN-LANGUAGE.md` was chosen against the current rendering, so
  changing it is a design decision, not a fix.

### 2026-09-17 (forms and controls that a keyboard and a screen reader can use)

Second pass from the interface-craft checklist, this one entirely
accessibility. Nothing here is a preference; every item is a control that
announces the wrong thing or cannot be reached at all.

- **A submit is no longer disabled because a field is empty**, in nine
  places. `disabled` takes a control out of the tab order in every
  browser, so dimming Look up did not warn a keyboard user that an
  address was missing: it deleted the page's only action from their pass
  over it. Each one now validates on submit, names what is missing, marks
  the field `aria-invalid` and puts the cursor in it. Disabling during
  the request is kept.
- The ninth was found by the new guard, not by hand: Prettier had wrapped
  `WalletEnrichment`'s condition across four lines, where a line-based
  grep could not see it. That file's Save also duplicated a rule its
  handler already enforces and reports properly, so the `disabled` was
  saying the same thing in the one form that cannot be read aloud.
- **`role="menu"` removed from the overflow menu**, with `role="menuitem"`
  from its rows. The role commits to the menu keyboard contract (focus
  moved in on open, roving arrows, Home/End, typeahead, focus restored on
  close) and none of it was implemented. A reader enters application mode
  inside a `menu` and stops handling arrows itself, so the role took away
  navigation the plain buttons already had, and only from the people who
  need it. It is now the disclosure it actually is: `aria-expanded` and
  `aria-controls`, `role="group"` on the panel, and focus handed back to
  the trigger on Escape or after choosing a row, which it never did.
- **The lookup now narrates.** The progress card renders under
  `processing` and the results under `complete`, so a live region inside
  the card was removed from the document in the same commit that would
  have changed its text: completion, the one event worth speaking, was
  the one it could never say. The region is now mounted for the whole
  page. It speaks in quarters, not percent, because polite announcements
  queue and a ten-thousand-wallet job would otherwise read a hundred
  sentences.
- Four admin job buttons (view, rerun, retry, cancel) were named by
  `title` alone, the weakest source in the accessible-name algorithm and
  one several readers skip. They now carry an `aria-label` that includes
  the job id, since the column repeats per row and four rows produced
  sixteen identically named controls.
- Three enrichment fields had a `<label>` that wrapped nothing and
  pointed at nothing, so each input announced as "edit text, blank".
  Wired with `useId`. The admin password field gained a name and
  `autocomplete="current-password"`.
- `ReachabilityChecker`'s error moved from `role="status"` to the house
  `InlineError`, which is `role="alert"`: it is now the answer to a
  submit somebody just pressed, and polite would queue it behind whatever
  the reader was saying.
- **`aria-invalid` now comes from a flag, never from the error slot.**
  An error variable carries three different things: an empty box, a
  malformed entry, and a request that failed. Only the first two are a
  bad value. `Boolean(error)` announced all three as one, and in
  `ApiKeysModal`, whose single `error` also serves revoke and copy, a
  later revoke failure marked the cleared create-name box as invalid.
  Narrowing it with `&& !x.trim()` was only half a fix: it stopped the
  request failures and silently dropped the malformed case, which is the
  one a person most needs pointing at. The rule everywhere now: the
  field is at fault when it is empty, or when the server answered 400.
- The admin password field was the same shape. A 401 means the password
  is wrong; the catch's "Failed to load" means the request fell over
  while the password may have been right. Both were announcing as a bad
  entry.
- **Three new guard rules**, all whole-file rather than line-based, since
  the shapes they catch are exactly the ones the formatter wraps. Their
  comment-blanking has its own fixtures, because this repo's prose quotes
  the patterns it bans at length. The `aria-invalid` rule found the admin
  password case on its first run.

### 2026-09-17 (skip link, no theme flash, and two dead faces)

The first pass of the interface craft checklist, at page level, where a
defect costs every visitor on every page. A new `interface-craft` skill
carries the whole list across projects.

- **A skip link is now the first tab stop on every page.** WCAG 2.4.1
  Bypass Blocks is Level A and was unmet on 19 of 20 pages: a keyboard
  user passed four repeated header stops before reaching anything the
  page was about. Visible on focus rather than permanently hidden,
  because sighted keyboard users are exactly who it serves.
- **The theme resolves before first paint.** `ThemeProvider` applies its
  class in an effect, which runs after the server HTML has painted, so
  every visitor resolving to dark saw a full-page flash of the light
  palette on each cold navigation. A two-statement blocking script now
  decides first, mirroring the provider's own order: stored choice, then
  the media query only for `system`, so the two can never disagree.
- **`color-scheme` is declared per theme block.** Without it a checkbox,
  a radio and a scrollbar all render in the light palette on a dark page,
  because native widgets do not read our tokens. Per block rather than
  `light dark`, because this project switches by class and a browser told
  both would follow the OS instead of the visitor's choice.
- **Two preconnects removed, two preloads added.** The preconnects opened
  DNS, TCP and TLS to Google Fonts origins this app never fetches from:
  every face is self-hosted. The preloads are the two the first paint
  waits on, the 200 h1 and the 300 lede, and no more, since a longer list
  competes for the same bandwidth.
- **Two `@font-face` blocks deleted.** `font-extrabold` had no uses, and
  every `font-bold` hit in the tree is a comment recording its own
  removal. Eight declared faces, six used.

Notable for what it did NOT change. The audit proposed "fixes" to the
34px control height, the hairline borders, the concentric radius formula
and the reduced-motion spelling; each is a documented decision with
arithmetic behind it in `docs/DESIGN-LANGUAGE.md`, and the verification
pass rejected all four.

### 2026-09-17 (an anonymous buyer can get back to what they paid for)

The match gate is the product's designed purchase moment, and until now
converting at it lost the thing you converted for.

- `currentJobId` is cleared the instant a job completes, which is right:
  it means "a job is in flight". But completion is exactly when a gated
  result appears, and the buy button then LEAVES the page. So an
  anonymous visitor who met the gate and either paid or cancelled came
  back to a homepage with no memory of the lookup at all. History could
  not recover it either: that route needs a session, and checkout takes
  no account.
- Cancelling is the larger share of it. Stripe's `cancel_url` is the bare
  domain, so every abandoned checkout lost the result too.
- A separate `gatedJobId` is remembered at completion, and only when
  something is actually locked, then restored at mount after the
  in-flight job finds nothing.
- The restore is guarded hard, because getting it wrong paints a
  months-old lookup over the upload form somebody came here to use: it
  requires a completed job that still HAS rows, still has locked matches,
  and was saved inside the 30-day payload retention window. Anything else
  forgets the key rather than half-restoring.
- Forgotten on every path that moves on: after a successful unlock, on
  reset, and when a lookup is opened from history, so a restored job can
  never fight one the user just chose.
- Only the anonymous rail needs it; a signed-in buyer already returns
  through `/#my-lookups`.
- Verified against a real completed job: 25 results, nothing gated, and
  the guard correctly forgets the key rather than restoring.

### 2026-09-17 (the ask, where the decision is made)

Two findings from the conversion craft audit, both at the moment a buyer
decides, and neither of them a broken thing. Both were missing arguments.

- **The fit badge tested the wrong quantity.** It picked the smallest
  pack whose SUBMISSION headroom accepted the file, so a pack could take
  a list and then run out of credits inside it. A 13,294-wallet list, the
  largest job ever run, was marked "Fits your list" on Campaign while
  that same card said "≈ 6,300 wallets" two lines below. Somebody
  trusting the badge paid $99, resolved 1,500 matches, and met the match
  gate with most of the file locked. Headroom is now the floor and
  expected matches join it as the test, using the same constant the card
  already prints in the other direction, so the badge and the wallet
  count cannot disagree. That list now recommends Scale.
- When nothing fits, the largest pack is still the honest answer, but it
  no longer claims to fit: the badge reads "Closest fit".
- **Six comparison pages quoted the whole price sheet with no way to
  buy.** `PackPricing` had no button, no link and no click handler and
  ended on prose, and the header is not sticky, so the only buy
  affordance had scrolled away by the time a reader reached the prices at
  line 425 of a 494-line page. The CTA now lives in the panel itself,
  once, and `/pricing` drops the block it used to render below, so there
  is one implementation rather than seven.
- Verified on a production server: all six comparison pages and /pricing
  render a buy path.

### 2026-09-17 (the packs show what a match costs)

The cards gave a price and a match count and left the buyer to divide.
Nobody divides, so a steep discount read as "bigger number, bigger
price".

- Trial is 11.6 cents a match. Campaign is 6.6, which is **43% cheaper**;
  Scale 57%; Index 69%. Every card above the smallest now says so, on
  `/pricing` and in the buy-credits modal.
- Derived from `PACKS`, never typed. That file is the only place a price
  lives, so a hardcoded percentage would be a second price sheet free to
  drift from the first, and the drift would be invisible: a wrong
  percentage renders as confidently as a right one. An invariant asserts
  both components compute it and carry no literal.
- The baseline pack shows nothing rather than "0% off", because the
  honest answer there is no saving.
- It also happens to support keeping Campaign as the recommended default:
  it is not merely the bigger pack, it is the first real discount.

### 2026-09-17 (a free lookup at the exact-match URL)

The audit's sharpest finding was that
`/blog/find-twitter-account-from-wallet` does not rank for its own
near-verbatim title, while page one of that query is an Apify listing
with 8 monthly users and a row of 2021 Twitter-tip-jar news. That is a
vacuum, not a fortress.

- `/find-twitter-account-from-wallet-address`: one input, one button, a
  clickable example, and the answer rendered in place. The shape is
  copied from five ranking free-tool pages, not invented: all five do
  exactly that, none pre-fills the field, and all put the long-tail
  phrase in the title tag while the H1 stays a short tool name.
- **The 301 was dropped.** The plan was to redirect the blog post into
  this page, and the reasoning refuted itself: the post does not rank, so
  there is no equity to consolidate, and the redirect would only delete a
  page. That post is also the site's only published statement of the
  identity rate and the reach rate, declared in five places in the
  figures checker. Both pages stay, cross-linked.
- `POST /api/wallet-socials`, keyless. POST rather than GET because an
  address in a query string lands in access logs, in the `Referer` of
  every outbound link on the result view, and in any CDN cache key.
- Two meters. An hourly bound of 20 on probing, misses included, because
  a miss still tells a prober the address is absent. And the same daily
  match budget the anonymous job rail spends, so a second door does not
  double the anonymous exposure.
- `FREE_LOOKUP_FLOOR_PER_DAY` is ADDED to that cap, not maxed against it.
  `Math.max(50, 5)` is 50, which is no floor at all: the page would have
  read zero the moment the list demo drained the day.
- It withholds what a pack is sold on. No follower count and no priority
  score, because `job-processor` strips both from every job without
  `paidData`, and a keyless route handing a stranger a field the free
  tier does not get is an inconsistency a customer would find first.
- A posted array was a 500 rather than a 400, because `.trim()` ran on
  whatever arrived. Found by testing the malformed cases, not by reading.
- The miss state is designed rather than an error. Most wallets published
  nothing, so the miss is the common case and the real conversion moment.
- Four reachability states, not three. `reassigned` is the harm case and
  it is the one summaries drop.

### 2026-09-17 (production had not deployed for eight days)

Every production build failed from 2026-09-09 to 2026-09-17 and nothing
said so. The homepage served an eight-day-old build while `main` moved
on: the collapsed FAQ, the hero extraction fix and the agent-label
correction were all merged and none of them were live.

- Two places read Neon during `next build`:
  `/api/starter-collections` (`dynamic = 'force-static'`) and the holder
  page's `generateStaticParams`. The corpus grew from 66 collections to
  158, the build generates them in parallel against one database, and
  they crossed Next's 60 second per-page export timeout. Three retries
  later `Export encountered an error` fails the whole deployment.
- **Both guarded themselves with `VERCEL_ENV === 'preview'`**, so previews
  skipped the work and went green while production did it and died. A
  check that passes on every pull request and fails only after merge is
  worse than no check: it turns a loud failure into a silent one. And
  because the corpus grows daily, the build got slower with no commit to
  blame.
- The route is `force-dynamic` with `s-maxage=3600,
stale-while-revalidate=86400`, so the CDN still answers most visitors
  from cache and the hourly cost the old comment protected is unchanged.
- Holder pages prerender nothing, on every environment alike. They render
  on demand under the same `revalidate` and cache for an hour exactly as
  before, so the cost is paid once by one request instead of 158 times
  inside a deployment with a deadline.
- The build went from failing after four minutes to succeeding in 18
  seconds. `/holders` and a holder report both verified rendering from a
  production server afterwards.
- The invariants asserted the OLD asymmetry, and three of them failed as
  soon as it was removed, which is the guard working. They now require
  the symmetric rule: nothing prerenders anywhere, and no
  database-reading route is force-static.

### 2026-09-16 (two agent facts, and a sentence that survives extraction)

- `KNOWN_AGENTS` (13,622) is the DETECTOR'S CATALOG, harvested from
  Virtuals and friends. `AGENT_WALLETS_FLAGGED` (242) is how many wallets
  in our own index carry the flag. Both true, 56-fold apart, answering
  different questions, and until now wearing one label.
- `/llms.txt` published "13,622+ wallets are flagged as belonging to AI
  agents", which is the catalog wearing the other one's label, on the file
  answer engines read. It now says the detector matches against a catalog
  of that size. The homepage tile reads "known AI agents" for the same
  reason.
- `/api/public-stats` returned 242 or 13,622 under ONE key depending on
  which branch ran: the live branch counted `social_graph.is_agent` and
  the preview fallback returned the catalog. The fallback now returns the
  same fact its live branch does.
- The homepage lede extracted as "Turn a wallet list into the and
  Farcaster accounts behind it." An `aria-label` on an SVG is announced by
  a screen reader and invisible to a text extractor, so the most quoted
  sentence on the domain lost its subject. An sr-only text node is clipped
  rather than removed, so it lands in `textContent`; the label prop is
  dropped so the name is not announced twice. Verified by extracting the
  rendered page, not by reading the diff.
- Three invariants: llms.txt cannot describe the catalog as flagged
  wallets, public-stats cannot fall back to a different fact than it
  serves, and the hero must name X in text.

### 2026-09-16 (the anonymous rail is metered)

Signing in made the product roughly a thousand times worse, and that,
not traffic, is why 43 signups over 90 days produced zero purchases.

- Anonymous callers got 3 jobs an hour times 50 open matches each: about
  3,600 matches a day, for ever, with no cumulative meter anywhere. A
  signed-in free account gets 100 per 30 days. The account gate therefore
  selected for staying anonymous and the free allowance could never
  become a reason to buy.
- `ANON_MATCHES_PER_DAY` caps the whole anonymous allowance per address
  per UTC day. The gate for a job is now the smaller of the per-job
  ceiling and what the address has left, decided at submit time because
  that is the only moment the address is known.
- A fixed daily cap, deliberately, not a sliding window. The limiter above
  it hardcodes 3600 in both `slidingWindowCount` and
  `secondsUntilNextAllowed`, so `windowHours` is decorative: 1 is the only
  value it implements, and writing 24 there would have silently bought a
  one-hour window. An invariant now asserts every entry is hourly so the
  field cannot start lying.
- The budget is spent on the gate GRANTED, not on matches delivered.
  Settling afterwards would mean storing a visitor's address on a
  long-lived job row, which is the worse trade. The refusal says so.
- The old invariant compared a per-job gate with a per-window allowance,
  which are not comparable quantities, so it reported clean over the whole
  inversion. It now bounds throughput per unit time, and was negative
  tested: raising the cap to 99,999 fails it.
- The Inngest pipeline imported the options type instead of mirroring it.
  Hand-copying that type is how the two pipelines drifted before, when
  this one billed nothing at all; a type-only import costs nothing and
  makes the next added option a compile error rather than a silent
  omission.
- `/success` sends a buyer to their lookups rather than offering to "Run a
  lookup". Somebody who has just paid to unlock a result does not want a
  new one, and the page previously left the thing they bought behind.

### 2026-09-16 (the discovery surface register)

Where the product can be found, checked rather than assumed, with a
tagging convention that makes each listing measurable.

- Verified by querying each directory directly. A registry entry does not
  propagate everywhere: it reaches Glama, which lists the server as
  healthy at 4.5/5 across 8 tools and tested it today, and it does not
  reach PulseMCP or mcp.so, both of which return nothing for walletlink.
- **Published v1.3.0 to the official registry**, which had been serving
  1.2.0; confirmed active and latest. Glama syncs from that registry so
  its listing refreshes with it, while PulseMCP and mcp.so do not, which
  is why they still need their own submissions. The procedure is in
  `docs/GROWTH.md`, including the preflight that compares the derived
  public key against the DNS proof, since the failure is otherwise an
  opaque signature error.
- Apify owns "find twitter account from ethereum wallet address" today,
  with a competing tool that scrapes X posts and assigns confidence
  scores, which is the weaker method this product is sold against. We do
  not appear on that query at all.
- Every listing carries `?ref=dir-<surface>`. A directory link arrives
  with a referrer we do not control and often with none, so an untagged
  listing that works looks exactly like one nobody clicked.
- The line: a directory listing is product metadata and is submitted as
  part of the work; a forum post is speech in a person's name and is not.

### 2026-09-16 (the NFT seed queue was empty)

All 22 recognized NFT collections had been seeded, so the novelty filter
emptied the queue and every NFT slot fell through to the trending feeds.
That is the behaviour `lib/recognized-contracts.ts` exists to correct:
139 of the 158 published reports answer a name nobody searches. The token
half cannot take up the slack, because ERC-20 seeding has imported
nothing since 2026-08-31.

- Ten collections added, taking the NFT side from 22 to 32. Five of them
  already had published pages, reached by discovery rather than by this
  list, so naming them moves coverage from 19 to 24 immediately and buys
  a guaranteed refresh rather than a new page. The five that are genuinely
  new, and that actually test the path, are Moonbirds, Nakamigos, Lil
  Pudgys, Parallel Alpha and Loopers. Ethereum
  gains Moonbirds, Nakamigos, Lil Pudgys and Parallel Alpha; Base gains
  Loopers, The Warplets and DX Terminal; Arbitrum gains Footium Players;
  HyperEVM gains Hypurr and PiP & Friends, which matters most because
  that chain's token discovery is gated off, so this list is the whole of
  its seed queue and it held one entry.
- Two independent sources each, as the file requires. Every address came
  from OpenSea through the seeder's own discovery rather than being
  typed, and every one was re-read onchain for `name()`, `symbol()` and
  `supportsInterface`. All answered ERC-721 except Parallel Alpha, which
  answered ERC-1155, a kind this list already carries.
- The Warplets earns its place on measurement rather than taste: it was
  the best-performing holder report in the 30 days to 2026-09-16, with
  more entries and more lookups than any other, and it had been reached
  by discovery so nothing guaranteed it would refresh.
- **Smol Brains is still excluded**, and it came up again because
  discovery offers it and the contract answers `name()` as "Smol Brain".
  That is not enough. It was rejected on 2026-08-30 because two reputable
  sources disagreed on its address, and an impostor deployment answers
  its own name just as confidently, which is exactly why the rule is to
  exclude on disagreement rather than believe whoever replies. The
  reasoning is now written at the point where the next person will try to
  add it.

### 2026-09-16 (the seed-coverage alarm)

A daily cron failed every day for sixteen days and every check stayed
green, because nothing counted what it was supposed to produce.

- `getSeedCoverage` counts `RECOGNIZED_CONTRACTS`, the 64 contracts
  chosen on the one criterion of whether a person would type the name
  next to the word "holders", against the ones the seeder has actually
  imported holders for. 32 of 64 today.
- The alarm is the other number: contracts attempted in the last seven
  days that imported nothing. That is a pipeline fault rather than a gap,
  and it is 32, every one of them an ERC-20.
- The cause is recorded in `docs/GROWTH.md`: the metered holder index has
  answered 401 since 2026-08-31 and the seed path forbids the public
  fallback by design, so every ERC-20 seed imports zero holders and
  records a `holders_imported = 0` row. 123 of them exist.
- `seeded_contracts` is granted to `sweep_runner`. Safe, unlike the
  tables the growth views exist to avoid: every column is public contract
  metadata, no wallet and no address. An invariant asserts the grant,
  because losing it would not fail the weekly run, it would delete the
  alarm and stay green, which is the same shape as the fault itself.
- A second invariant asserts the denominator is the list and never a
  literal, so adding the 65th contract cannot leave the count blind to
  the one page that never got built.
- Four buckets, exhaustive by construction, because the first three were
  not. `markSeedAttempt` resets `holders_imported` to 0 at the start of
  every attempt, so that column is the state of the last try and not a
  running total. A contract whose failure aged out of the window belonged
  to no bucket at all: not imported, not failing, not untried, simply
  absent. A coverage report that drops the contracts behind the coverage
  gap is the exact failure this section was written to end, so `stale` now
  catches them and the four sum to the named list.
- Corrected two of my own figures from the day before: the estate holds
  158 holder reports and not 66, and drew 97 entries and not 40. Both
  were copied from an older document instead of the measurement.

### 2026-09-16 (the social queue runs to 28 days, and its links are tagged)

The queue ran dry on 2026-09-23. It is now 28 days, and every link in it
carries a tag, because the channel has been posting daily for a week and
has one measured session to show for it.

- Days 15 to 28, with 14 new cards. Destinations are spread on purpose:
  two each to `/holders`, `/pricing`, `/mcp`, the blog and the homepage,
  three to `/vs`, one to `/check`. Fourteen days of posts all pointing at
  the homepage cannot tell you which page earns a lookup.
- Every link carries `?ref=x-<slug>` or `?ref=fc-<slug>`. A post on X
  arrives through `t.co` and a cast opens in an in-app browser, so the
  referrer is stripped or absent and the arrival reads as `direct`. A tag
  with no referring host is exactly what the `campaign` channel is for,
  and the prefix says which platform sent it. That is measurement, not
  attribution laundering: the tag never claims to be a platform referral,
  and the invariants still refuse to read one as such.
- `check:social` had a tokenizer that could not produce the date on its
  own allowlist. Alternation is first-match, so `2026-08-17` was read as
  `2026`, `08` and `17`, and `CHAIN_MATCH_RATES_MEASURED_ON` sat there
  unreachable: no post could carry the date its measurement is stamped
  with, and the failure named three figures that appear in no copy.
- It is also case-insensitive now, so `10K` tokenizes as `10K` rather
  than as a bare `10`.
- And it self-tests: every allowlisted figure has to be a token the
  tokenizer can actually emit. An entry it can never produce is dead and
  reads as permission that was granted. That assertion is what found the
  second one.

### 2026-09-16 (the growth ledger)

Nothing here changes the product. It makes the traffic work measurable,
because every decision underneath it was otherwise unfalsifiable: the
database recorded where an arrival came from and nothing anywhere said
what that meant.

- `channelFrom` in `lib/first-touch.ts` folds one stored acquisition
  string into one channel, beside the AI assistant roster that was
  already there. Search engines and social platforms get rosters of
  their own, matched the same way, and Google is a pattern rather than a
  list because it ships over 190 country domains.
- Unattributed is a channel and is never folded into direct. 1,489 of
  the last 30 days' sessions carry no origin at all, because the tracker
  shipped after the arrivals that produced them; counting those as
  direct would invent a direct channel four times the real one and every
  rate under it would be wrong in the flattering direction.
- A campaign tag still cannot manufacture a channel. `ref:google-ads` is
  a campaign, not a Google search, which is the same refusal the
  assistant classifier already made and now has two more spellings.
- `lib/growth.ts` reports sessions by channel by week, named sources,
  per-page entries against views, and this window against the last.
  Every rollup groups by the raw string and folds in TypeScript, so
  there is no second copy of the roster in SQL to drift.
- `scripts/growth-report.ts` prints it, `npm run growth:report` runs it,
  and `growth-report.yml` runs it every Monday into the job summary. It
  never fails on the numbers: a red build has to mean something is
  broken or the signal is trained away inside a month. It states a
  decline in its watchlist instead.
- It also refuses to compare against a window it cannot see. Page views
  were first recorded on 2026-08-18, so the first report's "previous"
  column is mostly the tracker being switched on, and the report says so
  rather than reporting a 329-fold rise.
- Three narrow views, `growth_page_events`, `growth_accounts` and
  `growth_purchases`, from `scripts/migrate-growth-views.ts`. The weekly
  job runs as `sweep_runner` and logs into a public Actions run;
  `users.email` is an address and `analytics_events.user_id` holds
  "localStorage ID or email". The views expose twelve columns between
  them, no id and no address, and invariants assert both that the ledger
  never reads the base tables and that neither is added to the grant
  list.
- Purchases and revenue mean packs bought by people. The x402 rail is
  excluded, matching the signup count beside it, which always excluded
  it: one agent settlement counted as a purchase would silence the
  watchlist line that exists to notice zero human conversion, and nothing
  would look wrong. The rail prints on its own line underneath whenever
  it is non-zero, so nothing is hidden either.
- The content table filters to content paths inside the query, before the
  row cap. Capping by views across every path and filtering afterwards
  discards the quietest content rows first, which are the ones the
  section exists to show.
- The social runway counts whole UTC days inclusive of today's post. The
  timestamp subtraction it replaced reported a queue ending a week today
  as six days, so the refill warning fired a day late.
- `docs/GROWTH.md` holds the measured baseline, what each channel means,
  the weekly cadence, and a dated log of interventions with what each
  was expected to move.

### 2026-09-16 (the homepage FAQ collapses)

Nine answers, 675 words, all open at once: the section was a wall, and
the questions underneath it could not be scanned.

- The heading is "Frequently asked questions", which is what people call
  it, in the sentence case the house style asks for.
- Each answer is a native `<details>`, matching the holder-report
  accordion exactly (same classes, same caret, same focus ring), so the
  open state, the keyboard handling and the expanded/collapsed
  announcement come from the browser and this file still has no hook.
- A closed `<details>` is collapsed, not absent, so every word stays in
  the HTML for a crawler, for an assistant reading the page, and for
  in-page find. The FAQPage structured data is unchanged and still built
  from the same array.
- The `dl` is gone: it may only hold `dt`, `dd` and a wrapping `div`, so
  a `details` cannot sit inside one. The question-to-answer pairing was
  never carried by those tags anyway; the FAQPage script states it.

### 2026-09-16 (the card headline measures what it paints)

The emphasis word in a share-card headline sat in a bare `<span>` inside
the headline's flex container, so Satori measured that run at the
parent's 200 weight and painted it at 600. Söhne halbfett is wider than
extraleicht, so every run after the emphasis started early and printed
through the last bold glyph: "published by the **owner**, never guessed"
went out on X as `owner` with the comma struck through the r.

- Each headline part is now its own flex box, and a box is measured in
  the font it is painted in. All thirteen cards were rendered and read
  after the change; six of them (the ones with text after the emphasis
  word) were affected, and the other seven looked perfect throughout,
  which is why it survived a month of posting.
- The non-breaking spaces at the split, which fixed the _other_ half of
  this in August, are now load-bearing rather than redundant: separate
  boxes mean Satori really does trim the boundary whitespace.
- Invariants pin both halves inside the `Headline` function, scoped so
  the correct weighted spans elsewhere on the card are not swept up.

### 2026-09-16 (AI assistants are a named channel, read out of what we already store)

One of the three accounts carrying first-touch attribution arrived tagged
`utm:chatgpt.com/via:chatgpt.com`, and nothing surfaced it: the source
table groups by the raw string and caps at 19 rows, so a channel this size
sits in the remainder. The data was already on disk and unreadable.

- `aiAssistantFrom` in `lib/first-touch.ts` maps a stored acquisition
  summary to ChatGPT, Perplexity, Claude, Gemini, Copilot, Grok, You.com or
  Poe. **Read time, not write time**: the column keeps the measurement, so
  adding an assistant to the list reclassifies every arrival already
  recorded. Bing and DuckDuckGo are deliberately absent, mixing assistant
  answers with ordinary search on one host.
- An "Of which, AI assistants" table on the admin funnel pane carries
  sessions, lookups, signups and purchases per assistant, computed from an
  uncapped grouping so the remainder row cannot hide it.
- Invariants: a campaign tag naming an assistant (`ref:claude-launch`) is
  not an arrival from one, a lookalike host (`chatgpt.com.evil.test`) is
  not either, a real subdomain is, and the roll-up classifies through the
  shared function rather than a second host list in SQL.

### 2026-09-16 (the segmented thumb sits on the segment it marks)

The thumb moved by whole multiples of one segment width, which is only
true if the segments are equal, and `flex-1 basis-0` does not make them
equal: a flex item's `min-width` defaults to `auto`, flooring each one at
its own label. Measured in Chrome, the admin tier filter came out 39.6 /
52.8 / 45.8 / 82.4px and the thumb covered **61%** of the selected
segment, spilling into its neighbour; the 7d/28d/90d ranges had the same
drift. Every class involved was on-system, so no grep could see it.

- `Segmented` is a grid: `grid-auto-columns: 1fr` with `min-w-0` segments,
  equal by construction at their natural size (N times the widest label)
  and equal again when a narrow parent squeezes them. The thumb arithmetic
  is unchanged; it was never the broken half.
- `scripts/check-control-height.mjs`, the guard that already opens a
  browser for this class of defect, now asserts the thumb covers the
  selected segment, and its self-test fixture reproduces the 61% case and
  requires the thumb assertion (not merely the height one) to catch it.

### 2026-09-15 (the IP window rolls; the hour boundary is not a reset)

The IP limiter's calendar-hour buckets doubled every limit at the
boundary: one IP pushed 6 lookup jobs through in 17 minutes (three at
14:47-14:58, three more at 15:01-15:04) because :00 handed it a fresh
bucket. `checkIpRateLimit` now uses the standard sliding-window estimate:
the previous hour's bucket counts at the fraction of it still inside the
rolling window, decaying linearly. No schema change; the status read
weights the same way; an invariant replays that exact burst and requires
the fourth job refused.

### 2026-09-14 (the anonymous gate: 50 matches per lookup, same machinery)

The match gate below made signing in strictly worse for a freeloader:
anonymous jobs were never metered and never gated, so 3 IP-limited jobs an
hour at 500 wallets each was worth up to 1,500 ungated matches against the
100 per 30 days an account gets.

- Anonymous jobs (no session, real caller; system jobs are exempt) now gate
  at `ANON_MATCHES_PER_JOB` (50) per job, in both pipelines. Nothing is
  billed; there is nothing to bill.
- The unlock accepts the same anonymous-ownership proof the results poll
  accepts, so a job run before signing up can be unlocked after it, with
  the new account's pack credits, on that same job.
- Invariants: the anonymous gate stays below the signed-in window (or the
  account gate selects for anonymity), and both pipelines carry it.

### 2026-09-14 (the match gate: the free allowance delivers what it bills)

A 224-wallet list on the free allowance was worth 223 matches, because
submission is bounded in wallets (ten times the remaining balance, since a
match rate is unknowable in advance) while the meter floored at zero after
the fact. A curated list of known-good addresses turned that headroom into
up to ten times the allowance, delivered in full. Found within hours of it
being exploited: a one-wallet probe, then the full list at a 99% hit rate.

- **`chargeForJob` now bills `min(found, remaining)` on the free allowance**
  and reports what happened (`billed`, `duplicate`, `paidFrom`); lots and
  legacy are unchanged. The worker records the gate on
  `lookup_jobs.matches_delivered` (null = ungated) and mirrors it onto the
  saved lookup (`lookup_history.job_id` + `matches_delivered`), because
  history stores the full payload and would otherwise be a free bypass.
- **Every serve surface applies the gate** (`lib/match-gate.ts`): the job
  poll, the saved-lookup read, and the paged `/v1/jobs/{id}` (which counts
  matches before the page boundary in Postgres so paging cannot re-open the
  gate). A locked row keeps the wallet and the never-billed identities (ENS,
  Lens, GitHub) and withholds X and Farcaster; on v1 it serves as
  `locked: true`, never `null`, and gated jobs carry
  `meta.matches_delivered` / `meta.matches_locked`.
- **Unlock**: `POST /api/jobs/[id]/unlock` opens the remainder with pack
  credits (lots only, never the rolling window), idempotent per job via a
  second partial unique index on `credit_ledger` (`paid_from = 'unlock'`;
  the per-job debit index is now partial the other way). The results view
  shows a banner with the locked count and an unlock button, or the pack
  upsell when credits are short; locked rows carry a chip in the table.
- **The Inngest pipeline now bills at all.** Its finalize never called
  `chargeForJob` and never wrote `anySocialFound`, so any job it processed
  completed unbilled; it now mirrors the worker's charge-and-gate block.
- Migration: `scripts/migrate-match-gate.ts` (columns + the ledger index
  split, transactional). Invariants: the gate cannot be out-earned, paging
  cannot re-open it, and all three serve routes stand behind the transform.

### 2026-09-09 (the daily social pipeline: one post per platform per day)

The X and Farcaster pipeline, reworked around three rules: standalone posts
only (no threads), a CTA on every post, and an on-brand image on every post.

- **`content/social/queue.json`** holds the 14-day runway, both platforms,
  reviewed by PR like any other published copy. `scripts/check-social-queue.ts`
  (now in preflight as `check:social`) enforces lengths (one tweet; the
  320-byte cast display window), CTA presence, the grep-visible house style,
  and a figures allowlist built from `lib/public-figures.ts` and
  `lib/packs.ts`: an unknown number in a post fails the build, which makes
  adding it the figure review.
- **`/social-card/[slug]`** renders each post's 1200x675 card live (Satori,
  Soehne, the OG palette), so a card shows the figures of the day it is
  VIEWED, not the day it was written; the registry in `lib/social-cards.tsx`
  interpolates constants and the checker rejects figure literals. Green
  appears only behind measured facts, per the colour law.
- **`daily-cast.yml` + `scripts/cast-daily.ts`**: the Farcaster half casts as
  @walletlink at 17:35 UTC with the card embedded and the CTA link in the
  text. One cast per UTC day, checkpointed in `ingest_state`; the same
  background budget guard as every other Neynar cron; a GitHub warning from
  three days out when the queue runs low. The X half is scheduled in
  Typefully at 17:00 UTC with the same cards attached as media.

### 2026-09-08 (matcha sweep: every remaining surface)

Fourth and final matcha design PR, from a five-auditor sweep over every
surface the first three did not touch. Nothing here changes a rule; it
finishes applying them.

- **Soft is the secondary everywhere now**: 36 outline secondaries move to
  the soft variant across admin (all eight retry blocks, nav pills, form
  cancels), the six /vs heroes, /pricing, /success and every dialog
  (Upgrade, Auth, ApiKeys, FarcasterDM, ContractImport, ProgressBar,
  LookupHistory). Outline survives where a control must read on an
  arbitrary surface.
- **The named fills reach the stragglers**: PackPricing and the /vs tier
  panels, the success banners, ContractImportModal's preview inset,
  ProgressBar's footer band, Meter and Sparkline tracks, the Progress
  primitive, static TableRow hover (subtle) and selected/footer (well),
  the overflow-menu item hover, and the muted Badge tone, which was the
  last opaque `bg-muted` chip that could self-erase on a well.
- **Dense admin rows drop to the compact tier**: the jobs table's four
  per-row controls, the whitelist and saved-lookup deletes, the
  recent-edits View, RemovalPane's Un-suppress, and the DM modal's key
  toggle (which had hand-rolled 28px before the ladder named it).
- **Emails and their landing page follow the retone**: every `#737373`
  becomes `#68696c`, `#e5e5e5` becomes `#e4e5e9`, body ink `#0a0a0c`, and
  both templates (plus /api/email/unsubscribe) gain the off-white
  `#f6f6fa` ground.
- **Share cards stop lying**: the OG palettes' `text`, `ink` and `paper`
  literals follow their retoned tokens (`#f9fafd`, `#0a0a0c`, `#f6f6fa`).
- **docs.walletlink.social** gains the retoned grounds
  (`background.color` light `#F6F6FA` / dark `#0A0A0C`) and an honest
  dark primary (`#36239A`, --accent-brand-hover); the AI bubble takes
  `--chat-bubble-shadow: var(--float-shadow)`, retiring its library
  default. The logo is untouched everywhere.
- globals.css sheds the unused shadcn `--sidebar-*` block and the dead
  `--radius`; `--card-foreground`/`--popover-foreground` join the
  undertone set so the product ships one body ink. /privacy joins the
  display opening and the one section-h2 register. Modals paint
  `bg-popover` (surfaces lighten as they rise; the panel was on the page
  ground, below the card it floats over).

### 2026-09-08 (matcha data surfaces: table density, entity pages, the lookup widget)

Third matcha design PR: the surfaces that use the fills and the ladder.

- **ResultsTable at matcha density.** 38px virtualized rows (+16% visible
  rows), no per-row hairline: delimiting is the opaque `--fill-row-hover`
  plus column alignment; the frame and sticky header keep their lines. The
  details control drops to the compact tier with a hit-area inset that tiles
  the row pitch exactly.
- **Holder reports open as an entity, not a sentence.** EntityHeader (chain
  mark, 30px/600 name, muted qualifier, reachable badge, mono address with
  copy), the stat strip in the new operational figure tier
  (`Figure variant="stat"`: 16px/500 value under an 11px mono label), and a
  sticky 384px action rail carrying the view's only filled button at the
  hero height. The report passes `wide` (the admin exception's second
  caller). Overlap becomes a chip cloud of soft buttons (the named exception
  to "a row of buttons never wraps"), and the measurement gets a native
  accordion of three quotable answers.
- **The homepage lookup is one widget.** The drop target, the alternates
  (now soft pills with the well-fill selected state) and the paste panel
  live in one Card; "Start lookup" moves to the 48px hero tier, the view's
  single primary action stated at a different scale.
- `Figure` gains the stat variant with both caption anatomies named; the
  accordion caret joins the sort arrow's motion rule and reduced-motion
  stop.

### 2026-09-08 (matcha controls: the height ladder, soft buttons, brand chips)

Second matcha design PR. Control primitives and their guards; the surfaces
that use them land next.

- **The control-height ladder.** `--height-control` grows three named
  siblings with placements: hero 48px (the single primary action of a view,
  body content only, never the header), compact 28px (table rows), micro
  24px (chart filter rows; the WCAG 2.2 floor). Button gains the matching
  sizes (`hero`, `compact`, `micro`, `icon-hero`, `icon-compact`), and
  `check-control-height.mjs` now asserts the rendered height of every
  element declaring ANY ladder token, with ladder steps in its fixtures.
- **The `soft` variant is the default secondary**: no border, rests on
  `--fill-subtle`, hovers to `--fill-hover`; `outline` is demoted to
  arbitrary surfaces and both it and `ghost` hover on the subtle fill, so
  one wash mechanism serves all three.
- **`FOCUS_RING_WITHIN`**: the one wrapper spelling of the focus ring
  (`has-[:focus-visible]`), for a container whose child holds focus.
- **Brand chips with the green fence.** `ChainChip`/`PlatformChip`
  (components/ui/chip.tsx) tint their field from the chain's plate via
  `color-mix`. Every tint percentage in `CHAIN_PLATES` is measured per theme
  against a 0.04 OKLab fence from `--attested-tint` and
  `--accent-brand-tint` plus a 0.015 visibility floor, and
  `check-contrast.mjs` re-measures the table on every run, fallbacks
  included (Robinhood and BNB fall back in light, Base and Polygon in dark,
  HyperEVM in dark for visibility). Hue in a background is identity; hue in
  a foreground is semantics, so no chain can impersonate attestation.
- The 11px fence widens to `Eyebrow` / `Badge` / `Button size="micro"`, and
  the affordance table gains the micro-pill row that keeps chips and badges
  visually distinct.

### 2026-09-08 (matcha-informed surfaces: fills, elevation, retoned neutrals)

First of the matcha design PRs, from the measured matcha.xyz deep-dive. Tokens
and surfaces only; controls, tables and page anatomy follow in their own PRs.

- **Interior fills.** Three named translucent washes replace ad-hoc surface
  use: `--fill-subtle` (soft-control rest), `--fill-well` (dialog insets,
  wells), `--fill-hover` (the one hover step), plus the opaque
  `--fill-row-hover` for virtualized rows whose sticky columns paint
  `bg-inherit`. Dialog inset panels move from `bg-muted` to `bg-fill-well`.
- **One elevation sentence for both themes.** The light page ground drops to
  `oklch(0.975 0.005 280)` under pure-white cards; `--muted` to 0.955 so the
  stack stays ordered. Re-solved in the same change: `--muted-foreground` to
  0.52 (5.09:1 on the new ground) and `--input` to 0.615 (3.28:1 on the new
  muted), because moving a ground re-opens every ratio solved against it.
- **The neutral undertone.** Every neutral gains chroma 0.005 at hue 280,
  the `--surface-inverse` precedent at quarter strength; lightness untouched.
  The dark hairline retones to `oklch(0.9 0.03 280 / 12%)` with its composite
  measured (1.34:1 on card, vs 1.32:1 before).
- **`shadow-float`.** The floating layer's one shadow becomes a named
  two-part token (soft lift + tight 1px edge); `shadow-lg` is now a rejected
  spelling in the design-language guard.
- **Guards updated in the same change**: `check-contrast.mjs` re-measures the
  retoned set and gains the dark-hairline composite assertion (>= 1.32:1 on
  card); `check-design-language.mjs` adds `shadow-lg` to the elevation rule's
  rejected list with fixtures both ways. `docs/DESIGN-LANGUAGE.md` records the
  new sections and the re-measured contrast table.

### 2026-09-02 (two new corpora: L2 name records, and creator profiles)

Two ingest routes join the index. Both are L0 truth inputs: they add facts and
provenance and move no verb, no price and no response shape. The evidence-class
decisions behind them are recorded under L0 in `docs/AGENT-SYSTEM.md`, and the
running posture of each is in `docs/OPERATIONS.md`.

- **Basenames text records, `basename_record`.** `com.twitter` written to a
  Base name by the wallet that owns it. Public class `onchain`, quality 50,
  identical to the mainnet ENS harvest because it is identical evidence one
  chain down: the wallet half is published onchain by the owner, the handle
  half is free text nobody checked, and the score below the trust line is what
  says so. It de-stacks against `ens` and `ens_onchain` for the reason those
  two de-stack against each other: three name records read as three
  independent facts would put a wallet over the trust line on one mechanism
  read twice.
- **Creator profiles, `zora_profile`.** The X account is attached through a
  flow the platform records as a dated link event, and wallets are connected
  to the same account. Public class `aggregated`, quality 35, alongside the
  other corroborating source rather than with the attested ones. The ledger
  evidences the account half and covers social accounts only; a linked wallet
  arrives as a type and an address with no signature, event or timestamp, so
  the wallet half is unevidenced and the pair is worth its weaker half. Only
  wallets the person brought are read, which keeps platform-provisioned
  addresses out. It carries no numeric X account id, so it adds reach and no
  rename detection.

Two filters on each are load-bearing rather than tidy, because without them
the row is about a different person, and each was measured rather than
assumed. On Base, an expired name still resolves: on a uniform 500-name
sample, 44.5% of the names carrying a social record were already past
expiry, so a name past `nameExpires` is dropped rather than harvested for
whoever buys it next. And the handle is re-read through the registry instead
of taken from the log, because a name moved between the two resolvers leaves
an old write in the logs of the one it left (5.0% of sampled names), which
would publish a handle its owner has retired. On the profile side, only
wallets the person brought themselves are ingested, since the platform
provisions wallets of its own on the same profile, and an unknown address
answers with a wallet-shaped record whose handle field holds a reverse name,
which is rejected before anything treats it as a social handle.

Raw record values are validated and then rejected, never stripped into shape.
The existing handle cleaner strips invalid characters, which turns
`x.com/somebody` into the handle `xcom` and a name ending `.base.eth` into a
handle nobody holds; both are accepted today by a rule that only strips. The
harvest gate recovers the forms that are recoverable (a leading `@`, a profile
URL) and rejects the rest.

The public evidence-class vocabulary is unchanged: both ids map to classes
that already existed, so the `sources` enum, its five values and the
`attested` derivation are exactly as they were. Two published enumerations
that spell the onchain route out in their own words were widened to say that
an owner-published name record may sit on Ethereum or on an L2 registry
(`docs-site/concepts/coverage.mdx`, and the `PublicSource` description in
`docs-site/openapi.yaml`). `ATTESTED_SENTENCE` is unchanged and that was
checked rather than assumed: a Base name is an ENS name, so “an onchain ENS
record” already names the route.

No migration and no grant. `social_graph.sources` is a plain `text[]`, and
both checkpoints are new rows in the existing `ingest_state` table, which
`sweep_runner` can already write.

### 2026-09-02 (right-to-removal stage 1: the promise becomes true)

The privacy page has promised since 2026-08-30 that a removal request needs
no proof and that we would rather admit a removal can undo itself than imply
a door that locks. Stage 1 builds the lock. Six policy decisions (recorded in
full under principle 8 of `docs/AGENT-SYSTEM.md`) shipped together:

- **Intake, staged.** Stage 1 is email-only to the published support
  address, executed by an operator through an admin-gated removal endpoint;
  no proof is demanded. Verified self-serve lanes are a later stage and are
  not built.
- **Scope.** Requester-named identifiers only: one independent
  `(kind, identifier)` row in `suppressed_identifiers` per identifier,
  nothing stored that associates the rows, insert timestamps jittered so a
  multi-identifier request cannot be reassembled. The dedupe and negative
  tables stay outside the boundary, documented, because deleting
  do-not-reprocess markers would increase processing of the person who
  asked to be left alone.
- **Disclosure, calibrated.** The email reply script is uniform and never
  confirms whether a record existed; no removed event type appears on any
  surface; no automatic refunds.
- **Reversal.** Before deletion the affected rows are copied to an
  operator-only quarantine table, purged at 30 days by the cleanup cron; a
  `lane` column on the suppression table records the verification method,
  never anything about the requester; un-suppress restores from quarantine
  and is operator-only.
- **Saved copies.** Background job payloads expire at 30 days; a serve-time
  filter strips suppressed identifiers from history and jobs reads; each
  removal amends saved results in place, non-fail-soft, removing the
  mapping keys (absent keys are the ordinary-miss shape, so an amended row
  cannot be fingerprinted as a removal) while keeping the wallet entry so
  row counts align. A saved reverse lookup whose subject is the removed
  handle is quarantined and deleted whole, name and all.
- **The promise, laddered.** `app/privacy/page.tsx` now states exactly what
  stage 1 ships: removal by email, executed by hand, permanent because the
  suppression list blocks re-collection, a 30-day quarantine copy kept so
  a mistaken removal can be undone, and saved customer lookups
  amended. The no-proof sentence, the jurisdiction-blind stance and the
  30-day SLA all stand; the exports-already-downloaded carve-out stays. The
  retention table gains the quarantine copies and job payload rows.

Enforcement is in the database, not a checklist: `BEFORE INSERT OR UPDATE`
row triggers with `SECURITY DEFINER` functions on every table declaring a
wallet or handle column (the UPDATE half is load-bearing: an upsert's
conflict branch would otherwise restore the handle through `COALESCE`), plus
a pre-flight filter in `lib/job-processor.ts` so a suppressed wallet with no
cached row does not run the external pipeline. The operator runbook (reply
script, endpoint order, un-suppress window, migration-before-merge) is in
`docs/OPERATIONS.md`; the posture row there moves from designed-unshipped to
stage 1 in review.

### 2026-09-02 (the funnel pane answers the source, gate and rail questions)

The admin funnel had the data for "where do people come from, which gate
converts, and what does the agent rail do" written and read by nothing; every
one of those questions needed hand SQL. Four new readers in `lib/analytics.ts`
close the gap, all admin-only.

- **Sources.** `getAcquisitionSources` groups sessions by the origin on their
  first page view (`page_view.metadata.origin`, written since 2026-08-25 and
  previously read only by a one-off campaign script) and accounts by
  `users.acquisition`, with a has-ever-bought column per source. Missing
  origins read `(untagged)`, never `direct`, because `direct` is a measured
  arrival and the absence of a measurement is not.
- **Gate conversion.** `getGateConversion` replaces `getPaywallTriggers`
  (same `(none)` and legacy `limit`/`feature` labels) and joins modal opens
  to same-session `checkout_started`/`checkout_redirected`. Checkout is the
  per-gate bottom step on purpose: a payment carries no session, so a
  per-gate "paid" would inherit the email-join floor the session funnel
  documents.
- **Purchases.** `getPurchases` reads settled `credit_lots` by pack and rail,
  grants excluded. The card says explicitly that the Revenue pane is
  card-processor-only and the two totals differ by exactly the onchain
  amount, so the panel does not regain two silently disagreeing revenue
  figures.
- **The agent rail.** `getAgentRail` is the first admin reader over
  `api_usage` (distinct callers, requests, credits) plus the key counts with
  the OAuth split and windowed onchain sales, presented as a rail beside the
  funnels rather than a fabricated step of them.
- **Previous window.** The journey route also computes the same-length window
  before the current one and the pane shows deltas on its four headline
  tiles; a zero or unmeasured baseline renders no delta rather than "+100%".
  The window options move from 7/30/90 to 7/28/90 so both sides of every
  comparison hold the same weekday mix; 28 is the new default.
- **Index note.** Every funnel reader that does not lead with an event type
  scans `analytics_events` by bare `created_at`, which no existing index
  serves. `scripts/migrate-analytics-created-at.ts` (idempotent, verified,
  **not yet run**) adds `analytics_events_created_at_idx`; the declaration is
  in `db/schema.ts` beside the other three.

### 2026-09-02 (the repo as an agent surface: tier D, plus a README prune)

Items 22 to 25 of `docs/AGENT-SYSTEM.md` (tier D), so a fresh session is
productive in one read and a red gate names its own cause; and the README
returns to orienting a repo visitor.

- **Preflight scripts (item 22).** `package.json` gains `typecheck` and one
  `check:*` script per guard, plus `npm run preflight`, which chains every
  gate that needs no database, no Chrome and no secrets (format check,
  typecheck, palette, design-language, contrast, og-palette, invariants).
  `docs/CI.md` names it as the local repro shortcut.
- **Preview builds stop touching Neon (item 23).** On a Vercel preview
  deployment, `/api/public-stats` serves the `lib/public-figures.ts`
  constants, `/api/starter-collections` serves the empty list the homepage
  panel already hides gracefully, and the holder listing
  (`lib/holder-pages.ts`, feeding `/holders`, the sitemap and
  `generateStaticParams`) answers empty, so no preview build reads the
  database and concurrent preview pushes can no longer starve each other.
  Production and local builds keep the live path, byte-identical; the guard
  condition is asserted in `scripts/check-invariants.ts` and its loosenings
  are mutations in `scripts/check-invariants-guard.ts`.
- **Guards name their own flakes (item 24).** `check-control-height.mjs`
  relaunches Chrome once with a fresh profile before failing and its failure
  message says the fault is environmental, not layout;
  `check-published-figures.ts` on a pull_request run whose only findings are
  DRIFT/STALE prints that the index moved, not the PR, with the
  sync-in-its-own-PR loop (exit code still 1); `check-design-language.mjs`
  appends a rephrase hint when a hit sits inside a string literal in a
  non-component file.
- **Posture as data (item 25).** New read-only `scripts/ops-status.ts` prints
  the `ingest_state` posture rows (`posture:*`, `neynar_credit_usage` with
  its age, `farcaster_sweep_resume`); `docs/OPERATIONS.md` stays the index of
  what each row means.
- **README prune.** The README says what the product is, why the code is
  public, how to run it and where the real docs live, and stops restating the
  API reference. Cut: the endpoint credit table and the rate-limit plan table
  (the docs site owns them, and the plan table predated plan laddering), the
  legacy Pro and Unlimited rows and sentence, the MCP OAuth design essay (a
  pointer to the `app/api/mcp/route.ts` header remains), the x402 per-address
  economics, and the environment-variable table (`.env.example` is the
  authority). Corrected: the licence section now says AGPL-3.0, matching
  `LICENSE` (it said MIT); the MCP tool count is eight, matching the server;
  the agent count is 13,622+, matching `KNOWN_AGENTS`; the commands block
  matches the new scripts. Added: a “Public on purpose” section carrying the
  `docs/README.md` rationale. Every figure the README still states is
  declared in `scripts/check-published-figures.ts`; `README.md` joined the
  live-share and known-agents claims there in the same change.
- **Held-handles sync.** The distinct-handles-held figure had fallen ahead of
  the live count on its four declared surfaces (460,798 published, 460,779
  held: the conflict resolver removes handles, so this count can shrink);
  synced so the figures gate runs green.

### 2026-09-01 (a pack buys its limits, the rail grows, and spend gets a dry run)

Gaps 17, 18 and 19 of `docs/AGENT-SYSTEM.md` (tier C, decided 2026-09-01),
shipped with their docs in the same wave.

- **Plan laddering (gap 17).** The account's highest UNEXPIRED pack decides
  the rate-limit preset a request is served under, spent down or not:
  Trial/Campaign/Agent stay on `developer`, a live Scale pack serves `startup`
  (300/min, 200-address batches), a live Index pack serves `enterprise`
  (1,000/min, 1,000-address batches). Decided per request in
  `authenticateApiRequest` from `credit_lots` (`PACK_API_PLAN` and
  `ladderedPlanId` in `lib/api-plans.ts`), never from anything a caller
  sends, never demoting a plan support raised by hand; keys stay stored on
  `developer` and legacy pro/unlimited keep their mapping. Credits still
  bound totals. The MCP resolve schema's cap moved to the largest plan batch
  so zod cannot refuse a list the caller's real plan accepts; the v1 handler
  enforces the served ceiling.
- **x402 growth (gap 18).** `{"quantity": N}` on the buy body, 1-25 packs in
  one settlement at linear price: the challenge, the verification and the
  grant all scale from the one strictly parsed number (`quantityFrom`), and
  replay idempotency stays keyed on the authorization. A valid `wts_live_`
  key presented with the payment makes the buy a top-up: credits land on that
  key's account, no key is minted, and the account is named only by the key's
  own prefix; an OAuth token answers `403 OAUTH_CANNOT_BUY` and an invalid
  key `401 INVALID_TOPUP_KEY`, both before any money moves. Every 10th
  settled purchase from the same wallet grants one bonus Agent pack of
  matches (`countSettledPurchases` counts settlement ids naming the wallet,
  so bonus lots never count and a replay cannot reach the branch).
- **`POST /v1/estimate` (gap 19).** The dry run: free on the match meter at
  any balance, weighed against the rate window like the batch it previews
  (one unit per address, via the new `rateWeight` option on
  `authenticateApiRequest`), capped at the plan's batch ceiling, minimum 10
  distinct wallets. Counts only, never identities: `in_index`,
  `previously_checked_empty`, `never_checked`, and a `{low, high}` band
  where low is exact for a batch of the list and high adds never-checked
  wallets at the measured overall rate. New `LIST_TOO_SMALL` error code.
- **Per-chain match rates on `/v1/stats`.** The 16-46% table left prose:
  `CHAIN_MATCH_RATES` in `lib/public-figures.ts` (registered as a dated
  measurement in `scripts/check-published-figures.ts`, with the coverage
  docs table as the record) now rides `data.match_rates`, and llms.txt
  interpolates it.
- **MCP: eight tools.** `walletlink_estimate_list` joins the seven, free,
  described honestly, weighed like the batch. Tool copy now states the
  plan-dependent batch ceiling, and the canonical pacing sentence was
  reworded (in the same PR as the behavior) to hold at every rung.
- **Invariants.** New adversarial assertions for all three: a plan name
  smuggled as a pack id ladders nowhere and the ladder never demotes; the
  quantity parser refuses coercion and the cap; the top-up cannot credit an
  account the key does not prove and refuses before settlement; the loyalty
  bonus is unreachable by replay; the estimate declares zero cost with
  per-wallet weight and its response can carry no identity keys.

### 2026-09-01 (the paid rail gets the async surface)

Gap 15 of `docs/AGENT-SYSTEM.md` (tier C, decided 2026-09-01), which also
closes gap 20: the key-authenticated surface is no longer sync-only, and the
job it runs is the standard pipeline, live resolve on miss, exactly like a web
job. Shipped with its docs in the same wave.

- **`POST /v1/jobs`.** Body `{wallets: [...]}`, validated and deduplicated
  like `/v1/batch`, weighed one request-unit (the work is billed as matches at
  completion, not the queue ticket). The list is bounded by the existing
  `canSubmit` verdict from the key's account (SUBMISSION_MULTIPLIER times the
  balance; refusal 402 `SUBMISSION_LIMIT_EXCEEDED` names the cap and both
  purchase paths) and by one active pending/processing job per account,
  across web and API alike (409 `JOB_ALREADY_ACTIVE` names the active id).
  Returns 202 with `job_id` and `status_url`; jobs of 10 wallets or fewer run
  inline, larger ones queue for Inngest with the cron worker as fallback.
  Billing is the existing idempotent `chargeForJob` at finalize: misses free,
  a failed job never billed, a resumed job never billed twice.
- **`GET /v1/jobs/{id}`.** Zero declared cost, so a drained key can collect
  what it already paid for. Strictly scoped to the key's account: a job
  another account owns answers the same 404 as a missing job (asserted in
  `scripts/check-invariants.ts`, with a guard mutation proving the assertion
  can fail). Progress reports the job row's counts with stage names mapped
  through an allowlist (`index`, `cache`, `onchain`, `live`), never internal
  pipeline identifiers. Completed results come back in the batch row shape:
  `publicTwitterField` with wallet-keyed reachability read at poll time,
  `verified` on both identity objects, evidence classes through the
  `publicSources` allowlist, entries null for wallets that resolved to
  nothing, `meta.matched` carrying the billed number.
- **Two MCP tools.** `walletlink_submit_job` (cost stated at the decision
  point: billed on matches like resolving, one active job per account, cap
  named) and `walletlink_job_status` (free on both meters; shows the first
  100 rows and points at the REST endpoint for the full set). Both forward
  the caller's own key through `lib/mcp-call.ts`, so pricing stays identical
  by construction.
- `readBodyCapped` moved from the batch route to `lib/api-auth.ts`, shared
  with the jobs route, so a route cannot forget the byte cap by copying the
  wrong template.
- **The docs, in the same wave.** `docs-site/openapi.yaml` gains both paths
  with the new error codes (`SUBMISSION_LIMIT_EXCEEDED`, `JOB_ALREADY_ACTIVE`,
  `JOB_NOT_FOUND`) and the job schemas; a new API reference page,
  `api-reference/jobs`, states the cost, the one-active-job rule, the
  balance-derived cap and the polling contract; the introduction's two meter
  tables, the errors page, rate limits, batch, the MCP page, the agent-pack
  page and the scan-depth concept page (whose "run it in the app" advice the
  jobs endpoint just retired) all pick up the new surface; llms.txt gains the
  async sentence with the submission multiplier interpolated. Endpoint and
  tool counts move six-to-eight and five-to-seven everywhere they were
  published.

### 2026-09-01 (the agent surface stops fighting its own callers)

Tier B of `docs/AGENT-SYSTEM.md` (gap register items 9 to 14): six ergonomic
defects the five-persona drive found, none touching pricing. The docs moved in
the same tree (openapi.yaml, the batch, stats, usage, errors and introduction
pages, the coverage concept page, mcp-server.mdx, agent-pack.mdx), and the new
cron got its posture row in `docs/OPERATIONS.md`.

- **Free endpoints honour their declared zero cost.** `authenticateApiRequest`
  refuses at zero balance only when the declared cost is above zero, so
  `/v1/stats`, `/v1/usage` and the two free MCP tools answer a drained key and
  carry the zero reading out in `X-Matches-Available`. The
  `ZERO_BALANCE_SENTENCE` moved to the new truth in the same diff.
- **Batch parity.** `POST /v1/batch` rows carry `last_updated` and `stale`
  (one derivation with single lookup, `lib/staleness.ts`), misses report
  `meta.previously_checked` (wallet to checked-at; absent means never seen),
  and the MCP trim keeps `farcaster.fid`, which the Farcaster DM rail is
  addressed by.
- **Retry honesty.** `POST /v1/batch` accepts `Idempotency-Key`: a resend of
  the identical request inside 24 hours replays the stored response
  (`Idempotency-Replayed: true`) and bills nothing; a reused key with a
  different body is refused 422, an oversize original 409. New
  `idempotency_keys` table (`scripts/migrate-idempotency-keys.ts`, **run
  before deploy**, then the read grant), swept by the cleanup cron. The
  metered MCP tools now declare `idempotentHint: false` and their descriptions
  state the retry-billing rule.
- **Coverage an agent can poll.** `/v1/stats` and the MCP coverage tool serve
  counts materialized daily into `ingest_state` by the new
  `/api/cron/refresh-coverage`, with `meta.as_of` (and `as_of` in the tool
  output) saying when they were taken.
- **The x402 key-cap deadlock.** `POST /api/x402/recover` accepts
  `revoke_others_and_reissue: true`: behind the same signed, single-use
  challenge, it revokes the account’s active keys and mints one fresh key in a
  single atomic statement, returning the revoked prefixes. Invariants assert
  the reissue sits behind the proof and the spent challenge; four new guard
  mutations prove those assertions can fail.
- The stale `lib/x402.ts` comment claiming the buy route sends no bazaar block
  is corrected; the CDP facilitator switch remains open.

### 2026-09-01 (attested starts telling the truth, and the contract gets one authority)

Tier A of `docs/AGENT-SYSTEM.md`, the eight truth bugs its five-persona drive
found on the public surfaces.

- `lib/canonical-sentences.ts` now holds the load-bearing sentences of the
  semantic contract the way `lib/public-figures.ts` holds the numbers;
  llms.txt and the MCP instructions interpolate them instead of hand-rolling.
- The MCP `attested` field derives from the evidence classes, not the narrow
  `verified` flag that reported false on the majority Farcaster-attested
  handles and taught agents to treat the strongest evidence class as weak. A
  record with no classified evidence reports null, never false.
- Refusals carry their remedies: the two NO_CREDITS messages name the pricing
  page and the x402 rail; the no-key and 401 texts name the machine path.
- The impossible reachability arithmetic (460,889 resolved presented as 99.5%
  of 460,798 held) is rewritten against a new registered coverage constant.
- One owner-attested enumeration everywhere, four routes including manual;
  agent-pack's stale recovery denial, quickstart's export contradiction,
  README's orphan 16-47% figure and the reachable-vs-has-account label are
  corrected; the batch pacing rule now appears at the decision point.
- The review of the wave itself caught our replacement text overstating the
  verified flag's narrowness (attested-social rows do set it true); corrected
  on every surface in the same change.

### 2026-09-01 (the agent surface gets a design authority)

Agents are now a first-class customer (the API, the MCP server, the Grok
plugin, llms.txt consumers), and their design decisions lived nowhere. Five
embodied agent personas drove the whole surface through the code and reported
back; the synthesis is three documents:

- `docs/AGENT-SYSTEM.md`: the layer tower (index, semantic contract, metered
  primitives, agent affordances, projections), the seven principles every
  change must preserve, a grounded gap register (including eight truth bugs on
  public surfaces, worst: the MCP `attested` field contradicts the docs' own
  definition), and a sequenced roadmap with Jake's pricing decisions marked.
- `docs/CI.md`: every CI gate, its dependencies, whether a red is
  deterministic or environmental, and the local repro command, so the next
  session does not rediscover the preview-build starvation or the figures
  drift loop the hard way.
- `docs/OPERATIONS.md`: live posture per pipeline and the PR protocol
  (Bugbot semantics included), updated in the same PR as any posture change.

CLAUDE.md gained a session-bootstrap section pointing at them, and
PROJECT_OVERVIEW.md gained the short form of the layer model. Documents only;
no behavior changed.

### 2026-09-01 (a tool call now reports what it left behind)

An agent that wanted to know its remaining quota after a resolve had to spend a
second call asking, because `lib/mcp-call.ts` kept only the status and body of
a v1 response and dropped the headers where the v1 handlers report quota.

- Every keyed v1 response now carries `X-Matches-Available`: the credit
  balance the call was admitted with, before its own matches were debited. It
  rides on success, on 402 (where it reads 0, the figure a caller most wants
  at that moment) and on 429; absent on 401 and for the legacy unmetered
  accounts. Documented in the API reference and declared in the OpenAPI spec.
- The v1 routes now send `Access-Control-Expose-Headers`, because without it
  a browser caller could read none of the headers the docs tell them to read;
  the rate-limit trio had this gap all along.
- `RouteCallResult` carries the response headers, and every metered MCP tool
  result now embeds a `quota` object: `matches_available_before_this_call`,
  `requests_remaining_this_window` and `window_resets_at` (ISO, converted from
  the header's Unix seconds). Error results carry it too: a 402 or 429 tool
  refusal is exactly when an agent needs the meters.
- The API error path (401, 402, 429) now sends CORS headers at all; it shipped
  without them, so a browser could not read the 402 that carries the balance,
  or tell it from a network failure.
- The `wallet_cache` schema comment claimed a 24h TTL; the TTL has been 7 days
  (`CACHE_TTL_HOURS`) since the constant moved. The comment now points at the
  constant instead of restating a number.

### 2026-09-01 (the FID enrichment endpoint was an open proxy)

`POST /api/enrich-fids` answered anyone, with no session check and no rate
limit, and every username in the body became one upstream request billed to our
own provider credential: an unmetered proxy for a credit pool that has already
been exhausted once this year. Its spend was also invisible, because
`fetchFidsByUsernames` was the one caller of the API that never reported to the
monthly counter.

- Every caller now passes an IP rate limit that counts usernames, not
  requests, because a request-shaped bound understates the exposure by the
  batch factor of 100. Anonymous callers get 300 usernames an hour; signed-in
  callers get 2,000, enough to enrich a large saved lookup across a couple of
  history views while capping what a scripted free signup can drain.
- `fetchFidsByUsernames` reports its spend, one credit per username, so the
  budget's answer to background work stays honest.
- The properties are asserted in `scripts/check-invariants.ts` and were
  mutation-tested: the refusal must precede the upstream fetch (anchored so a
  decoy string cannot satisfy it), the buckets must exist in comment-stripped
  source, the limiter must be charged per username, and the spend must be
  recorded.

### 2026-08-30 (the cron was seeding what nobody searches)

Both discovery sources rank by novelty (OpenSea `trending`, GeckoTerminal
`trending_pools`), and `NOVELTY_DAYS` then works further down each list. So the
pipeline was anti-correlated with search demand by construction: trending ranks
what has no search history yet. The corpus it built was 66 reports holding one
recognisable brand and a page titled "Unknown Token holders on Base", while
`chainlink holders` earned impressions against no page at all.

`lib/recognized-contracts.ts` leads both queues: 63 contracts over seven chains,
chosen on one criterion, whether a person would type the name next to "holders"
or "owners". Market cap does not qualify a wrapped asset and does not disqualify
a mid-sized collection with a loud community.

It is a prefix, not a new code path. `selectNovelCandidates` already cycles
candidates, so an entry seeded last week drops out on its own, the list empties
itself into the trending feeds once exhausted, and thirty days later the oldest
becomes eligible again and its report refreshes. Nothing needs pruning.

Two integration details that would have failed quietly:

- The Robinhood Blockscout fallback tested `candidates.length === 0`. A curated
  prefix makes that false, which would have suppressed the fallback and narrowed
  the one chain nobody else indexes to a couple of curated names. It now tests
  whether discovery found nothing, and appends rather than replaces.
- `discoverTokenCandidates` threw on a bad GeckoTerminal response, which would
  have discarded the recognised names along with the outage. It now returns them
  and rethrows only when there is genuinely nothing to seed, so a real discovery
  failure still reports itself.

Every address was read from live sources and re-read by a second pass against
different ones: an onchain `name()` call over an independent RPC, a resolution
run in the reverse direction (brand slug to address, the direction that catches
an impostor contract), and a second index. 63 survived, 22 were rejected, and
the rejections are recorded in the file because each looks like an obvious
addition until checked. CryptoPunks is the one worth knowing: it predates
ERC-721, `ownerOf` reverts, there is no ERC-165, and ownership sits in a
non-standard `punkIndexToAddress` mapping, so CoinGecko reports 100 holders
against a real figure near 3,900. Seeding it would publish exactly the broken
page this list exists to prevent.

### 2026-08-31 (rotating a key bypassed the cap it was meant to respect)

`rotateApiKey` selected on `id` alone, revoked unconditionally, and inserted
without going through `createApiKeyIfUnderCap`. Rotation is only count-neutral
while it retires exactly one ACTIVE key, and nothing checked that.

So: revoke a key once, then POST that same dead id N times. Each rotation
retired nothing and minted a live key, and an account held N+1 active keys
against a cap of 10. The cap was decoration.

The second consequence is worse. `oauth_grant_id` was not excluded, and the
replacement row carries none, so rotating an OAuth grant laundered a one-hour
access token into a permanent dashboard credential. Grants are capped
separately, in `lib/oauth/grants.ts`, for reasons that stopped applying the
moment the row could be rotated out of that category.

`listApiKeys` has always hidden grant rows, so the id could not come from the
dashboard. It came from `/api/developer/usage`, which filtered on `user_id`
alone. That now matches `listApiKeys`.

The select gains owner, active, not-revoked and not-a-grant, with ownership
moved into the WHERE clause rather than compared after the fact. The revoke is
now conditional on the row still being active and its returned rows gate the
insert, so two concurrent rotations of one key produce one replacement.

Blast radius today was small, and only because the paid gate happens to stand
in front of the route. That is not a defence anyone designed, and it is the
reason a proposed free API key was not shipped alongside this: it would have
opened the route to anyone who can sign up.

Six assertions. Two of them were wrong when first written and mutation testing
caught both, which is the whole argument for the practice:

- The function slice ran to end of file, so the grant-row assertion was matching
  `listApiKeys`'s own `isNull(oauthGrantId)` further down. It went green with
  the filter it protects deleted. Now bounded at the next export.
- Probing for `eq(apiKeys.isActive, true)` anywhere in the function passed on
  the conditional revoke's copy of that same expression, so deleting it from the
  select changed nothing. The select is now matched as one clause, and each of
  its four filters fails the run when removed individually.

The guard caught a second defect in the same change, and it is the more
instructive one. `check-invariants.ts` had an assertion that `listApiKeys`
hides OAuth grant rows, written as a regex over the RAW file:
`/listApiKeys[\s\S]*?isNull\(apiKeys\.oauthGrantId\)/`. The doc comment added
to `rotateApiKey` here mentions `listApiKeys` by name, so the regex anchored
inside that comment and ran forward to `rotateApiKey`'s own
`isNull(apiKeys.oauthGrantId)`. A comment about one function satisfied an
assertion about another, and the check passed with the filter it protects
deleted. It now reads the stripped source, bounded to the `listApiKeys` body.

Three assertions in this change were wrong when first written and all three
were caught by mutation or by the guard rather than by review.

### 2026-08-30 (the rail was live and invisible)

`POST /api/x402/buy` has sold credits for USDC on Base with no account since it
shipped. It was in no discovery index. A discovery index lists only what
declares itself, and this route's 402 carried no `extensions.bazaar` block, so
walletlink was absent from all 14,344 resources in Coinbase's index and from
payai's own, checked directly against both.

The shape was read off live indexed resources rather than from a docs page,
which turned out to matter: the block has a `schema` sibling alongside `info`,
and a description mentioning only `info` is incomplete. It is not in the SDK
either. `extensions` is typed `Record<string, unknown>`, so the contract belongs
to the index and there is nothing to typecheck against.

The input declaration carries the load here. This endpoint reads no request
body: the signed payment travels in the `PAYMENT-SIGNATURE` header, and an agent
that posts a payload gets nothing for it. The declared JSON Schema names that
header as the only required input, so the difference between a resource an agent
can find and one it can use is written down.

`resource.tags` is also set. It is the only field a discovery index can filter
on: a scan of the live index found freeform tags and no category taxonomy at
all across 14,344 resources.

Bugbot caught a defect that would have made the whole change a no-op, and it
was right. The `schema` block describes `info` itself and closes `input` with
`additionalProperties: false`, so a validating facilitator drops any resource
whose `info.input` carries a key the schema does not list. The first version
listed `method` and a `headers` property that was not even in `info.input`,
while the emitted input carried `type`, `bodyType` and `body`. It would have
failed validation and stayed unindexed: exactly the outcome this change exists
to prevent, with nothing local failing.

Corrected against a live indexed POST resource rather than from intuition. Its
`schema.properties.input` lists the same four keys as its `info.input`, marks
all four required, and only `input` is closed. The `output` half was wrong in
the same way, describing the endpoint's payload instead of `info.output`.

Verified the way a facilitator would: the 402 was captured from a built server,
and `info` was validated against its own `schema` with a real Draft 2020-12
validator. It passes, and the schema itself is a valid schema.

Six assertions now. The one that would have caught this compares the key list
in `info.input` against the key list the schema declares; dropping `bodyType`
from the schema fails it. The other one worth having guards argument position:
`createPaymentRequiredResponse(requirements, resourceInfo, error?, extensions?)`
puts the block fourth, and passed third it lands in `error` and is rendered to
the buyer as a failure string instead of being indexed, with nothing erroring.
Moving it to the error slot fails that assertion; dropping the schema sibling
fails two more.

Verified on the wire rather than in the source: a real 402 from a built server
decodes to `x402Version: 2`, `resource.tags` set, `extensions.bazaar` carrying
both `info` and `schema`, and `accepts` unchanged at `eip155:8453` / `exact` /
`1000000`.

No facilitator change. Pointing `X402_FACILITATOR_URL` at Coinbase's facilitator
by env var alone still takes the rail down, for the reasons recorded in
`lib/x402.ts`. Indexing needs the declaration, and the declaration is
independent of who settles.

### 2026-08-30 (the privacy page now describes what actually happens)

`app/privacy/page.tsx` promised people who never used walletlink that we would
"remove it and suppress it from being re-collected". Neither half was
implemented. There is no removal endpoint and no suppression list, and the only
opt-out in the schema is `email_opt_out`, which governs mail.

A design pass produced a database trigger that would enforce suppression on
every write path, and two adversarial reviews then established that shipping it
alone would have made the promise **more** false, not less. The trigger is a
storage guard; the sentence describes collection. Today a lookup of a suppressed
wallet finds no graph row and no cache row, so `lib/job-processor.ts` runs the
full external pipeline, the resolvers answer, and the handle lands in
`lookup_jobs.partial_results`, in `lookup_history.results` and on the customer's
screen before the write to `social_graph` is silently dropped. Worse, the guard
also blocks `upsertNegativeWallets`, which is what records "checked, nothing
here" and stops us asking again for 30 days. Suppressing a wallet would have
taken re-collection from monthly to once per lookup: a person asks to be left
alone and gets queried more often.

So the promise is corrected rather than the code, for now. The page keeps the
generous part, which is that we do not ask for proof of ownership, and adds
three things it did not say:

- Name every identifier you want gone, because we deliberately keep nothing
  that would let us work out which wallets and handles belong to one person, so
  we cannot find the others for you. That limitation is a consequence of a
  privacy choice, and the page now says so rather than implying a lookup we do
  not have.
- Removal is by hand and can undo itself when a later sweep finds the same
  public record. Write again and we will remove it again. That is worse than
  the old sentence claimed and better than pretending otherwise.
- Two things are permanently beyond reach: a customer's exported copy, because
  usage is recorded against the endpoint and never the address so we do not
  know who to tell, and a search engine's cache.

The removal system itself is deliberately not in this change. It needs a
pre-flight filter in the job processor, an admin removal endpoint, the trigger,
a coverage assertion over the schema, a JSONB amend across saved lookups and a
retention policy, and it should not land a row trigger on roughly 4M writes two
days before the full Farcaster sweep restarts.

Separately, the public docs published a real named person's assembled identity
as the canonical example: wallet, ENS name, X handle, Farcaster username, FID
and a reachability timestamp, across 8 files and 68 places. Replaced with a
synthetic identity. Three prose mentions are kept on purpose, because naming a
well-known ENS name in a format hint or an ethers.js snippet is not the same act
as publishing somebody's assembled identity as our own output.

### 2026-08-30 (the evidence stopped travelling with the account)

walletlink's central claim is that every match carries the class of evidence
behind it. `POST /v1/batch` returned a Farcaster account with no `verified`
field, so on the route that resolves the most addresses, the claim was missing.

The MCP layer had already noticed and handled it honestly: it reported
`attested: null` on every batch result rather than guessing, with a comment
saying the field is "absent on a many-address request". That comment described a
bug, not a design. Twitter had exactly the same bug and was fixed on its own,
and the comment beside that fix says "One builder is how that stops happening";
the builder never arrived for Farcaster.

`/v1/batch` now selects `farcasterVerified` and returns it, matching the three
routes that always did. The MCP null branch stays, because it is the difference
between "not attested" and "not reported", and collapsing those would turn a gap
in our own response into a claim about a person.

Eight assertions, one pair per v1 route, checked by mutation: reverting either
half of the batch fix fails one. They match inside the Farcaster object
specifically, so a `verified` belonging to twitter cannot satisfy them.

`docs-site` carried this as documented behaviour in two places, both now
corrected. `api-reference/batch.mdx` listed "No `verified` flag inside
`farcaster`" among three deliberate omissions; it is two now. `openapi.yaml` had
a whole schema, `FarcasterAccountBrief`, whose description said it "omits
`verified`. The other three endpoints include it. This is an inconsistency in
the API, recorded here rather than smoothed over." Honest, and no longer true:
the batch record now references `FarcasterAccount` and the brief schema is
deleted. Spec revalidated.

Also, smaller and less certain than it first looked. The `live` reachability
detail read "The owner attested this account, and it still reaches them." A
review flagged that as overclaiming against our own rule that reachable means
the account still exists. Checked, and the complaint was mostly wrong: the four
states are a deliverability set by design, where `suspended` says messages will
not arrive and `reassigned` says they would reach a stranger, so `live` carrying
a deliverability sense is coherent. There was still a real precision gain, so it
now reads "the same account still holds the handle", which is what is actually
checked. Deliverability was always inferred from that.

### 2026-08-30 (the disclosed AI Search endpoint is now inert)

The generated `ns-….search.ai.cloudflare.com` hostname had been committed to
this public repo. Confirmed live before changing anything: a single
unauthenticated POST to it, with no `Origin` header, returned 200 and real
indexed content. The bypass was real.

Rotation turned out to be impossible. Cloudflare generates the public endpoint
identifier the first time the endpoint is enabled and never rotates it, and
disabling the endpoint keeps it, so re-enabling reuses the same URL. A new
hostname meant a new namespace, two rebuilt instances, a full reindex and a DNS
repoint.

`default_domain_enabled` is now `false` instead. The generated hostname answers
404 with error 60018 on both `/search` and `/mcp`; `help.walletlink.social`
still answers 200 and the widget bundle still loads. No DNS change was needed,
because AI Search routes on the hostname the client requested rather than on the
CNAME target. Nothing in the repo referenced the generated host:
`components/DocsChat.tsx:19` has always pointed at the custom domain.

Two corrections to `docs/AI-SEARCH.md`, both of which had made the exposure
sound different from what it was:

- It said the zone was "the only place that spend can be bounded". The namespace
  carries its own `rate_limit`, 20 requests per 60 seconds sliding, applied by
  AI Search. The generated hostname was rate-limited while it was reachable;
  what it skipped was the zone, not every limit.
- `authorized_hosts` is not authentication. It listed three walletlink
  hostnames throughout, and the probe with no `Origin` still returned 200.

One footgun is now written down where it will be read: `public_endpoint_params`
is replaced in full on every update, and `default_domain_enabled` defaults to
`true`, so a later partial PUT silently reopens the generated hostname with
nothing failing and no deploy to review. There is no CI guard, because the state
lives in Cloudflare rather than in this repo.

### 2026-08-30 (the first move on AI search)

An AI-search research pass produced a list of sub-hour changes, each with a
binary check. Two of its recommendations changed under review, and both changes
are the interesting part of this.

**robots.ts: the named answer-engine groups were dropped, not added.** The
proposal was to name OAI-SearchBot, ChatGPT-User, PerplexityBot, ClaudeBot and
Claude-User so the decision was on the record. But a crawler obeys exactly one
group, and once it matches its own it never consults the wildcard group (RFC
9309 section 2.2.1). So a named group that does not repeat both lists verbatim
does not record a decision, it grants that engine `/api/` and `/_next/`, with
nothing anywhere erroring. Measured against a real spec parser, a named group
carrying the same two lists resolves identically to the wildcard group for every
bot, so the whole construct was ten extra lines and one silent-failure mode for
no behavioural change. The rosters rot too: OpenAI documents four tokens and
Anthropic three, and the proposal named five of eight. The decision is now
recorded in a comment, where it cannot open a path.

What did ship from that file is the one load-bearing line: `/api/public-stats`
is allowed. It is keyless, holds no customer data, and is the live source for
the index figure the homepage renders over its static fallback, so a crawler
running the page's JavaScript now reads the figure instead of recording a
blocked resource. It beats `Disallow: /api/` by longest match, 17 octets against 5. Verified with a spec parser across 12 bots and 14 paths, 168 cells, zero
violations: `/api/public-stats` is the only cell that changed.

**The MCP handshake reported version 1.0.0** while the public registry had moved
to 1.2.0 twice over, so the server and its listing disagreed in public with
nothing to catch it. It now reads `server.json`, the same file `mcp-publisher`
publishes. An import, not a `readFileSync`: the bundler inlines it, whereas a
read would depend on file tracing pulling a repo-root file into the function
bundle, and the trace does not include it. `title` was deliberately not wired:
`server.json`'s title is byte-identical to the name, and `mcp-handler` types
`serverInfo` as `{ name, version }`, so it only compiles behind an indirection
whose purpose is invisible.

**`initialize` now returns `instructions`**, 196 words, which it previously
omitted entirely. That string is the only text a model reads before choosing a
tool, so it carries what no single tool description can: what is in scope, where
the links come from, that billing is per address rather than per identity, that
an address resolving only to an ENS name or a GitHub account is free, and which
direction is expensive. The provenance paragraph is not decoration: a
handle-to-wallet lookup with no stated source reads as a deanonymiser, and this
is the first text a directory reviewer sees. The batch ceiling and the free
allowance are interpolated from constants; the 100-wallet reverse page is
written out, because `MAX_RESULTS` is module-local and is a different number
that merely equals the allowance today.

**Dates.** Six comparison pages stamped `dateModified` with `new Date()` at
build, so every deploy told crawlers the page changed that day. Following the
precedent the blog and the sitemap already set, the field is omitted rather than
fabricated. Four `datePublished` values were wrong: addressable and blaze said
`2025-01-01`, which predates the first commit in this repo by 377 days, and
airstack and holder were each a day early. cookie3 and formo were already
correct and were left alone. One live wrong blog date was found and fixed:
`content/published/farcaster-integration.md` said `2025-01-15` while the file
entered the repo on 2026-02-21, and that value was being served in the post's
JSON-LD and as its sitemap `lastmod`.

**The blended coverage rate is gone from the FAQ.** `app/layout.tsx` published
"30.8% across all three" in a site-wide FAQPage, against a house rule that the
chain decides the rate. The figure checker was indifferent either way, so
precedent decided: llms.txt, the README and all five comparison pages already
publish the chain rows with the instruction instead. Qualifying the number would
have left it inside an extractable unit where a truncated snippet keeps the
figure and drops the caveat; removing it has no such failure mode.

**LICENSE: AGPL-3.0.** The repo was public with no licence, which means all
rights reserved: readable, which is the point, but not reusable, and rejected by
some directories. AGPL keeps the hosted service unaffected while obliging anyone
running a modified copy as a service to publish their changes.

**The x402 facilitator was probed, not switched.** The finding is recorded in
`lib/x402.ts`: pointing `X402_FACILITATOR_URL` at Coinbase's CDP facilitator by
env var alone takes the rail down rather than listing it, because CDP answers
401 unauthenticated and `initialize()` calls `getSupported()` on first use.

Five assertions added, verified by mutation: reverting the version to a literal
fails two, nesting `instructions` inside `serverInfo` (which typechecks and is
then silently dropped) fails one, and reintroducing a blended rate fails one.

Not in this PR, and worth knowing. `Disallow: /_next/` blocks the CSS and JS
chunks and the image optimiser, so a rendering crawler sees this site unstyled.
That is pre-existing and Google's guidance is not to block render resources.

### 2026-08-30 (a public file documented the bypass next to the defence)

`docs/AI-SEARCH.md` carried four Cloudflare identifiers in its Resources table:
the account, the zone, the rate-limit ruleset, and the raw AI Search namespace
endpoint. This repo is public.

The endpoint is the one that mattered, and the same page explains why. The
public endpoint is unauthenticated by design and spends Workers AI neurons on
every answer, so the zone is the only place that spend can be bounded, which is
the entire reason the `help.` CNAME is proxied rather than DNS-only. A proxied
CNAME hides the origin from DNS, so that hostname was secret in practice and
this file was the only thing disclosing it. Anyone reading it could call the
origin directly and never touch the rate limit.

The document itself stays. It passes the test in `docs/README.md`: it explains
an assistant anyone can already interrogate, and every word of the reasoning is
still on the page. The identifiers fail that test, verify nothing about the
data, and moved to the private walletlink-ops repo.

**They are disclosed, not removed.** They were committed to a public repo, so
this changes the current tree and nothing else. Rotating the namespace is the
only action that revokes the bypass; the account and zone identifiers cannot be
rotated and were always the lower risk.

`docs/README.md` now records that the public/private test applies per fact, not
per file, because a document can be correctly public and still carry a line that
is not. Two assertions in `scripts/check-invariants.ts` enforce it: no tracked
file may publish a namespace endpoint, and none may tabulate a bare 32-hex
Cloudflare id under an Account, Zone or ruleset label. Both match on shape and
never on a value, because writing the identifier into the checker in order to
detect the identifier would republish it in a file nobody would think to search.
The table-shaped regex is deliberately narrow: a blanket 32-hex scan
false-positives on the keccak hashes already in that file.

### 2026-08-30 (the sitemap was frozen and /vs was a 404)

Search Console produced its first read, and it is small: 4 clicks and 379
impressions over the three months to 2026-08-28, average position 50.1, across
17 queries. Three faults in the plumbing explain part of it, and all three are
fixed here.

**`app/sitemap.ts` froze at build.** It is an async function with no
`revalidate`, so Next prerendered it once and never again: production served
106 URLs whose every `lastmod` was one of two build timestamps 10ms apart, and
the daily seed cron added collections that could not appear until somebody
redeployed. It now revalidates hourly, on the same cadence as the pages it
lists.

**Every `lastmod` was `new Date()`**, which stamps the render time on pages that
have not changed. Now a blog post carries its publish date, a holder report
carries `max(last_seen_at)` for its holder set (`ListedHolderCollection` grew a
`lastSeenAt` field and the query finally joins the `latest` CTE it already
computed), a hub carries the newest date among its children, and the static
marketing pages carry nothing at all, because nothing records when they last
changed. Google's guidance is to omit the field rather than supply a date the
content does not support. The built sitemap went from 2 distinct dates across
106 URLs to 110 across 123.

**`/vs` returned 404.** Six comparison pages, 806 to 1,533 words each, sat under
a path with no hub, so they had no crawl entry point and no reader could reach
one from another. There is now a hub, split by whether the vendor still exists,
carrying `ItemList` JSON-LD and listed in `app/llms.txt` and the sitemap. It
restates no claim from the pages it links, so it cannot drift away from them.

Two smaller things:

- `/admin` and `/success` were index-eligible. Both are client components, so
  the `noindex` had to go in a new `layout.tsx` for each. Deliberately not a
  robots.txt `Disallow`: a disallowed URL can still be indexed from a link, and
  Google cannot read a `noindex` on a page it may not fetch.
- `getHolderOverlap` had no floor on `sharedHolders`, so a report could publish
  a counterparty it shared 1 or 2 holders with. Holder lists are free from any
  explorer, which makes a small published intersection invertible: two lists and
  one count name the wallets. `OVERLAP_MIN_SHARED = 20` applies the same
  k-anonymity floor the listing rule already uses. Counterparties still named
  `Unknown Token` are dropped too; `sc.name IS NOT NULL` let the placeholder
  through. That floor is a claim about an attacker, so it is asserted in
  `scripts/check-invariants.ts` rather than trusted: four assertions, checked by
  deleting the `HAVING`, lowering the constant to 1 and dropping the name
  filter, each of which fails the run.

The sitemap had also never been submitted in Search Console (the Sitemaps report
read 0 of 0, and URL Inspection named `/pricing` as how it found `/holders`).
Submitted on 2026-08-30.

### 2026-08-27 (the check-in runs itself)

The daily run is a cron: `/api/cron/checkin-nonbuyers`, 16:00 UTC, five per
variant. An hour after the welcome sequence, so an account due both gets them an
hour apart rather than in the same second.

Selection and copy moved to `lib/checkin-campaign.ts`, and the script became a
front end for a dry run, a preview and a manual push. A second copy of either in
the CLI is how a campaign ends up sending two different emails depending on who
pressed it, and only one of them is the reviewed one.

**The pause switch is a row, not an environment variable.** An env var takes
effect on the next deployment, so stopping an outbound campaign with one means
waiting for a build while it keeps sending. `isPaused()` reads `ingest_state`,
checked before anybody is selected, so one UPDATE halts the next run. It fails
closed: a read error returns paused, because a switch whose failure means "carry
on" is not a switch. Verified by pausing, watching a `--send` refuse, and
resuming.

Running beside the welcome sequence is deliberate, Jake's call: a plain note
from a person is a different kind of mail from the branded sequence and the two
can interleave. The one collision that would have mattered was already closed,
since accepting the free pack gives the account credits and welcome-5 stands
down for credit holders.

358 invariants, 147 guard mutations.

### 2026-08-27 (the check-in drips, five a variant a day)

`scripts/checkin-nonbuyers.ts` takes `--per-variant`, defaulting to 5, and the
cap is per variant rather than per run.

`--limit` bounded the whole run and took its rows in signup order, so on a mixed
set it spent the entire day's quota on whichever variant held the oldest
accounts. `has-credits` is 94 of the 133, so a shared cap of five would have
sent nothing to the other two arms for eighteen days. Each arm gets its own
five, so all three start on day one and the batch that finishes first stops.

The `lifecycle_emails` ledger is what makes the drip resumable: an account
already written to is not selected again, so running this once a day walks the
queue holding no state of its own.

**Day one went out on 2026-08-27**: 12 sent, 0 failed. `used-credits` completed
in that run, both of them. 89 `has-credits` and 32 `no-credits` remain.

### 2026-08-27 (a check-in that read the account first)

A personal check-in to every account that signed in and never bought, plus the
onboarding bug the campaign would have walked into.

**The obvious version of this email was wrong, and the data said so.** Offering
a free Trial pack to every non-buyer would have offered a $29 pack to **96
people who were given one on 2026-08-23 and have not touched it**: of 25,000
granted matches, 3 were consumed, across 2 accounts. Offering somebody a gift
they are already sitting on is the one thing a message opening "I wanted to
personally check in" cannot survive, because it proves nobody looked.

So `scripts/checkin-nonbuyers.ts` splits on what the account already holds:

- **has-credits** (94): holds an untouched granted pack. No offer. The unused
  pack is the reason for writing, and the question is what got in the way.
- **used-credits** (2): has actually spent some of it, so they are the only
  people with an experience to report and the email asks about that.
- **no-credits** (37): holds nothing. The offer stands.

The first draft of that split keyed the offer on `consumed = 0`, which routed a
partly-spent grant into the offer arm and reintroduced the exact failure the
split exists to prevent, for two accounts.

**`sendPlainEmail`** sends these as text from a person, not inside the campaign
template: a note asking "let me know" that arrives as branded HTML from
`noreply@` answers its own question before it is read. Plain is not exempt from
any lifecycle rule, so it refuses without the unsubscribe secret and still sets
the one-click `List-Unsubscribe` headers. Every send is bcc'd for the archive,
because a script's mail exists in nobody's Sent folder.

**A gifted pack silently ended the welcome sequence.** Eligibility excluded any
account holding **any** credit lot, so gifting credits stopped onboarding with
nothing failing and no diff. It had cost nobody an email only by luck: all 100
granted accounts predate `SEQUENCE_START`. "Bought" is now `amount_cents > 0`,
the same test `getUserCohorts` uses. The sales email still stands down for
anyone holding credits, for its own reason: a live lot makes `hasPaidAccess`
true, so welcome-5's ask names features that are already open to the reader.
That is a copy problem, so it is applied to that one email rather than to the
sequence.

344 invariants, 141 guard mutations.

### 2026-08-27 (we held the evidence and answered "no wallets")

Some wallet owners have attested two live X accounts through different sources.
The row showed the second one, the CSV exported it, the public API served it as
`twitter.also`, the docs described it, and reverse lookup then answered "no
wallets" when somebody searched for it. Both reverse doors matched
`social_graph.twitter_handle` and nothing else.

- **Both reverse routes now match the second attested account.** A wallet
  matched this way carries a different handle in `twitter.handle` and names the
  searched one under `twitter.also`, so the answer corroborates itself.
- **The gate is the display's gate, not a second one.** Reverse and
  `alsoOnXForWallets` read the same `FROM` clause and the same source
  allowlist, because a wallet returned for a handle its own row does not show
  is worse than the gap it fixes.
- **`MAPPED_SOURCE_IDS` is derived from `SOURCE_CLASSES`**, so the allowlist and
  its enforcement cannot drift into two lists.

**The obvious implementation was unusable, and only a query plan said so.** An
`OR EXISTS (...)` bolted onto the route's `WHERE` reads perfectly and defeats
the index on `twitter_handle`: Postgres sequentially scans all 5,117,875 graph
rows and runs the subplan once per row. **19.7 seconds to return two wallets.**
`handle_conflicts` holds 3,680 rows in total, so resolving the wallets first and
matching them by primary key costs **42ms**, and the cost is set by the conflict
table rather than by the graph. Where a handle has no second-account claim,
which is nearly all of them, the predicate is the one that ran before.

**The first draft also broke a disclosure rule the file states in its own
header.** `/api/reverse` publishes the count to callers with no credits and
withholds the addresses, and the header is explicit that the address query "must
not run for them at all". Building the free count from a resolved wallet list
did exactly the work that forbids, one `console.log` from disclosure. The free
path now counts and the paid path lists, over one `FROM` clause, and the
invariant asserts the order of the two calls around the gate.

**Conflicts nobody can ever act on are now closed.** A conflict where both
handles are dead cannot be accepted (acceptance needs theirs live) and cannot
surface as a second account (that needs both live). It was inert: re-examined by
every run forever, counted in every queue total forever, unable to change any
answer. `closeBothDead` closes them under a distinct resolution, and only on
fresh readings of both sides, because two dead readings from six weeks ago are
not evidence that both are dead now.

Also: the conflict resolver's recheck budget was a fixed 300 credits a day, 14
lookups, against a sibling sweep allowed 96,724 by a formula derived from the
live balance. The backlog of 539 rechecks was cleared by hand (151 conflicts
resolved on 150 wallets, 14,796 credits) and `CONFLICT_RECHECK_CREDITS` is set
in production. 328 invariants, 133 guard mutations.

### 2026-08-26 (the funnel counted events and called them people)

The admin panel had thirteen destinations and four pairs of them answered the
same question in two places, with different numbers. Two of those numbers were
funnels. Underneath, three events had been declared since January and emitted by
nothing, and a fourth was written on every gate and read by nobody.

**The panel: thirteen tabs to nine.**

| was                      | is       | why                                                  |
| ------------------------ | -------- | ---------------------------------------------------- |
| Behavior + Revenue       | Funnel   | both drew a funnel, over different windows and bases |
| Behavior (rest) + Growth | Growth   | cohorts, retention and adoption are one question     |
| Lookups + Usage          | Usage    | both counted lookups and wallets by period           |
| Jobs + Saved lookups     | Records  | two lists of the same runs                           |
| Users + Whitelist        | Accounts | a whitelist grant is an entitlement on an account    |
| Enrichment + Conflicts   | Data     | both are social-graph quality work                   |

**The funnel is now a funnel.** `getSessionFunnel` counts distinct sessions that
reached each step, so a ratio between two steps is a ratio between two groups of
people. The old one grouped events by type, where one visitor opening the
pricing modal six times was six. Both are shown, stacked and labelled, because
the event counts remain the right answer for load and for the paywall work.

- The money tail is forced monotone. The buy-credits modal is the only way into
  a Stripe checkout, so a session that started one did see the pricing whether or
  not the beacon arrived. The steps above it are reported as measured, which is
  why "saw pricing" can exceed "got results": pricing is reachable from the
  marketing pages without running anything.
- "Paid" is joined by account email, because the Stripe webhook has no session,
  and it requires the session to have reached checkout as well. Without that
  second test it read 20 paid sessions against a single payment, because one
  buyer had visited twenty times.

**Three events existed and fired from nowhere.**

- `user_registered`, declared in January, emitted by nothing. The funnel had no
  account step at all, past the gate the whole free allowance is built around.
  It now fires in `getOrCreateUser`, inside the create branch only.
- `history_saved`, same. "History save rate" on the panel was a structural 0%
  for seven months. Saving is a checkbox the user sets, so it is a real
  behaviour; both pipelines now emit it from the point the save succeeded.
- `limit_hit` was written on every free-allowance refusal and read by nothing,
  while a cohort labelled "3+ lookups, hit limit, didn't pay" tested only the
  lookup count. The label had been claiming a test the code never made. It is
  now its own cohort, driven by the event.

**Two conversion rates, named.** There were three under one word: the Pulse tile
divided payments by lookups over 7 days, the revenue pane divided payments by
pricing views over 30, and the behaviour funnel divided everything by page views.
The tile linked to the pane, so the one journey a reader was invited to take
crossed two definitions in silence. `conversionRates` is now the only definition
of either, and both return `null` rather than 0 when there is nothing to divide
by.

**A raw-SQL window bound was five hours short.** Interpolating a JS `Date` into a
`sql` template sends a local-offset string, and these columns are `timestamp
without time zone` holding UTC, so Postgres kept the wall-clock half and dropped
the offset. Measured over 30 days on 2026-08-26: the query builder counted 3,739
events, the same window in raw SQL counted 3,645. The missing 94 were that whole
day. Production runs in UTC and never saw it, which is why it survived, and why
it made every local reading of these queries lie.

Also: `getFeatureAdoption` selected every event row in the window and filtered
eight times in Node, and applied the cron-heartbeat filter to two of those
filters but not the third; it is one aggregate query now. Contract imports carry
a session id, so that gate can be placed in a visit. Payments are split by rail,
since an onchain sale reaches the last step of the funnel having skipped the
three above it. 310 invariants, 26 guard mutations.

### 2026-08-26 (the index write was losing wallets quietly)

Two defects on the one path that persists what a lookup found. Both were
recorded against real jobs in `lookup_jobs.social_graph_write_errors`, and 7 of
the 77 jobs in the last fortnight ended with `social_graph_write_status =
'failed'`. Neither is visible from the outside: the lookup completes, the user
gets their results, and the index simply does not gain the row.

- **`source` was taken on trust at the write boundary.** The field is typed
  `string[]`, and that type is a claim about data we did not create: our own CSV
  export writes it comma-joined, so a customer re-uploading an export sends a
  string back. `asSourceList` already existed for exactly this and was applied
  on the resume path and both display paths; the write path, the one that
  persists, was the one that never got it. It now normalises once, at the top,
  before anything reads the field.
- **It failed two ways on the same input, and the loud one was the lucky one.**
  `isTwitterVerified(r.source ?? [])` threw `.some is not a function` and killed
  the batch. `mergeSources` took the same value and spread a string into single
  characters, storing a provenance list of `['w','e','b','3',…]` with nothing
  raised. `?? []` was never the right guard: it defends against null, and null
  was not the shape that occurs.
- **`db.transaction()` was called unconditionally**, and `neon-http` answers
  that with a throw at call time rather than at build time. So the entire index
  write depended on `USE_CONNECTION_POOLING=true` being set. Production sets it
  and was unaffected; every other environment failed every write, and
  `.env.example` never mentioned the variable. `db/index.ts` now exports
  `supportsTransactions()` next to the driver choice, so the capability cannot
  drift from the driver, and the write degrades to sequential statements rather
  than throwing.
- **Losing atomicity here is the right trade, which is worth stating.** Every
  statement on this path is idempotent: the upsert is `onConflictDoUpdate` keyed
  on the wallet, and the history rows are append-only. An interrupted run leaves
  a prefix written, which the next lookup of those wallets re-derives. A throw
  leaves nothing written and costs the whole batch to the same interruption.
- **Both were classified as transient and retried three times**, at one and two
  seconds of backoff, on writes that could not have succeeded on any attempt.
  Neither message contains a word the classifier looked for. A `TypeError` is
  now permanent by definition: it is raised by this code reaching into a value
  of the wrong shape, so it is a statement about the program, not the
  connection. The driver's refusal is matched on the capability wording rather
  than on the driver's name, so it survives a driver swap.
- **The fallback had a regression of its own, caught in review.** Without a
  rollback, a retry restarted the whole batch, and the upsert is idempotent in
  every column but one: `lookup_count` is `lookup_count + 1`, so every row the
  failed attempt had already committed counted a second lookup that never
  happened. That number is not cosmetic. It promotes a row to quality `medium`
  past 3, pulls it into the hot set `refresh-stale` rebuilds past 5, and orders
  the refresh queue. The retry now carries a cursor and resumes, and the cursor
  exists only where the driver cannot roll back, since a transactional retry
  that skipped committed work would lose it (found by Bugbot, Medium).
- **The classifier's first version was worse than the bug it fixed**, and that
  was caught in review too. It made every `TypeError` permanent. Node rejects a
  network failure as `TypeError: fetch failed`, and `neon-http` issues every
  query through `fetch`, so the rule stopped retrying exactly the transient
  faults the retry exists for, on the driver it exists for. It now matches the
  shape complaint (`is not a function`, `is not iterable`, `Cannot read
properties of`) rather than the type. Measured, because the two are the same
  class and only the message tells them apart: the network one carries a
  `cause` and reads `fetch failed`; the shape one carries none and names the
  value (found by Bugbot, Medium).
- **The assertion covering that case was passing over it.** It built a plain
  `Error('fetch failed')`, which is not an instance of `TypeError`, so it never
  reached the branch under test. It now constructs the error the way Node does,
  `cause` included. The guard separately caught a mutation still anchored to
  the single-line condition that had been rewritten, and therefore protecting
  nothing.
- **A committed prefix was still reported as a total loss.** `succeeded: 0` was
  true while every attempt ran in a transaction, because a failure rolled the
  whole thing back. The resume cursor ended that, and the exhausted-retry
  return was not updated with it: a run that wrote 900 of 1,000 wallets and
  then lost the connection recorded `'failed'` and logged "persist completely
  failed", which sends anyone reading it looking for a write that did happen.
  `job-processor` already had the right `'partial'` branch and simply could not
  reach it. It now reports what committed (found by Bugbot, Medium).
- Thirteen assertions and ten mutations, 295 and 120. The classifier is asserted
  against the two real failures by value, and separately asserted **not** to
  have been widened into always-true, which is how a set of refusal assertions
  passes while protecting nothing.

Not fixed here: the 7 jobs whose writes failed. Their wallets are all in the
graph today, arriving by another path, so there is nothing to replay.

### 2026-08-26 (somewhere to go, and copy that matches the gates)

Two changes that share one shape: the product had already opened a door and had
not told anyone, or was charging for a door that was never shut.

**A first action that needs nothing.**

- Every way into this product asked the visitor to bring a CSV, a contract
  address or a handle, and a signed-in account with no history saw nothing at
  all: `LookupHistory` renders `null` at zero rows. Fifteen of 139 accounts have
  ever run a saved lookup. The homepage now offers three of our own seeded
  collections (`lib/starter-collections.ts`, `components/StarterCollections.tsx`,
  `GET /api/starter-collections`), and a press runs 25 of one's holders.
- **What it saves is the import, not the resolution.** The holder lists are
  already in `wallet_holdings`, so nobody uploads one and nobody pays for a
  contract import. The wallets are then resolved like any other list: the seed
  cron writes the holdings whether or not it had the budget to resolve them, and
  a mean of 71 wallets in a 100-wallet sample have never been checked. A first
  draft of this said the run "costs no external API call at all", which is the
  confident-and-unchecked shape the invariants file exists for.
- **`POST /api/jobs` takes `{ collection }` in place of `{ wallets }`**, expanded
  at the top of the handler so the IP limit, `canSubmit`, the per-lookup ceiling,
  the credit meter and the analytics all see an ordinary lookup. No new gate, no
  separate allowance, no way in that skips the meter. `input_source` is
  `starter_collection`, set server-side, so the funnel can tell the action that
  needed nothing from the one that needed a contract.
- **A collection that is not seeded is refused before a wallet is read.** Without
  that this is an unmetered import of anybody's holders, on any chain, at our
  expense.
- **Capped at a quarter of the free allowance.** The cap is the worst case,
  because every wallet in a sample might match, and the panel offers the MOST
  reachable collections it can find, which is the opposite end of the
  distribution `MEASURED_MATCH_RATE` describes. Measured, the three cards resolve
  85, 25 and 35 of their first 100 wallets, so a 100-wallet cap would have spent
  85 of the 100 free matches on one press.
- **The holder report's CTA carries its collection**, and no longer offers
  "paste any contract address", which is credit-gated.
- **The route no longer answers when it fails.** It caught a database error and
  returned an empty list with a 200; the response is the cache entry, so one
  transient error was stored as a successful empty answer and the cards stayed
  hidden for an hour. It throws now, like `/holders` and its
  `generateStaticParams`, which read the same corpus (found by Bugbot, Medium).

**The lifecycle copy, reconciled with the gate it sells.**

- The reverse-lookup gate moved on 2026-08-25 (#191) and nothing reread the copy
  underneath it. **welcome-4**, first send 1 September, sold reverse lookup and
  priority ranking, both credit-gated, under a button reading "Run a free
  lookup". It now sells the split the product ships: free tells you how many
  wallets carry a handle, credits tell you which ones, under a CTA a free account
  can press. Nothing had gone out under the old text.
- **welcome-1's first instruction was the one thing the reader could not do.** It
  opened with "Paste a contract address"; contract import is credit-gated.
- **welcome-5 reads `PACKS[PACK_IDS[0]]`** instead of naming Trial by hand. Trial
  is the entry rung today by coincidence, not by construction: it is the first
  key, not the named one, and a cheaper rung underneath would leave the only
  sales email in the sequence selling the second one.
- `docs/EMAIL-SEQUENCE.md` matches the code again, and gains the rule that
  produced this: **a gate change is a copy change**.

**Nine surfaces were selling things that are free.**

- `ExportButton` branches only the X list on `entitled`; the CSV button has no
  gate at all, and `stampReachability` writes X reachability for every result
  set. Both were listed as pack features in the buy-credits modal, in
  `PackPricing` on `/pricing` and six comparison pages, in the schema.org FAQ
  answer that ships in every page's head, in `/llms.txt`, in the published docs,
  in `PROJECT_OVERVIEW.md` and in two lifecycle emails. It is welcome-4's defect
  pointing the other way: copy written from what the product was assumed to
  charge for instead of from the gate.
- **The line is on the fields, not the file.** `job-processor` sets
  `priority_score` and `fc_followers` to undefined whenever `paidData` is false,
  so those two columns are blank in a free CSV as well as locked in the table. A
  first pass at the docs fix asserted the opposite, from reading the export code
  without reading the processor that fills it.

**Guards.**

- Fourteen assertions and eleven mutations, 282 and 110. Four of the mutations hold
  the pack ladder (per-match price only ever falls, `PACK_IDS[0]` really is the
  cheapest, the ascending finder cannot recommend too large a pack, no two packs
  share a Stripe price variable), one holds the sales email to the entry rung,
  and the rest hold the starter path.
- **Three of the new assertions could pass over the thing they protect**, and
  each was found by writing the mutation rather than by reading the assertion.
  Two used a bare `indexOf`, which answers -1 for an identifier that is not there
  at all, so a deleted gate sorted before everything and satisfied both. The
  third asserted that `getHolderCollection(` precedes `wallet_holdings`, which
  stays true when the lookup is kept for its name and only `if (!collection)
return null;` is deleted: that compiles under `collection?.` and expands any
  contract on any chain. The refusal is the middle term now.
- **`scripts/check-invariants-guard.ts` does not survive being killed.** It
  restores each mutation in a `finally`, which SIGTERM skips, so a run cancelled
  at a timeout left a real defect (#189, uploaded CSV columns overwriting
  pipeline fields) sitting in the working tree. It takes over two minutes: let it
  finish, and do not run it while anything else is editing the files it mutates.

### 2026-08-25 (three blind spots, closed)

- **`/api/reverse` now emits an event.** The app's reverse lookup, the primary
  action on the page that receives 91% of traffic, wrote no analytics at all, so
  an engaged visitor and a bounce were the same row. It is fired from the client
  so the event carries a session id, which the server-side lookup events do not,
  and it records `locked` so the free half of the endpoint can be told apart
  from the paid one.
- **`users.acquisition` holds where an account came from.** It is written on
  insert only: first touch, not last. An update on an existing user would rewrite the acquisition
  source at every login and the column would converge on whatever people last
  clicked.
- **Not `users.origin`.** That column says which rail minted the row, and
  `getBalance` reads `'x402'` there to withhold the free allowance. A query
  showing 139 nulls in 139 rows made it look unused; unused and unpopulated are
  different facts, and the schema comment said which one it was. Sharing the
  column would have let a posted `origin: "x402"` mint a magic-link account that
  silently never receives its 100 free matches (found by Bugbot, High).
- **The attribution travels with the magic link token**
  (`magic_link_tokens.acquisition`,
  `scripts/migrate-first-touch.ts`). The browser that knows the first touch is
  the one that typed the email; the browser that creates the user row is
  whichever opens the mail, routinely a webmail preview or a link scanner.
  Reading it at verify time would have credited a share of every campaign to
  Gmail, which is worse than null because it looks like data.
- **First touch is captured once per browser** (`lib/first-touch.ts`): the
  referring host, `?ref=`, and the three UTM parameters, reduced to one
  groupable string. Stored in `localStorage`, never overwritten.
- **The referring host, never the referring URL.** Other sites put search terms,
  private document paths and their own session tokens in the addresses they link
  from. `referrerHost` reads `hostname` and discards everything else, and the
  invariants push URLs carrying a reset token and a search query through it. A
  self-referral returns null, or the site becomes its own biggest traffic source
  within a day.
- **The privacy policy says so**, because a referring domain and a campaign tag
  are not covered by "page views and product events".
- 69 assertions and 10 mutations, 233 and 82. One of them strips comments
  before reading source, because the assertion that the signup path never writes
  `users.origin` matched the comment explaining why it must not. The guard caught one of the new
  assertions passing while the code it protected was deleted: the "absurd query
  cannot produce an unbounded origin" case used a 300-character host, which
  fails the hostname check and drops out, so the total never approached the
  bound. The input is now long and valid, and a second assertion proves the
  unclamped string really would exceed it.

### 2026-08-25 (the slow source gets a ceiling)

- **The per-request timeout is 6s, down from 15s.** A wallet that has not
  answered in six seconds is not going to: across 208 healthy batches the
  slowest wave of 100 took 2.79s, so six is more than double the worst ever
  observed. The old 15s cost nothing while the upstream was healthy and
  everything when it was not.
- **A batch now has a deadline**, `max(30s, waves × 4s)`, and returns what it
  has when the budget is spent. Measured against the worst healthy batch (83.7s
  at 2,999 wallets) and against 13 August's median of 229s, which it would have
  cut to 120s.
- **Every wallet the deadline skips is recorded as unreached**, which matters
  more than the speed. The pipeline persists a negative only when a run
  completed without API failures and then trusts it for 30 days, so a silently
  dropped wallet would write a false "checked, has nothing" that no later lookup
  would correct.
- **A truncated batch says so** rather than reporting an upstream failure. The
  two produce the same count and only one of them is a decision this code made.
- **The 14% failure rate was one day, not a rate.** 30 of the 35 failures in the
  last month happened on 13 August, when roughly half of every batch went
  unreached; since 17 August there have been three. The earlier reading averaged
  a single incident across a month and reported it as steady state.
- **The cache was the other half of it, and it was missed.** `failedWallets`
  blocks the 30-day graph negative, and an unreached wallet still fell into the
  `['none']` branch of the 7-day `wallet_cache` write: cached as "checked, has
  nothing", read by later lookups, which then skipped the APIs entirely. Same
  failure the deadline exists to prevent, on the shorter of the two TTLs, which
  is why guarding only the graph looked complete. Found by Bugbot, High.
- 15 assertions and 7 mutations, 268 and 99.

### 2026-08-25 (a lookup now belongs to a visit, and a sale is recorded)

- **`lookup_started` and `lookup_completed` carry a session.** All 1,597 of them
  had none: both are emitted server-side and nothing told the server which visit
  it was serving, so the funnel could not answer "how many arrivals ran a
  lookup", which is the most useful question about this product. The browser
  sends its session id, `/api/jobs` validates it as a UUID before use, and it is
  stored on the job (`lookup_jobs.session_id`) because the completion is emitted
  minutes later by a worker that has only the row.
- **`payment_completed` was not broken, it was on the retired path.** Its only
  emitter sat inside the legacy tier purchase, which two accounts ever made, so
  it had fired exactly once in the lifetime of the table while every credit pack
  ever sold went unrecorded. Both live rails now book the sale where the credits
  are granted, awaited rather than floating, and only on the branch that
  actually wrote, so a repeated webhook or a replayed settlement cannot book a
  second sale. A hand-issued credit is not a sale and stays silent.
- **The funnel reports sessions and engaged sessions, both.** A session is
  engaged if it did more than arrive once: two events, or one that is not a
  pageview. Measured over the last 30 days that is 201 of 1,487, 13.5%.
  Reporting only the raw count makes the product look fifteen times worse at
  converting than it is; reporting only the engaged count quietly discards
  traffic somebody paid for. It is deliberately a statement about what a session
  did, not a verdict on what it was.
- **A failed funnel query now says so.** The catch returns a fully populated
  object of zeros, so a broken query and a quiet week render identically. That
  is not hypothetical: a `db.execute` result read as an array instead of
  `{ rows }` threw, and the funnel reported zero of everything while the
  database held 1,487 sessions. The panel now shows that the numbers were
  invented rather than measured.
- 20 assertions and 7 mutations, 253 and 92. The guard caught three of the new
  assertions passing while the code they protected was deleted, and one of the
  new mutations having no teeth.

### 2026-08-25 (the gate fired before the answer)

- **The reverse lookup on the homepage now answers everybody.** A caller
  without credits gets the count of wallets carrying the handle; the addresses
  still need a pack. Previously the panel opened the pricing modal on click,
  before any request was sent, so the first thing a stranger saw after typing a
  handle was a price and nothing else.
- **The rule is not new, only newly applied.** `/api/reachability` has always
  published that count for free and keyless, and `/check` explains the split to
  the reader in those words: how many wallets carry a handle is free, which ones
  is the product. `/api/reverse` was the one surface that implemented neither
  half.
- **Signing in was never the thing that unlocked it.** The server gate is
  `hasPaidAccess`, so an account changed nothing. The endpoint no longer answers
  a missing or expired cookie with 401: anonymous is a caller, not an error, and
  it was refusing strangers a disclosure the keyless endpoint hands out freely.
- **What prompted it.** In the two days after the QR auction, 57 sessions hit
  that gate having been shown nothing, and 37 created an account trying to get
  past it. Every reverse-lookup paywall hit in the database is from those two
  days.
- **The locked branch returns before the row query runs.** Withholding the
  addresses in the response is not enough on its own: a version that read every
  wallet and then declined to print them would have the same response shape and
  hold the addresses in memory. `lib/reverse-access.ts` builds the locked body
  and cannot be handed rows at all.
- **The free branch is bounded per address**, at the same limit and for the same
  reason as `/api/reachability`: one indexed read, capped so the count cannot be
  used to enumerate the index.
- **The panel says which half is free before the button is pressed**, and links
  `/check` for the no-account version. It was reachable from nowhere on the page
  that receives most of the traffic.
- 29 assertions and 6 mutations, 193 and 69. Two mutations cover the shapes that
  hide this rather than cause it: a locked body that leaks one address as a
  taste, and a limiter that is registered but never called.

### 2026-08-25 (a CSV column that overwrote the pipeline)

- **Fixed: opening a job in Admin > Jobs could take the whole page down** with
  `source?.map is not a function`.
- **The cause was upside-down precedence.** `lib/job-processor.ts` built each
  result as `{ wallet, source: [], holdings, ...walletData }`, spreading the
  uploaded CSV columns **last**, so a column name could overwrite a field the
  pipeline owns. `source` is the one that bites: our own CSV export writes it as
  a comma-joined string, so a customer who exported results and re-uploaded that
  file replaced `string[]` with `"web3bio,neynar"`. `wallet` and `holdings` had
  the same exposure.
- **Nothing threw where it happened.** Every later stage does
  `[...existing.source, 'cache']`, and spreading a string spreads its
  characters, so that job's provenance quietly became a list of letters.
  `source.includes('neynar')` kept returning true by substring match, and
  `source.length === 1 && source[0] === 'none'` started reading a character
  count. `publicSources` iterated the string, matched no class, and returned
  `undefined`, so the evidence column silently vanished from the export. The
  admin viewer called `.map` and was the only surface loud enough to notice.
- **Measured before fixing:** 480,674 stored result rows held an array and 2
  held a string, across one job and four saved lookups.
- **Three changes.** The uploaded columns are spread first, so a column cannot
  win a collision with a computed field. `asSourceList` in `lib/api-sources.ts`
  recovers a joined string rather than discarding it, since that is the shape
  that actually occurs. Both read paths coerce, so the rows already stored
  render instead of crashing, and no customer data was rewritten to achieve it.
- **Fixed in both pipelines.** Review caught that `inngest/functions/wallet-lookup.ts`
  is a second copy with the same defect in two more object literals, and it is
  the path every upload above the inline threshold takes: the first fix landed
  in the less used branch. The assertion had agreed with it, because it named
  `lib/job-processor.ts` and checked only that. It discovers the sites now, so
  a third copy is caught the day it is written.
- **22 new invariants and 9 new guard mutations**, taking both to 141 and 52.
  The first mutation is this bug reintroduced verbatim. The guard also caught
  the replacement assertion passing by matching nothing: it read only the text
  before `source: []`, so the broken ordering, where the spread comes after,
  skipped the check entirely.

### 2026-08-25 (a post about what the API is for)

- **"Nine things to build with a wallet address, and the calls that do them"**,
  published 25 August. Nine worked recipes: three that need only `curl`, three
  that turn on the reachability field, and three that only became possible once
  an agent could call the API itself (MCP in Claude, MCP in Claude Code, and an
  agent buying its own credits over x402).
- **Every response body in it is real.** A temporary key was minted against
  production, each call was made, the output was pasted in, and the key was
  revoked. An invented `meta` block in a post about an API is the kind of error
  a reader finds before we do.
- Four figures registered in `scripts/check-published-figures.ts`: the three
  reachability shares and the agent count. The post states them in the phrasings
  the existing patterns already match, so the scheduled sweep checks them like
  every other published number.

### 2026-08-25 (one name for the entity)

- **`LEGAL_ENTITY` in `lib/site-url.ts`**, read by the privacy policy, the
  footer and `llms.txt`. The privacy policy had said "Starl3xx Labs", written
  from memory, on the one page where the name is a legal claim rather than a
  footer credit. The correct value, "Starl3xx Labs LLC", was already in the
  repository in two places and was not read. A name looks too obvious to check,
  which is why it is the kind of fact that drifts. An invariant asserts none of
  the three spells it out, and a mutation proves the assertion catches it.

### 2026-08-25 (a privacy policy, and the cleanups that make it true)

- **`/privacy`**, linked from the footer and in the sitemap. Required for a
  directory submission, which rejects a missing one outright, and overdue on
  its own: the site collected email addresses, payments, lookups and IP
  addresses and said nothing anywhere about any of it.
- **Every retention period it states is one the code enforces.** Writing it
  turned up the reason it could not have been written honestly before: three
  cleanup functions existed and **nothing called any of them**, so sessions,
  spent sign-in tokens and hourly IP buckets had accumulated since the day each
  table was made. `app/api/cron/cleanup/route.ts` runs daily and calls all
  three, and adds an expiry to analytics events, which had none at all despite
  each row carrying a browser identifier and sometimes an email address.
- **The numbers are read out of the constants, never restated.** The policy
  imports `CACHE_TTL_DAYS`, `ANALYTICS_RETENTION_DAYS`, `SESSION_DURATION_DAYS`
  and four more, so the published figure and the code that enforces it cannot
  disagree. An invariant asserts each one is read rather than written as a
  digit, and a mutation proves the assertion catches it.
- **The section worth reading twice is "Addresses you look up".** It says
  plainly that a resolved mapping joins a permanent index and answers other
  people's lookups, and equally plainly that nothing about _who looked it up_
  is ever shared. That is how the product works, and a policy that left it
  implied would be the most misleading thing on the page.
- **A removal route for people in the index**, who may be in it having never
  used the service. No proof of ownership is asked for, because the alternative
  is demanding more information from a stranger than we already hold on them.
- **Processors are named by role**, except identity sources, which are a
  category. That is what GDPR article 13(1)(e) permits, and it keeps the
  sourcing rule in CLAUDE.md intact.

### 2026-08-25 (OAuth for the MCP server)

- **The MCP server is an OAuth 2.1 resource server.** Add
  `https://walletlink.social/api/mcp` to a client that supports it and the first
  tool call opens a consent screen: no key to create, copy or paste. The bearer
  key still works and every existing installation is untouched.
- **Why.** Anthropic's software directory policy, section 5.D, requires OAuth
  for an authenticated remote MCP server. A static bearer key does not satisfy
  it whatever else is true of the server, so a directory listing was blocked on
  this and on nothing else.
- **The whole authorization server is in this repo.** RFC 9728 protected
  resource metadata, RFC 8414 authorization server metadata, RFC 7591 dynamic
  registration, RFC 7009 revocation, client ID metadata documents, RFC 9207
  issuer identification, and PKCE with `S256` required rather than offered.
  Every client is public and no client secret is issued.
- **The access token is an `api_keys` row.** Metering, the three rate-limit
  windows, the balance check and the usage ledger all key off that table, so
  anything else would have meant a second copy of each, which is where a meter
  starts disagreeing with itself. `expires_at` bounds a token to an hour,
  `revoked_at` ends it, and one new column, `oauth_grant_id`, tells it from a
  key somebody pasted into a config. The consequence is written down rather
  than implied: an access token also authenticates a REST call, because the
  five tools are the six endpoints and there is nothing on one surface that is
  not on the other.
- **Refusal is a 401, never a tool error.** A 200 carrying `isError` is read by
  a client as a tool that failed: the model is handed the text and the turn
  moves on, no token is refreshed, nobody is offered a connection. A mistyped
  bearer key is the deliberate exception, because that person needs to read
  "your key is invalid" and has no connection to repair.
- **The discovery documents are rewrites in `next.config.ts`, not routes.** The
  App Router does not route a directory whose name begins with a dot, and does
  not say so: an `app/.well-known/` route compiles, emits no warning, and is
  absent from the build. Found by building it and reading the route list.
- **The sign-in detour carries nothing a client supplied.** `/oauth/authorize`
  validates and stores the request first, then refers to it by an opaque id, so
  the magic-link round trip has no attacker-controlled URL to carry.
- **Refresh tokens rotate and the replaced value is kept.** Presenting it is
  proof of a leak rather than a bad string, since the real client already
  exchanged it, and that revokes the grant. A replayed authorization code does
  the same.
- **Connected applications** are listed and revocable from the API keys modal,
  and not gated on holding credits: an account on the free allowance can
  connect a client, so it must be able to disconnect one.
- **The key cap no longer counts access tokens.** Without the exclusion,
  connecting a client would push a dashboard key past the cap and revoke a
  credential somebody was using.
- **The exchange validates before it spends.** Review caught the first version
  consuming the authorization code and checking `client_id`, `redirect_uri` and
  PKCE afterwards. A single attempt with a wrong verifier therefore burned the
  code and made the real client's retry look like a replay, which revoked the
  grant: anybody who could see a code could destroy the connection behind it
  while holding nothing else. Two smaller ones alongside it: `redirect_uri` is
  now required on the exchange rather than compared only when supplied, since
  the authorization request always carries one and comparing it optionally is
  the same as not comparing it; and a consent that loses a double-click race
  revokes the grant it just wrote, which was otherwise holding a slot in the
  per-account cap and pushing a live connection out of it.
- **A failed exchange no longer misreports itself.** Review found two more in
  the same place. A code near its expiry was judged by the Node clock in
  `loadCode` and by Postgres's in the consume, so an ordinary first exchange
  arriving a moment late failed the second and was read as a replay, which
  revoked the connection it was trying to establish. And because expiry was
  checked before `consumed_at` was visible, a replay that arrived after the
  window reported as merely expired and revoked nothing, which is the case
  replay detection exists for. One clock decides now, and `consumeCode` returns
  four outcomes rather than a boolean, because a boolean forced the caller to
  guess and it guessed wrong in both directions.
- **97 new invariants and 33 new guard mutations**, taking both to 119 and 43.
  Every claim above that says an attacker cannot do something is an assertion
  that tries it, and every assertion is proved to catch a real deletion.

### 2026-08-25 (the guard that tries the attack)

- **`scripts/check-invariants.ts`**, 22 adversarial assertions, run on every
  PR. Each one is an attacker doing the thing a comment claims is impossible.
- **Why.** Four defects reached review on 24 and 25 August with the same shape:
  a comment asserting a security property, and nothing that could contradict
  it. "Possession of the payload is proof", when every field of a settled
  payment is public onchain. "A replayer also needs the reply", when they
  replay from their own socket. "A header means this is metered", when
  `Bearer hunter2` is not a key. "This table is in the nightly dump", when it
  was in neither dump list. Each was checkable in seconds; none was checked
  twice. CI enforced button radius, palette, contrast and control height on
  every PR and nothing about the money path.
- **`scripts/check-invariants-guard.ts` reintroduces ten real defects and
  requires each to be caught.** It earned its place immediately: **four** of the
  first draft's assertions passed while the code they protected was deleted.
  The TTL assertion signed the wrong message, so the request was refused by the
  message binding and the TTL was never reached. The HMAC assertion recomputed
  the HMAC locally and so verified itself. The backup assertion used `[a-z_]+`,
  which cannot match a table name containing digits, and
  `x402_recovery_redemptions` has three. The fourth was found by review after
  the first three were fixed: the future-date assertion reused a live token
  with a different timestamp, so the HMAC refused it first and the `age < 0`
  branch was never reached. It was the assertion written immediately after the
  stale-challenge one, making the same mistake that had just been corrected
  three lines above.
- `issueChallenge` now takes an optional `issuedAt`, so a check can exercise it
  at a chosen moment rather than reimplementing what it is testing.
- No test framework, no new dependency, no database and no secrets, so it runs
  on a fork's pull request.

### 2026-08-25 (saying the rail exists)

The onchain rail went live and nothing pointed at it but its own docs page.

- **`/vs/formo` gains the row the rail was built for.** Both sides now take
  USDC on Base with no account, which makes it the one row comparing like with
  like. The difference is what the money buys: Formo charges a fixed $0.05 per
  address whether or not it resolves, and the Agent pack is $1 for 12
  **matches**, about $0.0198 an address, with a wallet that resolves to nobody
  costing nothing. Roughly 2.5x further on a list that matches at our measured
  rate. Both figures are derived from `lib/packs.ts` rather than written down,
  so the copy cannot drift from what the rail charges.
- **`llms.txt` gains a section**, which matters more than the rest: it is the
  surface an agent actually reads, and an agent is who the rail is for. Price,
  what a dollar buys, that misses are free, and how to recover a lost key.
- **README** gains a feature row and a section on the design.
- **The pricing UI is deliberately untouched.** `PackPricing` and
  `UpgradeModal` say nothing about the Agent pack, because a $1 pack shown
  beside a $29 Trial is the cannibalisation that keeping it out of `PACKS`
  exists to prevent. A surface that should advertise it imports `X402_PACKS`
  explicitly.

### 2026-08-25 (key recovery, which the payment could never provide)

`GET /api/x402/recover?wallet=…` issues a challenge; signing it with the wallet
that paid returns a new API key against the same credits. Off unless
`X402_RECOVERY_SECRET` is set.

- **This is the endpoint three failed attempts inside `/buy` were reaching
  for.** Each tried to serve a key to a returning payer from the payment
  payload: first on `from` and `nonce`, then on the EIP-3009 signature over
  them. All are published when the payment settles, the first two in USDC's
  `AuthorizationUsed` event and the third in the settlement transaction's
  calldata. **Nothing a caller can copy from a settled payment distinguishes
  the buyer from anyone reading Base.** Proving current control needs a value
  the wallet could not have seen in advance, which is a challenge this server
  issued.
- **The challenge carries no database row; the redemption does.** Verifying it
  is a stateless HMAC over the wallet and the moment, the same shape
  `unsubscribeUrl` already uses, under its own secret so rotating it
  invalidates only recovery challenges.
- **A short window is not single use, and the first version confused the two.**
  It relied on five minutes, reasoning that a replayer would also need to read
  the reply carrying the key. They do not: they send the captured request from
  their own connection and receive their own key in their own response. With
  the three-key cap they could also fill it and lock the buyer out of the
  recovery they were trying to use. `x402_recovery_redemptions` records a spent
  challenge, insert-first so the primary key decides a race rather than a read
  both redemptions pass. Verified: the buyer's redemption returns a key, an
  immediate replay returns 409, and two simultaneous redemptions of one
  challenge produce exactly one key.
- **The message is written to be read in a wallet**, because that is where it
  is shown: it says what it authorises, says no funds move, and names the
  wallet and the moment, so a signature captured for one purpose cannot be
  presented for another.
- **A challenge is issued for any wallet, whether or not it ever bought.**
  Refusing early would make the endpoint a free oracle for which wallets hold
  credits. Whether an account exists is answered after a signature proves who
  is asking.
- **The key is minted, not recovered.** Only a hash was ever stored, so the
  original cannot be produced by anyone including us. The credits are
  untouched: they belong to the account rather than to the key.
- Scoped to `origin = 'x402'`, so a signature can never open an account created
  some other way if `users.wallet` is ever written by something else. Bounded
  at 30 requests an hour per IP under a new `/api/x402` key, since asking for a
  challenge costs nothing.
- Verified against a production build with a seeded account: an unsigned
  request, a different wallet's signature, a forged token, a tampered
  `issued_at`, an expired challenge and a wallet with no account are all
  refused with one message and no key; the real buyer signing a live challenge
  is served.

### 2026-08-24 (the onchain rail)

Step five of the sequence. `POST /api/x402/buy` sells a $1 Agent pack for USDC
on Base, with no account, no card and no email. Off by default: without
`X402_PAY_TO` the endpoint answers 503, because a payment rail with a default
address is a rail that pays somebody else.

- **A pack, never per call.** The `exact` scheme charges before anything has
  resolved, which contradicts the one thing this product is sold on. The rail
  sells credits, the credits are metered on matches exactly as a card purchase
  is, and misses stay free.
- **$1 buys 12 matches, about 51 resolvable addresses at the measured rate.**
  That is $0.0198 an address, against $0.05 for the nearest comparable
  per-request service, and one dollar is exactly one full `/v1/batch` call.
- **The pack is deliberately not in `PACKS`.** `PACK_IDS` drives the pricing
  grid, the upgrade modal, the schema.org offers, `llms.txt`, the public price
  endpoint and nine comparison-page renders, so a fifth key would have appeared
  in all of them. `X402_PACKS` keeps it out, and because
  `app/api/checkout/route.ts` resolves a Stripe price through `isPackId()`,
  `agent` cannot be bought with a card at all. The gate is structural rather
  than a filter somebody has to remember.
- **Payments are remembered by the authorization, not the transaction hash.**
  The hash is unknown when a facilitator times out and can name an unmined
  transaction on a `settlement_pending`, so keying on it would double-grant in
  exactly the case the key exists to prevent. `credit_lots.settlement_id` holds
  `<network>:<from>:<nonce>` from the EIP-3009 authorization, which is fixed
  before settlement is attempted and which USDC itself refuses to honour twice.
  A separate column from `stripe_payment_id`, because that one is read as "this
  was a card sale" by two other queries.
- **The EIP-712 domain is the detail that silently breaks everything.** The
  first working version emitted `extra: {}`, which produces signatures that
  cannot recover to the payer, so every payment is rejected for no visible
  reason. Passing the price as money rather than as an explicit asset makes the
  SDK fill the domain from its own table: `USD Coin` version `2` on Base
  mainnet, and `USDC` on Base Sepolia, which is also how a testnet-verified
  rail fails on mainnet.
- **An x402 account gets no free allowance.** It cannot be created without a
  settled payment, so there is no faucet at signup; the faucet would be on the
  other side, where a spent lot falls back to 100 matches every 30 days for a
  wallet that cost a dollar to create. `getBalance` withholds it for
  `origin = 'x402'`.
- **The account is real but unreachable, on purpose.** Credits hang off
  `users.id` through five NOT NULL foreign keys, so a wallet that pays needs a
  row. Its email is synthetic under `.invalid`, reserved by RFC 2606 and
  guaranteed never to resolve, and `email_opt_out` is true from the moment the
  row exists so every lifecycle send already skips it. `ON CONFLICT DO NOTHING`
  plus a re-select rather than read-then-write, so two settlements from one
  wallet cannot 500 a buyer who has already paid.
- **A settled payment can be retried, which the first version could not do.**
  Settlement is the one step that cannot be repeated: the EIP-3009
  authorization is spent onchain the first time, so a second `settlePayment`
  for the same payload fails. Going straight to settle meant a caller who lost
  the response retried into a settlement error and never reached the idempotent
  grant that exists to serve exactly them. They had paid, and the only route to
  their key was a support thread. The settlement is now looked up before
  anything is verified or settled, which is also what makes the documented
  `newly_granted: false` reachable at all. A fresh key rather than the old one,
  because only its hash was ever stored, bounded at three active keys per
  account so a replayed payload cannot mint without limit.
- **A replay reports, and mints nothing.** Two attempts at reissuing a key to a
  returning payer were both wrong in the same way. The first matched on `from`
  and `nonce`, which are in USDC's public `AuthorizationUsed` event. The second
  verified the EIP-3009 signature, which the facilitator submits as
  `transferWithAuthorization` calldata, so it is public too. **Once a payment
  settles, every field of it is on a public chain**, and nothing in a payment
  payload can prove who holds the wallet afterwards. Proving that needs a
  challenge this server issued, which is a recovery endpoint and not this one.
  The replay branch now returns the balance and the settlement reference, and
  `signedByPayer` was deleted rather than left as a security helper that
  secures nothing.
- **The key cap no longer fails a purchase that already settled.** The pack is
  recorded before the key is minted, so throwing at the cap answered
  `GRANT_FAILED` for a payment that had succeeded and credits that existed. A
  capped account now gets 200, the balance, and the reason there is no fourth
  key.
- **One manual path, and it is loud.** Settle happens before the grant, because
  granting first would hand out credits for a payment that might fail. A
  database failure in between takes money without recording it, so that case
  logs the settlement reference at error and answers 500 rather than returning
  a key it did not create. The grant is idempotent on that same reference, so
  it can be issued by hand and cannot be issued twice.
- Verified against a production build: 503 unconfigured, a correct v2 challenge
  configured, and all three malformed-payment paths refused before anything
  settles.

### 2026-08-24 (two money bugs, found on the way to x402)

Groundwork for the x402 rail, aimed at what the code actually does rather than
at what the brief assumed. Both of these are on the **live Stripe path** and
neither needs x402 to bite.

- **A failed grant was reported as an already-completed one, and the purchase
  was lost.** `grantPack` caught every error and returned false, with a comment
  asserting the cause was a unique violation. The webhook reads false as
  "already granted", logs exactly that, and answers 2xx, so Stripe never
  retries. Any transient database failure therefore charged a customer and gave
  them nothing, and the only line in the log said the opposite of what had
  happened. It now returns false only for a genuine duplicate and throws
  otherwise, so the webhook answers 500 and Stripe retries; `grantPack` is
  idempotent, so a retry after recovery grants exactly once.
- **The duplicate test could never have fired anyway.** Drizzle wraps every
  driver error in a `DrizzleQueryError` and puts the original on `.cause`, so
  `error.code` is `undefined` and only `error.cause.code` carries `23505`. A
  check on the top-level code reads as correct and matches nothing.
  `isUniqueViolation` walks the cause chain, and was verified against this
  repo's own Drizzle rather than assumed.
- **`drawDown` could spend a lot past its own limit.** It read `granted` and
  `consumed`, computed the take in JavaScript, then added it. The increment was
  atomic; the number being incremented by was stale. Two debits in flight for
  one account both read the same `consumed` and both added a take computed from
  the same room. Demonstrated against Postgres: a lot with 150 of room took two
  concurrent debits of 100 and finished at **200 consumed against 150 granted**.
  The take is now computed inside the statement under `FOR UPDATE`, and the
  amount actually taken is returned rather than assumed. Same scenario now
  lands on exactly 150.
- That invariant is stated in this function's docstring and in `db/schema.ts`
  ("Always <= granted") and has no constraint behind it. `LEAST` makes the
  overshoot unrepresentable rather than merely unlikely.

### 2026-08-24 (prettier, enforced instead of dormant)

- **Formatted the repo and added `.github/workflows/format.yml`.** 170 files
  changed. Prettier had been installed for months with nothing running it: no
  CI, no git hook, no lint-staged, and `eslint-config-prettier` installed and
  never imported. 150 of 352 files had drifted out of conformance.
- **The unenforced middle was the dangerous state.** A formatter that runs on
  every commit is safe, because drift never accumulates. One that never runs is
  harmless dead config. One that runs occasionally against a 43%-nonconformant
  repo turns every `npm run format` into a hundred-file rewrite nobody can
  review, which is exactly how a one-line fix earlier today arrived as a diff
  with an unrelated reflow in it.
- **Verified by rendering, not by reading the diff.** The visible text of all 93
  prerendered pages was captured before and after: identical. eslint reports the
  same 12 errors and 19 warnings on the same four files as before, so nothing
  new was introduced.
- **Formatting broke a guard, which is worth knowing about.** The published-
  figures registry looks for the 13% on the share card with a regex that
  assumed the number sat on the same line as its opening `<span>`. Prettier
  reflowed that element across ten lines, and the guard reported `NO MATCH` on
  a page where nothing had changed. The pattern now tolerates whitespace
  wherever the formatter is allowed to put it, which in JSX is everywhere
  except inside a string. It failed loudly rather than silently, which is the
  right direction for a guard to fail in, and it is the argument for enforcing
  a formatter once rather than letting one loose occasionally.
- **The OpenAPI gate fired on a formatting-only change**, correctly: the
  reformat touched two v1 route files and `lib/api-sources.ts`. The diff there
  is line joins and splits with no value, name or behaviour changed, so the PR
  carries the `no-docs-needed` label, which is what that label exists for.
- **A finding that did not survive the check.** Bugbot reported that reflowing
  `{FREE_WINDOW_DAYS}-day` across a newline renders "30 -day window", and it was
  accepted and worked around in PR #179. It does not. JSX trims the newline
  adjacent to an expression. React emits `<!-- -->` between the resulting text
  nodes as a hydration delimiter, a browser never renders a comment, and the
  first attempt at verifying this replaced every tag including comments with a
  space, which invented the phantom twice over. The workaround is reverted and
  the trap is written down in CLAUDE.md.

### 2026-08-24 (listed, and said out loud)

- **Published to the official MCP registry** as `social.walletlink/wallet-identity`,
  status active. Step four of the sequence. The name is reverse-DNS because the
  registry requires it: a domain namespace is the reverse form of the domain,
  the same convention as a Java package, so `walletlink.social` becomes
  `social.walletlink`. Nothing user-facing carries that string; clients install
  the server as `walletlink`.
- **Verified by DNS, not by GitHub**, so the namespace is the domain rather than
  `io.github.starl3xx`. That is the stronger claim: it says walletlink.social
  vouches for this server, not that a GitHub account does. The TXT record sits
  on the apex, SPF-style rather than DKIM-style; a selector would fail with a
  generic signature error. The Ed25519 signing key is outside the repo at
  `~/.walletlink/mcp-registry-key.pem`, and the Cloudflare record is commented
  with its location, because it is the only way to publish an update.
- `server.json` is checked in as the source of truth for future publishes. The
  registry caps `description` at 100 characters, which rejected the first
  attempt.
- **The server is now said out loud on the surfaces that should say it.** The
  pack feature lists in `UpgradeModal` and `PackPricing`, the README feature
  table, and `llms.txt`, which is the surface an agent actually reads and had
  no mention of the MCP server at all.
- **`/vs/formo` gains a row.** Formo puts its MCP server behind Scale, the
  second of three plans. Ours is on every pack and on the free allowance,
  because it carries the same key and draws the same credits as the API it
  wraps. That is a like-for-like comparison rather than a claim.
- **`/mcp` was already taken on the docs site, and the repo said so.** Mintlify
  serves its own documentation-search MCP endpoint at
  `docs.walletlink.social/mcp`, which `docs/DOCS-SITE.md` has recorded since the
  site was built. A page at `docs-site/mcp.mdx` is shadowed by it: a browser
  asking for that URL gets `Method not allowed` as JSON, not the page. It was
  live that way for about an hour, and the dead URL was in the registry
  listing, the keys modal and the API reference. The page is now `/mcp-server`,
  the listing is republished at 1.0.1, and `docs/DOCS-SITE.md` says the path is
  reserved.
- **The OpenAPI spec was reachable all along.** Static files in `docs-site/`
  are served from the docs root, so `docs-site/openapi.yaml` has been public at
  `docs.walletlink.social/openapi.yaml` since it landed. It was left out of
  `llms.txt` on the assumption that it was not, which was never tested. It is
  now linked from `llms.txt` and from the MCP page, still without a `docs.json`
  entry, since registering it would generate a page per endpoint and duplicate
  the nine hand-written ones.
- The free-tier line rendered "30 -day window" for one commit. Running
  `prettier --write` over a file that had never been formatted reflowed
  `{FREE_WINDOW_DAYS}-day` across a newline, and JSX collapses that into a
  space. A template literal now keeps the figure and its hyphen atomic.

### 2026-08-24 (one click into an agent)

- **The API keys modal now offers "Add to Cursor" and "Copy Claude Code
  command"**, both already carrying the key that was just created. Step three of
  the sequence, and the lowest-friction install path that exists: no approval
  gate, no config file, no copying a key between two windows.
- **They are offered there and nowhere else, on purpose.** A key is shown
  exactly once, so a link published in the docs could only carry a placeholder,
  and a placeholder installs a server that fails on first use. The one screen
  where the plaintext key exists is the one screen where a working link can be
  built.
- **Nothing about the key's handling changes.** A `cursor://` link is handled by
  the local application and never fetched, so no key reaches an HTTP request, a
  referer or a log. The command goes to the clipboard, not to us. The key is
  still not persisted anywhere in the client.
- `lib/mcp-install.ts` holds the encoding. Cursor's deeplink base64s the server
  config object **on its own**, not wrapped in the `mcpServers` map the file
  format uses; passing the wrapped shape produces a link that installs an empty
  server.
- Docs gain the Claude Code one-liner and a note that `-s user` installs it
  everywhere rather than in one project.

### 2026-08-24 (the MCP server, which bills nothing of its own)

- **`app/api/mcp/route.ts`** puts five tools over the six `/v1` endpoints, so an
  agent can resolve a wallet without a person first reading an API reference.
  Remote, no OAuth, same bearer key and same balance as the REST API.
- **The design that matters is what this layer does not do: it never
  authenticates and never bills.** Every v1 handler already calls
  `authenticateApiRequest` itself and already calls `trackApiUsage` itself, and
  `trackApiUsage` performs the credit debit. A layer that did either on top
  would have authenticated twice, incremented the rate limiter twice and charged
  the caller twice for one tool call, and the debit is deliberately not
  idempotent, so the second charge would have been real money. Instead each tool
  builds a request carrying the caller's own `Authorization` header and hands it
  to the handler.
- **Three of the four flagged traps dissolved as a result.** `api_usage.endpoint`
  keeps recording the same six literals the REST surface records, so a
  client-supplied tool name can never mint a new key and
  `requests_by_endpoint` stays the bounded set the docs promise. The rate
  limiter is entered once per call, at the weight the equivalent REST call
  carries. And MCP prices identically to REST by construction rather than by a
  table somebody has to keep in step.
- **Discovery answers without a key.** `initialize` and `tools/list` reach no
  handler, so a client with no key or an empty balance still sees what the
  server offers. A handshake that answered 402 looks to every client like a
  server that is simply broken. That leaves one genuinely unauthenticated
  surface, so it is bounded by IP at 120 an hour in `lib/ip-rate-limiter.ts`.
  The bound is decided by JSON-RPC method, **not** by whether an
  `Authorization` header is present: the first version gated on the header,
  which meant any junk string in it removed the only cap on discovery. A header
  is not a key.
- **Which side the allowlist sits on is the whole design.** The second version
  listed the handshake methods and bounded those, which left every method it
  had not thought of, `resources/read`, `prompts/get`,
  `notifications/cancelled` and any string a caller invented, falling through
  to the unbounded branch. The MCP layer refuses all of them, so they reach no
  meter, which is exactly the surface the limit exists to cover. It now
  allowlists the metered side instead: everything is bounded except a body
  whose calls are _all_ `tools/call`. A method missing from that set is
  bounded, which is the safe direction to fail in, and a mixed batch is
  bounded too, or ninety-nine `tools/list` calls with one `tools/call`
  appended would buy the whole batch a free pass.
- **A failed call is a tool error, never a transport error.** 401, 402, 429 and
  400 from a handler would end the JSON-RPC session in most clients, and the
  person would see a dead connection rather than "no credits left". The HTTP
  status at this layer is always 200 and the failure travels as content the
  model can read out.
- **A handler called as a plain function has no wrapper to catch a throw.** Over
  HTTP, Next turns one into a 500. `lib/mcp-call.ts` reproduces that, or an
  unhandled throw would escape into the transport.
- **The fourth trap is real and unfixable, so it is documented at the top of the
  route.** `scripts/check-design-language.mjs` greps `app/` for Tailwind words
  and cannot tell a class from an English word, so a tool description containing
  the standalone word "rounded" fails CI. The banned list is in a comment there.
- Verified against a local production build: discovery with no key returns all
  five tools, an invalid key comes back as HTTP 200 with a readable tool error,
  the batch body stream drains through the synthetic request, the reverse
  cursor arrives on `nextUrl.searchParams`, and a throwing handler becomes a 500
  result rather than an escaped exception.
- New docs page at `docs-site/mcp.mdx`, with the connection block for Claude and
  for Cursor.

### 2026-08-24 (a machine-readable API, and the 43.9% it could not reach)

- **`docs-site/openapi.yaml`** describes the whole public API in OpenAPI 3.1:
  six operations, both authentication forms, every error code, the rate-limit
  headers, and the staleness headers on the single wallet lookup. It is the
  dependency the MCP server, SDK generation and agent discovery all sit on.
- **It records the four shapes rather than averaging them.** The same idea is
  returned four slightly different ways across the endpoints: `/batch` omits
  `verified` on the Farcaster object that the other three include, the forward
  lookup returns a `quality` object where the reverse lookups return a bare
  `quality_score`, and `also` appears on the forward paths only. Writing one
  schema that was true of none of them would have been tidier and wrong, so
  there are separate schemas and each says why it differs.
- **Writing it found a shipped bug that made 43.9% of the index unreachable.**
  `isValidFarcasterUsername` was `[a-z0-9_]{1,20}`. Measured against the
  4,699,611 usernames we hold: 1,477,534 contain a dot, 189,078 contain a
  hyphen, **zero** contain an underscore, and 334,345 are longer than 20
  characters. The rule allowed the one character that never occurs and rejected
  both that do, so `GET /v1/reverse/farcaster/{username}` answered 400
  INVALID_USERNAME for 2,065,051 names that are in the table, including
  `vitalik.eth`, which is the worked example on our own published docs page.
- **The new rule is `[a-z0-9][a-z0-9.-]{0,31}`**, derived from the index rather
  than from the fname spec, because the column holds both fnames and ENS names
  and the lookup matches on the column. It accepts 4,223,912 usernames, up from
  2,634,560. The leading-alphanumeric requirement is what still rejects
  Farcaster's `!<fid>` placeholder for an account with no username set, which is
  475,698 rows and not an addressable handle.
- **Two published pages were describing something the code does not do.**
  `usage.mdx` showed `requests_by_day` as an object keyed by date; it has always
  been an array of `{ date, count, credits }`. `errors.mdx` and
  `reverse-farcaster.mdx` carried the old username rule.
- **CI gains a narrower gate.** `docs-freshness.yml` already fails a PR that
  touches the API surface without touching `docs-site/`, but that accepts any
  prose edit, which would let the spec drift while a sentence changed. A second
  step requires `docs-site/openapi.yaml` specifically when a route, a validator,
  a plan limit or the `sources` enum moves, and a second job runs
  `redocly lint` whenever the spec itself changes, since a spec that no longer
  parses breaks the playground and every generated SDK without breaking a test.
- **Blog code blocks are readable again.** The typography plugin styles `pre` as
  light text on a near-black ground; the blog overrode only the ground, so every
  fenced block rendered gray-200 on gray-100.

### 2026-08-24 (the concierge shortlist, with the numbers already run)

- **`scripts/concierge-signals.ts`** turns the traffic plan's "three
  personalised replies per weekday" from an hour of manual searching into a
  review pass. It finds candidates, computes an honest number for each from our
  own index, and prints a drafted reply. It makes no writes, never seeds and
  never posts.
- **The plan's premise did not survive contact.** It named Clanker deployers as
  the densest pocket. Clanker is not a launch feed: `lib/clanker.ts` keeps a
  wallet and a social handle and throws the token address away (`topics[1]`, read
  in a comment only), so there is nothing to measure. A token deployed this
  morning has no holders either: two sampled live had three transfers each, being
  the pool, the locker and the deployer. And handle-shaped records are often
  launchpad bots minting tokens _about_ a public figure's post, so a reply about
  "your holders" would reach someone with no connection to the token. Clanker
  stays a good wallet-to-X source and is not used as a prospect list.
- **The strongest lane was already in the database.** We hold holder data for 76
  contracts and 51 clear the public listing floor, so they already have a live
  report at `/holders/<chain>/<address>` that their team has never been told
  about. 50 named candidates, all carrying measured numbers, at zero API cost.
- **The other two lanes reflect what is actually available.** X search runs
  through the repo's own twitterapi.io key, anchored to a marketplace or explorer
  link because the unanchored keyword query measured about three quarters
  giveaway farms. Farcaster uses the free Warpcast endpoint: Neynar is over its
  period budget (11,557,744 against a 10,000,000 plan limit) and pauses **all**
  requests on overage including the live paid lookup path, so no new Neynar
  caller may spend before 2026-09-01.
- **A report link and a source link are different fields.** They were one, and
  the draft printed whatever it held as "the full report is already public": on
  an X candidate that was the prospect's own announcement post, so the reply
  would have pointed a team at their own tweet and called it our analysis.
- **Every lane resolves contracts through one shared helper.** The resolution
  lived inline in the X lane, so the Farcaster lane extracted an address and
  then drafted "NO NUMBER AVAILABLE" for contracts we hold and have published. A
  lane should not be able to forget how to look something up.
- **The Farcaster lane links the cast, not the caster.** It pointed at the
  author's profile, which leaves the operator to go and find the announcement
  they are meant to be answering. The X lane links the tweet; this now links
  the cast, with the profile as the fallback.
- **One naming rule, shared.** The index lane rejected the seeder's `Unknown
Token` placeholder from the start. Once the other lanes learned to resolve
  collections they began preferring the collection name over the poster, so a
  placeholder started beating a perfectly good `@username` and produced a reply
  addressed to "Unknown Token". `isNamed` and `displayName` now serve every
  lane.
- **Dedupe follows an identity that merges.** Keying on "contract if present,
  else handle" is not enough: a contract-keyed winner picks up a handle when a
  post merges into it, and the next post from that handle still hashed to its
  own key and took a second slot. An alias map makes the two identities
  converge whichever arrives first.
- **The candidate cap breaks the query loop, not just the tweet loop**, so a run
  that is already full stops paying twitterapi.io for a page it cannot use. And
  candidates are deduped by contract, then handle, before the shortlist is
  sliced: with `source=all` one prospect arriving from two lanes ate two of the
  three daily slots.
- **The honesty rules are in the code, not the operator's head.** Always name the
  measured denominator, because seeding caps at 2,000 wallets and "1,707 of your
  20,977 holders" would be false. Quote `reachableAny` as a floor with "at
  least", because `checked` runs well below `holderCount`. Use the median
  Farcaster following, never the mean. Drop any collection where
  `measurementInProgress` is true, because a near-zero reachable count there
  means "not yet checked" rather than a finding. With no measured number the
  draft refuses to invent one and offers the published per-chain figure instead.

### 2026-08-24 (the changelog stops saying the relaunch was never sent)

- **Two entries claimed the relaunch campaign had not been sent.** It was sent
  on 2026-08-23: 100 grants, 100 emails, 0 failures, 25,000 matches granted,
  confirmed against `lifecycle_emails`. Both statements were true on the day
  they were written, so they carry a dated correction in place rather than
  being rewritten. A changelog that quietly revises its own history is worth
  less than one that shows where it was wrong.
- Found while checking whether the ~100 dormant accounts were still eligible for
  the welcome sequence. They are not, and the reason is not the `SEQUENCE_START`
  cutoff everyone reaches for first: they hold credit lots now, so the purchase
  exit rule excludes them independently. That distinction matters if the cutoff
  ever moves. `docs/EMAIL-SEQUENCE.md` carried the same claim and was corrected
  in PR #172.

### 2026-08-24 (a failed send stops being retried 288 times a day)

- **The five-minute runner had an unbounded retry loop.** `claimAndSend` deleted
  its claim when a send failed, which put the account back in exactly the state
  that made it eligible. Under one daily cron that was one retry a day. Under
  the five-minute cron it is 288 a day, per account, forever, for any failure
  that does not fix itself. Worse, `isEmailConfigured` only checks
  `RESEND_API_KEY` while `sendLifecycleEmail` also refuses without
  `EMAIL_UNSUBSCRIBE_SECRET`, so a whole class of permanent refusal passes the
  route's precondition and lands straight in the loop.
- **A failure is now written down.** New columns `attempts`, `failed_at` and
  `last_error`. The claim became an upsert that re-takes a failed row only once
  its backoff has elapsed (10, 20, 40, 80 minutes) and only while it is under
  `RETRY_CEILING` (5). A row now carries four states, and selection and the
  claim are written from the same four so they cannot disagree: delivered,
  in flight, retryable, dead. Migration:
  `scripts/migrate-lifecycle-retry.ts`, **run before deploy**.
- **The daily runner pins a user to their earliest undelivered email, stated
  explicitly.** Making selection agree with claim eligibility silently dropped
  the hold that kept a user on welcome-1: a welcome-1 that was backing off or
  exhausted no longer matched the first pass, so the user fell through to the
  second and would have received welcome-2 of a sequence whose first email never
  arrived. Each pass now requires that exactly the earlier emails are confirmed,
  which is the rule the old behaviour only implied. The JS dedupe stays as a
  safety net; it can no longer fire.
- **The reclaim skips recorded failures** (`failed_at IS NULL`). They are also
  unconfirmed, but they are a retry schedule rather than an abandoned claim, and
  deleting one would reset its attempt count and restart the loop.
- **The new cron was watched by nothing.** It is now in the health pane's `JOBS`
  list at `maxAgeHours: 2`, and it emits a heartbeat on every run rather than
  only when it sends. "No row" previously meant both "nothing to do" and "dead
  since Tuesday", which is precisely the distinction that pane exists to make.
- **Cron heartbeats are no longer counted as lookups.** Nine scheduled routes
  report health by writing a `lookup_completed` row carrying an `eventSubtype`,
  and every product query counted them as work a person did. At nine a day that
  was a rounding error; at 288 the machines would have been the majority of our
  "lookups". `NOT_A_HEARTBEAT` in `lib/analytics.ts` is now applied everywhere
  the count is read.
- **`migrate-lifecycle-claim.ts` is safe to re-run.** Its backfill was
  unbounded, so a second run after deploy would have marked live and abandoned
  claims as delivered and silently lost those emails. It is now bounded to
  pre-cutover rows, and its verification asserts the same bound rather than
  failing whenever a cron legitimately holds a claim.
- **The first-touch runner has its own send cap** (`FIRST_TOUCH_MAX_SENDS` 100,
  not the daily 200) plus a 240s wall-clock guard, so a run exits cleanly
  instead of being killed partway and leaving claims for the reclaim.
- `docs/EMAIL-SEQUENCE.md` and the module header described one cron, an
  immediate day-0 send and a ledger that proves delivery. All three were stale
  the moment the split shipped. Also corrected there: **the relaunch campaign
  has been sent**, 100 accounts on 2026-08-23, which that file and this one both
  denied for a day.

### 2026-08-24 (the welcome email stops arriving a day after the welcome)

- **Welcome-1 now sends about five minutes after signup, not up to 24 hours
  later.** The sequence ran on one daily cron at 15:00 UTC, so an account
  created at 15:01 waited 23 hours and 59 minutes for the email that greets it.
  New cron `/api/cron/welcome-first` at `*/5 * * * *` runs `welcome-1` only,
  for accounts past `FIRST_TOUCH_DELAY_MINUTES` (5). Worst case is now about
  ten minutes.
- **The delay is deliberate, and zero would be worse.** The account row is
  written at magic-link _verify_, so an inline send puts welcome-1 in the inbox
  in the same second as the sign-in link, and the email the person needs
  competes with the one they did not ask for. Five minutes clears the link and
  is long enough that most people have run their first lookup, which is the
  state welcome-1's copy assumes.
- **Sends now claim before they send.** `lifecycle_emails` is unique on
  (user, key), but the row was written _after_ the send, so two runners racing
  the same user delivered twice and inserted once: the constraint recorded the
  race instead of preventing it. That was theoretical with one cron and real
  with two, which overlap exactly at 15:00. `claimAndSend` inserts first and
  sends only if it took the row; a failed send deletes the claim so the next
  run retries rather than marking a person as emailed by an email that never
  left.
- **The daily runner keeps its day-0 pass** as the safety net, and both runners
  now select through one shared `ELIGIBLE_USER` fragment so the cutoff,
  opt-out, legacy-tier, whitelist and purchase exits cannot drift apart.
- **A claim nobody redeems is a welcome email that never arrives.**
  `claimAndSend` deletes its claim when the send _returns_ a failure, but it
  cannot delete anything when the process does not return at all: a timeout, an
  OOM or a deploy between the INSERT and the send leaves a row every runner
  reads as "already emailed", retried by nothing and reported to nobody. New
  column `lifecycle_emails.confirmed_at` is written after the send succeeds, so
  a row is proof of delivery rather than of intent, and `reclaimStaleClaims`
  deletes unconfirmed claims older than `CLAIM_RECLAIM_MINUTES` (15) before
  either runner selects. The residual window resolves in favour of sending: a
  process that dies after the send but before the confirm mails that person
  twice, and one duplicate greeting beats a welcome that silently never
  arrives.
- **The delay is a fact about the account, not about one cron.** Held only in
  the fast runner, the daily runner's day-0 pass still computed `now() - 0
days`, so an account created at 14:59:30 got welcome-1 thirty seconds later
  at 15:00, next to its own magic link. `FIRST_TOUCH_DELAY_MINUTES` moved into
  `ELIGIBLE_USER`, where no runner can reach past it.
- **Selection asks whether an email was delivered, never whether a row exists.**
  Once the claim is taken before the send, a bare `NOT EXISTS` reads an
  in-flight claim as a completed send: the daily runner found no welcome-1
  pending, fell through to welcome-2, and would have delivered the second email
  beside the first while the first was still leaving. Both runners now select on
  `confirmed_at IS NOT NULL`, which holds that user at welcome-1 until an email
  actually left. The lowest-pending ordering is the reason the daily runner
  loops in key order, so this is the predicate that has to carry it.
- **The reclaim is scoped to this sequence's own keys.** `lifecycle_emails` is a
  shared ledger: `scripts/relaunch-trial-grant.ts` writes 100 rows under
  `relaunch-trial-2026-08`. An unscoped delete would have read every one of them
  as an abandoned claim of ours, removed it, and let a `--send` re-run mail 100
  accounts that had already been mailed. A reclaim may only ever collect claims
  the runner doing the reclaiming could itself have taken. The relaunch script
  now also writes `confirmed_at` explicitly, because a ledger where "delivered"
  is implicit in one writer and explicit in another survives right up until
  somebody widens a WHERE clause.
- **The key scope binds as `sql.param(...)::text[]`, not a bare array.** Drizzle
  expands a plain JS array into one placeholder per element, so
  `ANY($1, $2, ...)` reaches Postgres as "op ANY/ALL (array) requires array on
  right side". `reclaimStaleClaims` runs first in both crons with nothing
  catching it, so the bare form would have thrown on every run before a single
  send: the scoping fix above would have shipped as a total outage of the
  sequence. Same binding `lib/x-accounts.ts` and `lib/clanker.ts` already use.
- **The readers were updated too, not just the writers.** A row stopped meaning
  delivery the moment `claimAndSend` began taking it first, so `getEmailStatus`
  (the admin Lifecycle card) and `scripts/relaunch-report.ts` now count
  `confirmed_at IS NOT NULL`. Unfiltered, the pane reported an in-flight claim,
  and an abandoned one waiting on the reclaim, as mail that went out: it would
  have answered "did the send go out" with yes on exactly the runs where it had
  not.
- **The suppression guard in `relaunch-trial-grant.ts` is deliberately NOT
  filtered.** Reporting should be accurate and suppression should be
  conservative: any row at all means do not send again. Filtering there would
  turn a stuck claim into a second email.
- Migration: `scripts/migrate-lifecycle-claim.ts`, **run before deploy**. It
  backfills `confirmed_at = sent_at` on existing rows, which were written under
  the old send-then-insert order and are all real deliveries; without the
  backfill the first reclaim would delete them and mail those accounts again.
  No new table, so no `migrate-grant-readonly.ts` entry.

### 2026-08-24 (the docs stop advertising a plan nobody is on)

- **The legacy Unlimited tier is gone from `docs-site/`.** The Plans table
  carried a second column, `Unlimited (legacy)` / `Startup`, with 300 rpm, 50k
  requests a day and a batch size of 200, and three other pages repeated "or 200
  on a legacy Unlimited account".
- **Nothing was on it.** Two accounts hold a legacy tier, one `pro` and one
  `unlimited`. `TIER_API_PLAN` maps `pro` to `developer` and `unlimited` to
  `startup`, and only the `pro` account has ever created an API key. So no key
  in existence carries `Startup` limits, and the column documented a plan a
  reader could neither buy nor reach. Checked against the database before
  removing it, not assumed.
- **The code is untouched, deliberately.** `legacyTierIsUnmetered`, the tier
  values, `TIER_LIMITS` and `TIER_API_PLAN` all stay: both accounts keep exactly
  what they bought, and if the `unlimited` account ever creates a key it still
  gets `startup` limits. CLAUDE.md requires this, and the removal was only ever
  about what is published.
- The admin pane keeps its Legacy badge and tier row, because it is the tool for
  managing those two accounts and hiding them there would make it lie.
- Also removed the `app/lookups.mdx` note about accounts that bought Pro or
  Unlimited before credits existed. The `plan_limits` defensive-parsing advice in
  `usage.mdx` is kept, with the legacy phrasing dropped.

### 2026-08-24 (the blog gets its front door)

- **New post: "How to find the X account behind an Ethereum wallet"**
  (`content/published/find-twitter-account-from-wallet.md`). Three methods, what
  each one proves, four minutes by hand, and the answer rate at scale. The 26
  existing posts all assume the reader already knows that resolving a wallet is
  a thing that can be done; this is the entry point none of them is.
- **Its figures are declared, not hardcoded.** The post states the index size,
  the Farcaster count and the X-handle count, so it is added to the `files` list
  of all three claims in `scripts/check-published-figures.ts`. The wording was
  chosen to match the patterns already there, so the guard checks it with no new
  regex. All three verified against `/api/public-stats` before publishing.
- **Both sample rates are declared, not just the index counts.** The post states
  the 23.7% any-identity rate and the ~13% reachable rate, so both rows of its
  table are registered in `MEASUREMENTS.published`. Declaring only the headline
  is how a post ends up stating a current resolution rate beside a stale reach
  rate, which is the exact conflation this guard exists to police.
- Keeps "any identity" (23.7%) and "reachable on X or Farcaster" (~13%) apart,
  and says in the post why quoting the first where the second belongs overstates
  an audience by half.

### 2026-08-24 (the sweep resumes instead of restarting, and stops leaving 580 MB behind)

- **Reclaimed 580 MB.** `farcaster_sweep_seen_1786631580832` held 3,676,509 rows
  from a sweep that started 2026-08-13 14:33 UTC and hit the Neynar ceiling ~6.5
  hours in. The database went from 3,245 MB to 2,665 MB.
  `scripts/cleanup-sweep-seen-tables.ts` collects these, dry-run by default. It
  drops with a plain `DROP` rather than `SET ROLE`: the `sweep_runner`
  membership is `set=false`, so assuming the role is refused, while
  `neondb_owner`'s inherited `neon_superuser` is enough. Probed inside a
  transaction that rolled back rather than reasoned about.
- **The monthly sweep resumes.** A budget-stopped `--full` now records where it
  stopped in `ingest_state.farcaster_sweep_resume`, and the schedule runs
  `--auto`: resume if there is a checkpoint, full sweep if not. Before this, each
  month restarted at FID 1, spent its budget re-covering the same ground,
  stopped in about the same place and abandoned another ~580 MB table. August
  spent 11,557,744 credits against a 7,500,000 ceiling without finishing.
- **A budget-stopped sweep now drops its own seen table** instead of keeping it
  "for forensics". It can never be used again, so keeping it only accumulated
  storage.
- **Revocation cleanup is deliberately NOT extended across segments**, and the
  reason is in `SweepCheckpoint`. Carrying the seen table across resumed
  segments would have been the obvious design and is a data-loss path: cleanup's
  integrity guards (a 100,000-row floor and a seen-vs-upserts ratio) are
  per-table, so an accumulated table describes the _earlier_ segments. A final
  segment that swept its whole range and silently returned nothing (a Neynar 404
  maps to `[]`, and `failedCalls` only counts nulls) would add zero wallets,
  trip no guard, and clear every pure-sweep row in the range it was meant to
  cover, deleting outright the rows the sweep was the only source for. Order
  10^6 rows. The floor's own comment claims to catch exactly that, and does on a
  single-run sweep, where the count really is zero.
- Cleanup therefore still requires one run covering the whole range, which is
  what it required before. It also now checks `fidsRequested` against the range
  rather than treating "did not budget-stop" as "covered it", and tests
  `budgetStoppedAtFid !== undefined` rather than truthiness, since FID 0 is
  falsy and would have fallen through to the branch that cleans up.
- `clearSweepCheckpoint` upserts `'null'::jsonb` rather than deleting the row:
  `sweep_runner` has INSERT and UPDATE on `ingest_state` but **not DELETE**, so a
  `DELETE` would have thrown on the success path immediately after cleanup had
  already cleared rows. It passes locally, where the owner role has DELETE.
- Checkpoints are validated on read (`isUsableCheckpoint`). A missing, null,
  zero or string `nextFid` each sweeps nothing while looking like a completed
  run.
- **Only `--full` and `--resume` write a checkpoint.** Lifting the write out of
  the seen-table branch to serve the resume path dropped the mode guard with it,
  so a `--range 1 50000` validation run that budget-stopped would have
  overwritten a real full-sweep checkpoint with its own narrow range. The next
  `--auto` would resume that span, complete it, clear the checkpoint, and the
  full sweep's progress would be gone with nothing reporting it. Found by Bugbot
  on the second review pass; the first pass returned no findings.

### 2026-08-24 (the money is backed up, constrained, and the banned figure is gone)

- **`credit_lots` and `credit_ledger` are in the nightly backup.** They are the
  only record of who paid and what they spent, `db-backup.yml`'s own header says
  it captures "the irreplaceable tables", and they were not in it. The dump
  covered 6 of 30 tables; it now covers 8. Both the `-t` entry and the
  `backup_reader` grant are needed, and `pg_dump` fails outright if they
  disagree, which is the right failure mode.
- **`scripts/migrate-grant-readonly.ts` now grants both read-only roles**,
  `sweep_runner` (CI) and `backup_reader` (the dump), from one table list each in
  one file. Two scripts with one list each is how the second stops being
  maintained.
- **Foreign keys on the two money tables.** `credit_lots.user_id` and
  `credit_ledger.user_id` now reference `users(id)`. Both columns were already
  `uuid` and `NOT NULL` with zero violations across 106 rows, so this is a
  catalog change with a 106-row scan, instantly reversible with `DROP
CONSTRAINT`. Applied by `scripts/migrate-money-fks.ts` against the **direct**
  endpoint, with `SET LOCAL lock_timeout` inside an explicit transaction.
- **`NO ACTION`, not `CASCADE`, unlike the four other keys to `users`.** A
  purchase record must outlive the account that made it. **Deleting a user who
  holds credit lots now fails** instead of silently deleting their payment
  history: a loud failure is recoverable, a silent deletion is not. 22 user rows
  were deleted in the current stats window by something outside this repo.
- **A non-uuid `userId` is rejected at `/api/jobs`.** Two values in `lookup_jobs`
  came from a harness outside this repo and are the reason a join from that
  column throws. Rejected rather than null-coerced, because a NULL `user_id`
  marks a system job whose partial results are withheld from every caller.
  `lib/user-id.ts` regenerates a corrupt localStorage value so a browser holding
  one self-heals instead of getting a permanent 400.
- **The uncited "~2.5% industry average" is gone from the last four surfaces.**
  It was purged from every public surface on 2026-08-22 and survived in
  `README.md`, `PROJECT_OVERVIEW.md`, the email sequence and the SEO draft. All
  four now say "low single digits", qualitatively, as CLAUDE.md requires.

### 2026-08-24 (`npm run db:push` refuses, and the ingest tables become visible)

- **`db:push` would have dropped eight tables holding 4.25M rows.** Measured
  against production: `drizzle-kit push` produced a 118-statement plan, 58 of
  them destructive, opening with `DROP TABLE ... CASCADE` on `x_accounts`
  (448,069 rows), `wallet_holdings` (121,826),
  `farcaster_sweep_seen_1786631580832` (3,676,509), `seeded_contracts`,
  `ingest_state`, `x_handle_attempts`, `clanker_unresolved_ids` and
  `farcaster_sweep_seen`. It also wanted to drop two `social_graph` indexes with
  no re-create, which puts a live endpoint onto a sequential scan of 5.1M rows.
  **None of the eight is in the nightly backup.** `ingest_state` is the smallest
  and the worst to lose: its five jsonb rows are every sweep checkpoint and
  budget counter, nine days before the X-handle sweep restarts.
- The command was documented in CLAUDE.md, README.md and PROJECT_OVERVIEW.md,
  and `push` only prompts on a TTY: in CI or with `--force` it does not ask. It
  now refuses via `scripts/db-push-refuses.mjs`, which carries the measurement so
  the refusal cannot be deleted as a mystery. The real command survives as
  `db:push:unsafe` for a scratch database or a Neon branch.
- **The seven declarable ingest tables are now in `db/schema.ts`** as read
  models, with column types read out of the live database rather than copied from
  the migration scripts. `farcaster_sweep_seen_1786631580832` cannot be declared,
  because `lib/farcaster-sweep.ts` creates it at runtime with a timestamp suffix;
  that is recorded in a comment instead. Four partial-index predicates and two
  `social_graph` indexes are still not reproduced, and the comment says so rather
  than leaving them to look like oversights.
- **CLAUDE.md gains a "Schema changes" section**: hand-written SQL in
  `scripts/migrate-*.ts` with the owner URL is the sanctioned path; `db:generate`
  was abandoned in January and its journal has never matched the database; and
  DDL must run against the **direct** endpoint, not the pooler, because Neon's
  pooler keeps a bare `SET` on a shared backend across client connections.
- **No database change.** Nothing in this entry mutates a row, a column or a
  constraint. Rollback is `git revert`.

### 2026-08-23 (a guard that opens a browser)

- **`scripts/check-control-height.mjs`**, the first guard here that can answer
  "what height did this actually render at". Every visible element carrying
  `h-control` or `size-control` must measure the token, on three pages at six
  widths from 320 to 1280, and no page may scroll sideways. 174 rendered
  controls checked per run.
- **It checks only elements that declare the contract**, so there is no
  exception list and no judgment about what counts as a control: an element that
  never asks for the control height is not one. The responsive forms
  (`sm:h-control`) are skipped for the same reason.
- **No dependency, no browser download.** It drives the runner's own Chrome over
  the DevTools protocol through Node's built-in WebSocket. The alternative was a
  test-runner dependency and a ~180MB Chromium per CI run to send three CDP
  messages. It starts `next dev` with `DATABASE_URL` blank, so it needs no
  secrets; the pages it measures all render without one.
- **Its fixture is the bug it was written for.** Like the other guards it proves
  itself before reporting, and that matters more here: a detached browser, a
  selector matching nothing, or a settle that fires before the font loads all
  produce an empty violation list, which reads exactly like a healthy page. So
  it measures the 22px `flex-1`-in-a-`flex-col` case, which it must catch, and
  the `sm:flex-1` correction, which it must not flag.
- **Verified against the real regression, not only the fixture.** With the fix
  reverted in `InputMethodPicker.tsx` it reported 8 failures and exit 1, at
  320/360/390/430 and clean at 768/1280, which is the defect's exact signature.
  The failure message names the cause and the two correct spellings.
- `docs/DESIGN-LANGUAGE.md` Enforcement now lists four guards rather than two,
  and records that its own "a grep cannot answer whether this renders" paragraph
  described a live defect for as long as it stood unenforced.

### 2026-08-23 (the homepage gets the phone pass the header already had)

- **The two alternates were 22px tall on every phone.** `altClass` carried a
  bare `flex-1`, and `flex-1` is `flex: 1 1 0%`: on a flex item the basis
  supplies the main size, so `height` is never consulted. Below `sm` that row is
  `flex-col`, so the 0% basis replaced `h-control`, the container had no free
  space to grow into, and `min-height: auto` dropped each pill to its content
  height. `sm:flex-1` restores 34px on a phone and changes nothing above it.
  Measured 22px at 320/360/375/390 and 34px at 640 before, 34px everywhere
  after, which is why no desktop review ever caught it.
- **The same defect, one card down.** The reverse-lookup field measured 35.5px
  against a Segmented and a button at 34px: three heights in one control row,
  the exact failure `--height-control` was created to end, reappearing three
  panes below the header where it was first fixed. Now 34/34/34.
- **The proof row cost 137px on a phone and 69px on a desktop.** Three figures
  need 273px; two 48px gaps ask for 369px against the 342px a 390px phone
  leaves, so the row wrapped 2 + 1. `gap-x-4` below `sm` fits it on one line
  down to 360. The opening block goes 263px to 195px and the dropzone's top edge
  394px to 326px.
- **The chain strip stopped dangling its separator.** `.join(' · ')` is 410px
  natural and wraps at every phone width, so line one ended on a middot. Laid
  out as flex children with a gap, which is the ruling the proof row above it
  already carried. The middots go at every width, as they did there.
- **The dropzone drew a white halo in dark mode.** Its class string hand-copied
  four of `FOCUS_RING`'s five classes and dropped `ring-offset-background`;
  Tailwind's initial ring-offset colour is `#fff`, so the page's primary action
  painted a white gap inside its own focus ring. It imports the shared string
  now.
- **DESIGN-LANGUAGE.md named sixteen tokens that do not exist.** `--h-ctl`,
  `--r-container`, `--t-display`, `--d-base`, `--e-out` and the rest resolve to
  nothing; every occurrence in the codebase was inside a comment. Renamed to
  what `globals.css` actually declares. The doc's own first line is "If a value
  is not here, it should not be in the code."
- **Two sections added to the doc**: the flex-item rule above, with the
  measurements, under Control height; and "The page on a phone" beside "The
  header on a phone", which had a measured pass over one row and none over the
  body. Also the arithmetic for why the control height stays 34px: `size-control`
  takes width from the same token, and 44px puts the phone header 16px over a
  320px screen.

### 2026-08-23 (llms.txt rewritten, and Venice.ai joins the Ask AI row)

- **/llms.txt roughly triples**, from a summary with four link lists to a file
  an assistant can answer from without visiting the site. New sections: who it
  is for and the jobs people hire it for, what a match is and what it costs,
  the five evidence classes and the quality-score bands, the four reachability
  states (including `reassigned`, which the file had never named), coverage as
  two numbers rather than one, and the API in prose. The Product section gains
  `/holders` and the shape of a per-collection report URL; Docs gains the two
  product-side pages and Scan depth; every comparison entry gains the one claim
  its page actually makes; all 26 blog posts are listed with descriptions.
- **Every figure interpolates a constant**, including the ones just added
  (`X_HANDLES_HELD`, `KNOWN_AGENTS`) and the API limits, which now come from
  `API_PLANS[CREDIT_API_PLAN]` rather than being typed. The reason is written
  into the route's header: `check-published-figures.ts` reads this file's
  _source_, so a literal typed here is invisible in both directions, and only
  the four hardcoded percentages are actually watched. All 57 figures pass.
- **The chain rates are labelled.** "Base 46.2%, Ethereum 16.6%" now says what
  it measures ("have an X or Farcaster account") and when it was measured, and
  the two-number rule is stated beside it rather than left implicit.
- **Venice.ai joins the Ask AI row.** It takes no prefill parameter:
  `?prompt=`, `?q=`, `?message=`, `?text=` and `?input=` were each checked
  against the rendered app on 2026-08-23 and all five land on an empty
  composer, so the link opens the chat and the visitor types. Recorded in the
  code rather than discovered again by the next person.

### 2026-08-22 (marketing and docs audit: 6-auditor sweep, 49 files corrected)

- **The uncited "2.5% industry average" and its "9x" derivative are purged**
  from every public surface: docs, homepage JSON-LD, llms.txt, the welcome
  sequence, and eleven blog posts (one retitled). Comparisons now use our
  measured figures or "low single digits, published by typical tools".
  CLAUDE.md and the positioning doc (v3) ban the number so it cannot return.
- **Provider names removed from public copy**: three blog posts named data
  vendors; they now describe evidence classes and mechanisms only.
- **Resolution vs reach un-conflated across seven posts**: 22% is the
  any-identity rate; the messageable X-or-Farcaster share (~13%) is now
  stated wherever "reachable people" were counted from the larger number.
- **Figure integrity**: the owner-attested claim's checker query now counts
  the four new attested sources (the Sybil import had moved the measured
  share under the published floor with nothing wrong); its watch list gains
  the four /vs pages and two comparison posts, and the pattern survives JSX
  line wraps. A known-agents claim (13,622, live-verified) joins the
  registry with new `KNOWN_AGENTS` constants. The docs coverage page's
  stale 95.9% resolution coverage is corrected to 98.1%, and
  "We resolved every X handle" lost its "every". 54 figures, all passing.
- **Truth fixes**: "Most bought" (no sales data) is now "Recommended"; the
  free allowance reads "rolling 30-day window" everywhere instead of
  "every 30 days"; /vs/holder speaks of Holder in the past tense with the
  retired treatment and drops a "forever" promise; the Addressable OG
  description matches the body's pricing claim; cache TTL corrected to 7
  days in two posts; the priority-score post now describes the formula the
  product actually computes (Farcaster followers, a paid field); two posts
  stop claiming a public agent dataset that does not exist; the fabricated
  "[DAO Name]" case-study attribution is anonymized; blog JSON-LD stops
  stamping dateModified with render time; an uncited "80% of builders"
  claim went qualitative in three posts.
- **Docs-site accuracy**: INVALID_CURSOR joins the error table, the
  reverse-Farcaster example drops reachability fields the API never
  returns there, examples use x.com, quickstart marks which flow steps
  need a pack, and chain lists and counts interpolate their constants.

### 2026-08-22 (the Snapshot and OpenSea harvests go on weekly crons)

- **Two scheduled workflows**: `snapshot-profile-harvest` (Sunday 06:00
  UTC, 500 hub requests a week, walks the users table from its checkpoint)
  and `opensea-account-enrich` (Sunday 06:30 UTC, 200 wallets against the
  missing-X default). Both idle cheaply once their pools drain.
- **`scripts/migrate-grant-harvest-writes.ts`** (run 2026-08-22): the
  attested-link ingest writes social_graph, handle_conflicts and
  ingest_state, and `sweep_runner` held write on only the first — no
  ingest_state grants at all and read-only handle_conflicts — so a harvest
  cron on that role would have died in CI with "permission denied", the
  exact trap CLAUDE.md documents for reads. Granted SELECT/INSERT/UPDATE on
  both (no DELETE; a scheduled job holds nothing it does not need).
- The Sybil import ran the same day: 2,615 rows carry `sybil_list`
  (2,100 new wallets, 257 fills, 258 corroborations) and 166 conflicts are
  recorded for the resolver.

### 2026-08-22 (three more attested-link sources: Sybil, Snapshot, OpenSea)

- **`scripts/import-sybil-list.ts`**: Uniswap's deprecated Sybil delegate
  registry, a frozen public JSON of signature-verified wallet-to-handle
  pairs. Dry-run against the live graph: 2,781 usable links, 2,100 new
  wallets, 257 fills, 258 corroborations, 166 conflicts to record.
- **`scripts/harvest-snapshot-profiles.ts`**: Snapshot profiles are set
  with a wallet-signed message and may name a Twitter handle. Walks the
  public hub API oldest-first with a checkpoint in ingest_state and a
  per-run request budget.
- **`scripts/enrich-opensea-accounts.ts`**: OpenSea accounts are wallet
  logins with OAuth-connected socials. Per-address enrichment, defaulting
  to the most-followed Farcaster wallets missing an X handle. The endpoint
  sometimes returns a numeric X user id instead of a handle; those are
  counted and skipped, because an id is only ever stored beside the handle
  it belongs to.
- All three are thin adapters over the shared attested-link ingest, with
  sources `sybil_list`, `snapshot_profile` and `opensea_profile` wired into
  the public-source allowlist (attested-social), `calculateQualityScore`
  (+25 peers) and `isTwitterVerified`. Every script is dry-run by default.

### 2026-08-22 (DeBank binding-tweet harvest, written ahead of credits)

- **`scripts/harvest-debank-bindings.ts`**: DeBank's Twitter binding flow
  makes users tweet their wallet address from their own account, so the
  corpus of those tweets is a public set of owner-published handle-to-wallet
  attestations. The script sweeps X search for the two template phrases in
  windows and hands the pairs to the shared attested-link ingest
  (`lib/attested-links.ts`), which owns the fill-only rules, the agreement
  gate, conflict recording and the quality contract; the script adds one
  corpus-specific rule (a handle spraying bindings across more than three
  wallets is dropped). `debank_tweet` is wired as an attested-social peer:
  the public-source allowlist, `calculateQualityScore` (+25) and
  `isTwitterVerified`. The last of those also gains `eas` and `clanker`,
  which wrote `twitter_verified = true` on ingest but were missing from the
  recompute, the exact bug the ethos entry there documents. Dry-run by
  default (read-only classification of what a commit would do);
  interrupt-safe checkpoint in ingest_state; stops cleanly on a request
  budget or a 402. Needs `TWITTERAPI_IO_KEY` with credits, which is why it
  ships unrun.

### 2026-08-22 (footer: Farcaster, llms.txt, and ask-an-AI links)

- **@walletlink on Farcaster** joins X and GitHub in the footer's social
  row, now that the account exists.
- **llms.txt is linked** beside the copyright, so the page written for AI
  crawlers is discoverable by the people who check for one.
- **"Ask AI about walletlink.social"**: prefilled-question links to
  ChatGPT, Claude and Perplexity above the legal row. The assistants read
  /llms.txt and the public pages; the question is deliberately neutral so
  the answer is theirs to give.

### 2026-08-22 (the holder hub stops listing unfinished measurements)

- **A listing floor on /holders, the sitemap and prerendering**: a report
  appears only once it shows at least 20 reachable people at 5% or more of
  its measured holders (`LISTING_MIN_REACHABLE`, `LISTING_MIN_RATE` in
  `lib/holder-pages.ts`). Three collections listed 0% reachable when in
  fact under half a percent of their holders had ever been checked: the
  resolution jobs never ran under the API budget pause, and a zero that
  means "not yet checked" was published as a finding. The floor keys on the
  reachable count because it only ever undercounts, so a collection
  graduates onto the hub automatically at the revalidation after its
  measurement catches up. Below-floor pages stay live at their direct URLs.
- **The hub label leads with the outcome**: "(N reachable people)" replaces
  "(2,000 holders measured)", which claimed measurement the budget pause
  had not delivered. Listings order by reachable people, best first.
- **Below-floor pages say why their numbers are small**: a caution note
  ("Measurement in progress: N of M holders checked so far") renders
  whenever such a page has under half its holders checked. A fully checked
  page that still misses the floor carries no note, because there the
  numbers are the finding.

### 2026-08-22 (the results table gains the attested filter and a row-detail dialog)

- **"Attested only" pill**, first in the filter row: isolates exactly the
  distinction the product is sold on, through `attestationOf` so the pill
  and the gutter dot share one definition. Ungated: the dot already shows
  on every free row.
- **A row-detail dialog** on the shared modal anatomy surfaces what the
  grid holds but hides: full copyable address (the same in-place swap),
  evidence and reachability states with visible labels, Lens, GitHub,
  Farcaster bio, the second X handle, and the agent fields on agent rows.
  Opened from a pinned per-row details button in a new trailing column,
  keyboard reachable, titled by ENS, handle, or wallet.
- These are the openstatus data-table patterns judged worth porting;
  the assessment deliberately skipped the installable blocks, the command
  palette, cell renderers, and infinite scroll as mismatched to this
  token-native client-side grid.

### 2026-08-22 (premium polish: the guidelines audit and the motion pass land)

- **Two data-honesty bugs.** The results table rendered every holdings value
  as USD even when the column is a token balance ("Bag"); it now formats a
  plain decimal in the browser locale. And the holder pages typed the
  free-allowance figures; they interpolate the constants.
- **Accessibility across the grid and checkout**: the attestation dots carry
  sr-only text, "Copied!" is a status announcement above the sticky header,
  the search input has a name, error and caution panels announce, the email
  field autofills and focuses on validation failure, loading buttons keep a
  text label, and username inputs stop autocorrecting.
- **An unsaved completed lookup warns before the tab closes**; exporting or
  saving clears the guard.
- **Motion joins the system**: row hover and the sort arrow use the motion
  tokens (the arrow rotates instead of teleporting), the sort header gets
  the one focus ring and the one press transform, copy toast, checkout
  errors and the Buy button's label swap share one fade-in mechanism, dead
  shimmer CSS is gone, and disabled controls fade rather than snap (opacity
  joins .transition-control, kept under reduced motion; decided today).
- **"Top influencers (1K+)" is gated** behind credits with the lock
  affordance: ungated, it leaked the locked follower signal one bit at a
  time (decided today). Also: one empty-cell character everywhere, real
  ellipses, prose links get the link-variant affordance, the Farcaster
  platform colours become tokens, and the pricing h1 carries its emphasis.

### 2026-08-22 (holder reachability reports: the programmatic SEO play ships)

- **`/holders/[chain]/[address]`: a report page per seeded collection.**
  Every page ranking for "[collection] holders" lists bare addresses; these
  answer who the people behind the wallets are and how many are reachable,
  from the index at hourly ISR (61 pages at launch, growing with the daily
  seed cron; no static figure literals, so nothing joins the figure
  checker by its own rule). Labels keep the discipline: "holders measured"
  and identity counts stay distinct from the attested-green "reachable
  people" number; the 2,000-holder measurement cap is disclosed on capped
  collections; aggregates only, never a wallet or handle list.
- **An overlap section links the mesh together** ("these holders also
  hold", seeded collections only), plus a `/holders` hub grouped by chain,
  sitemap entries (hub 0.8, reports 0.7) and a footer link.
- **`scripts/cast-farcaster.ts` and `scripts/setup-farcaster-signer.ts`**
  (PR #150): casting as @walletlink through an approved Neynar managed
  signer, dry-run default, budget-gated.

### 2026-08-22 (the welcome sequence goes live for new signups)

- **The five-email welcome sequence sends, daily at 15:00 UTC.** Jake
  approved the copy (his edits in `docs/EMAIL-SEQUENCE.md` are canonical and
  are mirrored verbatim in `lib/welcome-sequence.ts`, with `**bold**` and
  `*italic*` markers now rendered by the lifecycle template).
  Enrollment starts at accounts created on or after 2026-08-23: the earlier
  ~100 signups stay reserved for the relaunch campaign, which has still not
  been sent. **Corrected 2026-08-24: it was sent on 2026-08-23**, 100 granted
  and 100 emailed, 0 failures. Those accounts now hold credit lots, so the
  purchase rule excludes them from the welcome sequence independently of the
  cutoff. Exits: any credit lot, opt-out, legacy tier, whitelist. Every
  send is at-most-once via `lifecycle_emails`; a missed day catches up one
  email per user per run. The cron heartbeats as `welcome_sequence` and the
  admin health pane watches it.

### 2026-08-22 (/llms.txt: the marketing site becomes citable)

- **`/llms.txt` exists** (`app/llms.txt/route.ts`). The docs site already
  auto-serves its own; this is the marketing half, so an answer engine asked
  "how do I find the X handle for a wallet address" has a plain-text,
  citable statement of the product, the coverage facts, and the pricing
  model. Every figure interpolates the shared constants where one exists;
  the reachability and owner-attested sentences are phrased to match their
  declared patterns, and the route joined those claims' watch lists in
  `scripts/check-published-figures.ts` (40 figures checked, up from 36).
  No provider names, no refund ambiguity (the no-refund policy is stated).

### 2026-08-22 (the admin panel reads what the instrumentation writes)

- **The checkout funnel shows the step it was blind to.** The Revenue tab
  gains "Reached Stripe" (checkout_redirected) between started and completed,
  plus a caution line with checkout_failed counts and their reasons. Both
  events existed to explain the started-to-completed gap and were write-only
  since they shipped.
- **Paywall triggers surface on the Behavior tab.** New
  `getPaywallTriggers` + `/api/admin/analytics/paywall`: buy-credits modal
  opens grouped by the gate that opened them. The per-gate names shipped
  earlier today; rows named `limit` and `feature` are the legacy labels.
- **Lifecycle email lands on the Growth tab.** New `getEmailStatus` +
  `/api/admin/email`: sends by email key from the `lifecycle_emails` ledger,
  plus the opt-out count. Both were readable only through ad-hoc SQL.
- The health pane now watches the 08:40 handle-conflict resolver cron (its
  heartbeat existed; the JOBS list did not know it), and the dead
  `getEventCounts` helper is gone.

### 2026-08-22 (/pricing through the critical readers, and two figures stop being typed)

- **The pricing copy survived a 7-critical-readers pass.** Headline is now
  "Pay per match. Misses cost nothing." (the model in the H1 slot instead of
  an "X, not Y" template); the lede carries the evidence claim and the
  free-proof line; "honest" is no longer self-applied; and a new FAQ entry
  states the refund policy plainly: no refunds, check first with the free
  allowance (decided by Jake 2026-08-22, recorded in
  .agents/product-marketing.md v2).
- **"12 months" and "seven chains" are derived, not typed.** New
  `CREDIT_LIFETIME_MONTHS` in lib/packs.ts; `CHAIN_COUNT_WORD` now imported
  where it was retyped. Interpolated at every surface that said either:
  /pricing, PackPricing (all /vs pages), the layout JSON-LD, the success
  page, and the buy-credits modal.

### 2026-08-22 (/pricing exists)

- **`/pricing` is a page.** Until now the packs rendered only inside the
  buy-credits modal and on the /vs pages, so "walletlink pricing" searches
  and AI agents shortlisting tools found nothing at a URL. The page reuses
  `PackPricing` (every number a constant), computes its worked example from
  `MEASURED_MATCH_RATE`, answers the five pre-purchase questions in visible
  prose, and opens the buy-credits modal with the `pricing-page` trigger.
  Added to the sitemap at 0.9 and to the footer Product column. The
  site-wide FAQPage JSON-LD already carries the pricing answer, so the page
  adds no second structured-data block.

### 2026-08-22 (lifecycle email pipeline and the relaunch Trial-grant campaign)

- **Lifecycle mail exists as a category, separate from transactional.**
  `sendLifecycleEmail` in `lib/email.ts` sends with List-Unsubscribe and
  one-click headers, replies to help@walletlink.social, and refuses to send
  without `EMAIL_UNSUBSCRIBE_SECRET` (a send with no working unsubscribe is
  not a degraded send, it is one we must not make). Magic-link and purchase
  mail are unchanged and ignore the opt-out.
- **Schema: `users.email_opt_out` and the `lifecycle_emails` send ledger**
  (unique on user and email key, so every lifecycle send is at-most-once).
  Migration is `scripts/migrate-email-lifecycle.ts`; **run it before this
  deploys** (drizzle selects declared columns, the twitter_renamed_from
  lesson), then `scripts/migrate-grant-readonly.ts` for the CI role.
- **`/api/email/unsubscribe`**: stateless HMAC verification, GET for the
  footer link, POST for RFC 8058 one-click. Sets the flag and never reveals
  whether an address has an account.
- **`scripts/relaunch-trial-grant.ts`**: grants the Trial pack ($0 lot,
  synthetic payment id, noted) to every account that never bought and sends
  the campaign email. Dry-run default, `--to` preview, `--send` to execute,
  idempotent at both steps. Nothing has been sent. **Corrected 2026-08-24:
  sent 2026-08-23**, 100 grants and 100 emails, 0 failures, 25,000 matches
  granted. Track it with `scripts/relaunch-report.ts`.
- Funnel figures that motivated this (measured 2026-08-22): 102 accounts, 93
  from 2026-01, 11 ever ran a lookup, 0 ever bought, 2 signed in within 30
  days. Activation is the failure point, so the campaign gives the dormant
  list a concrete reason to return.

### 2026-08-22 (free-to-paid: gate analytics, checkout prefill, email sequence drafts)

- **The buy-credits modal logs which gate opened it.** `useUpgradeModal().open`
  takes an optional trigger name, and every gate passes its own:
  `export-x`, `column-followers`, `column-priority`, `reverse`,
  `contract-import`, `contract-import-link`, `deep-scan`, `submit-blocked`,
  `limit`, `limit-banner`, `header`. Before this every open logged as the
  generic `limit` or `feature`, so nothing could say which gate converts.
- **Signed-in buyers no longer retype their email at checkout.** The modal
  seeds an empty email field from the session on open; a deliberately typed
  different address survives.
- **`docs/EMAIL-SEQUENCE.md`: a five-email welcome sequence, drafted and
  stress-tested, not wired.** Copy passed a 7-critical-readers pass (one
  critical, six high findings fixed). The file carries the implementation
  plan: opt-out column, unsubscribe endpoint, state table, daily cron.
  Nothing sends without Jake's approval.

### 2026-08-22 (product marketing context document)

- **`.agents/product-marketing.md` is the positioning source of truth for
  marketing work.** Auto-drafted from README, `lib/public-figures.ts`,
  `lib/packs.ts` and the /vs pages; every figure in it is verified, and it
  bans quoting numbers that are not in `lib/public-figures.ts`. Marketing
  skills read it automatically, so positioning is defined once. Known gaps
  flagged inside: verbatim customer language and testimonials.

### 2026-08-22 (two open copy decisions closed)

- **The homepage headline is confirmed.** "Wallets in. People out." stays; the
  placeholder marker in `app/page.tsx` is gone.
- **The Buy credits dialog keeps its display-size title.** The one named
  exception to the dialog anatomy is now decided, not pending:
  `docs/DESIGN-LANGUAGE.md` records the reason (the purchase moment earns
  display type).

### 2026-08-22 (reverse lookups paginate, and the slice is no longer arbitrary)

- **`/v1/reverse/twitter/{handle}` and `/v1/reverse/farcaster/{username}` take
  a `cursor` query parameter and return `meta.next_cursor`.** Keyset
  pagination over (`fc_followers DESC NULLS LAST`, `wallet ASC`), encoded and
  strictly validated in `lib/reverse-cursor.ts`; a cursor the API did not
  produce answers `400 INVALID_CURSOR`. The +1-row probe makes `next_cursor`
  exact, and `truncated` now means more results remain after this page (on
  the first page that is the same signal as before).
- **The routes gained an ORDER BY.** They served an arbitrary, nondeterministic
  100-row slice; they now walk Farcaster reach first with the wallet address
  as tiebreak, matching the web app's `/api/reverse` ordering, which also
  makes the "ordered by Farcaster reach, matching the API" line in
  `docs-site/app/lookups.mdx` true.
- Billing is per page: 2 rate-limit units per request, 1 match credit per
  wallet returned, unchanged in rate.
- Docs: both reverse pages document `cursor`, `next_cursor`, the ordering and
  the live-index caveat; the "no pagination" paragraph is gone.

### 2026-08-22 (api_usage stores route templates, not concrete paths)

- **`api_usage.endpoint` now holds the route template.** The three
  parameterized `/v1` routes pass `/v1/wallet/{address}`,
  `/v1/reverse/twitter/{handle}` and `/v1/reverse/farcaster/{username}` as
  literals, and the dormant `withApiAuth` wrapper derives the template with
  the new `routeTemplate()` in `lib/api-usage.ts`. This bounds
  `requests_by_endpoint` in `/v1/usage` at one key per route, and it stops
  persisting the addresses and handles a customer looked up in an analytics
  table that echoed them back.
- **`scripts/migrate-endpoint-templates.ts`** rewrites the already-written
  rows to the templates. Hand-written idempotent SQL, per the migration
  pattern; it verifies that no concrete path remains under the three routes.
- `docs-site/api-reference/usage.mdx` documents the new keying and drops the
  unbounded-cardinality warning.

### 2026-08-22 (the renamed-from guard covers the fill-if-empty ingests)

- **`lib/ens-harvest.ts` and `lib/attested-links.ts` refuse a fill equal to
  `twitter_renamed_from`.** Both writers only fill a NULL `twitter_handle`,
  and the stored handle is NULL exactly on rows that were cleared, so an ENS
  text record or an attested link that still carries the dead string could put
  it back. A refused fill writes nothing: no handle, no url, no user id, no
  source label, no quality bump, no timestamp. With this, every social_graph
  writer that carries an incoming X handle holds the guard, and the
  `lib/conflict-resolution.ts` header now documents that invariant.
- **Stale records corrected.** `PROJECT_OVERVIEW.md` closed the open item (the
  sweep and live lookup guards shipped in PRs #135/#136), and
  `docs/DOCS-SITE.md` now records the Mintlify GitHub sync as connected, which
  it has been since content merged to `main` started publishing.

### 2026-08-22 (handle conflicts: the unreachable bucket resolves itself)

- **Bucket 1 of the conflict queue resolves automatically.** Measured on
  2026-08-22, 1,602 of the 2,914 open `handle_conflicts` had our stored X
  handle reaching nobody (`not_found` 1,363, `unavailable` 239) while the
  handle an attested source named was live, and in 1,598 of those the source
  also supplied the numeric id of the account, which matched. A customer who
  sends to our handle there reaches nobody, so there is nothing to protect by
  keeping it. `lib/conflict-resolution.ts` accepts theirs when the conflict is
  unresolved, the graph still serves the handle the conflict calls ours, the
  row is not admin-curated, ours is `not_found` or `unavailable` on a check no
  older than 7 days, theirs is live with an id on a check no older than 7
  days, and any id the source supplied equals the live one. A source with no
  id (the onchain attestation sweep) qualifies on liveness. Stale or missing
  checks are re-run first through `sweepHandles`, within a credit cap, one
  lookup to a row before two, rows whose our side is already known dead first.

- **What accepting writes.** `social_graph.twitter_renamed_from` = the old
  handle (new nullable column; `scripts/migrate-handle-renames.ts`, hand-written
  SQL, idempotent, no grant needed), `twitter_handle` = theirs, `twitter_url`,
  `twitter_user_id` = the source's id or the live one, `twitter_verified` =
  true, the source appended to `sources` without duplicates, `last_updated_at`
  = now(); `handle_conflicts.resolved_at` = now() with `resolution`
  `accepted-theirs: ours unreachable`; the wallet's `wallet_cache` row is
  deleted so the old handle is not served from cache for up to 7 days.
  **Apply the migration before this deploys**: `db/schema.ts` declares the
  column, and every `db.select().from(socialGraph)` in `lib/social-graph.ts`
  selects it, so a build that reaches production before
  `scripts/migrate-handle-renames.ts` has run fails every graph read with
  `column twitter_renamed_from does not exist`. One
  statement per batch of 500, with data-modifying CTEs, so a batch is atomic on
  the `neon-http` driver, which has no transactions. Every condition is
  re-tested inside the statement. Where two sources both qualify for one
  wallet, the one with an id is taken, every qualifying row naming the same
  handle closes with it, and a row naming a different handle stays open. A
  second run writes nothing.

- **Daily cron `/api/cron/resolve-conflicts` at 08:40 UTC**, after the
  reachability sweep at 08:00, same bearer auth and shape as the other crons,
  `maxDuration` 300, a `handle_conflicts_resolve` event. The recheck spend is a
  fixed `CONFLICT_RECHECK_CREDITS` (default 300, about fourteen lookups) rather
  than a share of the balance, and is refused when the balance cannot be read
  or sits at the reserve; acceptance still runs, since it costs nothing.
  `npx tsx --env-file=.env.local scripts/resolve-handle-conflicts.ts
[--dry-run] [--limit N] [--credit-cap N] [--recheck-days N]` is the manual
  entry. The dry run prints counts, the blocked reasons, what it would re-check
  and a sample of 20, and writes nothing, rechecks included.

- **The first run is the one that matters.** Every check behind the 1,602 was
  made on 2026-08-17, so a run before 2026-08-24 accepts them without spending
  a credit. After that, each row costs two lookups to re-qualify, and the
  default cap clears about seven rows a day.

- **Bucket 2 is surfaced, never swapped.** Where an unresolved conflict has
  both handles live, and any id the source supplied matches the account theirs
  resolves to, the result carries the second handle as `twitter_also`
  (`alsoOnXForWallets` in `lib/handle-reachability.ts`: one query per batch,
  keyed by wallet, `source` mapped through `publicSources`, so a customer sees
  the evidence class and never the provider). Ours stays primary. It appears
  under the X handle in the results row as a muted mono "also @handle" with a
  title saying both accounts reach someone; in the CSV as a `twitter_also`
  column, named like its siblings; in the X list export, which exists to reach
  people, so both handles go in; and in the public API as `twitter.also`
  (`{ handle, url, source }`) on `/v1/wallet` and `/v1/batch`, built in
  `publicTwitterField` and absent, not null, everywhere else. Documented in
  `docs-site/api-reference/wallet.mdx` and `batch.mdx`, which also stop
  claiming that batch omits `twitter.verified`; it has returned it since the
  four routes moved onto one builder. Stamped in `finalizeJobWithResults`
  after reachability, so a saved lookup carries it and a manual correction
  clears it along with the reachability verdict.

- **Admin.** The conflicts pane shows two more tiles, Resolved and Resolved in
  7 days, with the green dot, and the Unreachable hint says the group resolves
  automatically each day. The reader still offers no resolve button.

- **Not closed by this change.** The old handle is still the string Farcaster
  holds for the account, and two writers carry it back over an accepted swap:
  the monthly full Farcaster sweep (`lib/farcaster-sweep.ts`, which treats an
  incoming attested handle as authoritative) and a live lookup that reaches the
  Farcaster API (`lib/social-graph.ts`, which prefers the incoming handle).
  `twitter_renamed_from` is the column those writers need to refuse an
  incoming handle equal to it. Until they do, a swap lasts until the next
  writer carrying the dead string, and the next ingest reopens the conflict.

### 2026-08-22 (vs Formo; Blaze and Airstack marked retired)

- **New comparison: `/vs/formo`.** Formo is analytics and attribution for
  DeFi apps, sold as a subscription (Growth $199 a month billed yearly, $249
  monthly; Scale $399 billed yearly, $499 monthly; read from formo.so on
  2026-08-22 and confirmed in a browser). The overlap is its wallet profiles
  and the Import Wallets feature on Scale, plus a per-address profile over
  x402 at 0.05 USDC. The page prices a 10,000-wallet list three ways with the
  arithmetic shown, computed from `lib/packs.ts`, and says plainly when Formo
  is the right tool. Every Formo figure is dated in the copy. The
  reachability card on this page states the weaker claim the evidence
  supports ("nothing in Formo’s docs says it does") through a new
  `undocumented` prop.

- **Blaze and Airstack are gone; their pages stay.** withblaze.app and its
  dashboard, API and blog hosts no longer resolve (last archived copy January
  2026, no shutdown post found). airstack.xyz redirects to senpi.ai; its app
  and API hosts are down and it deprecated its Farcaster APIs on 2025-03-05.
  Both pages open with a dated "What happened to" section, speak of the
  service in the past tense (`ReachabilityClaim` gained a `retired` prop),
  and drop to priority 0.7 in the sitemap. An unsourced Blaze price was
  removed rather than kept.

- **Footer and related links list live competitors only:** Addressable,
  Holder, Cookie3, Formo. The retired pages link to each other and to the
  live four.

### 2026-08-22 (design review, PR 3 of 3: openings, motion, spacing)

- **Every page opens the same way.** Home now carries the signature the
  comparison pages had alone: a 200-weight display line with one 600-weight
  word, a 300 lede, then a `Figure` row for the three index figures. The
  headline "Wallets in. People out." is a placeholder marked in the code for
  Jake to confirm. `/check`, the blog index, the blog post and admin open on
  the same shape; section h2s are 300/24px everywhere, card titles 600/18px,
  and the reading column is left-aligned on every page.

- **Motion on the scale.** Progress fills, meter bars and the DM progress bar
  animate `transform: scaleX()` at the tokened duration, never `width`;
  `transition-colors` is gone in favour of `transition-control` on every
  surface including `Card` and table rows; the dialog panel arrives by fade
  and `scale(0.97)` over `--d-base` and leaves faster; the close is a ghost
  icon button. `--tracking-body` is applied on `body`.

- **One surface, nine steps.** Every `bg-muted/30`, `/40`, `/50` and
  `bg-card/80` wash is `bg-muted` at full opacity; cards are `p-6`, insets
  `p-4`; the 6, 10, 14, 20 and 40px spacings in the shell, footer, Recent
  wins, dropzone and `/vs` proof strips moved to the nearest step. The
  drag-over scrim is the dialog scrim. One `InlineError` for every error
  beside a control, replacing four shapes.

- **Blog copy.** Titles and table row labels in sentence case; 182 typed
  double hyphens and em dashes replaced with the mark each sentence wanted;
  one list marker. Figures unchanged and re-verified.

- **Admin.** Figures at 200 with tabular numerals, one stat-tile anatomy,
  pane headings and the h1 on the tier, one refresh control, one loading and
  one empty treatment, the conflicts filter as `Segmented` with short labels
  below `sm`, match rates as figures rather than progress bars.

- **Three new guard rules** so none of this comes back: `transition-colors`
  and `transition-all`, a `/NN` wash on a surface token, and a tracking
  literal (`tracking-tight`, `tracking-[-0.028em]`) all fail CI. Recorded in
  `docs/DESIGN-LANGUAGE.md` with the opening shape, the dialog anatomy and
  the left-aligned reading column.

### 2026-08-22 (design review, PR 2 of 3: use the primitives)

- **One figure, one weight.** `Figure` is the hero-figure weight (200) and
  loses its `brand` prop; prices, DM counters, Recent wins and the results
  hero count all render through it. `font-bold` is gone from the app: the
  five-weight scale has no 700, and `strong` now lands on 600 by a base rule.

- **Green is a fact.** The reachable count, the progress counters and pulse,
  a sent DM, a valid key, a delivered sign-in link and a completed purchase
  are `attested`; violet is back to meaning "you can act on this". The
  second green pair kept for the upgrade checklist is deleted.

- **The primitives own the patterns.** One focus ring (`FOCUS_RING`) shared
  by Button, Input, Textarea and Segmented; press feedback on every Button
  variant; the remaining shadcn semantics out of Button, Table and Progress;
  Eyebrow and Badge at the specified 11px, which the design guard now allows
  in exactly those two files. The account menu is `OverflowMenu`; admin
  tables are `Table`, admin chips are `Badge`, admin banners are one error
  and one success treatment.

- **Results.** Locked columns carry one "Unlock" control in the header
  instead of sixteen muted buttons; filters have constant labels and the
  segmented selected treatment; column headers say X handle, Farcaster and
  Farcaster followers; the wallet-cell chips are `Badge`; in-cell text
  controls are the link variant. Export buttons carry one icon and `XMark`.
  Progress stages use Phosphor glyphs, no growing dot or shadow, a green
  pulse, and Cancel at the control height.

- **One word.** "X" in running copy and `XMark` where a mark is wanted, on
  every surface including the share buttons, the overflow menu and admin;
  "Farcaster" in full. One CTA label ("Run a lookup") on the blog post and
  the five comparison pages, through `Button`. The contract dialog's title
  matches its trigger. Related comparisons name each page one way.

- **Dialogs.** Titles on the primitive's one treatment (Buy credits keeps
  its display title pending a decision); one action-row layout via
  `ModalFooter`; radius and inset kept below `sm`; the revealed API key wraps
  instead of scrolling sideways; one external-link glyph.

- **Guard.** The arbitrary-size rule now catches `rem` as well as `px`, and
  the border-opacity rule covers `caution` and `destructive`. The wordmark
  moves from an arbitrary 32px to `text-3xl`, which also puts it on the
  title tracking token.

### 2026-08-22 (design review, PR 1 of 3: defects and the shell)

- **One header on every page.** `PageShell` now renders the account cluster
  itself (balance chip, Buy credits, theme control, Sign in or avatar), so
  `/check`, the five `/vs` pages and the blog carry the same header as home.
  Before this a dark-mode visitor on `/vs` at desktop width had no theme
  control anywhere on the page, and a signed-in buyer there saw no balance.
  The upgrade dialog moved into a provider (`useUpgradeModal`) so the header
  can open it from any route. "Sign in" at every width; below `sm` Buy credits
  is the icon control with an accessible name rather than a "+" pill.

- **Phones can read the results and the blog again.** The results table is
  the product's one genuine data table, and it now scrolls sideways inside its
  own box with the wallet column pinned; it used to clip four columns with no
  way to reach them. Blog tables get their own scroll box, so the post no
  longer scrolls the whole page at 375px.

- **Control edges at 3:1.** Every textarea and the two home alternates drew
  their edge with the decorative hairline (1.26:1). A `Textarea` primitive
  shares `Input`'s edge; the alternates are `Button` outlines. Pending stage
  labels no longer sit at half opacity below AA.

- **Keyboard and screen readers.** Sort headers are real buttons with
  `aria-sort`; icon-only controls have names; form labels are associated with
  their fields; the admin job dialog is the `Modal` primitive with a focus
  trap and Escape instead of a hand-rolled `fixed inset-0`.

- **One badge.** `CHIP` and six hand-rolled chips are `<Badge>`, including the
  two "Credits" badges that sat forty pixels apart in two shapes. A
  `destructive-tint` token joins the other three tints.

- **Smaller defects.** The results heading derives a real name ("4 pasted
  wallets", the CSV file name, "Holders of X") and never falls back to
  "Results"; the cache note reads the 7-day TTL from the constant instead of
  saying 24h; the chat launcher is 48px and sits below open dialogs; admin
  queue health reads its payload instead of hard-coded zeros; measured-good
  admin states are green, not violet; `/vs` capability cells carry alt text
  and the pricing blocks have a gap.

### 2026-08-22 (Farcaster DMs for every pack)

- **Farcaster DMs open to pack holders.** The in-app DM sender had stayed on
  the legacy Unlimited account after the pricing change, because it was not on
  the pack feature list. It is now, and the button, the docs and the two
  pack feature lists say so. The route behind it had no auth at all (it
  proxies Warpcast with the caller's own key); it now requires a session and
  the same entitlement as the button.

### 2026-08-22 (the rest of the product catches up with the pricing)

- **Every surface now describes credit packs.** An audit after the pricing
  change found 168 places still describing the retired tiers: the app UI, the
  API error messages, the admin, the five comparison pages, thirteen blog
  posts, the public docs and the internal docs. All fixed in one branch, so a
  customer, a search engine and the AI assistant get the same answer. Text
  that exists only to serve the two legacy accounts keeps its tier names and
  says so.

- **Pack buyers were refused what the pack sold them, server-side.** The
  client gates were fixed with the pricing change; the routes behind them
  still read `tier`, which a pack never changes. Reverse lookup, contract
  import, adding addresses to a saved lookup and "new since you looked" all
  returned 403 naming Pro or Unlimited. Priority scores and follower counts
  were stripped from every pack buyer's job. Contract import was capped at 500
  holders for an Index buyer. `hasPaidAccess` in `lib/credits.ts` is the
  server twin of the client's `entitled`, and every gate uses it.

- **Two holes in the meter closed.** The free-window sum counted pack-paid
  debits against the free allowance, so the month after a buyer's lots ran out
  reported it exhausted. And `/api/lookup`, the original streaming path the
  UI stopped using in January, ran up to 5,000 wallets per request for any
  signed-in account with no balance check, no debit, and priority scores for
  everyone. Nothing had called it since the move (no rate-limit bucket was
  ever opened for it); it answers 410 with the replacement.

- **API keys need a live pack, not the free allowance.** `available > 0` is
  true for every signup inside its window, which would have let any free
  account mint a key. The server now matches the modal that offers keys.

- **The API says what was billed.** `/v1/batch` returns `meta.matched`, the
  billed count; `found` still counts ENS, Lens and GitHub, so `found >=
matched`. `/v1/usage` returns a `credits` object. `/api/developer/plans`
  returns the packs instead of three monthly plans nobody could buy, and
  `POST /api/checkout` no longer accepts a tier.

- **Admin sees packs.** Revenue is keyed on what was sold (`byProduct`), the
  dependency check watches the four pack price variables, the overview counts
  credit holders, and the per-user control can no longer grant a legacy tier:
  goodwill credit is a lot, not a tier.

- **Removed:** `upgradeUser` and `createCheckoutSession(email, tier)`, both
  uncalled since the pricing change, and the `/api/lookup` rate-limit entry.

### 2026-08-20 (credits, and a rating nobody gave us)

- **Pricing moves from one-time tiers to credit packs, metered in matches.** A
  match is a wallet resolved to an 𝕏 or Farcaster account; a wallet we cannot
  resolve costs nothing. Free is 100 matches every 30 days, then Trial $29 for
  250, Campaign $99 for 1,500, Scale $299 for 6,000, Index $899 for 25,000.
  Credits last 12 months. Still one-time payments: Stripe stays on
  `mode: 'payment'`.

- **The meter was the actual problem, not the price.** Free was 500 wallets per
  lookup with unlimited lookups and no cumulative quota, so the largest job in
  the product's history split into 27 free uploads and the median job of 300
  fitted whole. Nothing the product has ever done needed paying for. A
  per-lookup cap punishes the honest user and rewards splitting a file; the
  allowance is cumulative and account-wide now, so twenty runs of 500 debit
  exactly what one run of 10,000 debits.

- **Why packs rather than the subscription that was proposed.** 95 of 100
  identified people were active in exactly one calendar month and never
  returned, and 104 of 110 person-months consumed under 1,000 wallets. A monthly
  plan against that distribution posts roughly 95% logo churn at month two,
  nine to twenty-five times worse than the worst benchmark bucket for companies
  with no annual option. Packs also avoid building a customer portal, dunning,
  proration and the revocation path that `provisionPaidCheckout` is deliberately
  built without.

- **Why a match rather than a submitted wallet.** The median hit rate on a real
  list is 2.7%, and 29 of 64 real-list jobs returned under 2%. Billing by
  submitted wallet charges people for our coverage gaps. Billing by match makes
  the weakest number in the product irrelevant to what anyone pays, and it is
  the only version of "we do not guess" that reaches the invoice.

- **`aggregateRating` claimed 4.8 from 50 ratings, and there are no 50
  ratings.** The product has 102 accounts, one payment, and no review collected
  anywhere. That was fabricated structured data served to Google and to AI
  assistants, on a site whose whole position is reporting only what it can
  evidence, sitting two hundred lines from a FAQ answer about how carefully we
  distinguish an attested handle from an inferred one. Removed.

- **The two existing paying accounts keep exactly what they bought.** Neither is
  metered, on any path. The Unlimited account gets one condition, an
  anti-enumeration ceiling of 1,000,000 wallets in a rolling 24 hours, which is
  75x the largest job anyone has ever run and cannot reach a customer. Attaching
  any condition to a promise sold without one is a retraction, which is why it
  is set that high and why the message says the cap is on bulk extraction rather
  than on lookups.

- **Export is never capped, on any plan, and that is now a stated position.**
  The export is the product: upload a CSV, get a resolved CSV back. Cookie3 caps
  enriched exports at 5,000 wallets on a $299 plan and `/vs/cookie3` attacks
  them for it, so capping ours would have deleted our own comparison page. What
  gets gated instead is volume, and nothing else.

- **`PackPricing` is one component on five comparison pages**, for the same
  reason as `ReachabilityClaim`: it belongs everywhere and it contains numbers.
  Each page previously hardcoded a pricing section beside an interpolated
  `TIER_PRICES`, so half the figures moved when the constants moved and half did
  not.

### 2026-08-20 (a figure that could only fail by growing)

- **Review fixes, and both were the same mistake twice.** The measurement guard
  hardcoded the expected `13` in the checker instead of reading it from the
  record, which checks that the copy still agrees with the checker rather than
  with the measurement: change the sample's rate in `docs/SEO-STRATEGY.md` and
  everything stays green, which is exactly the failure the guard was added to
  catch. Both rates now come out of the record, so there is one authority and
  the checker is not it. The blog table publishing 23.7% is declared too, having
  been left out of the first version.
- **A consolidation that leaves one copy behind has not consolidated anything.**
  `lib/x-accounts.ts` still asserted its own 417,872 in the present tense,
  outside both claims, in the same commit that corrected the literal everywhere a
  customer reads it. Declared now, on the numerator and the denominator.
- **A dated record of one run is not a claim about the current total.** That file
  also says the first sweep resolved 417,998 handles in a four-hour window on
  2026-08-17, twice, as the evidence for why the staleness threshold is per
  handle. Both sentences are correct and stay correct: rewriting accurate history
  to satisfy a regex is the worse trade. Claims take an `ignoreNear` list for
  this, kept to narrow phrases rather than a file-level opt-out, because an
  exemption has to be honest about what it exempts.
- **And the anchor phrase stopped matching mid-commit, which is the argument for
  all of it.** Reflowing a doc comment split "we hold" across a line, the
  denominator pattern went quiet, and only the check's own NO MATCH line caught
  it. Every word of that phrase now tolerates a comment continuation.
- **The exemption then created the hole it was meant to avoid.** `ignoreNear`
  skipped historical figures inside the comparison loop, but the NO MATCH test
  ran before it, on raw regex hits. So a file whose every occurrence is exempt
  satisfied the test and compared nothing: green, with zero verification.
  `lib/x-accounts.ts` sits exactly there, one reworded sentence away from going
  quiet with two dated historical figures still matching. Exemptions are applied
  before the test now, so the question it asks is "is there a live claim here"
  rather than "did the regex hit anything". Verified by rewording that sentence:
  it fails NO MATCH where it previously passed.

- **A published count sat three days stale and every check reported green.**
  The resolved-handle figure said 417,872 across the docs, the README, the
  reachability panel and the AI prompt while the database held 428,059. Nothing
  caught it, and nothing was ever going to: the claim is declared as a `ceiling`,
  which passes whenever the published number is at or below the truth, because
  understating a count that only grows is safe. Safe is not the same as true. A
  ceiling now takes a second bound in the other direction, `staleBelow`, and
  fails at 2% behind with its own `STALE` line rather than an overstatement
  warning that would read as the wrong problem.

- **One fact, three numbers, again.** 417,872 in five surfaces, 422,990 in
  `lib/handle-reachability.ts`, 428,059 in the database. Its denominator was in
  the same state: 446,070 in one module header, 446,043 in another and in the
  docs, 446,329 in the database. Both now live in `lib/public-figures.ts` as
  `X_HANDLES_RESOLVED` and `X_HANDLES_HELD`, the reachability panel interpolates
  the first the way the homepage already interpolated the index size, and the
  denominator is declared for the first time. A coverage percentage is only as
  honest as the number underneath it, and nothing had ever looked at that one.

- **4.7M and 4.8M are two facts one digit apart, and only one was declared.**
  4.7 million is the Farcaster half; 4.8 million is every wallet with any
  identity. The blog post and `lib/eas-attestations.ts` carried an undeclared
  4.7M that reads exactly like a stale 4.8M. It is neither: it is correct, and it
  was one well-meaning correction away from becoming the wrong number, which is
  precisely how 4.8M, 4.9M and 5M happened the first time. Declared now.

- **The match rates cannot be settled by a query, so they are checked another
  way.** 23.7% any-identity and the ~13% reachable figure beside it came from a
  random sample of 600 holders across 18 collections, not from the database. The
  nearest query measures index composition rather than what a customer's list
  will match, and a green tick against the wrong predicate is a lie with a
  checkmark on it. Instead the measurement carries its date, the check fails when
  the sample is older than 120 days, and the published figure must still equal
  what the sample produced. That catches both real failures: an edit that changed
  the number without redoing the work, and a sample quoted for a year while the
  index it sampled tripled.

- **What is deliberately not declared, said out loud.** "22%" appears in about
  ten blog posts, and the same two digits carry unrelated facts in the same
  folder: one case study's governance participation went from 5.2% to 22.4%. A
  pattern loose enough to catch the match rate catches that too and reports it as
  drift. Declaring them properly is one entry per post, which is a job rather
  than a line, so the checker prints the gap as a note instead of pretending.

- **Four patterns were wrong the moment they were written**, and the check said
  so before this shipped: the resolved-handle window reached 33 characters into a
  neighbouring sentence and read "235,858 persisted negatives" as the claim, the
  denominator pattern matched the numerator sitting one sentence above it, and
  the coverage page's split stopped matching when its sentence moved from "were
  live" to "are live". The registry is only as good as its patterns, and the
  cheapest place to find that out is a local run.
- **A guard whose tolerance is wider than the gap it guards does nothing.** The
  Farcaster claim exists to stop 4.7 being "corrected" into the 4.8
  any-identity figure, and at a 3% tolerance that exact mix-up passed: 4.8
  against a true 4.6996 is 2.14% off. The mirror passed too, 4.7 against a true
  4.813 being 2.35% off. Both are 1% now. The rule a tolerance has to satisfy is
  not "is this close enough to be honest" but "is this tighter than the
  distance to the nearest value it could be confused with".

### 2026-08-20 (a comparison page aimed at the wrong Cookie)

- **`/vs/cookie` argued against a product that does not compete with us.** The
  page was built around Cookie.fun, which indexes AI agents and gates its premium
  analytics behind staking 10,000 $COOKIE. It ranks agent mindshare. It does not
  resolve a wallet list to anybody, so nobody choosing between it and us was
  making a real choice, and the page drew agent traders rather than people with a
  holder list. The competitor is Cookie3, a separate subscription product that
  sells "Advertise: Twitter<>Wallet Matching" as a line item on a published price
  sheet. `/vs/cookie3` replaces the page, and `/vs/cookie` 308s to it rather than
  404ing, because the old URL is in a sitemap that has already been crawled and
  is linked from four sibling pages and the footer.

- **The argument turned out to be a ceiling, not a price.** Cookie3's own plan
  table caps Twitter matching at 10,000 accounts on Website ($59/mo), Basic
  ($299/mo) and Growth ($749/mo) alike. Paying more buys wallet volume and export
  headroom and leaves the cap exactly where it was; only Enterprise, which is
  unpriced, lifts it. So a 50,000-wallet match is not buyable at any published
  price. That is their number rather than ours, which is what makes it worth
  building a page on.

- **Their prices carry the date they were read.** A competitor's price sheet is
  the one fact on a comparison page that goes stale without anything failing, so
  the table says when it was taken. Cookie3 does not make it easy to check: the
  nav "Pricing" link is inert and /pricing 404s, so the real table sits partway
  down /business.

- **The page also says the two Cookies apart.** The names collide, both products
  come from the same orbit, and a reader who lands on the wrong one has no way to
  tell. A short section names which is which and sends the agent-research reader
  where they meant to go.

### 2026-08-19 (a dot that only lined up at one row height)

- **A manual correction now reaches the saved lookups that show it.** Editing a
  wallet in the admin enrichment tab wrote to `social_graph` and stopped there,
  so every completed lookup kept the value a person had just declared wrong.
  A completed lookup is normally a record of what was true when it ran, and that
  is right; a manual edit is the one exception, because its whole purpose is to
  say the stored value was an error. Found on a real import, where a wallet kept
  showing a handle that no longer belongs to its owner after the correct one had
  been entered by hand. Only the corrected wallet's own row is touched, and only
  the fields the edit set.

- **The attestation dot sat below the address it belongs to.** The gutter pinned
  it with `items-start pt-3`, a fixed 12px from the top edge, while every other
  cell in the row is centred by the row's own `items-center`. The two agree at
  exactly one row height and drift at any other, which is why it looked fine
  when it was written and wrong in a screenshot. The gutter now centres like
  everything beside it.

### 2026-08-19 (the Bag, and a list that repeated people)

- **A contract import now shows how much each wallet holds.** Every holder
  source already returned the balance beside the address and all three parsers
  read the address and dropped it. The column itself needed no building: CSV
  uploads have had a holdings column all along, sortable, and feeding the
  priority score. Contract import was the one path that never filled it, so this
  is mostly a matter of stopping the discard and naming the column.
- **Whole units, or nothing.** An ERC-20 balance is an integer in the token's
  smallest unit and means nothing without `decimals`, so `decimals()` joins
  `name()` and `symbol()` on the metadata call. When it does not answer, the
  column is hidden rather than filled by assuming the usual 18: a wrong exponent
  misstates every row by orders of magnitude, and no column is honest where a
  confident wrong number is not. Balances go through `BigInt` before
  `formatUnits`, because a whale balance loses precision in a double well before
  the decimal point.
- **NFTs count items.** `getOwnersForContract` was asking for
  `withTokenBalances=false`; it now asks for true and sums the quantities per
  owner, so ERC-721 reads as the number owned and ERC-1155 as total quantity
  held. The cost is a response that grows with supply rather than with holder
  count, for the same single request.
- **A wallet missing from the map is one we did not measure**, not one holding
  nothing, so nothing is zero-filled anywhere along the path.
- **The header says "Bag" only where it is one.** A contract import is always a
  balance or an item count; an uploaded CSV column may be a USD value, and
  relabelling that "Bag" would be wrong. Same column, same sort, same score.
- **The Twitter list export repeated people.** One person with several wallets
  is several rows and one handle, which is the thing this index exists to
  reveal, and the file listed them once per wallet. Deduped on the lowercased
  handle, since X is case-insensitive and our sources disagree on casing. The
  button's count is now derived from that same list rather than counted
  separately, and the "left out" figure counts distinct dead handles too:
  reporting handles going in and rows left out put two different units in one
  sentence.

### 2026-08-19 (the footer names the company)

- **The site footer now reads "© 2026 Starl3xx Labs LLC"** rather than naming
  the site back to itself, and the byline points at starl3xx.fun rather than at
  an X profile. The year stays derived from the clock, so it is right next
  January without anyone remembering it.

### 2026-08-19 (a first-party consumer, and a sentence that expired overnight)

- **A first-party project now reads the index through the public API**, on its
  own service account with a real plan rather than an internal bypass. One
  account per consuming project, so revoking one touches nothing else and the
  usage panel attributes load to the project that caused it rather than to a
  person who owns several. `scripts/provision-api-account.ts` does it, and
  writes the key to a file at 0600 rather than printing it, because terminal
  scrollback gets pasted into issues.
- **The plan is metered on purpose.** The rate limiter is the only thing between
  a first-party consumer and the live lookup path a customer is on, and the
  Developer plan's 60/min is tight enough to catch the real failure mode of a
  key wired into a bot, which is a retry loop rather than steady load.
- **Provisioning never downgrades, and never pretends to rotate.** `--tier`
  defaults to `pro`, so re-running to mint a second key would have dropped an
  `unlimited` account to Developer limits without a word, and the key's plan came
  from the argument rather than from the account, which is the same downgrade by
  another route. The tier now only ever moves up the ladder, and the plan is
  derived from the tier the account actually holds. Minting also does not revoke:
  that is right for adding a consumer and wrong for a leak, so existing active
  keys are named as **STILL VALID** and `--revoke-existing` is the flag that
  makes a rotation a rotation. `TIER_RANK` moved to `lib/api-plans.ts`, since
  this was the second caller needing to compare two tiers and the first one had
  it as a private const.
- **The reachability docstring had gone stale in one day.** It said coverage was
  "93.7% and falling, because new handles arrive continuously and no scheduled
  job resolves them". The cron scheduled the next day is exactly the job it says
  does not exist, and coverage is now 94.8% and rising, with 422,990 handles
  checked and none left unchecked. The figure guard passed throughout, because
  it checks numbers against the database and this was a false clause sitting
  beside numbers that were merely stale.

### 2026-08-19 (the safe direction was still a dead end)

- **Yesterday's fix worked, and that is how we found the next one.** The Clanker
  sweep held its checkpoint rather than walking past a deploy it could not
  resolve, reported the run as failed, and the failure was real: the frontier had
  stopped at a single block and was 37,372 blocks behind the chain tip.
- **The account id was not an account id.** That deploy wrote the tweet's own
  status id into the `id` field instead of the user id. It is 19 digits, so
  `isAccountId` accepts it, and it names a user that has never existed. The
  resolver answers “no such user” and always will. Holding for a resolver that
  might recover is the right instinct against an outage and the wrong one here.
- **A permanent hold ends ingestion, quietly.** The scan starts at
  `checkpoint + 1`, so a frontier that never advances scans one fixed window.
  `MAX_RUN_BLOCKS` bounds that window to a week, which means once the tip passed
  it the sweep would have gone blind to new blocks while still reporting a run
  every day. That was due about 2026-08-25. The run cap bounds the work; it was
  never going to end the stall.
- **The frontier now gives up on evidence, not on elapsed time.** An id is
  retired after a reachable resolver has denied it on five separate runs, kept in
  `clanker_unresolved_ids`. A block distance measures how long we have been
  stuck and says nothing about the deploy that stuck us; a denial count is about
  the id itself and cannot be manufactured by an outage.
- **Only an answer counts as an answer.** `resolveAccountIds` now reports which
  ids the resolver actually replied about, separately from which it knew. A
  request that fails or never lands records nothing, so a repeat of the
  2026-08-18 outage, when the resolver's env vars were renamed and unset, would
  have added zero attempts rather than spending a fifth of every id's patience.
  This is the same distinction `x_handle_attempts` exists to make for handles.
- **Abandoning is not a failed run, and is still reported.** The range is
  finished, so the run is a success; `abandonedAccountIds` rides in the event
  metadata because it is the only path by which a link is knowingly given up.
- **The stuck block was cleared by hand, and cost nothing.** Waiting five days
  for the new threshold would have left four of them inside the blind window. The
  skipped deploy turned out to carry a link the same wallet had already
  established 104 blocks later in a well-formed deploy, so the graph lost
  nothing at all. `scripts/repair-clanker-checkpoint.ts` does this, refuses to
  move the checkpoint backwards, and needs `--apply` to write.
- **The catch-up run then cleared the whole backlog**: 18 links from 25 social
  deploys, 5 new wallets, and `blocksBehindHead` back to 0.

### 2026-08-18 (things that looked fine and were not)

- **Three "why is this empty" reports, none of which were empty.** The blog had
  no sort at all, so it came back in filename order and opened on 27 February.
  The admin funnel showed 0 page views above 34 lookups, because `page_view` and
  `csv_upload` were defined in January and never once called: 2,569 events in
  the table, not one of them either. Recent wins showed one tile because the 8%
  filter ran in JavaScript after a SQL LIMIT, so it only ever saw the 25 newest
  jobs while seven qualifying wins sat outside the fetch.
- **The funnel was dividing by a number nobody had collected.** `pageViews || 1`
  turned 34 lookups into "3400%" and 49 upgrade views into "4900%". A rate with
  no denominator now reads n/a, including for windows that predate the fix.
- **The token deploy scan was walking past links it could not resolve.** It
  dropped deploys whose account id the resolver could not answer for, which is
  right, and then advanced its checkpoint anyway, which made the drop permanent.
  It cost nine owner-attested wallet-to-X links on the morning the resolver's
  renamed env vars had not yet been set. The checkpoint is now a high-water mark
  of blocks actually finished, and a run that defers work says so.
- **The handle-liveness sweep is scheduled.** It had never had a cron while the
  docs promised a daily cycle. Its budget derives from the live balance and the
  reset date, `(balance - reserve) / daysUntilReset`, which cannot drive the
  balance below the reserve however often it runs.
- **Six faults had to be fixed before it could run unattended**, the worst being
  that transport failures were never recorded. Never-checked handles sort first,
  so the 22,828 that returned nothing on 2026-08-17 sat permanently at the head
  of the queue: what looked like a backlog was a loop. They are now backed off
  1, 2, 4, 8 days without anything being written to `x_accounts`, because a
  failed attempt is not a resolution.
- **A bulk pass no longer becomes a cliff.** All 417,998 rows were checked in a
  four-hour window, so at a flat 90 day threshold 417,872 of them came due on
  2026-11-15. Each handle now has its own threshold, derived from the handle, so
  the same rows spread across 91 days peaking at 4,804 against a capacity near
  5,112. Nothing rewrote `checked_at`: spreading the expiry is a policy, editing
  the timestamps would be a claim about when we looked.
- **The Health tab answers whether anything is configured and running.** Nine
  capabilities with what breaks without each, seven jobs with their last
  _successful_ run, and a section for work that runs on no schedule, which is
  how the missing cron stayed invisible. It makes no external requests.
- **Two sweeps were reporting failures as successes.** Both wrote their event
  before deciding they had failed, so a 502 left a record identical to a healthy
  run and the panel read them as fine.
- **walletlink.social/check.** One handle, no account, no key: reachable,
  suspended, no longer in use, or not checked yet. It reports how many wallets
  carry the handle and never which ones, because that is the paid reverse
  lookup. Unchecked renders neutral rather than green, since guessing there is
  the behaviour the page exists to disprove.

### 2026-08-17 (a second index behind the first, and a runbook that had moved)

- **A spent daily allowance no longer stops token import.** ERC-20 holder lists
  need somebody's index, because balances are a mapping with no enumerable owner
  list. There was one, it bills against a daily ceiling, and running out took
  the feature down on six chains at once for reasons that were ours rather than
  the customer's. A customer import that meets an exhausted, rate-limited or
  unreachable index now retries against that chain's public block explorer.
- **Five of the six chains, and the sixth is named.** Ethereum, Base, Arbitrum,
  Polygon and Optimism all have a public instance. BNB Chain has none, so it is
  the one chain where exhaustion still stops the feature, and the code and the
  error message both say so instead of implying otherwise.
- **Every URL was measured, not assumed.** One page of holders on a
  customer-sized token: Ethereum 0.8s, Optimism 0.6s, Arbitrum 0.9s, Polygon
  6.7s, Base 15.3s. Base has a latency floor near 11s that barely moves with
  page size, so it returns a first page and usually not much more, correctly
  marked truncated.
- **The first measurement was nearly wrong in a way that would have cost two
  chains.** Probing with USDC timed out on Base and Polygon at every page size,
  which reads exactly like a dead explorer. USDC has 12.7M holders on Base. Both
  instances are fine for the size of token a customer actually imports.
- **Background work is not allowed to use it.** The daily budget reserves 80%
  for customers, so the provider can be exhausted while the seed cron's own
  ceiling still shows room. Without an explicit opt-out the cron would have
  quietly moved a day of unasked-for seeding onto free public infrastructure.
- **An explorer that answers 429 is not asked again for five minutes.** Found by
  tripping Base's throttle while testing. Further calls cannot return holders,
  so they only cost the customer a second on the way to the same error.
- **The check runs weekly, because these URLs are not ours.** An instance can
  move or retire an API version with no commit here, so a pull-request gate
  cannot see it. `scripts/check-holder-fallback.ts` exercises the real fallback
  path, and fails if a chain claims a fallback it has no probe for.
- **The security runbook was not missing, it had moved.** Four places still
  pointed at `docs/SECURITY.md` as a local path; it lives in the private ops
  repo and is gitignored here, so anyone following those pointers found nothing.
  They now say where it is.
- **The half of it that is not a secret is now in `CLAUDE.md`.** A table created
  after the role split inherits no grants, and nothing fails until CI reports
  `permission denied for table <name>` on a run that passed locally. Which
  credential lives where stays private; "a new table needs a grant" is a fact
  about the schema and belongs with the schema.

### 2026-08-17 (every surface, not only the ones I had touched)

- **Four surfaces were outside the check.** The README said 4.7M, two versions
  old. The AI assistant was told to say "reachable" in the sense we had just
  retired. The blog held 71 uses of "22%" over 19 posts, a figure removed from
  the structured data the same day because nobody could say where it came from.
  The social media skill said 15-25%.
- **Blog: only the search descriptions were changed.** A dated post saying 22% in
  August is a record of what we believed then, not a claim about today. The
  description is different: it is the text a search engine shows, so it speaks
  in the present. Four were corrected; the body text stays.
- **The check now works in both directions.** It compared each declared figure
  with the database. It now also reads the copy and reports any figure that is
  **not** declared. A registry catches a number that drifts; it cannot catch a
  new number somebody writes tomorrow, which is how "22%" reached 19 posts while
  every declared figure passed.
- **Both directions were tested with wrong input, and both were broken.** The
  new sweep asked "does this file have any declared figure", so one declared
  figure made every other figure in the same file pass. Two false numbers put
  into the README went through. It now works for each match, not each file.
- **A comment is not published text.** The first correct version then reported
  the explanation inside `lib/public-figures.ts` as an undeclared figure, which
  would teach everyone to stop writing explanations. Comments are removed before
  a source file is read.
- The social media skill is outside the repository, so the check cannot see it.
  It now carries the current figures and says plainly that it is checked by a
  person, not by the machine.

### 2026-08-17 (one number, one place, and the claim moved to where people read it)

- **The header said 4.8M, the documents said 4.9M, and a correction earlier the
  same day made 20 files say 5M.** Three numbers for one fact. The header was
  right: `/api/public-stats` counts wallets with at least one identity. The
  correction counted every row, which adds 235,858 records that mean "we checked
  and found nothing". Those are real records and they are not wallets we
  resolved to a person.
- **`lib/public-figures.ts` now holds the figures.** Five comparison pages, the
  share card, the page description, the structured data and the home page all
  read from it. One change moves all of them. Live pages still read the API,
  which is the true source; the file exists because documents and page
  descriptions are built before a request exists.
- **The match rate is a range now, with the measurement behind it.** There is no
  single number: 26 collections, 72,318 holders, three chains, measured against
  our own index with no outside calls. Base 46.2%, Ethereum 16.6%, Robinhood
  Chain 15.6%. Base is about three times Ethereum because Base is where
  Farcaster lives, so the chain moves the result more than the collection does.
  An average would hide that.
- **The old "22% match rate" claim is gone.** Nobody knew where it came from and
  no measurement produced it.
- **The check we look at is on the comparison pages now.** Farcaster stores a
  proved X account as a name, written once, with no account number and no later
  check. Every tool built on those proofs carries the same dead names, and none
  can say which. We resolved all of them: 69.6% work, 20.7% suspended, 9.7% are
  names nobody holds. One component, five pages, and the figures come from the
  same file as everything else.
- **The word "reachable" now means one thing.** It was used for "has an X or
  Farcaster account" in marketing and for "the account still works" in the API.

### 2026-08-17 (a machine for the docs rule)

- **Every number we publish is now checked against the database.**
  `scripts/check-published-figures.ts` holds a list of each published figure: the
  file that holds it, how to read it, and the query that proves it. 11 figures
  are checked today.
- **It runs on a timer, not on a pull request.** The index grows every day, so a
  number that was correct when written becomes wrong with no commit, no
  difference and no pull request. A pull-request check cannot see that. It runs
  every Monday, and also on a pull request that changes the copy.
- **A claim it cannot find is an error, not a note.** If the words change and
  the list is not changed, the check would silently examine fewer things each
  time and report success all the way down.
- **The check was tested with wrong numbers.** The first version had a 5%
  tolerance on an exact count, and a wrong figure of 399,999 for a true 417,872
  passed. A number written to the digit is an exact claim and gets no room.
- **Corrected: the index passed 5 million**, so "4.9 million" was low in 2 doc
  pages and 20 places in the app.

### 2026-08-17 (we check if the X account still works, and we say so)

- **The X names in the index are now checked against X.** 417,872 of them
  resolved. 69.6% work, 20.7% are suspended accounts, and 9.7% are names that
  nobody holds now. About one third of every attested X name reaches no person.
  (This entry said "All 440,700 of them" when it was written on 2026-08-17. That
  was wrong on the day: 440,700 was the number of handles held, not the number
  resolved, and the sweep leaves transport failures unrecorded so they retry.
  Corrected 2026-08-18.)
- **This is a strength, not a fault.** Farcaster records a proved X account as a
  **name**, written one time, with no account number and no later check. So
  nothing in the protocol sees a name change or a suspension. Every product
  built on those proofs carries the same third. We are the only one that looked.
  "The owner proved this, and it still works" is a stronger statement than
  either half.
- **Results table.** A name we checked and found dead is marked, is not a link,
  and says why. It is not a link because a suspended account goes to a notice
  page and a freed name may belong to a different person now, so a click could
  show a stranger as the owner of the wallet.
- **Handle list export leaves the dead ones out.** That file gets pasted into a
  sending tool, so a dead name in it is a wasted send at best. Names we have not
  checked stay in: "not checked" is not "dead". The button says how many were
  left out and why.
- **CSV export gains `twitter_reachable`.** Empty where we did not check.
- **API: `reachable`, `reachability` and `reachability_checked_at`.** Absent, not
  false, when we have not checked. `suspended` and `unclaimed` stay separate
  because only one of them means the record can point at a different person.
- **One builder for the twitter field.** Four routes described the same fact
  three different ways, and one of them did not return `verified` at all.
- **The conflict list can be read.** 2,671 open, of which 1,496 are cases where
  what we serve reaches nobody and the other source works. Before this they were
  saved and unreadable. It shows the evidence and does not decide: a suspension
  can be lifted, and a person can hold two accounts.

### 2026-08-16 (two more attested sources, and one shape for all of them)

- **One set of write rules, three sources.** The rules that decide what reaches
  the graph moved out of the Ethos code into `lib/attested-links.ts`. A source
  now only produces a list of links; it cannot decide how they are written. This
  was extracted, not copied, because the rule was wrong once already: it put a
  source label on 2,479 rows that the source had never attested. Written one time
  for each source, that is one chance to be wrong for each source.
- **Proof that the move changed nothing.** The Ethos sweep was run again after
  the change. Every number is the same: 83,891 links, 0 new, 0 filled, 81,412
  agree, 2,479 conflicts.
- **Onchain attestations: 5,492 new wallets.** Links published on Base and
  Optimism as attestations. Two record types across two chains, read by one
  adapter. 16,509 records give 6,343 links. This is chain data, so there is no
  key, no meter, no rate limit and no supplier who can stop us.
- **86% of them were wallets we had never seen.** The expectation was the
  opposite. These people use crypto and our index already holds 4.7 million
  Farcaster wallets, so we expected a large overlap. There is almost none.
- **Clanker: 163 links in 30 days.** A person tells a bot on X to make a token,
  and the bot writes the account and the wallet into the chain record. Both
  halves are proved by the act. It is a small flow, and it is here because two
  thirds of the records carry the **number** of the X account, which cannot go
  stale the way a name can.
- **The identifier has two shapes, so the shape decides, not the label.** The
  same field holds a number for some records and a name for others, under seven
  different platform labels. A number of five digits or more is an account
  number; anything else is a name.
- **Icebreaker was measured and refused.** Of 1,227 profiles, 84 give a verified
  pair, and 69 of those we already hold. 15 new. The unverified ones are
  self-declared, which is what this product says it does not use.
- **Corrected before release: 3,566 rows were saved and could not be found.**
  The two new sources wrote the X name as the source wrote it, in mixed case.
  The reverse search makes the question lower case and looks for an exact match,
  so those rows were correct, present and impossible to find by name. 56.5% of
  the new rows. The names are now made standard in the one shared place, where no
  new source can forget the step, and the 3,566 rows are corrected.
- **Two smaller faults found at the same time.** When the same wallet and name
  arrived two times, the last one won, which could throw away the account number
  that is the whole reason for the Clanker source. And a record type that failed
  after its first page was counted as read, so a part-finished sweep reported
  success.
- Index now 4,938,576 wallets, 1,149,451 with an X handle.

### 2026-08-16 (a new source, and the first way to see a handle go bad)

- **72,867 more wallets have an X handle.** The count moved from 1,070,680 to
  1,143,547, which is 6.8% more. The graph moved from 4,836,596 wallets to
  4,905,352. The new source is an identity platform where a person proves the
  wallet with a signature and the X account with a sign-in.
- **The source is read once a day, not once for each lookup.** It holds 39,442
  people and 83,891 addresses. That is all of it, in about 80 requests and under
  three minutes. It covers about 0.3% of the wallets in a customer file, so a
  call for each lookup would pay for a wait and change almost nothing.
- **81,412 rows now hold the X account id.** This is the more important part. A
  handle is a name that the owner can change, and a change tells us nothing. An
  account id does not change. This is the first field in the pipeline that can
  show the difference between a new name and a dead account.
- **The id is only written next to a handle that it belongs to.** If we hold a
  different handle, we write no id and we change no handle. To do it the other
  way would make a row that says a specific account owns a name that it does not
  own. That is worse than either source alone.
- **2,479 disagreements are recorded in a new table, not settled in code.** Of
  250 that were examined: our handle no longer opens an account 54% of the time,
  and where both handles open an account, 90% of the time ours belongs to a
  person who does not hold the wallet. A rule in code would throw that away.
- **A new evidence class in the API: `attested-social`.** The owner attested
  both ends, so `aggregated`, which means "correlated, not attested", was not
  correct. The class is named for the method, never for the supplier. The
  published statement "over 99.9% of Twitter matches are owner-attested" stays
  true at 99.98%.
- Published numbers corrected in 20 places: the index is 4.9 million wallets.
- **Corrected before release: the label went on rows it did not belong to.** The
  first version of the write added the source name to every row it touched, and
  not only the rows it agreed with. So a wallet where the new source named a
  different account kept our handle, which is correct, and then took their
  label, which is not. The API showed `attested-social` for 2,479 handles that
  this source never attested. The write now uses the same agreement test for the
  label that it uses for the account id, the 2,479 rows are repaired, and 129
  scores that the label had raised are calculated again with the real function.
- **Two more faults of the same kind, found by following the first.** The live
  lookup path did not know the new source: it gave the source the unknown-source
  score of 5, and it did not accept the source as attested, so the next lookup
  would have quietly removed the verified mark from a handle that nothing had
  disproved. Both are corrected, and the score in the sweep is now the same
  number the live path calculates.
- **The quality number was wrong on 81,325 rows, in both directions.** The write
  raised a score to a floor but could never lower one, so rows written with the
  first, too-high floor kept it. 55,309 rows that said more than they should are
  corrected. Rows that say less than they should are left alone on purpose: a
  swept row that carries a low estimate until a real lookup calculates it is how
  every source here already works, and raising them would move some across the
  trust line, which changes what the product does with them.
- **An address that two people both claim is now dropped.** Postgres refuses to
  change one row two times in one statement, so a repeated address would stop a
  whole batch, after the conflicts for that batch were written. It is also the
  right answer: if two people each say an address is theirs, this source cannot
  say which, so it is not attested evidence.

### 2026-08-16 (colour that no guard was looking at)

- **The share cards and the sign-in email did not use the brand colours.** Both
  render outside the CSS cascade, so they must write colour values directly.
  Eleven of those values had moved away from the tokens they stand for. Only two
  were correct. Every grey had a blue tone in it, but the greys in the design are
  pure grey. This is the mark of a person who took a colour from Tailwind.
- **The blog card wrote eight colours of its own.** It uses the shared card
  colours for the background and the text, then wrote the other eight directly,
  because the shared set had no values for a light card. A shared set with a hole
  in it does not get made larger; it gets avoided. The hole is the fault, and the
  light-card values now close it.
- **Two colours in the shared set were dead.** No card read them.
- **Four Tailwind palette colours were live in the interface.** A green line on
  the growth graph, a green heat map, and two greens in the assistant. Each was
  written as `hsl()`, `rgba()` or a hex value, so the guard, which looks for
  class names, could not see any of them. They are tokens now, and the assistant
  uses the brand colour, because a button is an action and green is for a fact.
- **The "Copied!" message was black on black in the dark theme.** It used
  `bg-black text-white`. The dark background is almost black, so the message had
  no edge. It uses `bg-foreground text-background`, which is correct in both.
- **A new guard: `scripts/check-og-palette.mjs`.** It reads the tokens from
  `app/globals.css` at the time it runs, not from a copy, and it fails the build
  if a card or email colour is not a token value. Values that cannot be a token,
  such as the gradient on the dark card, are listed by name with the reason. The
  guard was tested against the three values that had moved, and it caught all
  three.
- **`lib/` was not in the design CI trigger.** A change to only `lib/og-fonts.ts`
  did not start the check at all, so the fault was invisible two times over.
- **The OKLCH maths moved to `scripts/lib/oklch.mjs`.** Two guards need it. Two
  copies of a colour conversion give two chances to be wrong in a way that looks
  correct.
- Removed five unused Next.js example SVG files.

### 2026-08-16 (the design skill gave instructions that CI rejects)

- **The frontend-design skill now points at `docs/DESIGN-LANGUAGE.md` first.**
  The skill is written for new work with no design system. This project has one,
  and the skill did not mention it. An agent that read the skill and not the
  design language wrote code that looked correct and failed the build.
- **Four raw colour values are gone from the skill.** It named hex values for the
  accent, the border and two text colours. `app/globals.css` holds those values
  as tokens, and an ESLint rule and `design-tokens.yml` both refuse a raw colour.
  The skill now names the token and the meaning, not the value.
- **The radius guidance was wrong in all three of its numbers.** It asked for
  8-12px cards, 6-8px buttons and 4px badges. The scale is 14px containers,
  pill controls and 6px chips. The skill now lists the five named values and says
  which ones CI refuses.
- **A reuse ladder was added before "write a new component".** Five questions,
  stop at the first yes: does it need to exist, does it exist already in
  `components/ui/`, does a token cover it, can it be a prop, and only then write
  something new. It also says what may never be skipped: accessibility, error
  states, input validation, and anything asked for by name.

### 2026-08-16 (a window that moves with the provider)

- **The count of requests is a moving 24 hours now, not a calendar day.** It
  was a box that emptied at midnight UTC. The provider does not empty its box
  at midnight UTC: it stopped our requests at 06:11 UTC and gave answers again
  at 15:55 UTC on the same day.
- **A box that empties at a different moment does not fail safely.** When ours
  empties and theirs does not, we read 0 while theirs is almost full, so the
  background task believes that it has a full day at the moment when there is
  nothing. This is how the stop happened: 7 imports late on one day and 2 early
  on the next were in 1 window of theirs and 2 of ours.
- **A moving total cannot agree with their box either**, because we do not know
  where their box starts. But it is never behind: each request in the last 24
  hours is in the count, wherever they put the line. The fault becomes a small
  amount of extra care, not a hole.
- **The write puts each event in one statement**, so 2 imports at the same time
  cannot lose each other. Old events go away on the next write.
- The Usage panel says "last 24h" now, not "today", because the number does not
  become 0 at midnight.

### 2026-08-16 (the cost of a request, read and not calculated)

- **A holder-page request costs 50 units, not 35.** The answer from the provider
  has a header, `x-request-weight: 50`, so there is no need to estimate this and
  no reason to prefer an estimate to it.
- **The old 35 came from arithmetic on a day total**, and it was 30% low. That
  method can only be as good as the belief that nothing else was in the total,
  and a budget guard must not hold that belief.
- **So the allowance is about 7.9 imports of 10,000 holders each day**, not 11.
  One import costs 101 requests and 5,050 units.
- **The day boundary of the provider is not midnight UTC.** They stopped each
  request at 06:11 UTC and gave answers again at 15:55 UTC on the same day. Our
  count starts again at midnight UTC, so when our day changes and theirs does
  not, we read 0 while they read almost full. This is written down as a known
  limit, because a correct answer needs a 24-hour moving total.

### 2026-08-16 (the meter was not connected)

- **The count of holder-index requests was never written.** The database held no
  record of it, for each import that the product has ever made. The write used
  `void`, which starts the operation and does not wait for it. On a server that
  stays alive, that is correct. Here the code runs in a function that can stop
  the moment it sends its answer, and an operation that nobody waits for is the
  one that stops.
- **So each guard read zero.** The limit for the background task never operated,
  because it compared its work against a count of 0. The Usage panel showed no
  cost. The first sign of the fault was the provider, which stopped each request
  for the remainder of the day.
- **The write waits now.** The cost is one database operation, some tens of
  milliseconds, at the end of an import that used some seconds and made as many
  as 100 requests.
- **A guard that fails open must show that it is open.** This one could not tell
  the difference between "no cost today" and "no information", and gave 0 for
  both.

### 2026-08-15 (a link can carry a contract)

- **`/?contract=0x…&chain=base` opens the importer with the address in place.**
  For Pro and Unlimited only, the same as the importer. A person on the free
  plan gets the upgrade window, which is what the contract card does.
- **The link fills the field. It does not press the button.** To get the holders
  has a cost against a daily allowance, and to arrive on a URL is not a request
  to spend it. The person sees the address and the chain, then decides.
- **The page reads the URL and then removes the parameters**, so a refresh
  cannot do the import again and the address does not stay in the history.
- **It waits for the account to load.** The tier is "free" while the session
  loads, so a person with Pro would have seen a window that offers a thing they
  have.

### 2026-08-15 (you can see the edge of a field now)

- **The line around a text field was almost invisible**: 1.26:1 against the page
  in the light theme and 1.48:1 in the dark theme. The rule is 3:1, because the
  line is the thing that says "this is a control".
- **The same line is on the outline button**, where the edge is the full
  affordance.
- **The 2 values are calculated, not chosen.** Each is above 3:1 against each
  surface that a control sits on.
- **The line for a card or a table does not change.** The rule permits
  decoration to stay quiet, and the thin-line look depends on it.
- **A new test measures each colour pair in both themes.** It reads the tokens
  from the CSS, and it tests its own colour mathematics against measurements
  from a browser first.

### 2026-08-15 (the header fits a telephone)

- **The header went past the edge of each telephone screen.** It needed 606px
  and did not become smaller, because each part had a fixed size and its text
  could not go to a second line.
- **Below 640px, 4 things change**: ".social" goes away, the theme control moves
  to the foot of the page, the chip that says "Free" goes away, and the mark and
  the name become smaller together.
- **A person with Pro or Unlimited keeps the chip at each size**, where it is
  the only thing that says the account is paid.
- The header needs 309px now. On a computer, nothing changes.

### 2026-08-15 (recent wins, on one line)

- **The homepage strip is named "Recent wins" now.** It says "Recent activity",
  but it shows only the lookups with a hit rate above 8%. This filter is
  correct, because the strip is proof for a buyer. But the name made a promise
  of a full record. Of the last 25 lookups, 13 were below the line, so a day
  with 12 lookups looked like a day with none. The filter stays. The word
  changes.
- **The strip keeps to one line at each width.** It asked for 6 cards and used
  `auto-fill`, which makes as many columns as the space permits. At the full
  width that is 5, so card 6 went to a second line alone. The count and the
  columns are together in the code now: 1 card, then 2, then 3, then 5.
- The steps come from a measurement of the card, not from an estimate. Below
  about 177px the text in the card goes to a second line, so 2 cards start only
  at 640px, where each one gets 290px.

### 2026-08-15 (the admin navigation shows all of itself)

- **The 12 destinations in the admin panel now go on more than one line.** They
  were in 2 strips that moved sideways. A sideways scroll bar puts things behind
  a movement that a person does not know is possible, and on a narrow screen it
  hid one half of the panel. The design language does not permit this, and the
  panel broke the rule in the most costly place: its own navigation.
- **The buttons make a grid: 2, 3 or 6 across.** The count of 6 is the same as
  the tiles below them, so the 2 parts make one rhythm.
- **A screen reader gets a name for each group and the current position.** Each
  group is a `nav` with a name, so a person can move past 12 controls. The
  button for the open page says `aria-current`. Before, only the violet colour
  said it.
- The 12 buttons were written out one at a time in the page. They are one list
  in `AdminNav` now, with the group titles in the standard label component.

### 2026-08-15 (the dialog footer holds, and selected text has one colour)

- **`ModalFooter` holds its position now.** No dialog used it, and that was the
  sign. It was inside the part that moves, so it held nothing. **A part that
  nobody uses usually does not do the thing that its name says.**
- **It is a property of `ModalContent`, not a child.** A child cannot go out of
  the box that it is in. The property puts the row below the body, with a line
  above it, so that you see it is separate from the text that moved up behind
  it.
- **The contract import preview uses it.** That step is tall: a chain selector,
  a count of holders, a warning about a limit and an example of the addresses.
  Its 2 buttons are the reason for the step, so they stay below the movement.
  The 2 other steps are short and use no footer, because a footer takes space
  from the screens that have the least.
- **Selected text is one colour on each surface.** Before, it was the colour of
  the operating system everywhere, but the brand colour inside an input. So the
  product had 2 colours for one thing, and the one that did not agree was the
  only one that a person chose.
- The rule uses the light brand colour, not the full brand colour. A selection
  covers a full paragraph, and a strong violet behind the words fights the words
  that it must show.

### 2026-08-15 (a keyboard can reach the cards, and the trend lines are back)

- **The 6 cards on the admin Pulse page work with a keyboard now.** Each card
  had a click function on the `div` and nothing more: no role, no stop for the
  Tab key, no Enter and no Space. They looked like controls, because they had a
  pointer and a border that changes on hover. A keyboard could not reach any of
  them. **A hover state is not a control if only a mouse can find it.**
- **The correction uses a real button.** `CardActivator` puts a `<button>` over
  the full card. A real button gives the focus, the Enter key, the Space key
  and the accessibility tree together. A `role` attribute with a key function
  gives only the parts that you remember.
- **The sparkline trend lines show again.** Two of them used the colour
  `hsl(var(--primary))`. But each token in this product is an `oklch` colour,
  so this makes `hsl(oklch(...))`, which is not a colour. The browser removes
  it and gives no message. A measurement in Chrome shows the result: the line
  colour became `none`, so the line was not drawn, and the area colour became
  black. **An incorrect colour is easy to see. A colour that is removed looks
  like a design.**
- **A new test refuses `hsl(var(--...))` and `rgb(var(--...))`.** It found the
  fault immediately in a real file.

### 2026-08-15 (each dialog keeps its contents now)

- **The upgrade modal no longer puts its two buttons below the panel.** The
  change on 2026-08-15 that was to correct this did only one half of the
  operation, and the fault stayed. A dialog was a grid. Its body received
  `min-h-0`, which lets the box become smaller. But the row of the grid stays
  at `auto`, which is the size of the contents. So the row became larger than
  the dialog, the body filled the row, and `overflow-y-auto` never received a
  box that was too small. Thus it did not cut the contents and it did not show
  a scroll bar.
- **A dialog is a flex column now.** The body is `flex-1 min-h-0
overflow-y-auto`. A measurement in Chrome shows the difference at a screen of
  663px: before, the panel was 631px and the body was 1298px, with the button
  644px below the edge of the panel. After, the body is 629px and the button is
  25px inside the panel.
- **All 6 dialogs had this fault**, not only the upgrade modal. Each one is
  correct now.
- **The 2 upgrade buttons stay on the screen.** Each card holds its own button,
  so one bar at the bottom is not possible. The card is the column: the list of
  features moves, and the button stays at the bottom edge. On a telephone the
  cards go one above the other and the dialog moves as before.
- **A dialog uses `100dvh`, not `100vh`.** On a telephone, `vh` is the largest
  size that the screen becomes. A dialog with this measurement goes behind the
  address bar exactly when the address bar is on the screen.

### 2026-08-15 (the generator now makes the correct thing)

- **The component generator makes Phosphor icons now.** `components.json` told
  `npx shadcn add` to use Lucide. This is not the icon set of this product, and
  it is the machine that put back the defaults that the last change removed.
  The value is `phosphor`, which the shadcn source shows is correct and which
  points to the package that this project already has.
- **The `lucide-react` package is removed.** No file imported it. A second icon
  set that nobody imports is still a second icon set that a person can find.
- **A new test refuses a Lucide import**, so the failure gives the reason in one
  line.
- **The design language has a new page: "Adding a shadcn component".** A
  generated component compiles, shows correctly and is incorrect. It has the
  radius, the shadow, the control height and the colour words of the library.
  The page gives the 6 steps to correct it. It also gives the rule for a
  component that already exists: make a new option on the component that you
  have; do not make a second file.
- Note: `baseColor` has no correct value. Each value makes the same `--primary`
  colour, because the components use it. So the test looks at the result
  instead. **Set the generator where you can. Test the result where you cannot.**

### 2026-08-15 (the library defaults that stayed behind)

- **Drag a file onto the page, and the target is violet again.** It was black.
  `--primary` is a shadcn default that this project never changed. It is almost
  black in the light theme and almost white in the dark theme, and its name
  makes it look like a brand token, so it moved through the product without a
  challenge. Both drop targets used it. One of them showed a violet edge at
  rest and a black edge during the drag, which is the same component with two
  colour systems in it.
- **The same default is now removed from six more places**: the period control
  and the stage bars in the admin dashboard, six cards that you can click, the
  text selection colour in each input, and the unused `Progress` part.
- **The period control in the admin dashboard is now the standard segmented
  control.** It was the third control of this type that somebody built by hand.
  It was 2px shorter than the button beside it, the arrow keys did nothing, and
  the selection moved without an animation.
- **Each card shows its edge again.** The `Card` part drew its hairline at 60%
  opacity. In the dark theme the border token is already 10% white, so 60% of it
  is 6% white. Six more faded edges are also at full opacity now.
- **Two hand-made text links are now the standard button.** The `link` type
  already existed, but no code used it, because its 34px height opens up a table
  row. It has an `inline` size now, so the height is not a reason to copy the
  classes a third time.
- **Two new tests keep all of this out.** `check-design-language.mjs` refuses
  the `primary` token and a faded hairline. Both tests have fixtures, and both
  found real faults on the first run: the six faded edges and one more incorrect
  hover colour that a manual search did not see.

### 2026-08-15 (a usage meter, and a page for each account)

- **A new Usage panel measures daily volume. It does not limit it.** No plan has
  a daily allowance, and this makes none. It exists so that a decision about a
  limit uses the behaviour that we see, and not a number that seems correct.
  - It reads in wallets, never in lookups. Eleven lookups of 200 wallets and
    eleven lookups of 10,000 wallets are both “eleven”, and only one of them is
    a problem. The worker learned this when it counted jobs.
  - The most important column is the busiest single day of each account. A limit
    is only reached on a busy day, so a limit below the highest day of an
    account has already refused a customer one time.
  - It also shows the money that this volume costs: the credits for this month
    and the requests for today, from the same counters that the guards read. So
    the panel and the limits cannot disagree.
- **Each account now has a page.** Click an address in the Usage panel or in the
  Users table. The page gives:
  - The money paid, from Stripe, with each refund. A paid tier with no payment
    gets the label “gifted, not paid”, because a tier is a permission and not a
    receipt.
  - Volume: the total for the life of the account, the busiest day, the days
    with activity, and a graph for each day.
  - The last 25 lookups, with the method, the network, the contract and the scan
    depth of each one.
  - The count of saved lookups and of API keys.
- **The page replaces the panel, and does not sit above it.** Two subjects on
  one screen make the reader decide which numbers belong to which.

### 2026-08-15 (a daily budget for the token holder index)

- **A customer used 75% of the daily allowance in two hours.** The ERC-20
  holder index has a daily limit. On this day a paying customer made 11 contract
  imports, and 7 of them had the maximum of 10,000 wallets, on Ethereum and BNB
  Chain. That is approximately 810 requests. The daily seed cron made
  approximately 71 requests in the same period, which is 8% of the total. So the
  cron is not the cause. A customer who uses the product is the cause.
- **When the allowance stops, each ERC-20 import stops.** This applies to
  Ethereum, Base, Arbitrum, Polygon, Optimism and BNB Chain together. NFT import
  is not affected, because it uses a different supplier. Robinhood Chain is not
  affected, because it uses its own explorer.
- **The message said “try again in a moment”.** That is the message for a rate
  limit. A daily allowance comes back tomorrow, not in a moment, so the customer
  makes the same request again and it fails again. The message now says that the
  limit comes back tomorrow, and it says which other methods still work. The
  test reads the body of the response, not the status, because the status is
  401 in some cases and 429 in others.
- **`lib/holder-index-budget.ts` gives the cron a limit.** It follows the same
  rule as the Neynar budget: measure each request, but stop background work
  only. A customer is never refused.
  - 80% of each day is held for customer imports. The cron gets the other 20%,
    which is approximately 228 requests. Six ERC-20 seeds need approximately
    126, so a normal day is not affected. The cron also runs at 07:00 UTC,
    before the customers of the day.
  - The cron measures its limit against the total for the day, not against its
    own total. If it measured only its own use, a busy morning would let the
    cron start with a full limit.
  - The count is in requests, because we can count each request exactly. The
    limit is in compute units, and the supplier gives no price for each
    endpoint. The number 35 units for each request comes from measurement of
    this day: approximately 880 requests used approximately 30,000 units. Two
    environment variables can correct it without new code.
  - If the count cannot be read, the guard permits the work. It exists to stop
    high cost, and to stop each cron because of one failed query would make a
    worse problem.

### 2026-08-15 (a modal that spilled, and controls that did not look like controls)

- **The upgrade modal put its last button below its own edge.** The dialog has a
  maximum height, and the content in it has `overflow-y-auto`. But the content
  is a grid item, and a grid item does not become smaller than its content
  unless you tell it to. So the maximum height did nothing, no scroll bar came,
  and the content went past the bottom of the white panel. “Upgrade to
  Unlimited” was below the edge, and a person could not press it. One property
  corrects it: `min-h-0`. Each modal in the product had this fault. Only the
  upgrade modal was tall enough to show it.
- **The two plan columns now have the same height, and their buttons align.**
  Unlimited has more features than Pro, so the two buttons were at different
  heights.
- **The segmented controls now look like buttons.** The method is from iOS,
  because iOS solved this first:
  - The moving part has two shadows. A wide soft shadow lifts it off the track.
    A narrow dark shadow below it draws the bottom edge. One shadow alone looks
    flat.
  - The unselected side is no longer grey. Grey is the colour of text that you
    cannot use, so the control said that half of itself was not available.
  - A hairline divides the segments, and it disappears on each side of the
    selected segment. The line says “these are separate buttons”. Its absence
    beside the selection keeps the control one object.
- **The colour toggle: System is now in the middle.** The order is Light,
  System, Dark. System is the default, and it is the middle of what the other
  two mean.
- **The colour toggle icons now use one weight.** The selected icon changed to
  the filled weight, which the design language keeps for status dots. At 16 px
  it makes the Monitor icon a solid block beside a line-drawn sun and moon. The
  moving part and the colour already show the selection.
- **Two buttons got an icon.** “Find wallets” has a wallet. “Sign in” in the My
  lookups panel has the same icon as “Sign in” in the header.

### 2026-08-15 (a price we do not sell, a term we never defined, and a feature that moves tier)

- **Five comparison pages showed $149.** Pro is $99. The number was written into
  each page, and it stayed after the price changed. A person who read a
  comparison page got a price that no plan has. Each page now reads the price
  from `TIER_PRICES`, which the checkout also reads, so the two cannot disagree
  again. The tables that said “$99 - $249” were correct, and they now read the
  same constant.
- **The social-media skill also said $149.** That file writes future posts, so
  it made new copy with the incorrect price. It is corrected, and it now has an
  instruction to read the constant before each draft.
- **“The index” had no definition.** Eight documentation pages use the term.
  None of them said what it is. The documentation home page now gives the
  definition first: the index is our own database of 4.7 million wallet
  identities, not a cache in front of the API of another company. Each later use
  links to that definition.
- **Growth of a saved lookup is now an Unlimited feature.** This has two parts,
  and both move together:
  - Add addresses to a saved lookup.
  - See which rows found an identity since you last opened it, which the `NEW`
    label shows.
  - The server enforces both. The `PATCH` that writes the joined result and the
    `GET` that calculates the new rows each examine the plan. A control that is
    only hidden is not a limit.
  - A change of name stays available to each owner of a lookup, because Pro
    includes full history, and a history that you cannot label is worse for no
    reason.
  - The gate on `GET` also stops the query, not only the answer. That query
    examines each wallet in the lookup, and it is the most expensive operation
    on the endpoint.

### 2026-08-15 (the same correction, applied to each surface that gives it)

The previous entry corrected the X-coverage statement in the documentation, the
structured data and the comparison pages. It did not examine the other places
that give the same statement. This entry corrects those, and it found a second
and more serious fault.

- **The published blog gave the names of two data suppliers, and it gave the
  order of the pipeline.** The rule is to give no supplier name in a public
  place. Five published posts broke it, in the first person: “we use X”, “Via
  the X API, we check…”, and a numbered list of the three steps in order. The
  API deliberately does not give this information: `lib/api-sources.ts` maps
  each internal name to a class of evidence, so that a customer cannot read the
  supply chain from a response. The blog gave it in words instead.
  - `farcaster-integration.md`: “We’ve integrated the X API”, and a 3-step list
    that named a supplier for each step.
  - `walletlink-vs-addressable.md`: a list with the title “walletlink.social
    uses”, which named two suppliers.
  - `farcaster-verified-addresses.md`: “(we use X)”, and a sentence that named
    a supplier.
  - `twenty-two-percent-match-rate.md`: two sentences that named a supplier.
  - `docs/SEO-STRATEGY.md`: three answers written for a customer, each of which
    named a supplier. This document supplies the words for future copy, so each
    error in it makes more errors later.
  - Each is now written as a class of evidence: an onchain record, a
    protocol-level verification, an identity index.
- **One post keeps the supplier names, and this is correct.**
  `wallet-identity-stack.md` explains the identity ecosystem to a reader who is
  building their own system. It names the products that exist in that ecosystem,
  which is the subject of the post. Only one sentence tied that architecture to
  ours, and that sentence is changed.
- **`README.md` said “owner-attested only”.** The same absolute as the
  documentation. The README is the first page a person sees in a public
  repository, and `docs/README.md` says that the repository is public so that
  this claim is checkable. So the README must be exact.
- **`docs/SEO-STRATEGY.md` now gives the rule for future copy.** Do not write
  “owner-attested only”. Write “over 99.9% are owner-attested, and each match
  carries its evidence”. It is stronger, a person can check it, and it stays
  correct when we add a source.

### 2026-08-15 (say what the X coverage really is, in a way that stays true)

- **The coverage page said “one of two routes”. The code has more.** It said
  that each X handle comes from a Farcaster verification or from an ENS text
  record. The pipeline also uses an identity index, which gives the `aggregated`
  class. The measurement: 1,070,576 wallets have an X handle. 1,039,525 come
  from a Farcaster verification and 39,906 from an onchain record or a manual
  review. Only 201 come from the identity index alone. So the statement was
  99.98% correct, and it was still not accurate.
- **The page now gives the rule, not the count of the sources.** Two routes are
  owner-attested and give almost all the coverage. An identity index gives the
  rest, and each of those records has the `aggregated` label. The promise to the
  customer is that each match carries its class of evidence, and that the
  classes do not change when we add a source. That statement stays correct as
  the number of sources increases.
- **The guarantee is enforced, and the page says so.** The classification is an
  allowlist. A new source with no classification gives no evidence class. It
  cannot get the classification of a different route. So a new pipeline cannot
  make `onchain` or `farcaster` mean something wider than it means today.
- **The same statement was in the structured data and on four comparison
  pages.** One said we return “only” owner-attested matches. One said the
  matches come from onchain records, when most come from a Farcaster
  verification. All are corrected. “We never guess” stays, because it is true at
  each evidence level: an identity index correlates published profile data, and
  it does not infer from a display name, a description or a time correlation.

### 2026-08-15 (a control that painted itself out, and two missing doc pages)

- **The scan-depth control was invisible on the upload panel.** Its track uses
  the `muted` colour. The panel uses the same colour. So the control had no
  edge: the unselected half showed only its text, and the selected half looked
  like a white shape with no relation to it. The control now has a hairline
  border, which is the rule that the design language already gives for
  separation. The correction is in the component, not in the page, because the
  next `muted` surface would cause the same fault.
- **Checkboxes used the colour of the operating system.** A checkbox with no
  style shows its tick in the accent colour of the operating system, which is
  blue on macOS. Blue is not in this product’s palette. All checkboxes and radio
  buttons now use the brand colour.
- **The design language now gives a rule for this fault.** A control must show
  its own edge. Examine each control on the page background, on the muted
  background and in a card. If one of the three makes it disappear, it needs a
  hairline border. No test can find this fault: the CSS is correct, each guard
  gives a pass, and the control is not visible.
- **Two new documentation pages.** “Running a lookup” gives the three ways to
  supply addresses, the networks for a contract import, the address limit for
  each plan, and the export formats. “Scan depth” gives the difference between a
  fast scan and a deep scan, and it says that the API always behaves as a fast
  scan.
- **A code comment named 2 networks where the code supports 7.** The comment in
  `lib/chains.ts` for token holder lists was written when two indexes were in
  use. Comments become incorrect in the same way as documentation.

### 2026-08-15 (a health report for the social graph, and a weekly repair)

The graph holds 4,755,201 rows. 99.5% of them have a reachable identity. The
`wallet` column is the primary key, so the table cannot hold a duplicate row.
There were no duplicate identities either: no handle was stored under two
casings, no wallet address had capitals, and no field held an empty string. The
faults were 63,275 rows, which is 1.3% of the table.

- **`scripts/graph-audit.ts` gives a read-only health report.** It counts
  malformed values, duplicate identity, rows that disagree with themselves, and
  the freshness of the data. It makes no change. Use it before a repair, and to
  find a new type of fault.
- **`lib/graph-repair.ts` corrects only what the row itself proves.** These
  faults were found and corrected:
  - 1,113 rows said `twitter_verified` but had no handle.
  - 34,189 rows had a `twitter.com` link. The Farcaster sweep writes `x.com`,
    and the ENS harvest wrote `twitter.com`. All links now use `x.com`.
  - 27,970 rows had a “first seen” time after their “last updated” time. A row
    cannot get an update before it exists.
  - 1 row had a handle with capitals, 1 had an ENS name with capitals, and 1 had
    a link that pointed to a different account.
- **Two writers made these faults. Both are corrected.** The negative-result
  writer gave a JavaScript time to one column and let the database supply the
  other. The database time is later, so each new negative row got a “first seen”
  time after its “last updated” time. The ENS harvest wrote the old domain name.
  Without these two corrections, the repair would find the same rows each week.
- **The repair runs each Monday at 09:00 UTC.** It has these guards:
  - It contains no `DELETE` statement.
  - Each repair has a row ceiling and stops above it. A repair that suddenly
    finds many more rows than usual has a fault in its own test, so it must stop
    and report.
  - A dry run is the default. You must give `--apply` to write.
  - It never changes the primary key.
  - It counts the rows again after the write, to prove that the repair did the
    work. If rows still agree with the test, it reports the difference.
- **Three problems need an answer from an external source, so the repair does
  not touch them:** 3 ENS names that are on more than one wallet, 6 Farcaster
  ids that carry more than one username, and 112 Farcaster usernames that have
  no id. The cron counts them and reports them.

### 2026-08-15 (one scan-depth control, in place of two checkboxes)

- **The options row asked the wrong questions.** It gave four checkboxes in one
  line: Save to history, ENS onchain lookup, Fast mode and Notify when done. Two
  of them named parts of the pipeline. Those two also disagreed with each other.
  Fast mode removed the slow sources. ENS is the slowest source. A person who
  selected both asked for two opposite things. The panel now asks two questions,
  each with its own label:
  - How deep do you want the scan? Fast, or Deep scan.
  - Do you want to keep this lookup? If yes, what is its name?
- **Fast now does what its name says.** A fast scan reads the walletlink index
  and the cache. It makes no live request, and it writes nothing back. Before
  this change it skipped one live source and called another, so it was neither
  quick nor complete, and one line of text could not describe it. The Farcaster
  sweep is complete, so the index already holds almost all of the data that the
  remaining call supplied.
- **Deep scan is the default, and it includes onchain ENS.** An ENS text record
  is the only source where the owner of the wallet publishes the handle. That
  evidence is what makes a row attested instead of inferred, and the product is
  sold on that difference. ENS was off by default before. ENS stays a paid
  feature; a free account gets every other source.
- **The time estimate follows the choice.** A deep scan calculates 18 seconds
  for each 1,000 wallets: 10 seconds for the live sources, and 8 seconds for the
  onchain ENS records. A fast scan calculates 5 seconds for each 5,000 wallets,
  because two indexed queries do not get much slower as the list gets longer.
  The estimate for a deep scan is now approximately twice the old number. The
  old number did not include ENS.
- **The two buttons have icons.** “Choose different file” has a swap icon.
  “Start lookup” has a magnifying glass.
- **A fast scan gave an empty row for a wallet that the index knows.** Step 1
  applies a stored row only when its quality is high and fresh, or medium. A
  high-quality row one day past its refresh window went to the live sources
  instead, because the live answer must not lose to the old one. A fast scan has
  no live pass, so those wallets came back empty. A fast scan now takes what is
  stored. The other modes do not change.
- **The cache step erased data that the index had found.** It merged the cached
  row with a spread. Each field of a cached row is present, and an empty field
  holds `undefined`, so the spread wrote `undefined` over a value from the
  index. A wallet with a Farcaster name in the index and a Twitter-only cache
  row lost its Farcaster name. The cache now supplies only the fields that it
  has.
- **Two contract imports in one visit recorded the first contract twice.** The
  start-lookup callback did not list the contract in its dependencies. Each
  setter that changes the contract also sets the input source, so the callback
  usually refreshed. Two contract imports in sequence set the input source to
  the same value, React stops an update that changes nothing, and the callback
  kept the first contract. The admin Source column then gave the wrong name for
  the second lookup.
- **A fast scan wrote index rows back to the index.** The write resets the
  “checked at” and “stale at” times. A fast scan makes no live request, so it
  put a new time on data that no source had confirmed. A later deep scan then
  trusted that time and did not call the sources. One fast scan stopped the next
  correct scan for the full trust interval. A fast scan now writes nothing.
- **The progress bar marked the ENS stage complete for a free account.** A job
  that cannot use ENS goes directly to the next stage. The stage list still
  included ENS, so the position moved one place too far, and a paid stage showed
  as complete. The list now includes only the stages that the job runs.
- **The progress bar showed the name of a data supplier.** The rule is to give
  no supplier name in the interface. That stage is now “Profiles”. ENS and
  Farcaster are protocols, not suppliers, so they keep their names. The stage
  list also had the wrong order and did not include the index read that starts
  each job. The list controls which dots are complete, so the order was
  incorrect on the screen. A fast scan now shows only the two stages that it
  runs.

### 2026-08-15 (job context in the admin panel, and two faults it exposed)

- **The Jobs table showed a localStorage uuid in the User column.** A signed-in
  job stores the `users.id`, so it joins to a real address. The table did not
  join, so it printed a raw uuid for the only paying customer on the platform.
  The column now shows the email. It shows "anonymous" for a visitor who never
  signed in, and "system" for a cron job.
- **A new Source column names what was looked up.** A contract import now
  records the contract on the job, so the table says "USDG ethereum" instead of
  only "5,000 wallets". Without it, a 1.6% match rate had no explanation. Jobs
  created before this change have no contract recorded and show how the wallets
  arrived.
- **`truncated` could never be true when the source did not report a total.**
  Three holder sources replaced an unknown total with the number of wallets they
  returned. The flag compares those two values, so it always calculated
  `5000 < 5000` and said the list was complete. A USDG import of 5,000 holders
  told the buyer it held every holder. An unknown total now stays unknown, and a
  result that exactly fills the limit is reported as truncated. The import
  preview no longer prints "N of N total holders" for an unknown total, because
  that still reads as a complete list. It says the import hit its maximum and
  that the token probably has more holders.
- **The worker admitted five jobs at once, whatever their size.** On 2026-08-13
  the seed cron queued five 2,000-wallet jobs and the worker took all five, so
  10,000 wallets hit Web3Bio together. Web3Bio answered 500 to about 1,200
  requests in each batch, and average latency went from about 20 seconds to 3.5
  minutes. The worker now budgets by wallets in flight, not by job count. Small
  jobs still run together. Large jobs run one at a time. It also admits a job
  that is already in progress before it starts a new one, because a budget plus
  the old queue order would let large cron jobs spend the whole budget each tick
  and leave a customer's half-finished lookup waiting.

The graph was not damaged by that incident. The guard in `job-processor.ts`
excluded every wallet whose check failed, so 5,432 wallets kept no row instead
of a false "no socials" row.

### 2026-08-15 (Stripe made no Customer objects)

- `createCheckoutSession` did not set `customer_creation`. The default value is
  `if_required`. A one-time card payment does not require a Customer, so Stripe
  made none. The account held **zero Customer objects**, and it had real
  completed sales. `customer_email` fills the field in the form. It does not
  make a Customer. Every payment therefore stored an empty `stripe_customer_id`,
  and the admin Users pane showed a dash in the Stripe column for each paying
  account. The value is now `always`.
- The Users pane shows the payment intent when no Customer exists. Sales from
  before this change have no Customer. The payment intent identifies the sale in
  Stripe. `/api/admin/users` now returns `stripePaymentId` for this purpose.
- The checkout reuses the Customer when Stripe already has one for that email.
  `customer_creation: 'always'` alone makes a new Customer for each checkout. A
  buyer who upgrades from Pro to Unlimited would get a second Customer. The
  second id would replace the first, and the first would become an orphan. That
  result is the opposite of one identity for one buyer.
- The checkout changes the email to lower case one time. It uses that form for
  the Customer lookup, for `customer_email`, and for both metadata blocks.
  Stripe matches its email filter by case. Every other path uses lower case. A
  buyer who typed a different capitalization on a second purchase would miss the
  Customer and make a duplicate.
- The code no longer writes `''` to `stripe_customer_id`. The callers read the
  value from `session.customer`, which is null when no Customer exists. An empty
  string in an id column says "there is an id, and it is blank".

### 2026-08-15 (the apex domain is canonical)

- Vercel now serves `walletlink.social` directly. It sends a 308 redirect from
  `www` to the apex. The configuration was the opposite before this change,
  while `metadataBase`, `sitemap.ts`, `robots.ts` and each canonical tag
  declared the apex. Each of them published a URL that redirected.
- This difference caused two separate failures. Stripe does not follow a
  redirect, so the webhook pointed at the host that redirected. Every delivery
  failed from 2026-01-17, and no payment gave an account its tier. The X card
  crawler met the same redirect on `og:image`, so it kept an old card.
- `PRODUCTION_URL` now holds the apex. The resolver in `lib/site-url.ts` and the
  SEO declarations state the same origin. No `www` literal remains in the code.
- The Stripe webhook endpoint now points at the apex. The apex answers directly.

**The rule to keep:** a URL that one machine gives to another machine must never
point at a redirect. Declare one origin only.

### 2026-08-15 (the Starter tier is removed)

- Jake retired Starter on 2026-08-12. It stayed in 42 places across 12 files. A
  comment defended it and said that legacy accounts needed it. No legacy account
  existed. **No user ever held the tier, and Stripe took no payment for it.** I
  checked production before I removed anything.
- I removed it from `UserTier`, from the price map, from the limit map, from the
  tier ladder, from the checkout, from the webhook, from the upgrade modal, from
  the account chip and from the analytics types. The new type `PaidTier` names
  the tiers that a person can buy. The signatures no longer write the union out
  four times.
- **The cumulative quota machinery went with it.** `TIER_QUOTA`, `walletQuota`
  and `walletsRemaining` existed only because Starter had a total cap of 10,000
  wallets. Each remaining tier has a per-lookup limit and nothing more.
  `walletsUsed` still counts up. It controls nothing now. It is a lifetime
  record, and an upgrade no longer sets it back to zero.
- `getUserAccess` sends `users.tier` through the new `normalizeTier()`. It no
  longer casts the value. The column holds free text. An unknown value used to
  index the limit map to `undefined`, which gave a broken lookup and no error.

### 2026-08-15 (the share text gave a match rate that was too high)

- The share copy calculated the match rate as
  `(twitterCount + farcasterCount) / totalWallets`. That formula counts a person
  two times if the person has an X handle and a Farcaster account. One real
  lookup of 1,057 wallets published **49%**. The product showed **30.8%** for
  the same lookup, because the formula counted 190 people two times. The copy
  now uses the distinct reachable count. The results header uses the same count.
  The page gives the count to the component from one predicate, so the two
  figures cannot differ.
- `StatsCards` had the same overlap error, and it was corrected earlier. The
  error stayed in `ShareButtons`, because that component calculates its own
  statistics instead of receiving them.

### 2026-08-15 (checkout provisioning, after a customer paid two times and got nothing)

Two separate faults occurred together. Each fault alone was survivable. Together
they took $198 from the first paying customer and gave the customer nothing.

- **The webhook never worked.** Stripe held the endpoint
  `https://walletlink.social/api/webhook`, which is the apex. Vercel served the
  project from `www`, and the apex sent a 307 redirect. Stripe does not follow a
  redirect. It records a 3xx as a failed delivery. Every payment after the
  endpoint was created on 2026-01-17 succeeded in Stripe and gave no account its
  tier. The endpoint now points at the `www` origin.
- **Production never had `NEXT_PUBLIC_URL`.** `createCheckoutSession` used the
  fallback `http://localhost:3000` and built `success_url` from it. After
  payment, Stripe sent the buyer to a dead port on the buyer's own machine. The
  buyer decided that the payment failed, and paid a second time. The new file
  `lib/site-url.ts` resolves the URL in one place. It uses the env var first,
  then the known production origin, then the preview URL, then localhost. It
  uses localhost only when the code does not run on a deployment. Production can
  no longer reach a localhost fallback.
- **`/api/auth/checkout-status` now gives the upgrade.** It only reported the
  tier before. It already asked Stripe, and it already knew that
  `payment_status === 'paid'`. If it had acted on that fact, no customer would
  have seen the webhook failure.
- **One function gives entitlement.** `provisionPaidCheckout()` is idempotent on
  the payment intent, and it records the sale itself. A grant cannot happen
  without a revenue record. Two paths can run at the same time and cannot count
  the sale two times.
- `payment_completed` was a floating promise, and a serverless runtime can
  discard it. The `payment_intent.succeeded` path recorded no sale at all. Both
  are corrected.
- A missing key or a missing webhook secret no longer reports "signature
  verification failed". A configuration error has its own type and answers 500.
  Stripe then retries the event instead of discarding it.
- **The dashboard reads revenue from Stripe, and it subtracts refunds.** It used
  to read the tier of each user. It mapped `pro` to $99 and `unlimited` to $249.
  That figure is entitlement, not income. It invented revenue for a
  complimentary account, and it could not see a refund. One $99 sale, one
  refunded $99 duplicate and one goodwill upgrade gave a report of $249. The
  true net was $99. The new route is `/api/admin/revenue`.
- The dashboard reports an account as complimentary when the account holds more
  than it paid for. This includes the partial case: a person bought Pro and
  received Unlimited. A check on the email alone would still have implied $249.
- `isStripeConfigured()` no longer needs `STRIPE_PRICE_STARTER`. Jake retired
  Starter on 2026-08-12, and the checkout rejects it. The old check meant that
  deletion of a dead env var would answer 503 to every purchase.

### 2026-08-14 (AI assistant on the marketing site)

- Floating chat bubble backed by Cloudflare AI Search over both
  `docs.walletlink.social` (13 pages) and the marketing site (33 pages).
  New `components/DocsChat.tsx`, mounted in the root layout, hidden on
  `/admin` and `/success`, loaded `lazyOnload` so 115 KB stays off the
  critical path.
- Everything is served from `help.walletlink.social`, a **proxied** CNAME, so
  queries and the widget bundle both pass through our zone. The public
  endpoint is unauthenticated and spends Workers AI neurons per answer, so the
  zone is where that spend is bounded: 8 req/10s per IP at the WAF, 20 req/60s
  at the endpoint.
- A system prompt enforces the two rules the corpus cannot: never name a data
  provider, and never merge "~23% has an identity" with "~13% is reachable".
  Both verified against the live endpoint. See `docs/AI-SEARCH.md`.

### 2026-08-14 (public docs site + API source-leak fix)

**`sources` no longer leaks the data supply chain**

- `/v1/wallet`, `/v1/batch` and both `/v1/reverse` endpoints returned the raw
  `social_graph.sources` array, which contains literal vendor names. New
  `lib/api-sources.ts` maps them to evidence classes (`onchain`, `farcaster`,
  `manual`, `aggregated`) on an **allowlist**, so an unmapped internal source is
  dropped rather than published. Breaking change to those response bodies.

**Docs site**

- New `docs-site/` holding the Mintlify content for docs.walletlink.social:
  13 pages covering the concepts and a full `/v1` API reference, written
  against the route handlers rather than against this README.
- `docs-site/` is the _only_ publishable folder. `docs/` stays internal, since
  `docs/SECURITY.md` is the backup and restore runbook.
- Freshness is enforced, not requested: `.github/pull_request_template.md` asks
  for an explicit docs decision and `.github/workflows/docs-freshness.yml`
  fails any PR that changes the public API surface without touching
  `docs-site/` (escape hatch: the `no-docs-needed` label).
- Corrected the Public API section above: those plans are tier benefits, not
  monthly subscriptions.

### 2026-08-12 (daily collection seed cron)

**Top/trending collections and tokens → holder lists → the graph**

- New `lib/seed-collections.ts` + `/api/cron/seed-collections` (07:00 UTC):
  one NFT collection per chain (Ethereum, Base, Robinhood Chain) and one
  trending token on Ethereum + Base per day, holders capped at 2,000 per
  contract, queued through the normal lookup pipeline as visible
  `seed_cron` jobs — Recent Activity now shows real collections with real
  match stats.
- Discovery: OpenSea top+trending (uses `OPENSEA_API_KEY`, or auto-provisions
  a temp key — capped at 2/day, so treat it as best-effort);
  GeckoTerminal trending pools (keyless); Blockscout holders-ranked list as
  the keyless Robinhood fallback. Denylists filter infra tokens (WETH/USDC…)
  and infra NFTs (Uniswap positions et al.) whose holder lists aren't
  audiences.
- Selection is novelty-aware via the new `seeded_contracts` table (30-day
  re-seed window), so the cron works down the rankings instead of re-buying
  the top 10.
- New `wallet_holdings` table records wallet ↔ contract edges at seed time —
  the audience-graph data ("holders of X") that social resolution alone
  can't provide. Migration: `scripts/migrate-seed-tables.ts` (applied).

### 2026-08-12 (ENS text-record harvest)

**Onchain com.twitter / com.github records → social_graph**

- New `lib/ens-harvest.ts`: scans mainnet TextChanged logs (both the 3-arg
  pre-2023 and 4-arg 2023+ signatures, topic-filtered to the two keys, any
  resolver), then resolves each node's CURRENT values fully onchain —
  registry → resolver → `text()`/`addr()` via Multicall3. No subgraph, no
  third-party indexer, no node→name healing needed: `text()` works on node
  hashes directly.
- These are the highest-quality Twitter edges that exist (the wallet owner
  set the handle onchain themselves): source `ens_onchain`,
  `twitter_verified`, quality 50 — below the 70 trust line because the
  Farcaster side was never checked. Fill-only upserts: never overwrite an
  existing handle; `last_updated_at` moves only when something was filled.
- Checkpointed in the new `ingest_state` table
  (`scripts/migrate-ingest-state.ts`, applied 2026-08-12); the daily Vercel
  cron (`/api/cron/ens-harvest`, 05:00 UTC) scans ~7,200 new blocks per day.
- CLI: `npx tsx --env-file=.env.local scripts/ens-harvest.ts
--backfill | --incremental`. Interrupt-safe.
- The ENS registry address comes from ethers' network config, not a typed
  constant — a wrong registry address fails silently (every `resolver()`
  read returns `0x`), which is exactly what happened on the first attempt.

### 2026-08-12 (Farcaster protocol sweep)

**Bulk-ingest every Farcaster verified wallet into social_graph**

- New `lib/farcaster-sweep.ts`: sweeps Neynar `/user/bulk` (100 FIDs/call,
  1 credit/FID — a full network sweep is ~3.3M of the free tier's 10M monthly
  credits) and upserts every verified + custody ETH address with username,
  FID, and follower count. Sources tagged `farcaster_sweep`.
- Swept rows are deliberately medium quality (score 45, no `last_checked_at`):
  they carry Farcaster data but were never checked for Twitter, so lookups
  use them as base data and still resolve the remaining fields. Sweep upserts
  never touch Twitter/ENS/Lens/GitHub columns, and `last_updated_at` only
  moves on identity changes so re-sweeps don't trigger "new matches" badges.
- Daily incremental Vercel cron (`/api/cron/farcaster-sweep`, 05:30 UTC)
  ingests newly registered FIDs (sequential, so new = above max known fc_fid).
- Monthly full re-sweep via GitHub Actions
  (`.github/workflows/farcaster-sweep.yml`) — requires `DATABASE_URL` and
  `NEYNAR_API_KEY` repository secrets.
- CLI: `npx tsx --env-file=.env.local scripts/farcaster-sweep.ts
--full | --incremental | --range A B`. Idempotent, safe to interrupt.

### 2026-08-12 (negative-result persistence)

**Stop re-buying API calls for wallets known to have no socials**

- `social_graph` now persists negative results: wallets that completed the full
  external pipeline with nothing found get a row (all socials NULL,
  `sources=['none']`) with a new `last_checked_at` column. Repeat lookups skip
  all paid API calls for 30 days. Previously this knowledge lived only in the
  7-day `wallet_cache` — the graph held ~5k positives out of ~86k wallets ever
  checked, so ~80% of every repeat list was re-purchased.
- False-negative protection: `batchFetchNeynar`/`batchFetchWeb3Bio` now report
  failed wallets (timeouts, 429s, 5xx) separately from genuine not-founds, and
  failures are never persisted as negatives. Fast-mode and Neynar-disabled runs
  don't persist negatives either (incomplete pipeline).
- All `social_graph` readers updated for rows without socials: v1 API
  wallet/batch report `found: false` (with `checked_at` to distinguish
  "never seen"), stats/analytics denominators count positives only, the
  refresh-stale cron skips negatives, and "new matches" badges ignore
  negative re-checks.
- Migration: `scripts/migrate-negative-persistence.ts` (applied 2026-08-12).

### 2026-08-12 (later)

**Pricing and packaging changes**

- **Pro: $149 → $99**, and contract import moved down from Unlimited into Pro
- **Free per-lookup limit: 1,000 → 500**
- **New analytics events**: `checkout_redirected`, `checkout_failed`; `limit_hit` wired up
- Revenue math in the webhook, admin dashboard and analytics updated to 9900 cents

Driven by the funnel: 41 checkout sessions started, 0 completed. Free gave 1,000 wallets
per lookup with unlimited lookups and ungated CSV export, leaving Pro with little to sell.

**Deploy order matters:** the `$99` Stripe price must exist and `STRIPE_PRICE_PRO` must
point at it _before_ this ships, or the site advertises $99 and charges $149.

### 2026-08-12

**Robinhood Chain support for contract import**

- **New network**: Contract import now supports Robinhood Chain (chain ID 4663) alongside Ethereum and Base
  - NFT (ERC-721/1155) holder lookups via Alchemy's NFT API on `robinhood-mainnet`
  - Requires `ROBINHOOD_MAINNET` to be enabled for the app in the Alchemy dashboard
  - Verified against onchain `ownerOf` enumeration: Alchemy returned exactly the same
    618 holders for StonkBrokers (4,444 tokens) with no gaps in either direction
- **ERC-20 gap handled explicitly**: Moralis has no holder index for Robinhood, so token
  lookups on that network now fail with a clear message instead of an opaque API error.
  The import modal warns before the request is made.
- **New `lib/chains.ts`**: Chain constants (`SUPPORTED_CHAINS`, `CHAIN_LABELS`, `CHAIN_IDS`)
  split into a dependency-free module. `lib/contract-holders.ts` imports `ethers` at module
  scope, so client components importing chain values from it would ship ethers to the browser.
- **Chain selector is now data-driven**: `ContractImportModal` maps over `SUPPORTED_CHAINS`
  instead of hardcoding radio buttons, so adding a network is a one-line change.
- **Moralis no longer gates NFT imports**: `/api/contract-holders` previously returned 503
  when `MORALIS_API_KEY` was unset, blocking NFT lookups that only need Alchemy.
- **Clearer errors**: New `UNSUPPORTED_CHAIN`, `CHAIN_NO_NFT_SUPPORT`, and
  `CHAIN_NO_ERC20_SUPPORT` codes replace a raw TypeError on unknown networks.

### 2025-01-21

**Admin analytics dashboard + IP rate limiting**

- **Admin analytics dashboard**: New "Dashboard" tab in admin panel with comprehensive usage metrics
  - Period selector: Today / Last 7 days / Last 30 days with comparison to previous period
  - Usage metrics: Lookups, wallets processed, match rate, avg processing time (with % change)
  - Match analytics: Twitter/Farcaster/any rates with progress bars and 7-day sparkline trends
  - Performance monitoring: Queue status (pending/running), success rate, stage distribution
  - Recent activity table: Last 5 completed jobs with match stats
  - New endpoint: `GET /api/admin/dashboard?period=today|week|month`
- **IP-based rate limiting**: Prevents abuse from unauthenticated users
  - 3 requests per hour on `/api/lookup` and `/api/jobs` per IP address
  - Atomic UPSERT prevents race conditions under concurrent load
  - Supports proxy headers: `x-forwarded-for`, `x-vercel-forwarded-for`, `cf-connecting-ip`
  - Returns standard rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, etc.)
  - Fails open if database unavailable (allows requests but logs warning)
  - New table: `ip_rate_limit_buckets` with hourly bucket granularity

**Database migration required**:

```sql
CREATE TABLE IF NOT EXISTS ip_rate_limit_buckets (
  ip_address TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  bucket_key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (ip_address, endpoint, bucket_key)
);
```

---

### 2025-01-18

**New Starter tier + API optimization**

- **Starter tier ($49)**: New entry-level paid tier with 10,000 wallets cumulative (total across all lookups)
  - All Pro features (ENS, follower counts, priority scoring, history)
  - Quota-based instead of per-lookup limits
  - `wallets_used` column tracks cumulative usage
- **API pipeline optimization**: Neynar runs first (fast batch API), then Web3Bio only for wallets without Twitter
  - Expected 30-60% reduction in Web3Bio API calls
  - Separate stage indicators: `neynar` then `web3bio` instead of `web3bio+neynar`
- **PROJECT_OVERVIEW.md**: New comprehensive context document for LLMs

**Database migration required**:

```sql
ALTER TABLE users ADD COLUMN wallets_used INTEGER NOT NULL DEFAULT 0;
```

---

**Scalability audit: fixes for high-load scenarios**

Critical fixes (P0):

- **Inngest concurrency**: Increased from 10 to 100 concurrent jobs - 50 jobs now start in ~5s vs ~250s
- **API timeouts**: Added 15-second timeouts to all external API calls (Web3.bio, Neynar, ENS) - prevents jobs from hanging indefinitely
- **Rate limit race condition**: Fixed with atomic UPSERT - accurate counting under high concurrency
- **Connection pooling**: Added optional Neon pooler support (`USE_CONNECTION_POOLING=true`) - reduces p95 latency from 200-500ms to 50-100ms
- **Cache state loss bug**: Fixed Inngest step serialization issue that was discarding cache hits - 2-3x faster processing

High priority fixes (P1):

- **Debounced search**: 300ms debounce on ResultsTable search - eliminates 1-2s lag with 10K+ results
- **Parallel cron processing**: Process 5 jobs simultaneously instead of 1 - 5x faster queue clearing
- **Adaptive polling**: Starts at 2s, increases to 5s when idle - ~60% reduction in server requests
- **Composite indexes**: Added `(status, created_at)` and `(user_id, created_at)` indexes for faster queries
- **COUNT aggregates**: Replaced full table scans with `COUNT(*) FILTER` - ~99% faster stats queries

Additional fix:

- **Neynar 404 handling**: Gracefully handles batches where no addresses have Farcaster accounts

**Database migrations required**:

```sql
CREATE INDEX IF NOT EXISTS lookup_jobs_status_created_idx ON lookup_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS lookup_history_user_created_idx ON lookup_history (user_id, created_at);
```

### 2025-01-17 (Evening)

**Admin Wallet Enrichment feature**

- **Manual wallet enrichment**: New "Enrichment" tab in admin panel for adding/editing social data
  - Search any wallet address to view existing social_graph data
  - Add Twitter, Farcaster, or ENS manually with 'manual' source tag
  - Recent manual edits list for quick reference
- **New API endpoint**: `POST /api/admin/social-graph` for admin wallet enrichment

**New matches notifications**

- **Enrichment badges**: "X new matches" badge appears on lookups when wallets have been enriched since last view
- **Row highlighting**: Enriched wallets highlighted with green background + "NEW" badge in results table
- **View tracking**: `lastViewedAt` timestamp tracks when users load lookups for accurate "new" detection
- **Automatic clearing**: Badges clear after user views the lookup (read-receipt pattern)

**Input source tracking**

- **Source column in admin history**: Shows whether lookup came from "File" (upload) or "Paste" (text input)
- **Color-coded badges**: Blue for file uploads, purple for text input
- **New database column**: `input_source` on `lookup_history` table

**Database migrations required**:

```sql
ALTER TABLE lookup_history ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMP;
ALTER TABLE lookup_history ADD COLUMN IF NOT EXISTS input_source TEXT;
```

### 2025-01-17

**Public API infrastructure**

- **Subscription API product**: New `/api/v1/` endpoints for external developers to access social_graph data
- **API key management**: Generate, validate, revoke, and rotate API keys with SHA-256 hashing
- **Three pricing tiers**: Developer ($49/mo), Startup ($199/mo), Enterprise ($799/mo)
- **Rate limiting**: Multi-tier sliding window limits (per-minute, daily, monthly) with `X-RateLimit-*` headers
- **Usage tracking**: Per-request analytics for billing and monitoring
- **Core endpoints**:
  - `GET /api/v1/wallet/[address]` - Single wallet lookup (1 credit)
  - `POST /api/v1/batch` - Batch lookup up to plan limit (1 credit/wallet)
  - `GET /api/v1/reverse/twitter/[handle]` - Find wallets by Twitter (2 credits)
  - `GET /api/v1/reverse/farcaster/[username]` - Find wallets by Farcaster (2 credits)
  - `GET /api/v1/stats` - Dataset statistics (free)
  - `GET /api/v1/usage` - API key usage stats (free)
- **Developer endpoints**: `/api/developer/keys`, `/api/developer/plans`, `/api/developer/usage`
- **New database tables**: `api_plans`, `api_keys`, `api_usage`, `rate_limit_buckets`

**Processing modal redesign**

- **Animated activity indicators**: Spinning ring + pulse effect shows processing even at 0%
- **Pipeline visualization**: 4-stage progress (Cache → Web3.bio → Farcaster → ENS) with active stage highlighting
- **Shimmer effects**: Progress bar has animated shimmer and sliding gradient when idle
- **Color-coded stats**: Twitter (sky) and Farcaster (violet) badges pulse when finding new matches
- **Job restoration fix**: Returning to page now properly restores stage info and animations

**New comparison pages**

- **`/vs/blaze`**: Compare against Blaze Web3 CRM ($79/month) - highlights Farcaster support and one-time pricing
- **`/vs/holder`**: Compare against Holder.xyz wallet messaging platform - emphasizes lookup focus vs CRM
- **SEO improvements**: Shortened titles, added keywords, Twitter cards, enhanced JSON-LD, internal linking between all /vs/ pages

**My lookups: Tiered history + Add addresses feature**

- **Renamed "Recent Lookups" to "My lookups"**: Better reflects user ownership
- **Tiered history visibility**: Free users see 1 lookup, Pro/Unlimited see full history with pagination
- **Add addresses to lookups (Pro+)**: Click "+" on any lookup to add more addresses
  - New AddAddressesModal with file upload and paste support
  - Deduplicates addresses already in the lookup
  - Merges new results with existing, preserving source tracking
  - Choose to add to existing lookup or create new one
- **Updated Upgrade modal**: Now lists history and add-to-lookups as Pro+ features
- **Updated vs/addressable page**: New comparison rows for Lookup History and Add to Lookups

**Admin dashboard enhancements**

- **Tabbed admin UI**: New tabs for Activity, Jobs, History, and Users management
- **Activity tab**: View/hide/delete completed jobs from public Live Activity feed
- **Jobs tab**: Monitor all jobs, filter by status, retry failed jobs, cancel stuck ones
- **History tab**: View/search/delete lookup history by user ID
- **Users tab**: View users by tier, change tiers via dropdown for manual upgrades
- **Hidden jobs**: New `hidden` column to hide spam/test lookups from public feed
- **New admin endpoints**: `/api/admin/activity`, `/api/admin/jobs`, `/api/admin/history`, `/api/admin/users`
- **Fixed match rate calculation**: Now uses `anySocialFound` instead of double-counting Twitter + Farcaster

**UX improvements**

- **Wallet limit warning**: Shows banner when uploaded file exceeds tier limit (before clicking Start)
- **Updated time estimates**: Processing now shows ~10s per 1K wallets (was incorrectly showing ~2min)
- **Live Activity filter**: Now hides lookups with fewer than 25 wallets
- **Copy refinements**: "Farcaster" instead of "FC", curly apostrophes, sentence case headings
- **Fixed Live Activity rate**: Now shows deduplicated "any social" rate (14.5%) instead of inflated sum (22%)
- **New `any_social_found` column**: Tracks unique wallets with Twitter OR Farcaster (not double-counting)

### 2025-01-16

**SEO & positioning**

- **Addressable alternative positioning**: New `/vs/addressable` comparison page
- **SEO meta tags**: Optimized title, description, and Open Graph tags for search visibility
- **Comparison content**: Feature comparison showing advantages over Addressable

**Live Activity improvements**

- **Industry average comparison**: Shows "9x industry avg" badge (vs ~2.5% baseline)
- **Cleaner copy**: Simplified homepage messaging and AccessBanner text

### 2025-01-15

**Tiered pricing with Stripe integration**

- **Three tiers**: Free (500 wallets), Pro (5,000 wallets, $99), Unlimited ($249)
- **Stripe Checkout**: One-time payment flow with automatic tier upgrade
- **Admin whitelist**: Manual unlimited access grants via `/admin` dashboard
- **Access control**: Tier-based limits enforced on frontend and backend
- **User database**: New `users` and `whitelist` tables for access management

**UI overhaul - Stripe-inspired design**

- **New color scheme**: Indigo accent color (`#635bff`) replacing green
- **Card-based layout**: Clean cards with subtle shadows and borders
- **Improved typography**: Better hierarchy and spacing throughout
- **Dark mode polish**: Refined dark theme with proper contrast
- **Consistent styling**: Buttons, inputs, and badges unified

**Rebrand to walletlink.social**

- **New domain**: Rebranded from previous name to walletlink.social
- **App icon**: Custom wallet emoji icon as favicon and header logo
- **Header clickable**: Logo/title returns to homepage from any state

**Performance optimizations**

- **Table virtualization**: ResultsTable uses `@tanstack/react-virtual` for 13K+ rows
- **Component memoization**: React.memo, useMemo, useCallback throughout
- **Reduced re-renders**: Optimized polling to avoid unnecessary state updates

**Live Activity redesign**

- **Card-based tiles**: Horizontal scrolling cards showing recent lookups
- **Pulsing indicator**: Green dot animation for "live" feel
- **Social proof**: Shows wallet count, Twitter/FC found, and match rate %

### 2025-01-14

**User-specific history + public wins showcase**

- **Private "Recent lookups"**: Each user only sees their own lookup history (localStorage ID until profiles)
- **"Recently processed" showcase**: Public tiles showing successful lookups (>10% social rate) as social proof
  - Updates every 3 minutes via polling
  - Shows wallet count, Twitter/Farcaster counts, and social hit rate %
- **Removed data source references**: Cleaner UI without Web3.bio/Neynar attribution in footer and results table
- **New database columns**: `user_id` on `lookup_history` and `lookup_jobs` tables

**Major performance optimizations + Inngest integration**

- **Parallel API calls**: Web3.bio and Neynar now run concurrently (saves 2-3s per batch)
- **Parallel Neynar batches**: Process 5 batches simultaneously instead of sequentially (5x faster)
- **Increased ENS batch size**: 50 wallets per batch instead of 20 (2.5x faster)
- **Larger chunk size**: 3000 wallets per cron invocation instead of 2000 (50% more throughput)
- **Inngest integration**: Optional workflow orchestration for 10-50x faster processing
  - Install: `npm install inngest` and add `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` env vars
  - Processes wallets in 500-wallet micro-batches with durable checkpoints
  - Falls back to cron worker if Inngest not configured
- **Estimated speedup**: 13k wallets now ~2-3 minutes (was ~17 minutes)

**Persist job ID across page refresh**

- Saves active job ID to localStorage so progress survives page refresh
- Automatically restores in-progress job state on page load
- Fixes issue where refreshing the page would lose connection to running job

**Add estimated processing time**

- Shows estimated time when file is uploaded (based on wallet count)
- Shows time remaining during processing (based on actual rate)

**Smooth progress bar animation**

- Progress counter animates smoothly instead of jumping in chunks
- Creates responsive feel during batch processing

**Add background job queue for large wallet lookups**

- New job queue system handles batches of any size without timeout
- Vercel Cron worker processes jobs in chunks (2000 wallets per invocation)
- Jobs persist in database and resume automatically if interrupted
- Frontend polls for progress instead of SSE streaming
- Users can close browser tab and retrieve results from History later
- New `lookup_jobs` table tracks job status, progress, and partial results
- New API endpoints: `POST /api/jobs`, `GET /api/jobs/[id]`, `POST /api/jobs/worker`

**Add browser notification on lookup complete**

- Opt-in checkbox to receive browser notification when long lookups finish
- Uses native Web Notifications API (no dependencies)
- Shows count of Twitter/Farcaster accounts found
- Click notification to focus the app tab

**Add Excel (.xlsx) file upload support**

- New file format support: upload .xlsx files in addition to CSV
- Unified file parser abstraction (`lib/file-parser.ts`) for extensibility
- Uses `read-excel-file` library (~50KB) for efficient Excel parsing
- Auto-detects wallet/address column in Excel files (same logic as CSV)
- Preserves extra columns from Excel files
- 10MB file size limit with clear error messaging

### 2025-01-14

**Add permanent social graph database** (`868e2bd`)

- New `social_graph` table stores all wallets with discovered social accounts permanently
- Merge & update strategy: new data fills gaps, follower counts update, existing data preserved
- Enrichment: backfills results from social graph after API calls complete
- Indexed on twitter_handle, farcaster, ens_name, fc_followers for future query capabilities
- Tracks firstSeenAt, lastUpdatedAt, and lookupCount per wallet

**Add dark mode with system preference toggle** (`9c414c0`)

- Dark mode support with automatic system preference detection
- Toggle cycles through System/Light/Dark modes
- Preference saved to localStorage

### 2025-01-13

**Add holdings, priority score, and enhanced export features** (`c1c77e2`)

- Holdings/Value column: auto-detects value columns from CSV (Peak index DTF value, balance, holdings, etc.), displays with $X,XXX.XX formatting
- Priority Score column: calculates `holdings × log₁₀(fcFollowers + 1)` with 5-bar visual indicator
- Top Influencers filter: quick filter button for accounts with 1K+ Farcaster followers
- Click-to-copy wallet: truncated `0x1234...abcd` display with clipboard copy and "Copied!" toast
- Twitter List export: new button to generate `.txt` file with @handles (one per line) for Twitter list import
- Enhanced CSV export: includes all columns (wallet, ens, holdings, twitter, farcaster, fc_followers, priority_score, source), sorted by priority score descending

**Format codebase with Prettier** (`2bd28ff`)

- Added Prettier configuration and formatted all source files

### Previous Updates

**Add Web3.bio API key support** (`f75c0fd`)

- Support for Web3.bio API key to increase rate limits

**Add warning for ENS with large wallet batches** (`2fc0aa4`)

- Show warning when using ENS lookup with >1000 wallets (may timeout)

**Speed up lookups to avoid Vercel timeout** (`b7e6899`)

- Optimized batch processing to complete within Vercel's function timeout limits

**Add ENS text record lookups for onchain Twitter handles** (`b38f945`)

- Query ENS text records directly onchain for the most accurate Twitter handle data
- Optional toggle (slower but more reliable than API sources)

**Add Neon database integration for caching and history** (`96f3780`)

- 24-hour result caching to speed up repeated lookups
- Lookup history feature to save and reload previous searches

**Initial commit: Wallet Social Lookup app** (`0ecff9d`)

- Core wallet-to-social lookup functionality
- Web3.bio and Neynar API integration
- CSV upload and export

---
