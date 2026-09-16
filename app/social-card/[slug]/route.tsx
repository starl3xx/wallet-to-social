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
  /**
   * The headline, split around its one 600-weight word.
   *
   * TWO defects live here, and for a month only one of them was fixed.
   *
   * The first is whitespace: Satori trims it at flex item boundaries, so
   * "eight chains, one answer" rendered as "chains,oneanswer". The
   * non-breaking spaces below fix that, and the comment that used to sit
   * here stopped at that sentence.
   *
   * The second is measurement, and it survived. With the emphasis in a bare
   * <span> inside this flex container, Satori measured that run at the
   * PARENT's 200 weight and painted it at 600. Söhne halbfett is wider than
   * extraleicht, so every run after the emphasis started early and sat on
   * top of the last bold glyph: "published by the owner, never guessed"
   * shipped to X as "owner" with the comma printed through the r. Only
   * headlines with text after the emphasis word could show it, which is six
   * of the thirteen cards, and the other seven looked perfect.
   *
   * Each part is therefore its own flex box. A box is measured with the
   * font it is painted in, so the advance widths cannot disagree. Rendering
   * each part separately makes the boundary whitespace load-bearing rather
   * than redundant, which is why both fixes have to stay.
   *
   * Every headline is one line at 64px today, so nothing relies on a part
   * wrapping internally; a part is atomic and would not. All thirteen cards
   * were rendered and read after this change.
   */
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
          <div style={{ display: 'flex' }}>{parts[0]}</div>
          <div style={{ display: 'flex', fontWeight: 600 }}>{parts[1]}</div>
          <div style={{ display: 'flex' }}>{parts[2]}</div>
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
