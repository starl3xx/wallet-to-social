---
title: 'Nine things to build with a wallet address, and the calls that do them'
meta_description: 'Nine worked recipes for turning Ethereum addresses into people: holder outreach, airdrop screening, list auditing, and three that only work once an agent can call the API itself.'
published: true
publish_date: '2026-08-25'
---

# Nine things to build with a wallet address, and the calls that do them

An address is a primary key with no row behind it. You can see what it holds, what it traded and when it woke up, and none of that tells you whose it is. Every recipe below is about closing that gap, and each one is a call you can paste into a terminal.

Three of them need nothing but `curl`. Three depend on a field we publish that we have not seen anywhere else. The last three only became possible when an agent could call the API without a person wiring anything first.

## 1. Turn a holder snapshot into a list you can actually reach

The starting point for most people. You have a CSV out of a block explorer or a Dune query, and you want the subset that is reachable.

```bash
curl -X POST https://walletlink.social/api/v1/batch \
  -H "Authorization: Bearer wts_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"wallets":["0x00000000000000000000000000000000000000a1",
                 "0x2211d1d0020daea8039e46cf1367962070d77da9",
                 "0x0000000000000000000000000000000000000001"]}'
```

The `meta` block is the part to build on:

```json
{ "requested": 3, "found": 2, "not_found": 1, "matched": 2 }
```

`matched` is what you are charged for, and it counts only addresses that resolved to an X handle or a Farcaster account. The third address above returns `null` and costs nothing. Up to 50 addresses per call.

That last point matters more than it reads. A list of 10,000 addresses is 200 calls, not 10,000, and you pay for the fraction that resolves rather than the fraction you submitted.

## 2. Screen an airdrop before you sign the transaction

Two fields decide this, and they answer different questions.

`agent.is_agent` marks a wallet we have identified as belonging to an autonomous agent rather than a person: 13,622+ agent wallets are flagged in the index. If your allocation is meant for humans, these are the rows to drop first.

The second is `twitter.verified`, and the name undersells it. It does not mean a blue tick. It means the link between this address and this handle was published by the address owner, onchain or in a signed record, rather than correlated by a third party. An attested link is expensive to fake because faking it means controlling the wallet.

Sort by that flag and the shape of a Sybil cluster tends to show up on its own: hundreds of addresses, no attested links, no Farcaster history, all funded within an hour of each other.

## 3. Find every wallet one person controls

The reverse direction, and the one people forget exists.

```bash
curl https://walletlink.social/api/v1/reverse/twitter/jessepollak \
  -H "Authorization: Bearer wts_live_YOUR_KEY"
```

```json
{
  "handle": "jessepollak",
  "total_count": 13,
  "returned_count": 13,
  "truncated": false
}
```

Thirteen addresses, one person. Run that across an allowlist and the duplicate entries collapse. Run it across a POAP claim list and the "we had 4,000 attendees" number often turns into something more honest.

There is a Farcaster equivalent at `/v1/reverse/farcaster/{username}`. Pass the username whole, including any `.eth` suffix: an ENS name attached to a Farcaster account is a large share of the index, and stripping the suffix finds nothing.

A page holds up to 100 wallets and each one is a match, so a widely held handle can spend a lot of credits in one call. `/v1/usage` is free; call it first if that matters.

## 4. Audit the list you already have

Here is the recipe we would run first, and almost nobody does.

We resolve the X handles in the index against X itself, daily. Of those checked so far: **69.6% are live**, **20.5% are suspended**, and **9.9% are names nobody holds any more**. Roughly a third reach no person at all.

Nothing about a stale list looks broken. The handles are well-formed, the CSV opens, the send completes. The messages simply arrive nowhere, and the campaign reports a low response rate rather than a dead list.

Every X handle we return carries the answer:

```json
"twitter": {
  "handle": "example_user",
  "verified": true,
  "reachable": true,
  "reachability": "live",
  "reachability_checked_at": "2026-08-17T03:47:22.406Z"
}
```

