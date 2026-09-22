/**
 * The Stripe API version every client in this repo sends.
 *
 * Pinned rather than left to the SDK. Unpinned, `new Stripe(key)` sends the
 * version the installed stripe-node was built for, so a dependency bump
 * silently moved every checkout, webhook read and revenue report to a new API
 * version: #363 would have taken this repo from `2025-12-15.clover` to
 * `2026-08-26.dahlia` with no line of code changing.
 *
 * stripe-node types `apiVersion` as exactly the version it was built for, so
 * the next SDK major that moves it fails the typecheck here. That is the
 * point: the upgrade becomes a decision in a diff, not a side effect.
 *
 * The webhook endpoint does NOT follow this constant. Its API version is set
 * in Stripe, on the endpoint, and decides the shape of the events we receive.
 * On 2026-09-22 it was still `2025-12-15.clover` while this moved to dahlia.
 * That is safe for now: none of dahlia's breaking changes touch a field the
 * webhook reads. Check the endpoint's version before relying on a field that
 * only a newer version sends.
 */
export const STRIPE_API_VERSION = '2026-08-26.dahlia' as const;
