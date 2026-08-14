import { ImageResponse } from 'next/og';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getPostBySlug } from '@/lib/blog';
import { OG, OG_FONT_FAMILY } from '@/lib/og-fonts';

// nodejs, not edge: this route reads the post from disk to get its title.
// That also means the fonts come from the filesystem rather than by fetch,
// so it cannot share the edge loader in lib/og-fonts.
export const runtime = 'nodejs';
export const alt = 'walletlink.social blog';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

function font(file: string) {
  return readFileSync(join(process.cwd(), 'public', 'fonts', file));
}

export default async function OGImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  const title = post?.title || 'walletlink.social Blog';

  const logoBuffer = readFileSync(join(process.cwd(), 'public', 'icon.png'));
  const logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;

  return new ImageResponse(
    (
      <div
        style={{
          // Paper, where the default card is dark. A feed of blog cards then
          // reads as a series rather than as the same image repeated.
          background: OG.paper,
          color: OG.ink,
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          fontFamily: OG_FONT_FAMILY,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoBase64} width={44} height={44} style={{ borderRadius: '10px' }} alt="" />
          <div style={{ display: 'flex', fontSize: '26px', fontWeight: 600 }}>
            <span style={{ color: '#4131B0' }}>walletlink</span>
            <span style={{ color: '#6B7189' }}>.social</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              alignSelf: 'flex-start',
              background: '#EDEEF8',
              color: '#4131B0',
              fontSize: '19px',
              fontWeight: 600,
              padding: '8px 18px',
              borderRadius: '999px',
              marginBottom: '26px',
            }}
          >
            Guide
          </div>
          <div
            style={{
              fontSize: '62px',
              fontWeight: 400,
              lineHeight: 1.08,
              letterSpacing: '-0.035em',
              maxWidth: '960px',
            }}
          >
            {title}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '19px', color: '#6B7189' }}>walletlink.social/blog</span>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '11px',
              background: '#E8F6EF',
              color: '#0F7A55',
              fontSize: '18px',
              fontWeight: 600,
              padding: '10px 20px',
              borderRadius: '999px',
            }}
          >
            <div style={{ width: '10px', height: '10px', borderRadius: '999px', background: '#0F7A55' }} />
            attested data
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: OG_FONT_FAMILY, data: font('soehne-buch.ttf'), weight: 400, style: 'normal' },
        { name: OG_FONT_FAMILY, data: font('soehne-halbfett.ttf'), weight: 600, style: 'normal' },
      ],
    }
  );
}
