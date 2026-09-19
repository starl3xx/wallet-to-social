/**
 * Print a key for `SECRET_BOX_KEY`.
 *
 * Usage: npm run gen:secret-box-key
 *
 * A script rather than a line in a README, for the reason every "generate a
 * secret" instruction eventually needs one: the alternative is somebody typing
 * a memorable string into the variable, and a 32-byte value that happens to be
 * 32 ASCII characters is accepted by `lib/secret-box.ts` and is not a key. The
 * length check cannot tell a passphrase from entropy, so the generator is the
 * thing that has to make entropy the easy path.
 *
 * It prints and does nothing else: it does not write `.env.local`, because the
 * same key has to be set in Vercel as well, and a script that silently put it
 * in one of the two places would be the reason production could not open what
 * development sealed.
 */
import { randomBytes } from 'crypto';

const key = randomBytes(32);

console.log('');
console.log('A new SECRET_BOX_KEY. Set the SAME value in .env.local and in');
console.log('Vercel, for every environment that opens what another sealed.');
console.log('');
console.log(`SECRET_BOX_KEY=${key.toString('base64')}`);
console.log('');
console.log('Rotating this makes every stored third-party token unopenable,');
console.log('so those connections have to be made again. That is the right');
console.log('response to a suspected database leak and the wrong response to');
console.log('anything else.');
console.log('');
