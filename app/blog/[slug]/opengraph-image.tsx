import { ImageResponse } from 'next/og';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getPostBySlug } from '@/lib/blog';

export const runtime = 'nodejs';
export const alt = 'walletlink.social blog';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OGImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  const title = post?.title || 'walletlink.social Blog';

  const logoBuffer = readFileSync(join(process.cwd(), 'public', 'icon.png'));
  const logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;

  // nodejs runtime here, so the subset Söhne files are read off disk rather
  // than fetched the way the edge OG routes do it.
  const fontDir = join(process.cwd(), 'app', 'fonts');
  const sohne = (weight: number) => readFileSync(join(fontDir, `sohne-${weight}.ttf`));

  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #0a0a0a 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '60px 80px',
          fontFamily: 'Sohne',
        }}
      >
        {/* Logo */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '40px',
          }}
        >
          <img
            src={logoBase64}
            width={40}
            height={40}
            style={{ borderRadius: '8px' }}
          />
          <span style={{ fontSize: '24px', fontWeight: 600, color: '#a3a3a3' }}>
            walletlink.social
          </span>
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: '48px',
            fontWeight: 700,
            color: '#ffffff',
            lineHeight: 1.2,
            maxWidth: '1000px',
            marginBottom: '24px',
          }}
        >
          {title}
        </div>

        {/* Description bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '24px',
            marginTop: 'auto',
          }}
        >
          <span style={{ fontSize: '18px', color: '#10b981', fontWeight: 600 }}>
            Blog
          </span>
          <span style={{ fontSize: '18px', color: '#525252' }}>|</span>
          <span style={{ fontSize: '18px', color: '#737373' }}>
            Wallet identity & Web3 marketing
          </span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Sohne', data: sohne(400), weight: 400 as const, style: 'normal' as const },
        { name: 'Sohne', data: sohne(600), weight: 600 as const, style: 'normal' as const },
        { name: 'Sohne', data: sohne(700), weight: 700 as const, style: 'normal' as const },
      ],
    }
  );
}
