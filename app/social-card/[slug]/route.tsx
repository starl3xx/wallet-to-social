import { ImageResponse } from 'next/og';
import { loadOgFonts, OG, OG_FONT_FAMILY } from '@/lib/og-fonts';
import { SOCIAL_CARDS } from '@/lib/social-cards';

/**
 * The daily social cards, rendered live so their figures are read at view
 * time (see lib/social-cards.tsx for the doctrine). One route serves every
 * card by slug; an unknown slug is a 404, never a blank card, because a
 * blank card attached to a scheduled post is invisible until it publishes.
 *
 * 1200x675: the 16:9 X media frame, and Farcaster clients render a direct
 * image URL inline at any ratio. Same Satori constraints as the OG images
 * (flex only, loaded fonts only, plain X).
 */
export const runtime = 'edge';

const size = { width: 1200, height: 675 };

function Headline({
  text,
  emphasis,
  big,
}: {
  text: string;
  emphasis?: string;
  big: boolean;
}) {
  // Satori needs explicit spans for the one 600-weight word; split around
  // the first occurrence and keep the rest at display weight. The spaces at
  // the split become non-breaking, because Satori trims whitespace at flex
  // item boundaries and rendered "eight chains, one answer" as
  // "chains,oneanswer" until they did.
  const at = emphasis ? text.indexOf(emphasis) : -1;
  const parts =
    at === -1 || !emphasis
      ? [text]
      : [
          text.slice(0, at).replace(/ $/, ' '),
          emphasis,
          text.slice(at + emphasis.length).replace(/^ /, ' '),
        ];
  return (
    <div
      style={{
        fontSize: big ? '64px' : '46px',
        fontWeight: 200,
        lineHeight: 1.06,
        letterSpacing: '-0.04em',
        maxWidth: '980px',
        display: 'flex',
        flexWrap: 'wrap',
      }}
    >
      {parts.length === 1 ? (
        parts[0]
      ) : (
        <>
          {parts[0]}
          <span style={{ fontWeight: 600 }}>{parts[1]}</span>
          {parts[2]}
        </>
      )}
    </div>
  );
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const card = SOCIAL_CARDS[slug];
  if (!card) return new Response('no such card', { status: 404 });

  const [logoData, fonts] = await Promise.all([
    fetch(new URL('../../../public/icon.png', import.meta.url)).then((r) =>
      r.arrayBuffer()
    ),
    loadOgFonts({
      extraleicht: new URL(
        '../../../public/fonts/soehne-extraleicht.ttf',
        import.meta.url
      ),
      book: new URL('../../../public/fonts/soehne-buch.ttf', import.meta.url),
      halbfett: new URL(
        '../../../public/fonts/soehne-halbfett.ttf',
        import.meta.url
      ),
    }),
  ]);

  const statColor =
    card.statTone === 'attested'
      ? OG.attested
      : card.statTone === 'brand'
        ? OG.brand
        : OG.text;

  return new ImageResponse(
    <div
      style={{
        background: OG.groundGradient,
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '56px 64px',
        fontFamily: OG_FONT_FAMILY,
        color: OG.text,
      }}
    >
      {/* Wordmark row plus kicker, same lockup as every share card. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoData as unknown as string}
            width={44}
            height={44}
            style={{ borderRadius: '10px' }}
            alt=""
          />
          <div style={{ display: 'flex', fontSize: '26px', fontWeight: 600 }}>
            <span style={{ color: OG.brand }}>walletlink</span>
            <span style={{ color: OG.textMuted }}>.social</span>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: '18px',
            color: OG.textMuted,
            letterSpacing: '0.08em',
          }}
        >
          {card.kicker}
        </div>
      </div>

      {/* The middle: variant decides whether figure or headline leads. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '26px' }}>
        {card.variant === 'stat' && card.stat && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span
              style={{
                fontSize: '130px',
                fontWeight: 200,
                letterSpacing: '-0.04em',
                lineHeight: 1,
                color: statColor,
              }}
            >
              {card.stat}
            </span>
            {card.statLabel && (
              <span
                style={{
                  fontSize: '26px',
                  color: OG.textMuted,
                  marginTop: '10px',
                }}
              >
                {card.statLabel}
              </span>
            )}
          </div>
        )}

        {card.variant === 'split' && (
          <div style={{ display: 'flex', gap: '96px' }}>
            {[
              [card.stat, card.statLabel],
              [card.stat2, card.stat2Label],
            ].map(([stat, label], i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column' }}>
                <span
                  style={{
                    fontSize: '96px',
                    fontWeight: 200,
                    letterSpacing: '-0.04em',
                    lineHeight: 1,
                    color: i === 0 ? statColor : OG.text,
                  }}
                >
                  {stat}
                </span>
                <span
                  style={{
                    fontSize: '24px',
                    color: OG.textMuted,
                    marginTop: '10px',
                  }}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
        )}

        <Headline
          text={card.headline}
          emphasis={card.emphasisWord}
          big={card.variant === 'claim'}
        />

        {card.sub && (
          <div
            style={{
              display: 'flex',
              fontSize: '25px',
              color: OG.textMuted,
              maxWidth: '900px',
              lineHeight: 1.4,
            }}
          >
            {card.sub}
          </div>
        )}
      </div>

      {/* CTA footer: violet, because a CTA is an affordance. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '24px',
          fontWeight: 600,
          color: OG.brand,
        }}
      >
        {card.cta}
      </div>
    </div>,
    { ...size, fonts }
  );
}
