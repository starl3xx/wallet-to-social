---
title: 'The 22% match rate: how we got far past single digits'
meta_description: 'Technical deep dive into how combining onchain records, protocol verifications, identity indexes and a social graph achieves a 16-46% wallet-to-social match rate, measured by chain.'
published: true
publish_date: '2026-03-26'
---

# The 22% match rate: how we got far past single digits

> **Update, August 2026:** Farcaster matching is now backed by our own index of the complete Farcaster protocol (every FID’s verified and custody addresses, 4.7M wallets, refreshed daily), so Farcaster matches are deterministic rather than best-effort API lookups. The pipeline and per-source contribution figures below describe the original architecture and predate the full index; treat them as historical context.
>
> **The 22% figure was re-measured on 2026-08-13 and holds.** See the verification below.

## Verification: re-measured 2026-08-13

The original 22% predates the full Farcaster index, so it was re-measured from scratch. Both benchmarks are reproducible from this repo.

**Full pipeline** (`scripts/benchmark-pipeline-sample.ts`): a seeded random sample of 600 holders drawn from 26,619 unique holders across 18 NFT collections on two chains (9 Ethereum, 9 Robinhood Chain), run through the live pipeline:

| Metric                                             | Result    | 95% CI        |
| -------------------------------------------------- | --------- | ------------- |
| **Any identity** (X, Farcaster, ENS, Lens, GitHub) | **23.7%** | 20.3% – 27.1% |
| X or Farcaster                                     | 12.8%     | 10.1% – 15.5% |
| Farcaster                                          | 11.3%     | 8.8% – 13.8%  |
| Twitter/X                                          | 9.3%      | 7.0% – 11.6%  |

22% sits inside the confidence interval and is the conservative end of it.

**Read the two rows carefully, because they answer different questions.** “Any identity” is the 22-24% headline: we return _something_ (a handle, an ENS name, a Lens profile) for roughly one wallet in four. “X or Farcaster” is the subset you can actually send a message to, and that is ~13%. An ENS name is an identity, not a contact channel. Campaign planning should use the second number; the first is a resolution rate, not a reach estimate.

**Index-only** (`scripts/benchmark-match-rate.ts`): the same collections resolved against our own database with **zero external API calls**:

| Chain                           | Holders | Farcaster | X-or-Farcaster | Any identity |
| ------------------------------- | ------- | --------- | -------------- | ------------ |
| Ethereum (9 collections)        | 15,314  | 13.4%     | 14.5%          | 15.2%        |
| Robinhood Chain (9 collections) | 17,304  | 11.3%     | 12.0%          | 12.6%        |

The index-only Farcaster rate (11-13%) now equals what the live pipeline returns (11.3%). Every Farcaster match the product makes is already served from our own data; the external Farcaster call has become a redundancy check rather than the source of truth.

Where the index is still thin is ENS: index-only “any identity” is 13-15% against the live pipeline’s 23.7%, and nearly all of that gap is ENS names not yet harvested onchain. That gap is the roadmap, not a limitation of the method.

Tools that resolve wallets to social identities typically publish rates in the low single digits. That means if you have 10,000 wallet addresses, most tools will identify social profiles for a few hundred of them at best.

walletlink.social matches 2,200 out of those 10,000, a 22% match rate. This post explains exactly how, covering the data sources, the pipeline architecture, and where each source contributes.

## Why single digits is the baseline

The industry average comes from a common approach: look up the wallet’s ENS name (if any), check for text records, and return whatever is found.

This approach has structural limitations:

- Only ~12% of active Ethereum wallets have ENS names
- Of those, only ~8% have social text records set
- Of those records, ~15-20% are stale (changed handles, deactivated accounts)

If you do the math: 12% (have ENS) x 8% (have text records) x 82% (records are valid) = roughly 0.8%. Some tools do better by adding scraped databases or third-party enrichment, reaching the low single digits. But the ceiling for ENS-only approaches is low.

