/**
 * Whether a scraped "this wallet is an AI agent" claim survives contact with
 * what the address owner actually published.
 *
 * ## The problem this exists for
 *
 * `known_agents` is populated from Virtuals Protocol's own API, which gives a
 * `walletAddress` and a `sentientWalletAddress` per agent. For a large share of
 * agents that address is the **creator's personal wallet**, not an autonomous
 * one. So the row says "this wallet is an AI agent" about a human being.
 *
 * Measured on 2026-09-19 against production: of 13,622 agent wallets, 1,037
 * also appear in `social_graph` and 536 resolve to an X handle. Of those 536,
 * **492 carry an owner-attested identity that is not the agent's own**: the
 * agent record either names a different X account (102) or names none at all
 * (403). Only 31 agree.
 *
 * The clearest single case: `0x4b67…ccba` is recorded as agent `AGGENT`, whose
 * own X account is `@AGGENT_ai`. The wallet resolves, attested, to
 * `@avocato31`. Those are two different accounts, so the wallet belongs to the
 * person who made AGGENT rather than to AGGENT.
 *
 * ## Why attested wins
 *
 * This is the distinction the product is sold on, applied to itself. An
 * owner-attested identity is published BY the address owner: a Farcaster
 * verification, an onchain ENS or Basename record, an attested-social sign-in.
 * A `known_agents` row is one third-party API's say-so, carried in with no
 * proof that the address it names is the agent's rather than its author's.
 *
 * CLAUDE.md states the rule this is an instance of: what green must never mark
 * is "an inference presented as confirmation". A badge reading `HOWLR` beside a
 * wallet whose owner published `@thedojieth` does exactly that, and it does it
 * over the top of the strongest evidence the index holds.
 *
 * ## What it does NOT do
 *
 * It does not delete anything. `known_agents` keeps every row: it is an L0
 * fact with provenance, and the pipeline is the only thing allowed to write
 * there. This is an L1 judgment about what those facts MEAN on a row, applied
 * where the row is assembled, which is the layer that owns the question.
 *
 * Nor does it claim the wallet is not an agent. It declines to assert that it
 * is, which is the honest position when the only evidence for the claim is
 * contradicted by better evidence against it.
 *
 * ## It applies to CATALOG claims only
 *
 * The caller decides which claims to put through this, and only claims from
 * `known_agents` belong here. The defect is specific to that source: a third
 * party names an ADDRESS as an agent's and the address is often the creator's.
 *
 * A bio-keyword claim is a different shape of thing. It is made about the
 * Farcaster account attached to this wallet, which the owner verified, so an
 * attested Farcaster identity does not contradict it, it IS its evidence.
 * Passing one through here withdraws it every time, because the wallet has an
 * attestation and no catalog handle to match against, and it takes with it
 * exactly the agents whose own account is the presence worth keeping.
 */
import type { WalletSocialResult } from './types';
import { isTwitterVerified, isFarcasterVerified } from './social-graph';

/** The agent-shaped fields a row can carry. */
const AGENT_FIELDS = [
  'is_agent',
  'agent_name',
  'agent_framework',
  'agent_type',
  'agent_token_symbol',
  'agent_verified',
  /**
   * The detection source goes too, and it is easy to miss because it is the
   * one agent field that is not named `agent_*` in the graph's own vocabulary
   * and was NULL everywhere until recently. A withdrawn row that still carries
   * `known_list` is a leftover catalog claim about an address the product has
   * just declined to call an agent, stored in `wallet_cache` and
   * `social_graph` where the next reader finds it.
   */
  'agent_detection_source',
] as const;

/**
 * Does this row carry an identity its owner published?
 *
 * `=== true` on purpose, for the reason the flags' own doc comment gives:
 * `undefined` means "not known on this path", not "false". A row that never
 * touched the social graph must not be read as unattested, or the rule would
 * strip an agent claim on the strength of evidence nobody ever looked for.
 */
export function hasAttestedIdentity(row: {
  twitter_verified?: boolean;
  farcaster_verified?: boolean;
  source?: string[];
}): boolean {
  if (row.twitter_verified === true || row.farcaster_verified === true) {
    return true;
  }
  /**
   * The row's sources, read through the graph's own definition.
   *
   * The flags are not set by every path that produces an attestation. A live
   * ENS resolve writes `twitter_handle` with source `ens` and no flag; the
   * fresh Neynar path had the same gap until it was fixed by hand. So a first
   * lookup whose only attestation had just arrived read as unattested here,
   * the catalog badge survived, and `prepareUpsertData` then computed
   * `twitterVerified` from that very source and ORed `is_agent` into a graph
   * that cannot take one back.
   *
   * `isTwitterVerified` is the function the graph write already uses, so this
   * asks the same question the same way rather than keeping a second list of
   * attested sources that would drift. Patching each live path instead would
   * have fixed ENS and waited for the next source to be added.
   */
  const sources = row.source ?? [];
  if (sources.length === 0) return false;
  return isTwitterVerified(sources) || isFarcasterVerified(sources);
}

/**
 * Whether the agent's own social account is the one on this row.
 *
 * Lowercased and `@`-stripped on both sides, because the two came from
 * different suppliers and neither agrees with the other about casing or the
 * leading sigil.
 */
function sameAccount(
  a: string | null | undefined,
  b: string | null | undefined
) {
  if (!a || !b) return false;
  const norm = (h: string) => h.toLowerCase().replace(/^@/, '').trim();
  return norm(a) === norm(b);
}

/**
 * Whether the agent claim should be asserted on this row.
 *
 * `agentHandle` is the X handle `known_agents` holds for the agent ITSELF,
 * which is the only thing that can tell "this agent has a social presence and
 * this is it" from "this is the human who deployed it".
 */
export function agentClaimHolds(
  row: {
    twitter_verified?: boolean;
    farcaster_verified?: boolean;
    twitter_handle?: string;
    farcaster?: string;
    source?: string[];
  },
  agentHandle: string | null | undefined
): boolean {
  // Nothing published by the owner to contradict it: the claim is the only
  // evidence there is, and it stands.
  if (!hasAttestedIdentity(row)) return true;

  // The owner published the agent's own account. Consistent, and the case the
  // rule must not break: an agent with a verified Farcaster or X presence is a
  // real thing, and 31 of them are in the index today.
  if (sameAccount(agentHandle, row.twitter_handle)) return true;
  if (sameAccount(agentHandle, row.farcaster)) return true;

  // An attested identity that is not the agent's. The wallet is a person's.
  return false;
}

/**
 * Strip the agent claim from a row, in place, leaving everything else.
 *
 * Deleted rather than set false, on the same absent-is-not-false rule the rest
 * of this row follows: `is_agent: false` is a claim that we checked and it is
 * not an agent, and that is not what happened. What happened is that we
 * decline to say.
 */
export function clearAgentClaim(row: WalletSocialResult): void {
  for (const field of AGENT_FIELDS) {
    delete (row as Record<string, unknown>)[field];
  }
}

/**
 * Apply the rule to one row. Returns true when the claim was withdrawn.
 */
export function reconcileAgentClaim(
  row: WalletSocialResult,
  agentHandle: string | null | undefined
): boolean {
  if (!row.is_agent) return false;
  if (agentClaimHolds(row, agentHandle)) return false;
  clearAgentClaim(row);
  return true;
}
