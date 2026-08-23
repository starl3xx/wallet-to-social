---
title: 'The wallet identity stack: ENS, Farcaster, and beyond'
meta_description: 'Technical overview of wallet identity data sources: ENS text records, Farcaster verified addresses, Lens profiles, and identity aggregators.'
published: true
publish_date: '2026-04-20'
---

# The wallet identity stack: ENS, Farcaster, and beyond

Resolving an Ethereum wallet to a social profile sounds simple. In practice, it requires querying multiple independent data sources, each with different coverage, accuracy, and freshness characteristics. No single source comes close to full coverage. The power is in the combination.

This post is a technical overview of the identity data sources available today, how they work, what they’re good at, and where they fall short. If you’re building on wallet identity data or evaluating resolution services, this is the landscape you need to understand.

## The data sources

### ENS text records

**How it works:** The Ethereum Name Service allows owners of `.eth` names to set arbitrary text records on their ENS domain. Common records include `com.twitter`, `com.github`, `url`, `description`, and `avatar`. These records are stored onchain (or via CCIP-Read for offchain resolution) and can be queried by anyone.

**What it provides:**

- Twitter/X handle (via `com.twitter` text record)
- GitHub username (via `com.github`)
- Website URL
- Avatar (often an NFT reference)
- Email (rarely populated)
- Farcaster handle (via `com.farcaster`, newer, less common)

**Strengths:**

- Onchain and verifiable: the ENS owner explicitly set these records
- Persistent: records stay until the owner changes them
- Widely adopted among power users and builders
- No API key required for basic lookups (public Ethereum state)
- Supports wildcard resolution for subdomains

**Weaknesses:**

- Requires the user to own an ENS name ($5+/year)
- Requires the user to actively set text records (gas cost, technical knowledge)
- No verification that the Twitter handle actually belongs to the ENS owner
- Stale records are common: users change Twitter handles and don’t update ENS
- Coverage is limited to ENS holders (~2.2 million names, many without text records)

**Typical match rate contribution:** 3-5% of arbitrary wallet lists.

**Querying ENS text records:**

```javascript
// Using ethers.js or viem
const resolver = await provider.getResolver('vitalik.eth');
const twitter = await resolver.getText('com.twitter');
const github = await resolver.getText('com.github');
const url = await resolver.getText('url');
```

Onchain queries are reliable but slow (one RPC call per record per name). For batch resolution, offchain indexers are more practical.

### Farcaster verified addresses

**How it works:** Farcaster users can verify Ethereum addresses by signing a message with their wallet. These verifications are stored on the Farcaster Hub network and are cryptographically provable. Each Farcaster account (FID) can have multiple verified addresses.

**What it provides:**

- Farcaster username and FID
- Display name and bio
- Follower/following counts
- Verified Ethereum addresses (multiple per account)
- Connected Twitter handle (if the user linked it)
- Profile picture

**Strengths:**

- Cryptographically verified: the wallet owner signed a message proving ownership
- Bidirectional: you can go from wallet to Farcaster AND from Farcaster to wallet
- Fresh data: verifications are recent (Farcaster’s growth is concentrated in 2024-2025)
- High-quality audience: heavily weighted toward active crypto builders
- Twitter handle often available as a connected account
- Rich metadata (follower counts, bio, activity)

**Weaknesses:**

- Limited to Farcaster users (~400,000 DAUs, growing)
- Biased toward crypto-native and builder audiences
- Users can unverify addresses (though this is rare)
- Requires Farcaster Hub access or a hub API for querying

**Typical match rate contribution:** 8-12% of crypto-active wallet lists. This is the single highest-contributing source for most resolution pipelines.

**Querying Farcaster verifications:**

Several hub APIs expose an addresses-to-users lookup and support batching hundreds of addresses per request, making them efficient for large-scale resolution.

### Lens Protocol profiles

**How it works:** Lens Protocol (originally on Polygon, migrating to Lens Chain) assigns profile NFTs to users. Each profile has an owner address and can include metadata like bio, social links, and content references.

**What it provides:**

- Lens handle (e.g., `@alice.lens`)
- Profile metadata and bio
- Owner wallet address
- Follower/following counts on Lens
- Linked social handles (when populated)

**Strengths:**

- Profile ownership is onchain and verifiable
- Profiles are composable NFTs with rich metadata
- Active developer ecosystem building on Lens data

**Weaknesses:**

- Smaller user base compared to Farcaster
- Polygon-native means additional cross-chain complexity
- Profile metadata is less consistently populated than Farcaster
- Migration to Lens Chain introduces data freshness concerns during transition
- Twitter/X handles are not always linked

**Typical match rate contribution:** 2-4% of wallet lists. Meaningful but secondary to Farcaster and ENS.

### Identity aggregators

**How it works:** an aggregator queries multiple identity sources (ENS, Farcaster, Lens, Unstoppable Domains, and others) through a single API and normalizes results into a consistent format.

**What it provides:**

