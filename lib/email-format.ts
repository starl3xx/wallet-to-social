/**
 * Whether a string has the shape of an email address we can send to.
 *
 * Shared by the sign-in modal and `/api/auth/send-magic-link`, so the browser
 * refuses what the server would refuse. The rule is deliberately loose about
 * the local part and about non-ASCII domains, and strict about one thing: every
 * label of the domain must be non-empty. The older check here,
 * `[^\s@]+\.[^\s@]+` after the `@`, accepted `name@gmail.com.` (an address
 * copied with the period that ended its sentence), and the email provider then
 * refused it with a raw error that reached the screen.
 *
 * Callers trim first: a pasted address often carries a space.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export function isEmailShaped(email: string): boolean {
  return email.length <= 254 && EMAIL_SHAPE.test(email);
}
