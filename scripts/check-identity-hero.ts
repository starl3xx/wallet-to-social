import assert from 'node:assert/strict';
import sharp from 'sharp';
import { filterHeroSnapshot } from '../lib/identity-hero/server';
import {
  heroSnapshotSchema,
  type HeroSnapshot,
} from '../lib/identity-hero/types';
import { refreshPortrait } from '../lib/identity-hero/avatars';
import { GET as refreshRoute } from '../app/api/cron/refresh-hero/route';
import { NextRequest } from 'next/server';
const wallet = '0x' + '1'.repeat(40);
const fixture: HeroSnapshot = {
  version: 1,
  checkedAt: new Date().toISOString(),
  accounts: [
    {
      id: 'jesse',
      name: 'Jesse',
      fid: 99,
      handle: 'jessepollak',
      fc: 'jesse.base.eth',
      wallet,
      xPhoto: null,
      xVerified: true,
      checkedAt: new Date().toISOString(),
      wallets: [
        {
          address: wallet,
          evidence: 'Walletlink verified X link',
          xAttested: true,
        },
      ],
    },
  ],
  sample: null,
};
for (const [kind, value] of [
  ['wallet', wallet],
  ['twitter', 'jessepollak'],
  ['farcaster', 'jesse.base.eth'],
] as const) {
  assert.equal(
    filterHeroSnapshot(fixture, new Map([[kind, new Set([value])]])).accounts
      .length,
    0
  );
}
assert.equal(filterHeroSnapshot(fixture, new Map()).accounts.length, 1);
assert.equal(
  heroSnapshotSchema.safeParse({
    ...fixture,
    accounts: [
      { ...fixture.accounts[0], xPhoto: 'https://untrusted.test/image' },
    ],
  }).success,
  false
);
const saved = process.env.CRON_SECRET;
delete process.env.CRON_SECRET;
assert.equal(
  (
    await refreshRoute(
      new NextRequest('http://localhost/api/cron/refresh-hero')
    )
  ).status,
  401
);
process.env.CRON_SECRET = 'test-secret';
assert.equal(
  (
    await refreshRoute(
      new NextRequest('http://localhost/api/cron/refresh-hero', {
        headers: { authorization: 'Bearer wrong' },
      })
    )
  ).status,
  401
);
if (saved === undefined) delete process.env.CRON_SECRET;
else process.env.CRON_SECRET = saved;
const oldFetch = globalThis.fetch;
const oldBase = process.env.X_RESOLVER_API_BASE;
const oldKey = process.env.X_RESOLVER_API_KEY;
process.env.X_RESOLVER_API_BASE = 'https://resolver.test';
process.env.X_RESOLVER_API_KEY = 'test';
try {
  let source = await sharp({
    create: { width: 400, height: 400, channels: 3, background: '#7354ab' },
  })
    .png()
    .toBuffer();
  let imageRequest = '';
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith('https://resolver.test/'))
      return Response.json({
        data: {
          id: '18876842',
          userName: 'jessepollak',
          profilePicture:
            'https://pbs.twimg.com/profile_images/123/avatar_normal.jpg',
        },
      });
    imageRequest = url;
    return new Response(new Uint8Array(source), {
      headers: { 'content-type': 'image/png' },
    });
  };
  const portrait = await refreshPortrait('jessepollak', '18876842', null);
  assert.equal(
    imageRequest,
    'https://pbs.twimg.com/profile_images/123/avatar_400x400.jpg',
    'fetch the high-resolution source instead of enlarging an X thumbnail'
  );
  assert.ok(portrait?.startsWith('data:image/webp;base64,'));
  const encoded = Buffer.from(portrait!.split(',')[1], 'base64');
  assert.equal((await sharp(encoded).metadata()).width, 320);
  assert.ok(
    encoded.length <= 30000,
    'retina portraits retain the payload budget'
  );
  source = await sharp(source).resize(256, 256).png().toBuffer();
  const smaller = await refreshPortrait('jessepollak', '18876842', null);
  assert.equal(
    (await sharp(Buffer.from(smaller!.split(',')[1], 'base64')).metadata())
      .width,
    256,
    'smaller originals are not artificially enlarged'
  );
  for (const payload of [
    {},
    { data: null },
    { data: {} },
    { data: { id: '18876842' } },
  ]) {
    globalThis.fetch = async () => Response.json(payload);
    assert.equal(
      await refreshPortrait('jessepollak', '18876842', '/hero/cached.webp'),
      '/hero/cached.webp',
      'empty or incomplete resolver data retains the reviewed portrait'
    );
  }
  globalThis.fetch = async () =>
    Response.json({
      data: {
        id: '999',
        userName: 'jessepollak',
        profilePicture: 'https://pbs.twimg.com/test.jpg',
      },
    });
  assert.equal(
    await refreshPortrait('jessepollak', '18876842', '/hero/cached.webp'),
    null,
    'recycled handles cannot retain a face'
  );
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      data: {
        id: '18876842',
        userName: 'jessepollak',
        profilePicture: 'http://127.0.0.1/private',
      },
    });
  };
  assert.equal(
    await refreshPortrait('jessepollak', '18876842', '/hero/cached.webp'),
    '/hero/cached.webp'
  );
  assert.equal(calls, 1, 'unapproved image destinations are never fetched');
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  assert.equal(
    await refreshPortrait('jessepollak', '18876842', '/hero/cached.webp'),
    '/hero/cached.webp'
  );
} finally {
  globalThis.fetch = oldFetch;
  if (oldBase === undefined) delete process.env.X_RESOLVER_API_BASE;
  else process.env.X_RESOLVER_API_BASE = oldBase;
  if (oldKey === undefined) delete process.env.X_RESOLVER_API_KEY;
  else process.env.X_RESOLVER_API_KEY = oldKey;
}
console.log(
  'Hero suppression, validation, refresh authentication and portrait failure checks passed.'
);
