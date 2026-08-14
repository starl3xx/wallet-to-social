import OGImage from './opengraph-image';

/**
 * The 𝕏 card and the Open Graph card are the same image at the same size, and
 * were previously two byte-identical copies that had to be edited in lockstep.
 * Re-exporting the generator makes that structural rather than a convention
 * somebody has to remember.
 *
 * Only `alt` differs, because the two are read in different places.
 */
export const runtime = 'edge';
export const alt = 'walletlink.social | Wallet-to-social lookup for crypto teams';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default OGImage;
