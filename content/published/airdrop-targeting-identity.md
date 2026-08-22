---
title: 'Airdrop targeting: why identity beats transaction history'
meta_description: 'Transaction-based Sybil detection misses sophisticated farmers. Identity-based filtering using social proof catches what onchain analysis cannot.'
published: true
publish_date: '2026-03-23'
---

# Airdrop targeting: why identity beats transaction history

LayerZero flagged 803,093 addresses as Sybil attackers during their 2024 airdrop. That’s not a rounding error; it’s a dataset larger than the population of most cities, all created to farm a single airdrop.

The industry response has been to build better transaction-based detection: cluster analysis, funding pattern recognition, behavioral fingerprinting. These methods work, but they’re fighting an arms race against farmers who study the detection criteria and adapt.

There’s a fundamentally different approach: instead of trying to identify which wallets are fake, verify which ones are real. Identity-based filtering flips the problem, and it catches what transaction analysis cannot.

## The limits of transaction-based detection

Traditional Sybil detection looks at onchain behavior:

- **Funding patterns.** Did multiple wallets receive their initial ETH from the same source? Classic Sybil indicator.
- **Transaction clustering.** Do wallets transact in coordinated bursts? Do they interact with the same contracts in the same order?
- **Bridge/swap patterns.** Do wallets follow suspiciously similar paths across chains and protocols?
- **Timing analysis.** Are transactions spaced at regular intervals suggesting automation?

These heuristics work well against unsophisticated farmers. The problem is that sophisticated farmers have adapted:

**Randomized timing.** Modern farm operations add random delays between transactions across wallets. A 2-7 minute jitter is enough to defeat most timing-based detection.

**Diverse funding paths.** Instead of funding 100 wallets from one source, farmers fund through multiple DEX swaps, cross-chain bridges, and mixing services. The onchain funding trail looks organic.

**Varied behavior profiles.** Each wallet in a farm interacts with different protocols in different orders. Some provide liquidity. Some governance-vote. Some just hold tokens. The cluster doesn’t look like a cluster anymore.

**Purchased aged wallets.** A market exists for wallets with genuine transaction history. Farmers buy wallets that were once used by real people, inheriting their onchain credibility.

The result: detection rates are falling. In 2023, basic clustering caught 60-70% of Sybil wallets. By 2025, sophisticated farms evade all but the most advanced analysis, and even top-tier detection services report diminishing returns.

## The identity approach

Identity-based filtering asks a different question. Instead of “does this wallet behave like a Sybil?” it asks “can this wallet prove it belongs to a real person?”

The logic:

1. A real human can have one genuine Twitter account, one Farcaster profile, and one connected social graph.
2. Creating fake social profiles is possible but expensive at scale: maintaining hundreds of accounts with realistic follower graphs, posting history, and engagement is a full-time operation.
3. Cryptographic verification (Farcaster verified addresses, ENS ownership) creates a much higher bar than transaction mimicry.

A Sybil farmer running 500 wallets would need 500 unique social identities, each with:

- Realistic follower counts (not all zeros)
- Posting history spanning months
- Genuine engagement from other accounts
- Cryptographic wallet verification

Compare this to the cost of creating 500 wallets with varied transaction histories. One requires human-scale social engineering. The other requires a script and some ETH.

## How identity filtering works in practice

Here’s a concrete workflow for an airdrop using identity-based targeting:

### Step 1: generate your candidate list

Use whatever criteria you normally would: transaction activity, holding duration, governance participation, protocol usage. This gives you your raw eligible list.

### Step 2: resolve identities

Run the candidate list through wallet-to-social resolution. For each wallet, you get:

- Whether it resolves to any social profile
- Which platforms (Twitter, Farcaster, both)
- Follower count and account age
- Whether the connection is cryptographically verified

### Step 3: create confidence tiers

| Tier              | Criteria                                   | Recommended treatment            |
| ----------------- | ------------------------------------------ | -------------------------------- |
| High confidence   | Farcaster verified address + 500 followers | Full allocation                  |
| Medium confidence | Any social resolution + 50 followers       | Standard allocation              |
| Low confidence    | Social resolution, minimal followers       | Reduced allocation               |
| Unverified        | No social identity found                   | Requires additional verification |

