# wallet-to-social Now Supports Farcaster: 3x More Wallet Matches

You have 10,000 wallet addresses. Now what?

This is the question every token project, DAO, and NFT collection faces. You know who holds your token—the blockchain tells you that. But 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D doesn't have a DM inbox.

You can't email a wallet address. You can't tag them on Twitter. You can't invite them to your Discord.

The wallet identity problem has plagued Web3 since day one. And until now, the solutions have been fragmented at best.

**Today, we're announcing Farcaster integration for wallet-to-social—and it changes everything.**

## Why Farcaster Changes the Game

Farcaster isn't just another social network. It's the first major platform where verified wallet addresses are a core feature, not an afterthought.

When someone connects their wallet to Farcaster, that verification is public and cryptographically provable. No ENS text record that might be outdated. No self-reported Twitter handle that could be wrong. A verified, on-chain connection between identity and wallet.

The numbers tell the story:

- **Farcaster DAU grew 10x in 2024** — from 50K to over 400K daily active users
- **80% of active crypto builders are now on Farcaster** — your most engaged holders are there
- **Verified addresses mean reliable matching** — no more guessing if that Twitter handle is real

This isn't a niche platform anymore. Farcaster is where Web3 lives.

## What This Means for wallet-to-social Users

We've integrated the Neynar API to bring Farcaster data into every wallet lookup. Here's what you get:

### 1. Farcaster Profiles Included in Results

Every wallet lookup now checks Farcaster's verified address database. If a wallet has a connected Farcaster account, you'll see it alongside ENS, Twitter, and other social profiles.

### 2. Follower Counts for Prioritization

Not all matches are equal. A holder with 50,000 Farcaster followers is a potential brand ambassador. A holder with 50 followers might be a quiet supporter. Now you can see the difference.

We include Farcaster follower counts in results, and our Priority Score formula factors them in:

```
Priority Score = Holdings × log₁₀(Followers + 1)
```

This surfaces your whales with reach—the holders who can actually amplify your message.

### 3. Verified Twitter Handles

Here's something most people don't realize: Farcaster users often verify their Twitter accounts on the platform. These verified handles are more reliable than self-reported ENS text records.

When we find a Farcaster profile, we also pull their verified Twitter handle. It's another layer of accuracy in your holder data.

### 4. 3x More Matches

The bottom line: adding Farcaster as a data source increases match rates by approximately 3x compared to ENS alone.

Our benchmarks show:
- **ENS-only lookups**: ~8% match rate
- **With Farcaster added**: ~22% match rate
- **That's 9x better than the industry average of 2.5%**

More matches means more holders you can actually reach.

## How It Works

Nothing changes in your workflow. Upload your CSV of wallet addresses, and we handle the rest.

Behind the scenes, we now query:

1. **Web3.bio** — aggregates ENS, Lens, and other identity sources
2. **Neynar API** — Farcaster profiles and verified addresses
3. **On-chain ENS records** — direct text record lookups for Twitter, email, etc.

Results are cached for 24 hours, so repeat lookups are instant.

## Real Results: A DAO Case Study

One DAO we worked with had 8,000 governance token holders but only 5% participation in votes. They knew they had engaged holders—the on-chain activity proved it—but they couldn't reach them.

Using wallet-to-social with Farcaster integration, they identified 1,800 holders with social profiles (22% match rate). Of those, 200 had significant social reach.

They reached out directly via Twitter and Farcaster. The results:

- **40% response rate** on direct outreach (vs. 2% on broadcast)
- **Governance participation jumped from 5% to 22%**
- **Created an ambassador program** from their top 50 matches

The difference between knowing your holders and reaching your holders is everything.

## How This Compares

You might be wondering how wallet-to-social stacks up against other tools in the space.

**vs. Addressable**: Addressable is a full CRM suite—powerful but complex. If you just need to know who your holders are and how to reach them, that's overkill. wallet-to-social does one thing well: wallet-to-social resolution, instantly.

**vs. Blaze**: Blaze bundles wallet enrichment with campaign tools, community features, and more. Great if you need all that. But if you want focused, pay-as-you-go wallet lookups without a monthly commitment, we're simpler.

**vs. Holder.xyz**: Holder focuses on analytics—understanding your holder composition. We focus on action—giving you the social profiles to actually reach them. Different problems, complementary solutions.

## Getting Started

Farcaster integration is live now for all wallet-to-social users. No setup required.

1. Go to wallet-to-social
2. Upload your CSV of wallet addresses
3. Get back social profiles—now including Farcaster

Processing 10,000 wallets takes under 2 minutes. Results are cached for 24 hours.

## The Bigger Picture

Farcaster integration is a milestone, but it's part of a larger thesis: **wallets are becoming social profiles**.

Every on-chain action is public. Every token you hold, every NFT you collect, every governance vote you cast. The data is there. What's been missing is the identity layer that connects wallets to people.

Farcaster is building that layer. ENS is building that layer. And wallet-to-social is the tool that aggregates it all.

The wallet identity problem isn't solved yet. But with Farcaster's growth and the broader shift toward on-chain identity, we're getting closer every day.

---

**Ready to find your holders?**

Upload your wallet list and see who you can reach. With Farcaster integration, you'll match more holders than ever before.

[Try wallet-to-social →]
