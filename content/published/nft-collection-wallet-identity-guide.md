---
title: 'Wallet identity for NFT collections: a step-by-step guide'
meta_description: 'A step-by-step tutorial for NFT collection teams to export holders, resolve wallet identities, and build a targeted outreach plan.'
published: true
publish_date: '2026-05-18'
---

# Wallet identity for NFT collections: a step-by-step guide

If you run an NFT collection, your holders are your community. But unless you are one of the few projects where most holders hang out in your Discord, you probably have limited visibility into who actually owns your tokens.

This guide walks through the full process: exporting your holder list, resolving wallet identities, analyzing the results, and building an outreach plan. It is written for NFT teams, but the same approach works for any ERC-721 or ERC-1155 project.

## What you will need

Before starting, gather the following:

- Your NFT contract address
- Access to Etherscan (free account is fine)
- A wallet identity resolution tool (this guide uses [walletlink.social](https://walletlink.social))
- A spreadsheet application for analysis

Total time: about 30-45 minutes for a collection with up to 10,000 holders.

## Step 1: export your holder list

There are several ways to get a current snapshot of your holders. Here are the two most common.

### Option A: Etherscan token holder export

1. Go to `etherscan.io/token/YOUR_CONTRACT_ADDRESS`
2. Click the “Holders” tab
3. You will see a table of all current holders with their balances
4. Click “Download CSV Export” (requires a free Etherscan account)

The CSV will contain columns for wallet address and token quantity. For ERC-721s, the quantity represents the number of NFTs held.

### Option B: Dune query

If you want more control over the data, write a Dune query:

```sql
SELECT
  "to" as holder,
  COUNT(*) as nft_count
FROM erc721_ethereum.evt_Transfer
WHERE contract_address = 0xYOUR_CONTRACT_ADDRESS
GROUP BY "to"
HAVING COUNT(*) > 0
ORDER BY nft_count DESC
```

Note: This simplified query counts transfers _to_ each address. For accurate current balances, you need to subtract transfers _from_ each address as well, or use a pre-built Dune dashboard that tracks net holdings.

Export the results as CSV.

### Cleaning the data

Whichever method you use, clean the CSV before proceeding:

- Remove the null address (`0x0000...0000`) if present
- Remove known marketplace contracts (OpenSea, Blur, etc.): these are not real holders
- Remove your own project treasury or team wallets unless you want to resolve those too

You should end up with a clean CSV where each row is a wallet address that currently holds at least one of your NFTs.

## Step 2: resolve wallet identities

Upload your cleaned CSV to walletlink.social. The tool accepts CSVs with wallet addresses and will process them in batch.

Here is what happens during resolution:

1. Each wallet is checked against multiple identity sources: ENS records, Farcaster verified addresses, Twitter links, onchain attestations, and other public signals.
2. Wallets that match a social identity are returned with the associated profiles.
3. Known AI agent wallets are flagged separately.
4. Results are streamed back in real time so you can watch progress.

For a collection with 5,000 holders, expect processing to take a few minutes. At current match rates (~22%), you will resolve roughly 1,100 wallets to at least one social profile.

## Step 3: analyze your results

Once resolution is complete, export the results and start analyzing. Here are the key things to look at.

### Overall resolution rate

What percentage of your holders resolved to a social identity? The answer tells you how “reachable” your community is:

| Resolution rate | Interpretation                                        |
| --------------- | ----------------------------------------------------- |
| Below 15%       | Your holder base skews anonymous or bot-heavy         |
| 15-25%          | Typical for most collections                          |
| Above 25%       | Your holders are unusually active on social platforms |

### Platform distribution

Where are your holders most active?

```
Example breakdown for a 5,000-holder collection:
- Farcaster only:     320 holders (29%)
- Twitter only:       410 holders (37%)
- Both platforms:     270 holders (25%)
- ENS only:           100 holders (9%)
- Total resolved:   1,100 holders
```

This tells you where to focus your outreach. If your holders skew Farcaster, that is where you should be posting and DMing. If they skew Twitter, optimize for that.

### AI agent detection

Check how many of your holders are flagged as AI agents or bots. This matters for several reasons:

- Agent wallets should not receive governance voting rights in most cases
- Agent holders inflate your “community” numbers artificially
- Understanding the human-to-agent ratio gives you a realistic view of your actual community size

### Holder size vs. identity resolution

Cross-reference the number of NFTs held against whether the wallet resolved:

- Do your largest holders (5+ NFTs) resolve at a higher rate than single-NFT holders?
- Are your unresolved wallets concentrated among small holders or spread evenly?

This tells you whether your most invested community members are reachable or hidden.

## Step 4: segment your holders

With your analyzed data, build segments for outreach. Here is a framework designed for NFT collections:

**Tier 1: High-value, resolved holders (personal outreach)**

- Hold 3+ NFTs AND have a social profile
- These are your core community. Know them by name.
- Estimated size: 5-10% of resolved holders

**Tier 2: Active social presence, any holding size (community builders)**

- Resolved to Farcaster or Twitter with meaningful follower counts (500+)
- These holders amplify your project. Treat them as partners.
- Estimated size: 10-15% of resolved holders

**Tier 3: Resolved holders, standard (general outreach)**

- Have a social profile but do not fall into Tier 1 or 2
- Contact through scalable channels (group messages, tagged posts)
- Estimated size: 70-80% of resolved holders

**Tier 4: Unresolved holders (indirect outreach)**

- No social profile found
- Reachable only through onchain means (token-gated announcements, POAP-based notifications) or general public channels
- Estimated size: ~78% of total holders

## Step 5: build your outreach plan

Now turn your segments into a concrete plan.

### For tier 1 (personal outreach):

Write individual messages to each holder. Reference their specific holding. If they hold a rare NFT, mention it. If they have been holding since mint, acknowledge the loyalty. The goal is a two-way conversation, not a broadcast.

Sample message framework:

> Hi [name], I’m [role] at [collection]. You’ve held [X] pieces since [approximate date], including [specific NFT if notable]. I wanted to connect directly and see if there’s anything you’d like to see from the project. We’re working on [current initiative] and your input would be valuable.

### For tier 2 (community builders):

Engage with their existing content first. If they have tweeted or casted about NFTs (even other collections), interact genuinely. Then reach out with an offer: early access to news, an invitation to a holder call, or a request for feedback on upcoming plans.

### For tier 3 (general outreach):

Use scalable but targeted approaches:

- Farcaster channel posts tagging holders by username
- Twitter lists of resolved holders for easy monitoring and engagement
- Periodic batch messages around major announcements

### For tier 4 (indirect):

- Post announcements that get surfaced through the onchain context (token-gated channels, POAP drops for engagement)
- Make it easy for these holders to self-identify by linking their social accounts (provide clear instructions)

## Step 6: maintain and update

Holder lists change constantly as NFTs trade. Build a maintenance rhythm:

- **Monthly:** Re-export your holder list and re-run resolution to catch new holders and account for sales.
- **Quarterly:** Review your segment definitions and outreach effectiveness. Adjust thresholds based on what you learn.
- **After major events:** Any time there is a significant mint, airdrop, or marketplace surge, update your data.

Keep a running record of who you have contacted, when, and what the outcome was. This prevents duplicate outreach and lets you track which approaches drive the most engagement.

## What success looks like

After implementing this workflow, you should see measurable changes:

- Higher attendance at community calls and events
- More organic social posts from holders about your collection
- Better secondary market health (engaged holders list at higher prices and hold longer)
- Direct feedback that informs your roadmap

The collections that thrive long-term are the ones that treat their holder list as a living community rather than a static ledger. Wallet identity resolution is the bridge that makes that possible.

---

Start with your holder list. Upload it at [walletlink.social](https://walletlink.social) and see who your community really is. Free for your first 100 matches in every rolling 30-day window.
