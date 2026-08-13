# SEO Strategy: walletlink.social

**Positioning:** The simple, affordable alternative to Addressable for crypto teams who just need wallet-to-social lookups. Backed by a 4.7M-wallet identity index with complete Farcaster protocol coverage (August 2026 milestone): the deterministic, owner-attested counter to Addressable's probabilistic "fingerprinting".

**August 2026 update:** The dataset grew from ~5k to 4.7M wallets with complete Farcaster coverage and full reverse lookup (any Farcaster handle → wallets). Two dead-competitor migration pages went live: `/vs/holder` (Holder sunset June 2024) and `/vs/airstack` (Airstack deprecated its API, pivoted to Senpi), and `/vs/blaze` was rewritten as a migration page (Blaze left web3; withblaze.app is dead).

**Twitter coverage, corrected 2026-08-13:** it is **over 1 million wallets**, not the ~41k this document previously stated. The sweep had been discarding the verified X handles Neynar returns alongside Farcaster profiles; recovering them took the figure from 43,704 to 1,070,442. Nearly all are owner-attested: most from an X account verified on Farcaster, the rest from on-chain ENS records.

The old guidance here said "never market Twitter coverage as millions". That is now wrong and should not be followed. The claim to protect was never the size, it was the **provenance**: every match is one the owner attested, versus a competitor's probabilistic fingerprinting. Market the attestation, and keep the two figures distinct, since 4.7M is Farcaster coverage and Twitter is its own number.

**Match rate, verified 2026-08-13:** 23.7% any-identity, 95% CI 20.3–27.1%, measured on a random sample of 600 holders drawn from 26,619 across 18 collections on two chains (`scripts/benchmark-pipeline-sample.ts`). The 22% used throughout the site sits inside that interval and is its conservative end. Keep "any identity" (~23%, counts ENS and Lens) distinct from **"reachable on X or Farcaster" (~13%)**: the first is a resolution rate, the second is what a campaign can actually message.

---

## 1. Target Keywords

### Primary Keywords (High Intent)
| Keyword | Search Intent | Difficulty | Priority |
|---------|--------------|------------|----------|
| `addressable alternative` | Competitor research | Medium | **HIGH** |
| `addressable competitor` | Competitor research | Medium | **HIGH** |
| `wallet to twitter lookup` | Solution seeking | Low | **HIGH** |
| `wallet to social lookup` | Solution seeking | Low | **HIGH** |
| `ethereum wallet twitter` | Solution seeking | Medium | **HIGH** |

### Secondary Keywords (Feature-focused)
| Keyword | Search Intent | Difficulty | Priority |
|---------|--------------|------------|----------|
| `find twitter from wallet address` | How-to | Low | Medium |
| `crypto wallet social profiles` | Research | Low | Medium |
| `farcaster wallet lookup` | Solution seeking | Low | Medium |
| `web3 wallet to twitter` | Solution seeking | Low | Medium |
| `ens to twitter` | Solution seeking | Low | Medium |
| `bulk wallet lookup` | Solution seeking | Low | Medium |
| `token holder outreach` | Use case | Medium | Medium |

### Use Case Keywords (High Value)
| Keyword | Search Intent | Difficulty | Priority |
|---------|--------------|------------|----------|
| `find nft holders twitter` | Solution seeking | Low | **HIGH** |
| `defi user outreach` | Use case | Low | **HIGH** |
| `nft community marketing` | Use case | Medium | **HIGH** |
| `airdrop targeting twitter` | Use case | Low | Medium |
| `dao member twitter` | Solution seeking | Low | Medium |
| `token holder marketing` | Use case | Medium | Medium |
| `find nft collectors social` | Solution seeking | Low | Medium |
| `defi protocol marketing` | Use case | Medium | Medium |

### Dead-Competitor Migration Keywords (High Intent, Low Competition)
| Keyword | Search Intent | Landing Page | Priority |
|---------|--------------|--------------|----------|
| `blaze alternative` | Migration | `/vs/blaze` | **HIGH** |
| `withblaze shut down` | What happened | `/vs/blaze` | **HIGH** |
| `holder.xyz alternative` | Migration | `/vs/holder` | **HIGH** |
| `airstack alternative` | Migration | `/vs/airstack` | **HIGH** |
| `airstack api deprecated` | What happened | `/vs/airstack` | **HIGH** |