Feed last quarter’s list back through `/v1/batch` and filter on `reachable`. It is the cheapest quality win available, because you are re-checking rows you already paid to resolve.

One subtlety worth respecting: `reachable` is **omitted**, not `false`, when we have not checked the handle. Absent means unknown. Treating it as a negative throws away good rows.

## 5. Route around a handle that died

The interesting case is not that a handle is gone. It is that the person is not.

A wallet whose X handle returns `not_found` frequently has a live Farcaster account attached to the same address, sometimes with several hundred thousand followers. The identity did not disappear; one of its addresses did. If your outreach only knows about X, that person is invisible to you and reachable by anyone who checked the other field.

So the rule is: read both, prefer the reachable one, and fall back rather than drop. The row you were about to discard is often your best one.

And the sharper version of the same problem. A handle that is released can be registered by somebody else, which means an address in your list can now point at a stranger. We keep `twitter_user_id`, the permanent numeric account id, precisely so a rename is distinguishable from a handover. A handle string alone cannot tell you which happened.

## 6. Sort by reach, not by balance

Holder lists get sorted by balance because balance is the column that arrives with the data. It is the wrong sort for anything to do with attention.

Every Farcaster match carries `followers`. Sorting on that gives you a different top of the list than balance does, and for a launch announcement, an ambassador shortlist or a set of people to brief before a vote, it is the list you actually wanted. The largest holder is often a bridge contract. The most-followed holder is a person who will post about it.

## 7. Ask in English, and let the model do the joins

This is where it stops being an integration exercise. Add the MCP server to Claude, Claude Code, Cursor or anything else that speaks the protocol:

```
https://walletlink.social/api/mcp
```

Connect it and the first tool call opens a consent screen. There is no key to create, copy or paste; sign in, approve, and the call continues where it left off. If you would rather use a key, the header still works exactly as it does on the REST API.

Then the recipes above stop being scripts:

> Here is a CSV of 400 addresses from our last mint. Who are the ten with the largest Farcaster followings, and which of them have a live X account?

The model resolves the batch, sorts, filters on reachability, and hands back a table. Five tools cover it: resolve wallets in either direction, read index coverage, and check the balance. Every tool description states its own cost, because an agent that cannot see the price cannot spend responsibly.

## 8. Name the address in front of you, mid-incident

The one we did not anticipate and now use constantly.

You are in a terminal, reading a contract, and an address appears. A deployer, a signer on a multisig, a counterparty in a trace, a recipient in a transaction you are trying to explain. Normally that is a context switch: open a block explorer, search, guess.

With the MCP server connected in Claude Code, it is a question:

> Who deployed this contract?

The model reads the deployer from the chain, resolves it, and answers with a name and a link. During an audit or a post-mortem this is the difference between a spreadsheet of hex strings and a list of people, and the cost is one credit per address that resolves.

## 9. Let an agent buy its own access

The last barrier to an autonomous workflow is usually the signup form. An agent that needs data at 3am cannot create an account, confirm an email and enter a card.

So it does not have to:

```bash
curl -X POST https://walletlink.social/api/x402/buy
```

That answers `402` with a payment challenge. Pay $1 in USDC on Base and the response carries a working API key with 12 match credits behind it, which is about 50 resolvable addresses at our measured rate, or one full batch call. No account, no card, no email address anywhere in the flow.

The credits are the same ones a card buys and are metered the same way, so an address that resolves to nobody still costs nothing. The key works on the whole REST API and on the MCP server.

## Where to start

If you have a list, start with recipe 4. Auditing what you already hold costs almost nothing and usually changes what you think you have.

If you are wiring something new, start with recipe 1 and add the reachability filter on day one rather than after the first campaign underperforms.

If you want to feel the difference, connect the MCP server and ask it something. The five tools are documented at [docs.walletlink.social/mcp-server](https://docs.walletlink.social/mcp-server), the REST API is described in OpenAPI 3.1 at [docs.walletlink.social/openapi.yaml](https://docs.walletlink.social/openapi.yaml), and the free allowance is 100 matches per rolling 30 days, which is enough to test every recipe on this page.