## The four-source pipeline

Our resolution pipeline queries four data sources for each wallet. Each source covers a different slice of the identity landscape, and the overlap between them is surprisingly small.

### Source 1: ENS onchain text records

The most direct approach. For wallets with ENS names, we query the resolver contract for `com.twitter`, `com.github`, `url`, and other text record keys.

**What it catches:** Crypto-native users who’ve invested in ENS names and configured their records. These tend to be builders, long-term participants, and identity-conscious users.

**Limitations:** Low coverage, no verification, stale data. We use ENS as a starting point, not an authority.

**Contribution to overall match rate: ~7% of wallets resolved.**

### Source 2: Farcaster verified addresses

This is the single largest contributor to our match rate. We check whether a wallet appears as a verified address for any Farcaster account.

The key advantage is cryptographic verification. When a wallet is listed as verified for a Farcaster Identity (FID), the owner signed a message proving control. There are zero false positives in this mapping.

**What it catches:** The ~800,000 Farcaster users who’ve verified at least one wallet address. Since average users verify 1.8 addresses, this covers approximately 1.4 million wallet addresses.

**Limitations:** Only covers Farcaster users. Strong crypto-native bias, less useful for wallets owned by DeFi-only users who don’t participate in social platforms.

**Contribution to overall match rate: ~15% of wallets resolved (including ~8% that are unique to Farcaster, not found via ENS).**

### Source 3: identity index aggregation

An identity index correlates profiles across several namespaces at once: ENS, Farcaster, Lens Protocol, Unstoppable Domains and others. Querying one is effectively querying many, at the cost of taking its correlation on trust rather than reading an attestation yourself.

**What it catches:** Cross-protocol identities. A wallet might not have ENS records or Farcaster verification but could have a Lens profile or an Unstoppable Domain with social records.

**Limitations:** Depends on upstream data quality, and inherits the same stale-data problems as raw ENS lookups. This class adds coverage breadth but not depth, and it correlates rather than attests, which is why matches carrying only this evidence are labelled `aggregated` rather than presented as owner-attested.

**Contribution to overall match rate: ~3% of wallets resolved uniquely (not already found by ENS or Farcaster).**

### Source 4: social graph enrichment

This is the compound interest of identity resolution. Every time we resolve a wallet, that result goes into a persistent social graph database. On subsequent lookups, we check this database before hitting external APIs.

But the social graph does more than caching. It enables transitive resolution. If we know that `@alice_crypto` on Twitter is associated with wallets A and B (from previous lookups), and wallet C sends tokens to both A and B regularly, there’s a potential connection to explore.

We’re conservative with transitive resolution: we only use it for confirmed multi-wallet relationships where the same social identity has verified multiple addresses. But over time, this compounds.

**What it catches:** Wallets that have appeared in previous resolution batches, multi-wallet users where one wallet was previously resolved, and cross-session enrichment.

**Contribution to overall match rate: ~2% of wallets resolved uniquely (grows over time as the graph expands).**

## The pipeline architecture

The resolution pipeline processes wallets in a specific order optimized for speed and accuracy:

```
Input: Batch of wallet addresses
         |
    [1. Cache Check]
         |  Hit -> Return cached result (24h TTL)
         |  Miss -> Continue
         |
    [2. Social Graph Check]
         |  Hit -> Return stored result
         |  Miss -> Continue
         |
    [3. Parallel External Lookups]
         |
    +---------+-----------+
    |         |           |
  [ENS]  [Farcaster]  [Indexes]
    |         |           |
    +---------+-----------+
         |
    [4. Merge & Deduplicate]
         |
    [5. Confidence Scoring]
         |
    [6. Store to Social Graph]
         |
    Output: Resolved profiles with confidence scores
```

Steps 3a, 3b, and 3c run in parallel. This is critical for performance: a batch of 10,000 wallets completes in under 2 minutes because we’re not waiting for each source sequentially.