### Dataset-Scale Keywords (Farcaster Moat)
| Keyword | Search Intent | Difficulty | Priority |
|---------|--------------|------------|----------|
| `farcaster wallet index` | Solution seeking | Low | **HIGH** |
| `reverse farcaster lookup` | Solution seeking | Low | **HIGH** |

### Long-tail Keywords (Blog/Content)
| Keyword | Content Type |
|---------|-------------|
| `how to find twitter accounts from ethereum wallets` | Tutorial |
| `find social profiles of token holders` | Guide |
| `crypto community outreach tools` | Listicle |
| `wallet address to social media 2024` | Guide |
| `alternative to addressable web3` | Comparison |

---

## 2. Homepage Meta Tags

### Title Tag (60 chars max)
```
Wallet to Twitter Lookup | Addressable Alternative | walletlink.social
```

### Meta Description (155 chars max)
```
Turn wallet addresses into Twitter & Farcaster profiles instantly. No sales calls, no subscriptions. One-time payment starting at $99. Upload CSV, get socials.
```

### Open Graph
```
title: "walletlink.social - Wallet to Social Lookup"
description: "Find Twitter & Farcaster profiles from Ethereum wallet addresses. The simple alternative to Addressable. No subscriptions, instant access."
```

---

## 3. Landing Page Copy

### Hero Section

**Headline:**
> Find who's behind the wallets

**Subhead:**
> Turn your CSV of Ethereum addresses into Twitter handles and Farcaster profiles. No sales calls. No subscriptions. Just results.

**CTA:** Upload your CSV

### Value Props (3 columns)

**1. Upload, Lookup, Export**
> Drop your wallet list, we find the socials. Export to CSV or Twitter List in seconds.

**2. One Price, Lifetime Access**
> $99 for 5,000 wallets/lookup (Pro), $249 for unlimited. Both include API access. No monthly fees. No enterprise contracts.

**3. All Major Sources**
> We check ENS, Web3.bio, and Farcaster to maximize your match rate.

### Social Proof Section

**Headline:** See what others found

Display RecentWins component showing:
- Wallet count processed
- Match rate (e.g., "22% - 9x industry avg")
- Twitter/Farcaster breakdown

### Comparison Section (fold 2)

**Headline:** Why teams switch from Addressable

| | walletlink.social | Addressable |
|---|---|---|
| **Focus** | Wallet → Social only | Full marketing suite |
| **Pricing** | $99 - $249 one-time | $1000s/month subscription |
| **Access** | Instant, self-serve | Sales calls required |
| **Setup** | Upload CSV, done | Onboarding process |
| **Contracts** | None | Enterprise agreements |

**CTA:** Start your first lookup free (500 wallets)

### How It Works Section

1. **Upload** - Drop your CSV with wallet addresses
2. **Process** - We check ENS, Web3.bio, Neynar for matches
3. **Export** - Download CSV or export to Twitter List

### FAQ Section (Schema markup opportunity)

**Q: What sources do you use?**
> We aggregate data from ENS text records, Web3.bio (which indexes multiple protocols), and Neynar for Farcaster. This gives you the highest match rate without needing to configure multiple APIs yourself.

**Q: How accurate are the results?**
> Our match rates average 15-25% depending on your wallet list, which is 6-10x higher than industry average (~2.5%). We only return verified connections - no guesses.

**Q: Why not use Addressable?**
> Addressable is a full web3 marketing platform - great if you need attribution, ads, and CRM. But if you just need wallet-to-social lookups, you're paying for features you won't use. We focus on one thing and do it well.

**Q: Can I try before buying?**
> Yes! Free tier includes 500 wallets - no credit card required.

---

## 4. Comparison Page: `/vs/addressable`

### URL Structure
`/vs/addressable` (folder-based for future competitors)

