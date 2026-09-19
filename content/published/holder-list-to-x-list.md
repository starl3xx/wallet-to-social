---
title: 'From a holder list to an X list in one step'
meta_description: 'A token contract gives you addresses. An X list gives your community somebody to follow. Here is how walletlink closes the gap between the two, and what the numbers actually look like.'
published: false
publish_date: '2026-09-19'
---

# From a holder list to an X list in one step

A token contract will give you a list of addresses. That is a real asset and it is also close to useless on its own: nobody can read it, nobody can follow it, and no amount of staring at `0x4cb7…7cd5` tells you who is behind it or whether they are worth talking to.

The gap between "I have the holders" and "I can reach the holders" is where most community work stalls. Closing it used to take a spreadsheet, a lookup tool, a lot of copy-pasting, and then a manual slog of adding people to an X list one at a time.

walletlink now does the whole thing: upload the holder list, get back the accounts, and turn them into a real X list in your own account with one click.

## Why an X list is the right artifact

Most outreach tooling produces something disposable. A CSV gets downloaded, used once, and forgotten in a downloads folder. A DM campaign is a thing you do _to_ people.

An X list is different in three ways that matter.

**It is durable.** It keeps working after the lookup is forgotten. New posts from those accounts keep arriving in it, months later, with no further effort.

**It is public, if you want it to be.** A list called "Holders" that anyone in the community can follow turns a private marketing asset into a shared one. Every member can now see what every other member is saying. That is a community feed you did not have to build, host or moderate, assembled out of accounts that were already there.

**It is honest.** You are not scraping anyone or adding them to a mailing list they never asked for. An X list is a public, reversible, non-intrusive thing that X itself provides, and membership is visible to the person who was added.

## What the numbers actually look like

Two questions decide whether this is worth doing for a given collection: how many holders have an X account at all, and how many of those accounts still work.

The first answer depends far more on the chain than on the collection. Measured across the index, **Base holders are reachable on X or Farcaster at several times the rate of Ethereum holders**. A community that grew up on Base is simply more findable than one that did not, and no tool changes that. The current per-chain rates, with the date they were measured, are on the [coverage page](https://docs.walletlink.social/concepts/coverage).

The second question is the one almost nobody asks, and it is where most holder lists quietly rot. People rename on X. Accounts get suspended. A handle somebody attested to their wallet two years ago may now belong to a complete stranger who bought the name.

walletlink separates those cases rather than collapsing them:

- **live** — the handle still reaches the account that published it
- **suspended** — the owner attested it and X has since suspended it
- **unclaimed** — nobody holds the name now, usually a rename
- **reassigned** — the name resolves perfectly to a live account that is _not_ the one attested alongside that wallet

That last state is the dangerous one, because it looks healthy. The handle works, the account is active, the profile picture loads. It is just a different person. Adding them to a list called "our community" is a small, specific, public mistake.

**The list builder only ever adds live handles.** A suspended or vacated handle has no account to add, and a reassigned one belongs to whoever took the name. That is a deliberate refusal, not an oversight: a shorter list of real people beats a longer list with strangers in it.

## Honest limits

**It takes a while.** X allows 300 additions every 15 minutes, one member per request, which works out at 20 a minute sustained. A list of 300 takes about 15 minutes; a list of 3,000 takes about two and a half hours. The job runs in the background and survives the rate limits, so you can close the tab, but it is not instant and nothing can make it instant.

**X caps a list at 5,000 members.** A larger holder list is truncated, and we tell you by how many rather than quietly shortening it.

**Not everyone is findable.** Even on the best chains most holders have published no social identity at all. A list from a low-attestation community can legitimately come back small, and that is an answer about the community rather than a failure of the lookup.

**Renames are still a hard problem.** An X handle that changed hands is detectable only where we hold the numeric account id attested alongside the wallet, and we do not hold one for every row. Where we cannot tell, the handle is marked unchecked rather than guessed at, because the alternative is a confident wrong answer.

## The shape of the work

1. Import a contract, or upload a CSV of addresses
2. walletlink resolves them against the index and shows what it found, with each identity marked by how it was established and whether it still works
3. Filter to what you want: attested only, with an X handle, above a follower threshold
4. Create the X list, name it, choose public or private
5. Authorize with X once, and the list builds itself in your account

The authorization is deliberately temporary. walletlink does not keep a standing connection to your X account: it asks for permission that expires in a couple of hours, uses it to build the one list you asked for, and then has nothing. A second list means authorizing again. That is one extra click in exchange for us never holding the ability to act as you.

## Who this is for

Anyone who has a token contract and wants the people behind it to be able to find each other. NFT collections building a public community feed. Protocols who want to know which of their depositors are actually posting. Anyone who has looked at a holder export and thought there must be something better to do with this than a spreadsheet.

[Try it with your own collection](https://walletlink.social)
