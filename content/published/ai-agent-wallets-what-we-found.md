---
title: "We Scraped 13,622 AI Agent Wallets. Here's What We Found"
meta_description: "Data breakdown of 13,622 AI agent wallets across Virtuals Protocol, ElizaOS, and Olas. How agents inflate holder counts and what to do about it."
published: true
publish_date: "2026-02-27"
---

# We Scraped 13,622 AI Agent Wallets. Here's What We Found

Over the past three months, we built a detection pipeline for AI agent wallets operating on Ethereum and Base. The final count: **13,622 wallets** controlled by autonomous agents, spread across three major platforms.

This post is a data dump. No speculation about the future of AI agents in crypto -- just what the numbers show right now.

## The Three Platforms

| Platform | Agent Wallets | % of Total | Primary Chain |
|----------|--------------|------------|---------------|
| Virtuals Protocol | 12,971 | 95.2% | Base |
| ElizaOS | 621 | 4.6% | Ethereum / Base |
| Olas | 30 | 0.2% | Ethereum / Gnosis |

**Virtuals Protocol** dominates the count by a wide margin. Their architecture spawns a new wallet for each agent instance, which means a single agent concept can generate dozens of on-chain addresses. Most of these agents are trading agents -- they buy and sell tokens based on predefined strategies, social signals, or market conditions. A meaningful subset are "social agents" that hold tokens as part of a persona (think AI-driven Farcaster accounts that accumulate tokens related to their character).

**ElizaOS** (formerly ai16z's Eliza framework) accounts for 621 wallets. These tend to be more sophisticated -- many run multi-step DeFi strategies involving lending, LP provision, and yield farming. The wallet count is lower because ElizaOS agents typically reuse a single wallet across operations rather than spawning new ones.

**Olas** runs the tightest ship with just 30 detected agent wallets. Olas agents tend to operate on Gnosis Chain and focus on prediction markets and service-oriented tasks. Their small footprint reflects a design philosophy where agents are services, not autonomous traders.

## What These Agents Actually Do

We categorized agent activity by transaction patterns:

| Activity Type | % of Agent Wallets | Avg Transactions/Week |
|--------------|-------------------|----------------------|
| Token trading (buy/sell) | 68% | 47 |
| Liquidity provision | 14% | 12 |
| Social token holding | 11% | 3 |
| Governance voting | 4% | 1 |
| Other DeFi | 3% | 8 |

The majority are traders. They execute high-frequency swaps, often on DEXs like Uniswap or Aerodrome. The average trading agent executes 47 transactions per week -- far above the human median of about 4.

Social token holding is the more interesting category. These agents hold tokens as part of an identity. An AI agent with a Farcaster profile might hold a specific memecoin to signal alignment with a community. They're not trading -- they're performing identity.

## The Holder Count Inflation Problem

Here's where it gets practical.

We analyzed 50 token projects on Base and found that **AI agent wallets represented 3-18% of unique holder addresses** depending on the token. For smaller tokens (under 5,000 holders), the inflation was worse -- up to 18% of "holders" were agent wallets.

This matters for three reasons:

**1. Marketing decisions based on bad data.** If you think you have 5,000 holders but 900 are agents, your community is 18% smaller than you believe. Growth campaigns built on inflated baselines produce misleading ROI.

**2. Airdrop waste.** Agents that receive airdrops typically dump immediately. We tracked 200 airdrop events targeting wallets later identified as agents -- 73% of received tokens were sold within 24 hours. That's not community distribution. That's exit liquidity.

**3. Governance distortion.** While only 4% of detected agents participate in governance, the ones that do can hold significant voting power. We found three cases where agent wallets held top-50 governance positions in DAOs.

## How to Detect Agent Wallets

Agent wallets share recognizable patterns:

- **Transaction regularity.** Agents transact at consistent intervals -- often exactly every N blocks or every N minutes. Human wallets show irregular, bursty patterns.
- **Gas optimization.** Agents almost always use gas estimation and set precise gas limits. Human wallets frequently overpay or use wallet defaults.
- **Contract interaction patterns.** Agents call the same contract functions repeatedly with parameter variations. Humans browse, try things, make mistakes.
- **No social graph.** This is the strongest signal. Agent wallets almost never resolve to any social identity -- no ENS name, no Farcaster profile, no linked Twitter account. When we run agent wallets through identity resolution, the match rate is under 0.3%, compared to 22% for human wallets.

That last point is what makes identity resolution a powerful filter. If a wallet has a verified Farcaster profile or an ENS name with populated text records, it's almost certainly human-controlled. The absence of identity doesn't prove a wallet is an agent, but the presence of identity effectively rules it out.

## The Growth Trajectory

We've been tracking agent wallet creation rates since September 2025:

| Month | New Agent Wallets | Cumulative |
|-------|------------------|------------|
| Sep 2025 | 1,240 | 4,891 |
| Oct 2025 | 1,890 | 6,781 |
| Nov 2025 | 2,100 | 8,881 |
| Dec 2025 | 2,340 | 11,221 |
| Jan 2026 | 2,401 | 13,622 |

The growth is roughly linear at around 2,000 new agent wallets per month. Virtuals Protocol accounts for most of the increase, driven by their agent launchpad making it easier to deploy new agents.

If this rate holds, we're looking at 25,000+ agent wallets by mid-2026. And these are just the three platforms we've instrumented -- there are undoubtedly agents running on custom infrastructure that we haven't detected.

## What This Means for Token Projects

The practical takeaway: **you need to account for agents in your holder data before making decisions based on it.**

If you're running outreach, airdrops, or governance campaigns, agent wallets are noise. They won't engage with your community. They won't become ambassadors. They'll either dump your tokens or sit inert.

The good news is that detection is straightforward. Identity resolution is the fastest filter -- run your holder list through a service like [walletlink.social](https://walletlink.social), and any wallet that resolves to a social profile is almost certainly human. The unresolved wallets need further analysis, but you've already separated signal from noise.

We've published our full agent wallet dataset (addresses only, no private data) as a public resource. If you're building analytics tools or holder dashboards, this list is a useful exclusion filter.

## The Bigger Picture

AI agents are permanent fixtures of the on-chain ecosystem. They provide liquidity, execute strategies, and increasingly participate in social layers. The question isn't whether they belong -- it's whether your analytics can distinguish them from humans.

Every holder dashboard, every community metric, every airdrop allocation that doesn't account for agents is working with contaminated data. The sooner projects build agent detection into their workflows, the better their decisions will be.

---

**Clean your holder data before your next campaign.**

[walletlink.social](https://walletlink.social) identifies human holders by resolving wallets to verified social profiles. Upload your holder list, filter out the noise, and reach the people who actually matter.
