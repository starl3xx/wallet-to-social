import { ImageResponse } from 'next/og';
import { loadOgFonts, OG, OG_FONT_FAMILY } from '@/lib/og-fonts';

export const runtime = 'edge';
export const alt = 'walletlink.social | Find your DeFi users, NFT holders & AI agents on Twitter & Farcaster';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OGImage() {
  const [logoData, fonts] = await Promise.all([
    fetch(new URL('../public/icon.png', import.meta.url)).then((r) => r.arrayBuffer()),
    loadOgFonts({
      extraleicht: new URL('../public/fonts/soehne-extraleicht.ttf', import.meta.url),
      book: new URL('../public/fonts/soehne-buch.ttf', import.meta.url),
      halbfett: new URL('../public/fonts/soehne-halbfett.ttf', import.meta.url),
    }),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          background: OG.groundGradient,
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          fontFamily: OG_FONT_FAMILY,
          color: OG.text,
        }}
      >
        {/* Wordmark. The brand sits on the name, the suffix stays quiet, same
            as the site header. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoData as unknown as string} width={52} height={52} style={{ borderRadius: '12px' }} alt="" />
          <div style={{ display: 'flex', fontSize: '30px', fontWeight: 600 }}>
            <span style={{ color: OG.brand }}>walletlink</span>
            <span style={{ color: OG.textMuted }}>.social</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: '76px',
              // The display tier: 200, not 400. Satori substitutes the nearest
              // available weight rather than failing, so before the extraleicht
              // cut was loaded this rendered at 400 and produced a blunter card
              // rather than a broken one, which is why it shipped unnoticed.
              fontWeight: 200,
              lineHeight: 1.02,
              letterSpacing: '-0.04em',
              maxWidth: '880px',
              display: 'flex',
              flexWrap: 'wrap',
            }}
          >
            Turn wallets into&nbsp;<span style={{ fontWeight: 600 }}>people</span>.
          </div>
          <div
            style={{
              fontSize: '27px',
              color: OG.textMuted,
              marginTop: '22px',
              maxWidth: '760px',
              lineHeight: 1.35,
            }}
          >
            {/* Plain X here, not 𝕏. Söhne has no U+1D54F, and Satori renders
                with only the fonts handed to it: there is no fallback chain to
                borrow the glyph from, so the styled character comes out as a
                missing-glyph box. Browsers fall back automatically, which is
                why the app UI can keep 𝕏 and this cannot. */}
            Farcaster usernames, X handles and ENS names. Attested, never inferred.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '56px' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '40px', fontWeight: 600, letterSpacing: '-0.03em' }}>5M</span>
              <span style={{ fontSize: '17px', color: OG.textMuted, marginTop: '4px' }}>wallets indexed</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {/* The X-or-Farcaster figure, not the 23% any-identity one. The
                  share card is the first thing anyone sees, so it states the
                  number a campaign can actually be planned against.
                  It deliberately no longer says "reachable": that word now has a
                  precise meaning in the API (the handle still resolves to an
                  account) and one word cannot carry both. */}
              <span style={{ fontSize: '40px', fontWeight: 600, letterSpacing: '-0.03em', color: OG.brand }}>13%</span>
              <span style={{ fontSize: '17px', color: OG.textMuted, marginTop: '4px' }}>have an X or Farcaster account</span>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              background: OG.attestedTint,
              color: OG.attested,
              fontSize: '19px',
              fontWeight: 600,
              padding: '11px 22px',
              borderRadius: '999px',
            }}
          >
            <div style={{ width: '11px', height: '11px', borderRadius: '999px', background: OG.attested }} />
            Farcaster coverage complete
          </div>
        </div>
      </div>
    ),
    { ...size, fonts }
  );
}
