/**
 * What a person agreed to when they claimed, frozen.
 *
 * A consent record that cannot say WHICH WORDS were on the page is not a
 * consent record. Storing a boolean, or a date, or a version number pointing
 * at text that has since been edited, all answer "did they agree" and none
 * answers "to what", which is the only question that matters later.
 *
 * So the text lives here as a frozen array, every version kept forever, and a
 * row stores the version plus the sha256 of the exact string. The hash is
 * belt and braces against the one failure this design still has: somebody
 * editing a historical entry in place rather than adding a new one. A stored
 * hash that no longer matches its version's text is loud, where an edited
 * string is silent.
 *
 * ## Why it is not in the database
 *
 * Because it is not data, it is the product. A row of text somebody can
 * UPDATE is a row somebody can UPDATE, and the whole point is that these
 * strings never change after anyone has agreed to one. In source they are
 * reviewed, diffed and version-controlled by default, and an edit to a
 * historical entry shows up in a pull request rather than nowhere.
 */
import { createHash } from 'crypto';

export interface ConsentVersion {
  id: string;
  text: string;
}

/**
 * Every version, oldest first. NEVER edit an entry that has shipped: add a
 * new one and let the old rows keep pointing at what they actually agreed to.
 */
export const CONSENT_VERSIONS: readonly ConsentVersion[] = [
  {
    id: '2026-09-20.1',
    text: [
      'You are confirming that you control this wallet address and this X account.',
      '',
      'What we do with it: we record the pair in our index, which is a commercial product. The record says that the owner of this address published this account, and customers can see it.',
      '',
      'What it replaces: if we already hold a different account for this address, yours takes its place, because you are the owner and we were working from something weaker.',
      '',
      'What we keep: the address, the account name and its numeric id, the signature you just made, and the fact that you agreed to this text.',
      '',
      'What we do not keep: any access to your X account. We read your account name once and discard the token in the same request. Nothing here can post, follow, or read your messages.',
      '',
      'Undoing it: you can withdraw at any time from the same page, with the same wallet. Withdrawing removes the pair from the index and stops us collecting it again.',
    ].join('\n'),
  },
  /**
   * Added rather than edited, which is the whole mechanism working.
   *
   * Version 1 said "yours takes its place" about an address we already hold a
   * different account for. That was never what the code did and, after
   * review, is not what it should do: overwriting on a signature alone makes
   * a stolen key enough to rewrite an identity. The claim records a
   * disagreement instead, and settles when the handle we serve stops
   * reaching anyone.
   *
   * Version 1 stays exactly as it was. Nobody has consented to it in
   * production, and it is kept anyway, because the rule that makes a stored
   * hash mean anything is that it holds whether or not a given version was
   * ever used.
   */
  {
    id: '2026-09-20.2',
    text: [
      'You are confirming that you control this wallet address and this X account.',
      '',
      'What we do with it: we record the pair in our index, which is a commercial product. The record says that the owner of this address published this account, and customers can see it.',
      '',
      'Where we hold nothing for this address, your claim fills it. Where we already hold the same account, your claim confirms it and adds the account id, which is the part that survives a rename.',
      '',
      'Where we hold a different account, we record that you disagree and keep serving what we have until the handle we hold stops reaching anyone. A signature proves control of a key, and keys are lost and sold, so we do not let one rewrite an identity outright.',
      '',
      'What we keep: the address, the account name and its numeric id, the signature you just made, and the fact that you agreed to this text.',
      '',
      'What we do not keep: any access to your X account. We read your account name once and discard the token in the same request. Nothing here can post, follow, or read your messages.',
      '',
      'Undoing it: you can withdraw at any time from the same page, with the same wallet. Withdrawing removes the pair from the index and stops us collecting it again.',
    ].join('\n'),
  },
] as const;

/** The version a new claim is recorded against. */
export const CURRENT_CONSENT = CONSENT_VERSIONS[CONSENT_VERSIONS.length - 1];

export function consentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * The stored hash for a version id, or null when the id is unknown.
 *
 * Used to prove a historical entry has not been edited in place. An unknown
 * id is null rather than a throw, because the caller is usually rendering a
 * record rather than validating one, and a record pointing at a version this
 * build does not carry is a fact to show, not a crash.
 */
export function hashForVersion(id: string): string | null {
  const found = CONSENT_VERSIONS.find((v) => v.id === id);
  return found ? consentHash(found.text) : null;
}
