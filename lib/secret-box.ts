/**
 * Symmetric encryption for a secret this system has to be able to read back.
 *
 * ## Why this exists at all, when nothing else here needed it
 *
 * Every other credential in this repository is a SHA-256 digest of something
 * handed out once: API keys (`lib/api-keys.ts`), sessions and magic links
 * (`lib/auth.ts`), the x402 redemption token, and our own OAuth access and
 * refresh tokens (`lib/oauth/grants.ts`). That works because in every one of
 * those cases the caller presents the secret and we only have to recognise it.
 * A digest cannot be turned back into the thing, which is the point, and it is
 * why a leak of those tables leaks nothing usable.
 *
 * An outbound OAuth token is the first credential here that breaks the shape.
 * We are the client: to act on somebody's behalf we have to send their actual
 * access token to the provider, and to keep acting we have to send their actual
 * refresh token. Recognising it is not enough, so hashing is not available, and
 * the honest description of what we now hold is a recoverable secret belonging
 * to somebody else.
 *
 * That is a real reduction in the safety of this database and it should be
 * stated rather than absorbed. The mitigation is that the key lives in the
 * environment and the ciphertext lives in Postgres, so a dump of the database
 * alone, which is the realistic exposure, yields nothing. It is not a
 * mitigation against anything that can read the environment.
 *
 * ## The construction
 *
 * AES-256-GCM. Authenticated, so a tampered ciphertext fails to open rather
 * than opening into a different string: an attacker with write access to the
 * column must not be able to flip our stored token into one they control.
 * A fresh 12-byte IV per encryption, which GCM requires be unique per key, and
 * `randomBytes` rather than a counter because there is no coordination point
 * between serverless invocations that could keep a counter.
 *
 * The stored form is `v1.<iv>.<tag>.<ciphertext>`, all base64url. The version
 * prefix is not decoration: it is the thing that makes a key rotation or an
 * algorithm change possible later without guessing at what an old column
 * contains, and `open` refuses a version it does not know rather than trying to
 * parse it as the current one.
 *
 * ## The key
 *
 * `SECRET_BOX_KEY`, its own variable rather than a reuse of
 * `EMAIL_UNSUBSCRIBE_SECRET` or `X402_RECOVERY_SECRET`, on the reasoning
 * `.env.example` already gives for those two being separate: rotating a secret
 * should invalidate exactly one thing. Rotating this one is the response to a
 * suspected leak of the database, and it must not also log every subscriber out
 * of their unsubscribe links.
 *
 * 32 bytes, supplied base64 or hex. It is NOT stretched from a passphrase:
 * `scrypt` on every call would be a per-request cost for no gain, and a
 * low-entropy passphrase stretched is still a low-entropy passphrase against an
 * offline attacker holding the ciphertext. `npm run gen:secret-box-key` prints
 * a real one; `isConfigured()` is false when it is absent or the wrong length,
 * and every caller degrades rather than throwing, the way `lib/x-resolver.ts`
 * does.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** The only format `open` accepts today. See the module comment. */
const VERSION = 'v1';

/**
 * The key, or null when it is absent or unusable.
 *
 * Read on every call rather than captured at module load. A module-level
 * constant is evaluated once per serverless instance, which means an instance
 * that started before the variable was set holds the wrong answer until it is
 * recycled, and the symptom is a subset of requests failing for no visible
 * reason.
 *
 * Length is checked here rather than left to `createCipheriv`, which throws
 * `Invalid key length` from inside the crypto layer at the moment of use. A
 * misconfigured key should be a refusal at the edge, not an exception in the
 * middle of a token refresh.
 */
function key(): Buffer | null {
  const raw = process.env.SECRET_BOX_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  // base64 and base64url both decode with the same decoder; hex is accepted
  // because it is what a person pasting from `openssl rand -hex 32` will have.
  const buf = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');
  return buf.length === KEY_BYTES ? buf : null;
}

/** False when the key is missing or the wrong size. Callers degrade on this. */
export function isConfigured(): boolean {
  return key() !== null;
}

/**
 * Encrypt a secret for storage.
 *
 * Returns null when unconfigured, so a caller cannot accidentally store a
 * plaintext token by treating a thrown error as "encryption is off". The
 * refusal has to be something the type system makes them handle, which is why
 * this returns `string | null` rather than throwing.
 */
export function seal(plaintext: string): string | null {
  const k = key();
  if (!k) return null;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, k, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    enc.toString('base64url'),
  ].join('.');
}

/**
 * Decrypt a stored secret, or null if it cannot be opened.
 *
 * Every failure returns null and none of them say which failure it was. The
 * distinction between "wrong key", "tampered ciphertext" and "malformed" is
 * useful to an operator and equally useful to an attacker probing the column,
 * and the operator has the logs. GCM's own authentication does the real work:
 * `decipher.final()` throws when the tag does not verify, which is the case
 * that matters, and it is caught here rather than propagated so a single bad
 * row cannot take down a batch.
 */
export function open(sealed: string | null | undefined): string | null {
  const k = key();
  if (!k || !sealed) return null;

  const parts = sealed.split('.');
  if (parts.length !== 4) return null;

  const [version, ivPart, tagPart, dataPart] = parts;
  // An unknown version is refused, never parsed as the current one. A future
  // v2 with a different IV length would otherwise be fed to a v1 decipher and
  // fail as a corrupt tag, which reads as tampering rather than as a rollback.
  if (version !== VERSION) return null;

  try {
    const iv = Buffer.from(ivPart, 'base64url');
    const tag = Buffer.from(tagPart, 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;

    const decipher = createDecipheriv(ALGORITHM, k, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]);
    return out.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Whether a stored value is in the sealed format.
 *
 * For asserting that a column holds ciphertext without holding the key, which
 * is what a migration check and an invariant need: both run where the key may
 * not be, and neither should have to decrypt to answer "is this plaintext".
 */
export function looksSealed(value: string | null | undefined): boolean {
  if (!value) return false;
  const parts = value.split('.');
  return (
    parts.length === 4 &&
    parts[0] === VERSION &&
    Buffer.from(parts[1], 'base64url').length === IV_BYTES &&
    Buffer.from(parts[2], 'base64url').length === TAG_BYTES
  );
}

/**
 * Constant-time equality for two secrets, for the rare comparison that is not
 * a database lookup.
 *
 * Here rather than in each caller because the length guard in front of
 * `timingSafeEqual` is the part people leave out: it throws on a length
 * mismatch, so the naive wrapper turns a comparison into a crash for exactly
 * the input an attacker controls.
 */
export function secretEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