- Unified identity profiles from multiple sources
- Social links aggregated across platforms
- ENS, Farcaster, Lens, and other identities in one response
- Avatar resolution
- Platform-specific metadata

**Strengths:**

- Single API call replaces multiple source queries
- Handles deduplication and normalization
- Covers sources that are impractical to query individually
- Includes lesser-known identity sources (Unstoppable Domains, .bit, etc.)
- Actively maintained and expanded

**Weaknesses:**

- Third-party dependency: you’re relying on their aggregation logic
- Rate limits apply (higher with API key)
- May lag behind primary sources for very recent verifications
- Response format may not include all metadata from each source

**Typical match rate contribution:** an aggregator’s contribution is the sum of its sources minus overlap. A well-configured pipeline pairing an aggregator with direct protocol-level Farcaster lookups typically yields 18-22% total match rates.

### Other sources

**Unstoppable Domains:** Similar concept to ENS but for alternative TLDs (.crypto, .nft, .wallet). Smaller user base, lower match rate contribution (~0.5-1%), but occasionally surfaces identities that ENS misses.

**DeBank / Zerion profiles:** Some users have set up profiles on portfolio tracking platforms. These occasionally link to social accounts. Not a primary source but can fill gaps.

**Onchain attestations (EAS):** Ethereum Attestation Service allows arbitrary attestations, including social identity claims. Still early in adoption but represents the future of composable identity.

## Source overlap and diminishing returns

The identity sources aren’t independent. A significant portion of users who have ENS text records also have Farcaster verifications. Understanding overlap is important for estimating total match rates.

```
Source A alone:        8%
Source B alone:        5%
A + B (no overlap):  13%
A + B (with overlap): 10%  (3% overlap)
```

In practice, the overlap between ENS and Farcaster is roughly 30-40% of the matched set. Users who invest in onchain identity tend to invest across multiple platforms.

The implication: adding a third source after ENS + Farcaster yields diminishing returns. Lens might add another 1-2% net new matches. Unstoppable Domains adds less than 1%. The first two sources capture the majority of resolvable wallets.

A typical resolution pipeline and its cumulative match rate:

| Sources used                | Cumulative match rate |
| --------------------------- | --------------------- |
| ENS only                    | 3-5%                  |
| ENS + Farcaster             | 14-18%                |
| ENS + Farcaster + Lens      | 16-20%                |
| All sources via aggregation | 20-22%                |

## Data quality considerations

Match rate is only useful if the matches are accurate. Each source has different quality characteristics:

**Verification strength:**

- Farcaster verified addresses: Cryptographic proof. Highest confidence.
- ENS ownership: Onchain proof of ENS ownership, but linked social handles are self-reported and unverified.
- Lens profile ownership: Onchain proof, but social links in metadata are unverified.

**Freshness:**

- Farcaster: Generally fresh. Users actively maintain profiles.
- ENS text records: Often stale. Users set records once and forget to update.
- Lens: Variable. Active users maintain profiles; inactive users don’t.

**False positive risk:**

- Highest with ENS text records (user changed Twitter handle, record still points to old one)
- Lowest with Farcaster verified addresses (cryptographic verification is current or revoked)
- Moderate with aggregation layers (stale data from any source propagates)

For critical use cases (airdrop targeting, governance outreach), consider weighting Farcaster-verified matches higher than ENS text record matches. The cryptographic verification provides stronger confidence that the social profile actually belongs to the wallet owner.

## Building a resolution pipeline

If you’re building your own resolution system, the recommended architecture is:

1. **First pass: protocol-level Farcaster batch lookup** (highest match rate, highest quality)
2. **Second pass: onchain ENS text records** for unresolved wallets (any RPC works)
3. **Third pass: an identity aggregator** for remaining unresolved wallets (catches Lens, UD, and other sources)
4. **Deduplication**: merge results where multiple sources resolve the same wallet
5. **Confidence scoring**: weight matches by source verification strength

Alternatively, use a service like [walletlink.social](https://walletlink.social) that solves the same problem at scale and returns matches already deduplicated, quality-scored and labelled with the class of evidence behind each one. The 22% match rate reflects the combined output of all major sources with deduplication and quality filtering applied.

## Where the stack is heading

The identity stack is expanding. Several trends will increase match rates over the next 12-18 months:

- **Farcaster’s continued growth** adds verified wallet-social links at scale
- **ENS v2** improvements may lower the barrier to setting text records
- **EAS and other attestation protocols** enable composable identity claims
- **Account abstraction (ERC-4337)** changes the relationship between wallets and users
- **Cross-chain identity** extending resolution beyond Ethereum to L2s and other chains

The technical foundation for wallet identity resolution is solid and maturing. The sources are growing. The tooling is improving. For teams building on this data, the question isn’t whether wallet identity will become reliable infrastructure; it’s how quickly you integrate it.

---

**Skip building the pipeline yourself.**

[walletlink.social](https://walletlink.social) aggregates ENS, Farcaster, Lens, and more into a single resolution service. Upload wallets, get social profiles, and let the identity stack work for you.
