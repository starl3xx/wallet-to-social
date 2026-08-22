---
title: 'How Farcaster verified addresses changed wallet identity'
meta_description: "Technical explanation of how Farcaster's cryptographic wallet verification delivers 3x better match rates than ENS text records alone."
published: true
publish_date: '2026-03-19'
---

# How Farcaster verified addresses changed wallet identity

Before Farcaster, wallet identity resolution was an ENS problem. You’d look up an address, check if it had an ENS name, query the text records for a Twitter handle, and hope the data wasn’t stale.

The match rates were terrible. ENS text records cover a small fraction of active wallets, many records are outdated, and there’s no cryptographic proof that the claimed social account actually belongs to the wallet owner.

Farcaster changed the equation. Not because it’s a bigger platform, but because its identity architecture is fundamentally different. Adding Farcaster as a resolution source delivered a **3x improvement** in match rates for our pipeline.

This post explains the technical reasons why.

## The ENS text record model

ENS allows any name owner to set arbitrary text records. The convention for social identity uses keys like `com.twitter` and `com.github`:

```
ENS Name: alice.eth
Records:
  com.twitter: @alice_crypto
  com.github: alice-dev
  url: https://alice.xyz
```

Anyone who controls `alice.eth` can set these records to anything. There’s no verification. If Alice sets `com.twitter: @elonmusk`, the record saves without complaint.

This creates three problems for identity resolution:

**1. No proof of ownership.** The text record is a claim, not a proof. You’re trusting that `alice.eth` actually controls `@alice_crypto`. For identity resolution at scale, unverifiable claims are noisy data.

**2. Stale records.** People change Twitter handles, deactivate accounts, or lose access. ENS records persist until manually updated. We’ve found that roughly 15-20% of ENS Twitter records point to accounts that are suspended, deactivated, or have changed handles.

**3. Low adoption.** Setting ENS text records requires a transaction and gas fee. Most ENS holders set their primary name and stop there. Across all ENS names with at least one transaction in the past year, only about 8% have any social text records set.

Despite these limitations, ENS text records were the best available data source for years. The industry’s 2.5% average match rate is largely built on ENS-only resolution.

## The Farcaster identity architecture

Farcaster uses a two-key system for identity:

**Custody address.** The Ethereum address that registered the Farcaster account (FID). This address controls the account: it can transfer ownership, add signers, and manage recovery. Each FID has exactly one custody address.

**Verified addresses.** Additional Ethereum addresses that the user has cryptographically proven they control. The verification process requires signing a message with the claimed address, and the signature is stored onchain (on Optimism, where Farcaster’s contracts live).

```
FID: 12345
Custody address: 0xabc...
Verified addresses:
  - 0xdef... (signed verification message)
  - 0x123... (signed verification message)
Username: alice
Display name: Alice
Connected Twitter: @alice_crypto (via Warpcast OAuth)
```

The critical difference: **verified addresses are cryptographic proofs, not claims.** When wallet `0xdef...` is listed as a verified address for FID 12345, it means someone with the private key for `0xdef...` signed a specific message. You don’t have to trust anyone; the math proves it.

## Why this matters for match rates

The architectural difference translates directly into resolution quality:

### More wallets covered

As of early 2026, there are approximately 800,000+ Farcaster accounts with at least one verified address. Many users verify multiple wallets: their main wallet, a hardware wallet, a hot wallet used for trading. The average Farcaster user has 1.8 verified addresses.

This means roughly 1.4 million wallet addresses are linked to Farcaster identities with cryptographic proof. That’s a larger identity dataset than actively-maintained ENS social records by an order of magnitude.

### Higher accuracy

Because verification requires a signature, there are zero false positives in the wallet-to-FID mapping. If a wallet is listed as verified for a Farcaster account, the wallet owner did verify it. Compare this to ENS text records where 15-20% of social claims are stale or inaccurate.

### Richer social data

A Farcaster profile gives you more than a username. Reading the protocol, you get:

