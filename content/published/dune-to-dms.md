---
title: 'From Dune Dashboard to DMs: Turning Analytics into Action'
meta_description: "Dune shows who holds your token. But you can't DM a wallet address. Here's how to bridge the gap between onchain analytics and real outreach."
published: true
publish_date: '2026-05-07'
---

# From Dune Dashboard to DMs: Turning Analytics into Action

Dune Analytics is one of the best tools in crypto. You can query any EVM chain, build dashboards that track holder behavior in real time, and share everything publicly. For understanding onchain activity, nothing else comes close.

But Dune has a hard stop. It tells you what is happening onchain. It does not tell you who is behind those wallets or how to reach them.

This is the gap between analytics and action, and it is where most token projects get stuck.

## The Dashboard Plateau

Here is a scenario that plays out constantly:

A project team builds a Dune dashboard tracking their token holders. They can see wallet-level data -- balances, transaction history, holding duration, governance votes. They identify their most valuable holders, their most active participants, and their at-risk wallets showing signs of selling.

Then what?

The dashboard gives them a list of addresses. They know `0xABC...` has held 100K tokens for six months and voted in every proposal. They know `0xDEF...` just sold 40% of their position. They know `0x123...` is a new holder who bought in last week.

These are actionable insights trapped behind an identity wall. You cannot DM a hex string.

## What Teams Actually Do (And Why It Doesn't Work)

Faced with this gap, most teams default to one of three approaches:

**1. Ignore the individual data, blast the group.**

Post a general announcement in Discord: "Governance vote this week, please participate!" This reaches maybe 2-3% of holders. The specific wallet you identified as a non-voting whale never sees it.

**2. Try to manually identify addresses.**

Someone on the team starts copying wallet addresses into Etherscan, checking ENS names, searching Twitter for people who have posted their address. This works for maybe the top 10 holders. It does not scale to 500 or 5,000.

**3. Build an internal tool.**

Some larger teams build custom scripts that check ENS, cross-reference known addresses, and try to match wallets to community members. This works but requires engineering time, ongoing maintenance, and usually produces mediocre match rates because it only checks one or two sources.

None of these approaches actually close the gap. The data stays in the dashboard.

## The Missing Step

The workflow that actually works has four steps, not three:

```
1. Query    -->  Dune / onchain analytics
2. Export   -->  CSV of wallet addresses + relevant data
3. Resolve  -->  Wallet-to-social identity resolution
4. Outreach -->  Personalized contact via Twitter / Farcaster DMs
```

Most teams stop after step 2 because step 3 has historically been difficult. There was no reliable way to batch-resolve thousands of wallet addresses to social profiles. You could check ENS one at a time. You could search Farcaster manually. But there was no pipeline.

This is exactly the problem that [walletlink.social](https://walletlink.social) solves. You take your Dune export, upload the wallet list, and get back Twitter handles, Farcaster accounts, and ENS names for every resolvable address. At current match rates, that is about 22% of wallets -- enough to meaningfully act on your analytics.

## A Concrete Example

Let's walk through a real workflow. Say you run a DeFi protocol and want to contact holders who have been inactive in governance.

**Step 1: Dune query.**

You write a query that returns all token holders who have _not_ voted in the last three governance proposals but hold more than 10,000 tokens. The query returns 2,300 wallet addresses.

**Step 2: Export.**

Download the results as a CSV. Your file has wallet addresses and token balances.

**Step 3: Resolve.**

Upload the CSV to a wallet identity resolution tool. You get back results:

- 506 wallets matched to at least one social profile
- 312 have Farcaster accounts
- 287 have Twitter handles
- 43 are flagged as AI agents or bots

**Step 4: Outreach.**

Now you have 463 real humans with social profiles (506 minus 43 agents) that you can contact directly. You segment them:

| Segment                | Count | Message                                                     |
| ---------------------- | ----- | ----------------------------------------------------------- |
| Whales (>100K tokens)  | 28    | Personal DM from a core team member about upcoming proposal |
| Mid-holders (10K-100K) | 187   | Farcaster cast tagging them in a governance summary thread  |
| Smaller holders        | 248   | Batch outreach with a link to a governance guide            |

You just turned a Dune dashboard into a targeted outreach campaign.

## Why This Matters More Than You Think

The projects that close this loop have a structural advantage. Consider the compounding effects:

**Better governance participation.** Quorum requirements exist for a reason. When you can directly notify large holders about proposals, participation rates climb. Some projects have reported 3-5x increases in governance engagement after implementing direct outreach.

**Reduced sell pressure during volatility.** Holders who feel connected to a project are less likely to panic sell. A single DM from a team member during a dip -- "here's what's happening, here's our plan" -- can be the difference between a holder and a seller.

**More effective airdrop targeting.** Instead of airdropping to all holders equally, you can identify which holders have social reach and prioritize them. A holder with 10K Farcaster followers who receives a generous airdrop becomes an organic marketing channel.

**Community feedback loops.** When you can reach your holders, you can ask them questions. What features do they want? What would make them more active? This direct line to your community is valuable data that no dashboard can provide.

## The Technical Reality

The reason this workflow was not standard practice until recently is simple: wallet identity resolution at scale was unreliable. Match rates in the low single digits meant that resolving 2,300 wallets would give you maybe 50-60 identities. Not enough to justify the effort.

At 22% match rates, the math changes. 2,300 wallets yield 500+ identities. That is a meaningful population. You can segment it, prioritize it, and build a real outreach operation around it.

And match rates are climbing. More users verifying on Farcaster, more ENS text records being populated, more attestation infrastructure coming online. The gap between "what Dune shows you" and "who you can actually reach" is narrowing.

## Start Where You Are

You do not need to build a sophisticated system on day one. Start with one Dune query, one export, one resolution batch, and one round of outreach. Measure what happens. Then iterate.

The analytics are already there. Your Dune dashboards already surface the insights. The only thing missing is the bridge from wallet to person.

---

Bridge the gap. Upload your Dune export to [walletlink.social](https://walletlink.social) and turn your analytics into outreach. Free for your first 100 matches every 30 days.
