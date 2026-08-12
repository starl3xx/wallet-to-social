import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'walletlink.social — Find your DeFi users, NFT holders & AI agents on Twitter';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OGImage() {
  const [logoData, sohne400, sohne600, sohne700] = await Promise.all([
    fetch(new URL('../public/icon.png', import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(new URL('./fonts/sohne-400.ttf', import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(new URL('./fonts/sohne-600.ttf', import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(new URL('./fonts/sohne-700.ttf', import.meta.url)).then((r) => r.arrayBuffer()),
  ]);

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
          alignItems: 'center',
          padding: '60px 80px',
          fontFamily: 'Sohne',
        }}
      >
        {/* Logo area */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            marginBottom: '40px',
          }}
        >
          <img
            src={logoData as unknown as string}
            width={56}
            height={56}
            style={{ borderRadius: '12px' }}
          />
          <span
            style={{
              fontSize: '32px',
              fontWeight: 600,
              color: '#e5e5e5',
            }}
          >
            walletlink.social
          </span>
        </div>

        {/* Main headline */}
        <div
          style={{
            fontSize: '52px',
            fontWeight: 700,
            color: '#ffffff',
            textAlign: 'center',
            lineHeight: 1.2,
            marginBottom: '24px',
            maxWidth: '900px',
          }}
        >
          Find your token holders on Twitter & Farcaster
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: '24px',
            color: '#a3a3a3',
            textAlign: 'center',
            marginBottom: '40px',
            maxWidth: '700px',
          }}
        >
          Wallet-to-social lookup with 22% match rate. AI agent detection included.
        </div>

        {/* Stats row */}
        <div
          style={{
            display: 'flex',
            gap: '48px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '36px', fontWeight: 700, color: '#10b981' }}>22%</span>
            <span style={{ fontSize: '16px', color: '#737373' }}>Match rate</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '36px', fontWeight: 700, color: '#10b981' }}>9x</span>
            <span style={{ fontSize: '16px', color: '#737373' }}>vs. average</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '36px', fontWeight: 700, color: '#10b981' }}>13K+</span>
            <span style={{ fontSize: '16px', color: '#737373' }}>AI agents detected</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      // Söhne ships CFF (OTTO) outlines, which Satori renders as a silent
      // fallback; these are converted to glyf TTF and subset to Latin + the
      // punctuation these cards use, which keeps all three weights at ~54KB
      // total for the edge bundle. Registered under an ASCII family name so
      // Satori's matching never sees the umlaut.
      fonts: [
        { name: 'Sohne', data: sohne400, weight: 400, style: 'normal' },
        { name: 'Sohne', data: sohne600, weight: 600, style: 'normal' },
        { name: 'Sohne', data: sohne700, weight: 700, style: 'normal' },
      ],
    }
  );
}
