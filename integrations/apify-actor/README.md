# Wallet to Twitter and Farcaster lookup

Turn a list of Ethereum or EVM **wallet addresses** into the **X (Twitter) handles** and **Farcaster accounts** their owners published, and run it in reverse to find every wallet attested to a handle. Backed by a 4.85 million wallet identity index across eight onchain networks.

This Actor returns only identities a wallet owner published themselves. It does not guess, and when it has nothing it says so.

## Why this is different from scraping posts

Most wallet-to-Twitter tools search X for posts that **contain** an address and ask a language model who the owner probably is. That is the wrong way round. The commonest reason an address appears in a public post is that it belongs to somebody else: a scam call-out, a drainer warning, a dust-sender complaint, a block explorer link someone pasted.

This Actor reads the opposite direction. Every match comes from something the owner did:

- a Farcaster verification, signed by the account holder
- an onchain record the wallet owner wrote, such as an ENS `com.twitter` text record
- an attested social sign-in
- a manually verified record

Each row is labeled with which class of evidence it came from, so you can set your own confidence bar instead of trusting a score somebody else assigned. Over 99.9% of the X handles in the index arrive by one of the first two routes.

## Handles that no longer reach anybody

Having an account and reaching a person are different claims, and most tools conflate them.

Of 473,215 distinct X handles resolved against X itself: **70.1% are live, 20.1% are suspended, and 9.8% were never claimed**. Close to a third of the handles on a typical holder list reach nobody at all. Where the check has been run, each row carries an `x_reachability` value of `live`, `suspended`, `unclaimed` or `reassigned`, so you can drop the dead ones before you spend anything on reach.

An empty `x_reachability` means the handle was not checked. It never means nobody is behind it.

## How to find the Twitter account behind an Ethereum wallet address

One address or ten thousand, the method is the same and it takes about a minute.

Paste the address into `walletAddresses`, leave `lookupMode` on `wallets`, add your API key, and run. The dataset comes back with the X handle, the Farcaster username, the evidence class behind each one, and whether the X handle still reaches a person. If the owner never published an account, the row says `found: false` and you were not charged for it.

Going the other way is one field: set `lookupMode` to `x_handle`, put the handle in `handle`, and you get the wallets that account is attested to.

## How to use it

1. Get a free API key at [walletlink.social](https://walletlink.social). Sign in and take one from the account menu: no card, and no pack needed. The free allowance is 100 matches every 30 days.
2. Choose a lookup mode: wallets to social accounts, or a handle back to its wallets.
3. Paste your addresses, or a whole CSV column. Anything shaped like an EVM address is picked out.
4. Run it, then export the dataset as CSV, JSON or Excel.

## Input

| Field             | What it does                                                            |
| ----------------- | ----------------------------------------------------------------------- |
| `lookupMode`      | `wallets`, `x_handle` or `farcaster_username`                           |
| `walletAddresses` | EVM addresses, one per row                                              |
| `walletText`      | Paste a CSV column or a newline-separated list instead                  |
| `handle`          | The handle to reverse, for the two reverse modes                        |
| `apiKey`          | Your walletlink.social key, starting with `wts_live_`                   |
| `includeMisses`   | Keep a row per address submitted so the output lines up with your input |
| `maxReversePages` | Reverse pages to fetch, 100 wallets each                                |

## Output

One flat row per wallet, ready for a spreadsheet:

```json
{
  "wallet": "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
  "found": true,
  "x_handle": "VitalikButerin",
  "x_url": "https://x.com/VitalikButerin",
  "x_verified": true,
  "x_reachability": "live",
  "farcaster_username": "vitalik.eth",
  "farcaster_url": "https://farcaster.xyz/vitalik.eth",
  "farcaster_followers": 123456,
  "farcaster_fid": 5650,
  "ens_name": "vitalik.eth",
  "evidence": "onchain, farcaster",
  "last_updated": "2026-09-14T00:00:00.000Z",
  "stale": false
}
```

Fields are flat on purpose, because these datasets are exported to CSV far more often than they are read as JSON.

## What it costs

The Actor itself is free to run. It calls the walletlink.social API with your key, and that API is metered in **matches**, where one match is one wallet resolved to an X handle or a Farcaster account.

A wallet that resolves to nothing costs nothing, which on most lists is the majority of them. The free allowance is 100 matches every 30 days. Credit packs start at $29 for 250 matches and last 12 months, with no subscription.

Reverse lookups are the expensive direction: one page returns up to 100 wallets and bills one match per wallet returned, so a single page can spend an entire free allowance. `maxReversePages` defaults to 1 for that reason.

## Coverage

Eight onchain networks: Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, HyperEVM and Robinhood Chain.

Match rates depend far more on which chain a list comes from than on anything else about it. Measured across 26 real collections: Base 46.2% of holders reachable, Ethereum 16.6%. Plan against the chain your holders are actually on.

## Frequently asked questions

**Does it find an account for every wallet?** No, and no honest tool does. Most wallets never published a social identity. You are told which resolved and which did not.

**Is this scraped from X?** No. Nothing here is read from a post, a display name or a bio.

**Can I look up a handle instead?** Yes. Set `lookupMode` to `x_handle` or `farcaster_username` to get the wallets attested to it.

**What if someone asked to be removed?** Suppressed wallets and handles are filtered at read time and return the same shape as a wallet that was never indexed.

**Is there an API or an MCP server?** Both. See [walletlink.social/mcp](https://walletlink.social/mcp) and [docs.walletlink.social](https://docs.walletlink.social).
