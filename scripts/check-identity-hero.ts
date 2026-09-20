import assert from 'node:assert/strict';
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