### The merge step

When multiple sources return data for the same wallet, we merge with a priority hierarchy:

1. **Farcaster verified address**: highest confidence (cryptographic proof)
2. **ENS onchain records**: high confidence (onchain data, but unverified claims)
3. **Identity index correlation**: medium confidence (depends on upstream source)
4. **Social graph**: confidence varies (based on original resolution source)

If sources conflict (ENS says `@handle_a`, Farcaster says `@handle_b`), we keep both but flag the Farcaster result as primary. In practice, conflicts are rare, about 0.3% of multi-source matches.

### Deduplication

A single person might appear through multiple sources with slight variations:

- ENS: `@alice_crypto`
- Farcaster: `alice` (with connected Twitter `@alice_crypto`)
- Identity index: `@Alice_Crypto` (case variation)

The deduplication step normalizes handles, matches across platforms, and produces a single identity record with all known profiles attached.

## Where the matches come from

Across a representative sample of 500,000 wallets:

| Source                      | Wallets matched | % of total matches | Unique contribution |
| --------------------------- | --------------- | ------------------ | ------------------- |
| Farcaster                   | 75,000          | 68.2%              | 42,000 (38.2%)      |
| ENS                         | 35,500          | 32.3%              | 14,000 (12.7%)      |
| Identity indexes            | 18,000          | 16.4%              | 3,300 (3.0%)        |
| Social graph                | 11,500          | 10.5%              | 2,200 (2.0%)        |
| **Combined (deduplicated)** | **110,000**     | **100%**           | **22% match rate**  |

Note that the percentages in the “% of Total Matches” column sum to more than 100% because many wallets are matched by multiple sources. The “Unique Contribution” column shows wallets found by that source and no other.

Farcaster is the dominant source, providing 68% of all matches and 38% of unique matches. This is why the growth of Farcaster directly correlates with improving match rates across the industry.

## Performance optimizations

Processing 10,000+ wallets efficiently required several architectural choices:

**Batch API calls.** Instead of querying one wallet at a time, we batch into groups of 100. This reduces API round trips by 99% for large uploads.

**Cache layer with 24-hour TTL.** Results are cached in PostgreSQL with a 24-hour expiry. Repeat lookups for the same wallet (common when teams iterate on their analysis) hit the cache instead of external APIs.

**Streaming progress.** The API uses Server-Sent Events to stream progress back to the client. For a 10,000-wallet batch, you see results populating in real time rather than waiting for the entire batch to complete.

**Parallel source queries.** Every source class is queried simultaneously for each batch. The total wall-clock time is the slowest source, not the sum of all sources.

## What pushes match rates higher

Three factors will improve match rates over time:

**Farcaster growth.** Every new Farcaster user who verifies a wallet address adds to the resolvable pool. If Farcaster reaches 2 million verified users (plausible within 12-18 months), match rates could approach 30-35% for general wallet populations.

**Multi-chain verification.** Currently, Farcaster verification is primarily Ethereum and Base wallets. As verification expands to other chains, coverage broadens.

**Social graph compounding.** The more wallets we resolve, the richer the social graph becomes. Each resolution adds data that helps future lookups. This creates a flywheel where match rates improve with usage volume.

## The takeaway

The 22% match rate isn’t a single technique. It’s four data sources, a merge pipeline that handles conflicts and deduplication, and a social graph that compounds over time.

Any single source peaks around 7-15%. Combining them pushes to 22% because the overlap between sources is smaller than you’d expect: different identity platforms attract different user populations.

The architecture is straightforward. The insight is simply that no single identity source is sufficient, and the real work is in the merge logic that combines them reliably.

---

**See the 22% difference on your data.**

[walletlink.social](https://walletlink.social) runs the full pipeline on your wallet list. Free tier covers 100 matches in every rolling 30-day window. Upload a CSV and see how many holders you can identify.