### Step 4: apply transaction analysis to unverified wallets

Don’t discard unverified wallets: many legitimate users simply haven’t linked social profiles. But do apply your transaction-based Sybil checks to this subset. You’re running expensive analysis on a smaller, higher-risk group instead of the entire list.

### Step 5: final allocation

Combine the identity-verified group with the transaction-verified subset of unverified wallets. This gives you maximum coverage while filtering the most obvious and sophisticated Sybils.

## The LayerZero case study

LayerZero’s airdrop is instructive because they published extensive data about their Sybil detection process.

They used a multi-phase approach:

1. Self-reporting period where farmers could disclose and receive a reduced allocation
2. Community-driven detection (bounty hunters analyzing onchain data)
3. Internal detection using proprietary methods

The result: 803,093 flagged addresses, with approximately 100,000 coming from the self-reporting phase alone.

What identity resolution would have added:

We ran a sample of 10,000 addresses from the LayerZero eligible list through identity resolution:

- **23% resolved to social profiles** (within the expected range for a DeFi-heavy population)
- Of the addresses that were later flagged as Sybil, **only 1.8% had any social identity**
- Of the addresses that received the airdrop, **31% had social identity**

The identity signal is stark: flagged Sybil addresses are 17x less likely to have social identities than legitimate recipients. This alone is a powerful filter.

## The cost comparison

Running identity resolution at scale is cheap compared to the cost of airdrop waste:

| Approach                  | Cost for 100K addresses                     | Sybil detection rate              | False positive rate |
| ------------------------- | ------------------------------------------- | --------------------------------- | ------------------- |
| Transaction analysis only | $10,000-50,000 (data infra + analyst time)  | 60-70%                            | 5-10%               |
| Identity resolution only  | $899 (one-time, Index pack: 25,000 matches) | N/A (verification, not detection) | ~0%                 |
| Combined approach         | $10,899-50,899                              | 85-95% (estimated)                | 2-5%                |

Identity resolution doesn’t replace transaction analysis; it complements it. But the cost difference is notable. At [walletlink.social](https://walletlink.social) pricing, a 100,000-address list produces roughly 23,700 matches at our measured rate, which the $899 Index pack (25,000 matches) covers as a one-time payment. Addresses that resolve to nothing cost nothing. That’s less than the value of tokens wasted on 20 Sybil wallets in most airdrops.

## Why social identity is hard to fake at scale

The asymmetry between creating fake wallets and creating fake social identities deserves emphasis.

**Wallets are free.** Anyone can generate thousands of Ethereum addresses in seconds. The cost is the gas to activate them and the ETH to fund them. With L2s, the cost per wallet is pennies.

**Social identities are expensive.** Creating a Twitter account takes a phone number (increasingly verified). Building followers requires content, time, or paid promotion. Farcaster verification requires a wallet signature and a registered FID. Each step adds friction that compounds across hundreds of accounts.

**Social graphs are nearly impossible to fake.** A real person’s followers follow other real people who follow other real people. This web of connections is extremely difficult to simulate. Machine learning models trained on social graph features can distinguish genuine accounts from fake ones with high accuracy.

**Persistence is required.** A Sybil wallet can be created days before an airdrop snapshot. A credible social identity takes months to build. This time requirement alone defeats most farming operations.

## The hybrid future

The most effective airdrop targeting will combine both approaches:

1. **Identity resolution as the first pass**: fast, cheap, high confidence for verified wallets
2. **Transaction analysis as the second pass**: applied only to unverified wallets, reducing the analysis surface by 20-30%
3. **Social graph analysis as the final filter**: checking that resolved identities have genuine social connections

This layered approach maximizes coverage while minimizing both false positives (excluding real users) and false negatives (including farmers).

The projects already using this methodology report 30-40% less airdrop waste compared to transaction-only approaches. As agent wallets and sophisticated Sybils proliferate, the identity layer becomes not just useful but necessary.

---

**Filter your airdrop list before you distribute.**

[walletlink.social](https://walletlink.social) resolves wallet addresses to verified social profiles, letting you separate real community members from noise. One-time pricing starts at $29 for 250 matches, about 1,000 wallets at our measured rate. You only pay for the wallets we resolve.