- Display name and bio
- Follower count on Farcaster
- Connected Twitter handle (via Warpcast’s OAuth flow, another verification layer)
- Posting history and engagement metrics
- Channel memberships

The connected Twitter handle is particularly valuable. When a user connects Twitter through Warpcast’s OAuth flow, that connection is verified by Twitter’s OAuth protocol, stronger than any ENS text record.

## The resolution pipeline

Here’s how a multi-source resolution pipeline works in practice:

```
Input: 0xdef...

Step 1: Check ENS reverse resolution
  -> alice.eth
  -> Query text records: com.twitter = @alice_crypto

Step 2: Check Farcaster verified addresses
  -> FID 12345
  -> Username: alice
  -> Verified Twitter: @alice_crypto
  -> Followers: 8,400

Step 3: Check identity index aggregation
  -> Confirms both ENS and Farcaster data
  -> Adds Lens profile: alice.lens

Step 4: Merge and deduplicate
  -> Twitter: @alice_crypto (confirmed by 2 sources)
  -> Farcaster: alice (FID 12345)
  -> Followers: 8,400 (Farcaster)
```

When multiple sources agree, confidence is high. When they disagree (ENS says one Twitter handle, Farcaster says another), the cryptographic source (Farcaster) takes precedence.

## The 3x improvement

We measured the match rate impact of adding Farcaster as a resolution source across 500,000 wallets:

| Resolution source      | Match rate | Unique matches |
| ---------------------- | ---------- | -------------- |
| ENS only               | 7.1%       | 35,500         |
| ENS + Farcaster        | 22.0%      | 110,000        |
| Farcaster contribution | +14.9%     | +74,500        |

Farcaster contributed 3x more unique matches than ENS alone. And crucially, these are higher-confidence matches: every one backed by a cryptographic verification.

The overlap between ENS and Farcaster matches is relatively small (about 22% of ENS-matched wallets also have Farcaster profiles). This means the two sources are largely complementary rather than redundant.

## What Farcaster gets right

From an identity resolution perspective, Farcaster’s design choices solve real problems:

**Verification is built-in, not bolted on.** Users verify wallets as a natural part of account setup, not as an extra step they have to seek out and pay gas for.

**Multiple addresses per identity.** People use multiple wallets. Farcaster’s model acknowledges this and lets users prove ownership of all of them under one identity.

**Social data is accessible.** The Farcaster protocol is open, and APIs like Neynar provide rich social data alongside identity information. You get the connection AND the context.

**No gas cost for users.** Farcaster runs on Optimism with minimal transaction costs. Users don’t face a $5-20 gas fee to verify a wallet, unlike setting ENS text records on mainnet.

## The remaining gap

Even with Farcaster, we’re at 22% match rates, not 100%. The 78% of unresolved wallets fall into several categories:

- **Exchange deposit addresses**: not personal wallets at all
- **Contract addresses**: multisigs, smart wallets, DeFi positions
- **Crypto-native users who avoid social identity**: privacy-focused participants who deliberately don’t link wallets to profiles
- **AI agents and bots**: automated wallets with no human identity
- **New or casual users**: people who haven’t adopted Farcaster or ENS

As Farcaster adoption grows (active users have increased roughly 10x since early 2024), the coverage will expand. But some wallets will always be unresolvable, and that’s fine. The goal isn’t 100% coverage; it’s reaching enough holders to make outreach effective.

## Building on cryptographic identity

The shift from claim-based identity (ENS text records) to proof-based identity (Farcaster verified addresses) is the most important technical development in wallet identity resolution.

It’s the reason walletlink.social achieves 22% match rates where ENS-only approaches top out around 7%. And it’s the foundation for even higher match rates as Farcaster continues to grow.

---

**See the Farcaster difference on your own data.**

[walletlink.social](https://walletlink.social) combines onchain ENS records, protocol-level Farcaster verifications and correlated identity data into a single resolution pipeline, and labels every match with the evidence behind it. Upload your wallet list and see how many holders you can identify.
