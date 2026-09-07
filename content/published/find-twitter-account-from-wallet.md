---
title: 'How to find the X account behind an Ethereum wallet'
meta_description: 'Three ways to find the Twitter or X account behind an Ethereum address, what each one actually proves, and why most wallets still have no answer.'
published: true
publish_date: '2026-08-24'
---

# How to find the X account behind an Ethereum wallet

You have an address. `0x4a2b...c91f`. You want to know who it is, or at least where to reach them.

There are exactly three ways to get from an Ethereum address to an X (formerly Twitter) handle. They rely on completely different mechanisms, they prove different things, and for most addresses none of them has an answer at all.

This post covers all three, how to do it by hand for one wallet, and what happens when you try it on ten thousand.

## What an address alone tells you

Nothing. That is the important thing to understand first.

An Ethereum address is a hash of a public key. It carries no name, no email, no profile. Everything you can learn about who owns it comes from somewhere the owner chose to publish, or from somewhere a third party recorded a link.

That has a direct consequence: **you are never looking up an identity, you are looking for a claim somebody made.** The three methods below are three kinds of claim, and they are not equally strong.

## Method 1: ENS text records

If an address has an ENS name, that name can carry text records, including one conventionally used for a social handle:

```
Name:    alice.eth
Records:
  com.twitter: alice_crypto
  com.github:  alice-dev
  url:         https://alice.xyz
```

The owner of `alice.eth` wrote that record and paid gas to store it onchain. That makes it a genuine statement of intent: nobody sets a text record by accident.

What it does not do is prove anything about the X account. ENS does not check. If Alice writes `com.twitter: elonmusk`, the record saves without complaint. It is a claim published onchain, which is exactly how our API labels it: evidence class `onchain`.

Two further limits are worth knowing before you rely on it. Text records persist until somebody manually updates them, so they go stale quietly when a person changes handle or loses an account. And adoption is thin, because setting a record costs a transaction. Most people who buy an ENS name set the name and stop.

**Do this when:** you want the strongest signal of deliberate intent, and you can tolerate the record being out of date.

## Method 2: Farcaster verified addresses

Farcaster works differently, and this is the method that actually moves the numbers.

A Farcaster account can list verified addresses. To add one, the user signs a message with that address’s private key. The signature is recorded by the protocol. There is no trust involved: the mathematics proves that whoever added the address held the key.

```
FID:      12345
Username: alice
Verified addresses:
  0x4a2b...c91f   (signed)
  0x88de...02aa   (signed)
Connected X: alice_crypto
```

The X handle attached to a Farcaster profile is connected through an OAuth flow, which means X itself confirmed the account at the moment it was linked. So this path gives you two verified halves: the wallet proved by a signature, and the X account proved by OAuth.

That is why Farcaster is the largest single source in our index by a wide margin. The index holds 4.8 million wallet identities. Of those, 4.7 million Farcaster wallets came from the protocol itself, and 1.19 million wallets have a linked Twitter handle.

**Do this when:** you want the strongest proof available. This is the closest thing to certainty in wallet identity.

One caution, and it is the subject of the next post in this series: a connected X handle is a string that was correct on the day it was captured. Farcaster stores it and never rechecks it. A meaningful share of those handles no longer reach anybody.

## Method 3: attested links elsewhere

The first two methods cover the people who opted into ENS or Farcaster. A third group published the link somewhere else entirely.

These are the cases where a wallet and a social account were established together by an action, rather than by filling in a profile field:

- **Onchain attestations.** Signed statements published to a chain that name a wallet and a handle together. Evidence class `onchain`, same as an ENS record, because the statement lives on a chain.
- **Owner-attested platform profiles.** An account where the wallet is the login and the social handle was attached by signing in, so both halves were established by the owner rather than typed in by a stranger. Evidence class `attested-social`.
- **Actions that name both.** A token deployed by request from a social account, for instance, establishes both halves by the act itself.

The reason to care about this third group is coverage. When we added onchain attestations to the index, the overwhelming majority of what they held were wallets we had never seen before. They were not duplicates of the ENS and Farcaster population, they were a different population.

**Do this when:** the first two methods came back empty, which they will most of the time.

## Doing it by hand, for one wallet

Four minutes, no tooling:

1. **Reverse-resolve the address to an ENS name.** Any block explorer or ENS app will do this. If there is no name, skip to step 3.
2. **Read the text records on that name.** Look for `com.twitter`. Treat what you find as a lead, not an answer.
3. **Check Farcaster.** Search the address in any Farcaster client. If the address is verified against an account, you get the username, the follower count and the connected X handle.
4. **Confirm the handle still exists.** Open it. This step is not optional, and it is the one everybody skips.

Step 4 catches more than you would expect. A handle that resolved perfectly through two sources can still belong to a suspended account, or to a completely different person who claimed the name after the original owner abandoned it.

## Doing it for ten thousand

The manual process does not survive contact with a real holder list. Four minutes per wallet is 28 working days for ten thousand addresses, and by the time you finish, the first ones are stale.

What changes at scale is not the method. It is that you now care about the answer rate.

Here is the honest number. On a random sample of 600 holders drawn from 26,619 across 18 collections on two chains, measured on 2026-08-13:

| Measure                     | Rate           | What it means                                         |
| --------------------------- | -------------- | ----------------------------------------------------- |
| Any identity                | 23.7%          | ENS, Lens, GitHub, X or Farcaster: something resolves |
| 95% confidence interval     | 20.3% to 27.1% | The real figure for your list sits in here            |
| Reachable on X or Farcaster | ~13%           | A channel that will actually accept a message         |

Those two rates are not the same number and should never be quoted as one. **Roughly a quarter of a holder list resolves to some identity. Roughly an eighth can actually be messaged.** If you budget a campaign off the first figure, you have overstated your audience by about half.

The remaining three quarters are not a failure of method. They break down into groups that were never going to resolve:

- Exchange deposit addresses, which are not personal wallets at all
- Contract addresses: multisigs, smart wallets, open DeFi positions
- People who deliberately keep wallets and profiles apart, which is a legitimate choice
- Automated wallets with no human behind them
- People who simply never adopted ENS or Farcaster

No tool gets to 100%, and any vendor quoting a number near it is measuring something other than what you are buying. The useful question is not what share of your list resolves. It is whether the share that does is large enough, and current enough, to be worth acting on.

## Where to start

If you have one wallet, do it by hand. The four steps above take four minutes and cost nothing.

If you have a list, the thing to test first is not the tool. It is your own list: run a few hundred addresses and look at what comes back before you plan anything around the result. A list of exchange deposit addresses and a list of NFT holders return very different answer rates, and you want to know which one you have before you write the campaign.

---

**Try it on one wallet, then on all of them.**

[walletlink.social](https://walletlink.social) runs all three methods in one pass and labels every match with the evidence behind it, so you can see which claims are proved and which are merely published. You get 100 matches free in every rolling 30-day window, and wallets we cannot resolve cost nothing.
