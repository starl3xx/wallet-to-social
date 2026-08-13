import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'walletlink.social | Wallet-to-social lookup for crypto teams';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function TwitterImage() {
  const logoData = await fetch(
    new URL('../public/icon.png', import.meta.url)
  ).then((res) => res.arrayBuffer());

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
          fontFamily: 'system-ui, sans-serif',
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
          A 4.7M-wallet identity index with complete Farcaster coverage. AI agent detection included.
        </div>

        {/* Stats row */}
        <div
          style={{
            display: 'flex',
            gap: '48px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '36px', fontWeight: 700, color: '#10b981' }}>4.7M</span>
            <span style={{ fontSize: '16px', color: '#737373' }}>Wallets indexed</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '36px', fontWeight: 700, color: '#10b981' }}>100%</span>
            <span style={{ fontSize: '16px', color: '#737373' }}>Farcaster coverage</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '36px', fontWeight: 700, color: '#10b981' }}>13K+</span>
            <span style={{ fontSize: '16px', color: '#737373' }}>AI agents detected</span>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
