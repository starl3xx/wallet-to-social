---
title: 'The future of wallet identity: what comes after 22%'
meta_description: "Wallet-to-social match rates run 16-46% depending on the chain. Here’s why that number is climbing and what new identity standards mean for the onchain ecosystem."
published: true
publish_date: '2026-05-04'
---

# The future of wallet identity: what comes after 22%

Right now, the best wallet-to-social resolution tools match about 22% of Ethereum addresses to a social identity. That is many times the low-single-digit rates typical tools publish, and it is a meaningful number, enough to build outreach strategies, segment communities, and run targeted campaigns.

But 22% also means 78% of wallets remain anonymous. That gap represents both a limitation and an opportunity. The interesting question is not where match rates are today, but where they are heading and what forces will push them higher.

## Why match rates are where they are

To understand the future, it helps to understand what drives the current 22%. Wallet identity resolution works by aggregating signals from multiple sources:

- **ENS names** with linked social records
- **Farcaster verified addresses** connected to social profiles
- **Onchain attestations** (EAS, Coinbase Verifications)
- **Public social posts** containing wallet addresses
- **Reverse lookups** through platforms that store wallet-social mappings

The 22% figure reflects the current state of these signals. Most crypto users have not explicitly linked their wallet to a social identity in a publicly resolvable way. The ones who have tend to be more active and engaged: early adopters, builders, governance participants.

## Five forces pushing match rates higher

### 1. Farcaster’s growth trajectory

Farcaster requires wallet verification at signup. Every new Farcaster user creates a publicly resolvable wallet-to-social link. As of early 2026, Farcaster has crossed 800K+ verified accounts, and growth has been accelerating since Frames and native actions drove a new wave of adoption.

This is the single biggest driver of improving match rates. Unlike Twitter, where connecting a wallet is optional and fragmented across different tools, Farcaster bakes wallet verification into the protocol. Every new user is automatically resolvable.

If Farcaster reaches 2-3 million users (plausible given current growth curves) match rates for active Ethereum addresses could climb past 35% on that signal alone.

### 2. ENS adoption and text records

ENS domain ownership has been steadily growing, but the more interesting trend is text record adoption. ENS allows users to attach arbitrary key-value data to their names, including Twitter handles, Farcaster IDs, email addresses, and URLs.

ENS Labs has been pushing to make text records easier to set and update. The introduction of ENS L2 names and reduced gas costs for record updates removes friction that previously kept adoption low. As more ENS holders populate their text records, the resolution surface area expands.

### 3. Attestation infrastructure maturing

Ethereum Attestation Service (EAS) and similar protocols are building the plumbing for verifiable identity claims. Coinbase’s onchain verifications, Gitcoin Passport stamps, and project-specific attestations all create new linkages between wallets and real-world identities.

These systems are still early. Most attestations today are about proving properties (country of residence, KYC status) rather than social identity. But the infrastructure is converging. When a wallet has a Coinbase verification, a Gitcoin Passport, and a Farcaster account, the identity graph becomes rich enough to resolve with high confidence.

### 4. Application-level wallet binding

More applications are asking users to connect wallets as a core part of their UX:

- Gaming platforms binding wallets to player profiles
- Social apps using wallet login as the default
- DeFi dashboards linking to notification preferences
- DAO tools connecting governance participation to communication channels

Each of these creates a potential resolution signal. As the application ecosystem matures, the number of wallet-to-identity touchpoints multiplies.

### 5. Privacy-preserving identity standards

This one is counterintuitive. Better privacy tools will actually _increase_ resolvable match rates, not decrease them.

Right now, many users avoid linking their wallet to social accounts because the link is all-or-nothing. Either your wallet is fully public and tied to your name, or it is fully anonymous. There is no middle ground.

Emerging standards around selective disclosure (proving you are a real person with a social account without revealing which account) create new possibilities. Users who would never publicly link their wallet might opt into a system where their identity is verifiable by authorized parties (like a project team) without being globally public.

Zero-knowledge proofs, soul-bound tokens with selective reveal, and privacy-preserving attestations are all active research areas that could unlock identity signals from currently unreachable wallets.

## What higher match rates enable

The jump from 22% to 40% or 50% is not just a quantitative improvement. It crosses qualitative thresholds:

**Community-wide outreach becomes viable.** At 22%, you reach your most active and visible holders. At 40%+, you reach a representative cross-section of your community. Governance participation data stops being biased toward the most public actors.

**Sybil detection gets sharper.** The more wallets you can resolve to identities, the easier it becomes to identify clusters that share one identity or no identity at all. Identity coverage and Sybil resistance scale together.

**Onchain reputation becomes meaningful.** When most active wallets have resolvable identities, onchain history starts functioning as a reputation system. Lending protocols, governance systems, and access-gated communities can make decisions based on verifiable identity-linked history.

## The timeline

Predicting exact numbers is a fool’s errand, but directional trends are clear:

| Timeframe  | Estimated match rate | Primary driver                                     |
| ---------- | -------------------- | -------------------------------------------------- |
| Today      | ~22%                 | ENS + Farcaster + public signals                   |
| 12 months  | ~30-35%              | Farcaster growth + ENS text records                |
| 24 months  | ~40-50%              | Attestation infrastructure + app-level binding     |
| 36+ months | ~50-65%              | Privacy-preserving identity + standard convergence |

These estimates assume continued ecosystem growth and no major regulatory disruptions that either force or prevent identity linking.

## What this means for builders

If you are building anything that depends on knowing who your onchain users are (and that includes nearly every token project, DAO, and NFT collection) the trajectory matters more than today’s snapshot.

The tools you adopt now should be built to incorporate new identity signals as they emerge. A resolution service that only checks ENS today will miss Farcaster signals. One that only checks Farcaster will miss attestation-based identities tomorrow.

The platforms that win in wallet identity will be the ones that aggregate aggressively across every available signal and adapt as new standards emerge. That is the approach [walletlink.social](https://walletlink.social) takes: multi-source resolution that improves as the underlying identity infrastructure matures.

## The bigger picture

The endgame is not 100% match rates. Some wallets will always be anonymous, and that is fine. The goal is reaching a threshold where wallet identity is reliable enough to build robust systems on top of it: governance, reputation, outreach, access control.

We are closer to that threshold than most people realize. The 22% of today is not a ceiling. It is a floor.

---

Start resolving your holders today and build your identity dataset as coverage grows. Try [walletlink.social](https://walletlink.social) free for your first 100 matches in every rolling 30-day window.
