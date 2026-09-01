---
title: 'Nothing indexes HyperEVM. So we asked the contract.'
meta_description: 'HyperEVM has no NFT holder API and no public explorer. We built an onchain enumerator instead, and found four ways the obvious version returns a wrong answer instead of an error.'
published: true
publish_date: '2026-09-01'
---

# Nothing indexes HyperEVM. So we asked the contract.

A collection called HYPE TERMINAL launched on HyperEVM on 28 August. Four days later it had 6,666 tokens and a few hundred holders, and somebody asked us the obvious question: who are these people?

We could not answer, and the reason was not the chain. It was that every holder-list source we use refuses it.

## Three refusals

We check three things before saying a chain is supported. On HyperEVM, all three said no, on the same afternoon:

- The NFT API that serves holder lists on our other seven chains answers, in as many words, that the endpoint “isn’t enabled for that chain or network just yet.”
- The metered index we use for token balances rejects the chain outright: `chain must be a valid enum value`, for both the chain’s name and its hexadecimal id.
- There is no public explorer instance to fall back on. Four candidate hostnames, four 404s.

What HyperEVM does have is plain JSON-RPC. Every node on the chain will answer questions about a contract. Nobody had packaged those answers into a holder list, so we wrote one.

## Reading owners off the contract

An ERC-721 knows who owns each token. Ask it 6,666 times and you have the holder list. Batch the questions twenty at a time and it takes about fifteen seconds.

That is the whole idea, and it is not the interesting part. The interesting part is that the obvious implementation of it is wrong in four different ways, and every one of them returns a **plausible wrong answer** rather than an error.

### 1. The first token that does not exist is not the end

The natural loop asks for token 0, then 1, then 2, and stops when one of them fails.

HYPE TERMINAL numbers its tokens from 1. Token 0 does not exist. That loop returns **zero holders and reports success**: not an error, not an empty-looking result anybody would question, just a confident claim that a collection with thousands of owners has none.

So the walk covers the whole id range and treats a missing token as a gap to step over, never as a stopping point. What proves the scan finished is not where it stopped but a count at the end: the number of owners found has to equal the supply the contract reports. If it does not, we throw rather than return.

### 2. Batched answers can come back in any order

Twenty questions in one request come back as twenty answers, and the protocol does not promise they arrive in the order asked.

Every answer is a valid wallet address. So a shuffled response produces a holder list of exactly the right length, full of real addresses, with the wrong person against each token. Nothing downstream can detect it. Nothing upstream will ever mention it.

Answers are matched by their request id, never by their position.

### 3. Some nodes answer questions about the past with the present

We wanted a snapshot pinned to one block, so the same query always returns the same list.

Two of the three public endpoints accept a historical block and answer with **current** state anyway, with no error and no warning. We caught it on a token that changed hands at block 44,675,209: asked about block 44,675,200, those endpoints returned the owner from nine blocks later.

A pinned snapshot against them is wrong and looks right. We do not pin.

### 4. The fastest host is not the safe batch size

One endpoint accepts a hundred questions per request. Two others reject anything past twenty.

Sizing to the fastest host means your fallback fails on its first request, which is precisely the moment a fallback exists for. Twenty is the only size all three accept, so twenty is the size.

## What it found

The first collection resolved completely: 6,666 tokens, every one accounted for, in one pass with no failed calls.

About a quarter of the holders turned out to be reachable, which is in line with what we see on established collections elsewhere. Nobody had to give us anything for that: the identities were already in the index, because a wallet on HyperEVM is the same address it is anywhere else. Chain support was never a resolution problem. It was an enumeration problem.

The day after we shipped it, our discovery job found a second HyperEVM collection on its own and resolved all of its holders without anybody asking. That is the part that matters more than the first one.

## The rule underneath all of this

A short holder list is worse than no holder list.

If you hand somebody 400 of 619 holders and do not say so, they will run a campaign against 400 people and believe they reached everyone. Our importer computes “was this truncated?” by comparing the number returned against the total the source reported, so a scan that quietly stopped early would report that it had everything.

Every path through the HyperEVM enumerator either returns a provably complete owner set or throws. There is no partial success. A collection too large to read is refused before a single call is spent, with copy that tells you to upload the list instead, because uploading works today and retrying will not.

That is not a feature anybody asks for. It is the difference between a number you can act on and a number that happens to be printed.

---

*HyperEVM is our eighth chain, NFT collections only, because nothing indexes token balances there yet. If you run a collection on it, the holder report is free to look at and you can run a sample of the holders without an account.*
