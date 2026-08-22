---
title: 'The priority score formula: finding your most valuable holders'
meta_description: 'How the priority score formula (holdings x log10 followers) surfaces your best ambassador candidates by combining token position with social reach.'
published: true
publish_date: '2026-03-09'
---

# The priority score formula: finding your most valuable holders

You’ve resolved your wallet list to social profiles. You have names, handles, follower counts. Now what?

Sorting by token holdings gives you whales. Sorting by follower count gives you influencers. Neither sort gives you the people who are both invested and influential: the holders most likely to become genuine ambassadors for your project.

That’s the problem the priority score solves.

## The formula

```
Priority Score = Holdings x log10(followers + 1)
```

That’s it. Holdings is the raw token balance (or USD value, depending on your preference). Followers is the combined follower count across matched social profiles (Twitter + Farcaster). The `+1` prevents the log of zero for accounts with no followers.

The logarithmic scale on followers is the key design choice. Here’s why.

## Why not just multiply holdings by followers?

A linear multiplication creates a problem: follower count dominates the score.

Consider two holders:

| Holder | Holdings       | Followers | Linear score | Priority score |
| ------ | -------------- | --------- | ------------ | -------------- |
| Alice  | 50,000 tokens  | 500       | 25,000,000   | 134,948        |
| Bob    | 100,000 tokens | 200       | 20,000,000   | 230,103        |

With linear multiplication, Alice scores higher because her followers (500 vs 200) compensate for lower holdings. But Bob holds twice the tokens; he has twice the skin in the game. For most outreach purposes, Bob is the more valuable contact.

Now look at the priority score column. Bob scores higher because the logarithm compresses the follower difference. The gap between 200 and 500 followers matters less than the gap between 50,000 and 100,000 tokens.

This reflects a practical reality: **the difference between 200 and 500 followers is less meaningful than the difference between 200 and 20,000 followers.** The log function captures this: it gives weight to social reach while keeping holdings as the primary driver.

## The log scale explained

For those who want the intuition behind logarithmic scaling:

| Followers | log10(followers + 1) | Interpretation       |
| --------- | -------------------- | -------------------- |
| 0         | 0.00                 | No social presence   |
| 9         | 1.00                 | Minimal presence     |
| 99        | 2.00                 | Small audience       |
| 999       | 3.00                 | Moderate audience    |
| 9,999     | 4.00                 | Significant audience |
| 99,999    | 5.00                 | Large audience       |

Each 10x increase in followers adds 1.0 to the multiplier. Going from 100 to 1,000 followers adds the same score increment as going from 10,000 to 100,000. This means:

- A holder with 10,000 followers scores 4x a holder with 0 followers (all else equal)
- But a holder with 100,000 followers only scores 5x, not 10x

This prevents celebrity accounts from completely overwhelming the rankings. A holder with 1M followers and 100 tokens shouldn’t outrank a holder with 10,000 followers and 50,000 tokens. The log scale enforces that.

## Real-world examples

We ran the priority score against a mid-cap token’s top 1,000 holders. Here’s what the top 10 looked like when sorted by priority score versus raw holdings:

**Sorted by raw holdings (top 5):**

| Rank | Holdings  | Followers | Social profile    | Priority score |
| ---- | --------- | --------- | ----------------- | -------------- |
| 1    | 2,400,000 | 0         | None (unresolved) | 0              |
| 2    | 1,800,000 | 0         | None (unresolved) | 0              |
| 3    | 950,000   | 340       | @crypto_whale_xx  | 2,406,420      |
| 4    | 720,000   | 0         | None (unresolved) | 0              |
| 5    | 680,000   | 12,400    | @defi_builder     | 2,782,652      |

**Sorted by priority score (top 5):**

| Rank | Holdings | Followers | Social profile      | Priority score |
| ---- | -------- | --------- | ------------------- | -------------- |
| 1    | 680,000  | 12,400    | @defi_builder       | 2,782,652      |
| 2    | 950,000  | 340       | @crypto_whale_xx    | 2,406,420      |
| 3    | 420,000  | 45,200    | @nft_community_lead | 1,953,744      |
| 4    | 310,000  | 88,000    | @base_ecosystem     | 1,531,310      |
| 5    | 180,000  | 230,000   | @web3_educator      | 965,376        |

The holdings-sorted list is dominated by unresolved wallets: likely contracts, exchanges, or agents. Useless for outreach. The priority-scored list surfaces real people with both meaningful positions and social reach.

Holder #5 in the priority list (@web3_educator) holds only 180,000 tokens (ranked ~45th by holdings alone) but has 230,000 followers. They’re an ideal ambassador candidate that pure holdings-based sorting would bury.

## When priority score falls short

The formula isn’t perfect. A few situations where it needs manual judgment:

**Multi-platform presence.** A holder active on both Twitter and Farcaster with 5,000 followers each shows 10,000 combined followers. Someone with 10,000 on Twitter only shows the same number. But the multi-platform holder might be more valuable for cross-platform outreach. The score doesn’t capture this.

**Engagement rate.** A holder with 50,000 followers and 0.1% engagement rate is less useful than one with 5,000 followers and 10% engagement rate. Follower count is a proxy for reach, not influence. We’re exploring engagement-weighted variants but haven’t shipped them yet.

**Holding duration.** A long-term holder with 10,000 tokens is more committed than someone who bought yesterday. The current formula treats them equally. Some teams apply a time-weighted multiplier on the holdings side.

**Bot followers.** Inflated follower counts on Twitter are common. The formula trusts the follower number at face value. Farcaster followers are harder to fake, which is one reason Farcaster-resolved profiles tend to produce more reliable priority scores.

## How to use priority scores

In practice, teams use priority scoring for three main workflows:

**Ambassador recruitment.** Sort by priority score, take the top 50, review manually, and reach out. These are your holders who have both financial alignment and the audience to amplify your message.

**Governance mobilization.** Before a critical vote, sort by priority score and send direct outreach to the top 100. These holders have both voting power and the social presence to encourage others to participate.

**Whale watching with context.** Instead of tracking raw holdings, track priority scores over time. A whale who’s building a social presence around your token is a different signal than one who’s silently accumulating.

## Implementation

The formula is simple enough to implement in a spreadsheet:

```
=B2 * LOG10(C2 + 1)
```

Where B2 is holdings and C2 is followers. No libraries needed.

If you’re using walletlink.social, the priority score is calculated automatically when your upload includes a holdings column. Results come pre-sorted by priority score, with the raw data available for custom analysis.

---

**Surface your most valuable holders.**

[walletlink.social](https://walletlink.social) resolves wallets to social profiles and calculates priority scores automatically. Upload a CSV with wallet addresses and holdings, and get your ranked list in minutes.