### Title Tag
```
walletlink.social vs Addressable: Which is Right for You? (2024)
```

### Meta Description
```
Detailed comparison of walletlink.social and Addressable. If you only need wallet-to-social lookups without the full marketing suite, see why teams choose us.
```

### Page Outline

1. **Intro** (50 words)
   - Both help crypto teams reach wallet holders
   - Different approaches for different needs

2. **Quick Summary Table**
   - Feature comparison grid
   - Pricing comparison
   - Best for X vs Best for Y

3. **What is Addressable?** (100 words)
   - Full web3 marketing platform
   - Wallet-to-social is one feature among many
   - Enterprise focus with sales process

4. **What is walletlink.social?** (100 words)
   - Single-purpose tool: wallet to social
   - Self-serve, instant access
   - One-time payment model

5. **Feature Comparison**
   - Wallet lookup: Both
   - Twitter export: Both
   - Farcaster: walletlink.social (Addressable unclear)
   - Ad attribution: Addressable only
   - CRM integration: Addressable only
   - API access: included with both walletlink.social paid tiers

6. **Pricing Comparison**
   - walletlink: $99 (5K/lookup) / $249 (unlimited) one-time, API access on both
   - Addressable: Custom pricing, typically $1K+/month
   - ROI calculation example

7. **When to Choose Each**
   - **Choose walletlink.social if:**
     - You just need wallet → social lookups
     - You want to start today (no sales call)
     - You have a specific project/campaign
     - Budget is a concern

   - **Choose Addressable if:**
     - You need full marketing attribution
     - You want CRM integration
     - You have ongoing enterprise needs
     - Budget isn't a constraint

8. **CTA Section**
   - "Try walletlink.social free - 500 wallets, no credit card"

---

## 5. Technical SEO Checklist

### Immediate Actions

- [x] Update meta title/description in layout.tsx
- [ ] Add structured data (Organization, Product, FAQ schemas)
- [ ] Create sitemap.ts
- [ ] Create robots.ts
- [ ] Add canonical URLs
- [ ] Optimize Core Web Vitals (already done with virtualization)

### Content to Create

- [x] `/vs/addressable` comparison page
- [x] `/vs/blaze` migration page (Blaze left web3 — rewritten August 2026)
- [x] `/vs/holder` migration page (Holder sunset June 2024)
- [x] `/vs/airstack` migration page (Airstack deprecated its API, pivoted to Senpi)
- [ ] Blog post: "How to Find Twitter Accounts from Ethereum Wallets"
- [ ] Blog post: "Token Holder Outreach: A Practical Guide"
- [ ] Blog post: 4.7M-wallet index milestone / complete Farcaster coverage (targets `farcaster wallet index`, `reverse farcaster lookup`)

### Link Building Opportunities

- Web3 tool directories (Alchemy Dapp Store, etc.)
- Crypto marketing communities
- Twitter/X threads about the tool
- Farcaster posts

---

## 6. Schema Markup

### Organization Schema (layout.tsx)
```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "walletlink.social",
  "applicationCategory": "WebApplication",
  "operatingSystem": "Web",
  "offers": {
    "@type": "Offer",
    "price": "99",
    "priceCurrency": "USD"
  },
  "description": "Turn wallet addresses into Twitter & Farcaster profiles"
}
```

### FAQ Schema (for FAQ section)
```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [...]
}
```

---

## 7. Content Calendar (Suggested)

| Week | Content | Target Keyword |
|------|---------|----------------|
| 1 | Update homepage copy | addressable alternative |
| 2 | Create /vs/addressable page | addressable alternative, addressable competitor |
| 3 | Blog: "Wallet to Twitter Guide" | find twitter from wallet address |
| 4 | Blog: "Token Holder Outreach" | token holder outreach |

---

## 8. Success Metrics

Track in Google Search Console:
- Impressions for "addressable alternative"
- Click-through rate on comparison queries
- Average position for primary keywords

Track in analytics:
- Organic traffic to homepage
- Organic traffic to /vs/addressable
- Conversion rate (upload → paid)
