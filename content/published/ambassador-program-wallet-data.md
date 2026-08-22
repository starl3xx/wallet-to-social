---
title: 'Building an ambassador program with wallet identity data'
meta_description: 'Use Priority Score (holdings x followers) to find your best potential ambassadors. A step-by-step guide to building a wallet-data-driven ambassador program.'
published: true
publish_date: '2026-04-06'
---

# Building an ambassador program with wallet identity data

Most ambassador programs in Web3 are built backwards. Projects post an application form, get hundreds of responses from people who want free tokens, and then spend months figuring out which “ambassadors” actually hold any of their token.

There’s a better approach: start with your holders and work outward. The people who already have skin in the game and social reach are your natural ambassadors. You just need to find them.

## Why traditional ambassador programs fail

The standard playbook looks like this:

1. Post an ambassador application on Discord
2. Receive 500 applications
3. Review applications manually (or don’t)
4. Select 50 ambassadors based on follower counts and vibes
5. Discover that 30 of them don’t hold your token
6. Discover that 15 of them applied to 20 other ambassador programs simultaneously
7. End up with 5 people who actually care

The fundamental problem is information asymmetry. You don’t know who your holders are, so you can’t invite the right people. Instead, you cast a wide net and hope.

The result is a program full of professional “ambassadors” who farm incentives across dozens of projects and add minimal genuine value. Your actual power users (the holders with real reach who talk about your project organically) never applied because they didn’t see the form or didn’t think of themselves as “ambassador material.”

## The priority score framework

Priority Score is a simple formula that surfaces holders with both meaningful token positions and social reach:

```
Priority Score = Holdings x log10(Followers + 1)
```

The logarithmic scaling on followers is intentional. It prevents follower count from dominating the score. A holder with 100,000 tokens and 1,000 followers scores similarly to a holder with 10,000 tokens and 100,000 followers. Both are valuable: one brings conviction, the other brings reach.

Here’s what the scoring looks like in practice for a hypothetical token:

| Wallet    | Holdings | Twitter followers | Farcaster followers | Priority score |
| --------- | -------- | ----------------- | ------------------- | -------------- |
| alice.eth | 250,000  | 45,000            | 12,000              | 1,164,250      |
| bob.eth   | 80,000   | 120,000           | 5,000               | 406,240        |
| carol.eth | 500,000  | 2,000             | 800                 | 1,652,500      |
| dave.eth  | 15,000   | 8,000             | 25,000              | 66,150         |
| eve.eth   | 180,000  | 500               | 200                 | 486,540        |

Carol scores highest despite having modest social reach because her holdings are substantial. Alice is a strong second with a balanced profile. Bob has massive reach but lower holdings. Dave has great Farcaster presence but smaller holdings.

Each of these people represents a different kind of ambassador value. The score helps you find all of them.

## Step-by-step: building the program

### Step 1: export your top holders

Pull your token holder list from Etherscan, Dune, or your own analytics. You want wallet addresses and token balances. For most projects, the top 2,000-5,000 holders are the relevant pool.

Format the data as a CSV with at minimum two columns: `wallet_address` and `holdings`.

### Step 2: resolve identities

Run the holder list through a wallet identity resolution service. At a 22% match rate, a list of 5,000 holders typically yields 1,000-1,100 identified profiles with Twitter handles, Farcaster usernames, follower counts, and ENS names.

Export the enriched data. You now have a spreadsheet with wallet addresses, holdings, social profiles, and follower counts.

### Step 3: calculate priority scores

In your spreadsheet or script, calculate the Priority Score for each resolved wallet. Sort descending. Your top 50-100 by Priority Score are your ambassador candidates.

A quick Python snippet if you prefer scripting:

```python
import math
import csv

def priority_score(holdings, followers):
    return holdings * math.log10(followers + 1)

with open('enriched_holders.csv') as f:
    reader = csv.DictReader(f)
    scored = []
    for row in reader:
        if row['twitter_handle'] or row['farcaster_handle']:
            followers = max(
                int(row.get('twitter_followers', 0)),
                int(row.get('farcaster_followers', 0))
            )
            score = priority_score(float(row['holdings']), followers)
            scored.append({**row, 'priority_score': score})

scored.sort(key=lambda x: x['priority_score'], reverse=True)
```

### Step 4: research your top candidates

Before reaching out, spend 5 minutes per candidate reviewing their social profiles:

- Do they post about crypto/Web3 regularly?
- Have they mentioned your project organically?
- What’s their content style? (Technical? Memes? Analysis?)
- Are they active on Farcaster, Twitter, or both?
- Do they engage with other projects in your ecosystem?

This research prevents embarrassing outreach to inactive accounts or people who have moved on from crypto entirely.

### Step 5: personal outreach

This is where most programs fail by going generic. Don’t send a template. Reference their specific holdings, their content, and why you think they’d be a good fit.

A strong outreach message includes:

- Acknowledgment that they’re a holder (you know this from the data)
- Something specific you noticed about their social activity
- A clear, low-commitment ask (not “be our ambassador”, more like “would you be interested in early access to X”)
- No immediate mention of compensation

The goal of first contact is a conversation, not a contract.

### Step 6: structure the program

For the holders who respond positively, structure tiers based on their natural strengths:

**Content Creators** (high followers, regular posting): Early access to announcements, exclusive content to share, attribution and amplification from your official accounts.

**Governance Champions** (high holdings, moderate reach): First look at proposals, direct line to the team for feedback, governance discussion facilitation.

**Community Connectors** (active across multiple platforms): Cross-platform moderation, event coordination, new member onboarding.

Compensation should match contribution, not just follower count. Token allocations, exclusive access, revenue sharing on referrals, or simply public recognition all work depending on your project’s stage and economics.

### Step 7: measure and iterate

Track these metrics monthly:

- Social mentions from ambassadors (volume and reach)
- Governance participation from ambassador networks
- Secondary referrals (new holders who came through ambassadors)
- Ambassador retention rate
- Content quality and engagement rates

The data-driven approach doesn’t stop at selection. Use the same wallet identity data to measure whether your ambassadors are actually moving the needle.

## The compound effect

Ambassador programs built on wallet identity data have a structural advantage: they’re selecting for people who already demonstrated commitment by holding your token. This isn’t a cold outreach program: it’s activating your existing community.

When your ambassadors are genuine holders with real social reach, their advocacy is authentic. Followers can tell the difference between someone who believes in a project and someone farming an ambassador reward. That authenticity compounds over time into organic growth that no paid campaign can replicate.

The data to build this exists in your holder list today. The question is whether you’ll use it.

---

**Find your natural ambassadors.**

[walletlink.social](https://walletlink.social) resolves wallet addresses to social profiles and calculates Priority Scores automatically. Upload your holder list, sort by score, and see who your most valuable community members actually are.
