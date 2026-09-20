import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { ingestState, socialGraph } from '@/db/schema';
import {
  isKindSuppressed,
  loadSuppressionList,
  type SuppressionSets,
} from '@/lib/suppression';
import { heroSnapshotSchema, type HeroSnapshot } from './types';
import seeds from './seeds.json';
import { refreshPortrait } from './avatars';
import sampleSeeds from './sample-seeds.json';

export const HERO_STATE_KEY = 'landing_identity_hero_v1';
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

/** Applied on every serve; a saved snapshot cannot bypass right-to-removal. */
export function filterHeroSnapshot(
  snapshot: HeroSnapshot,
  sets: SuppressionSets
): HeroSnapshot {
  const accounts = snapshot.accounts
    .filter(
      (p) =>
        !isKindSuppressed(sets, 'twitter', p.handle) &&
        !isKindSuppressed(sets, 'farcaster', p.fc)
    )
    .map((p) => ({
      ...p,
      wallets: p.wallets.filter(
        (w) => !isKindSuppressed(sets, 'wallet', w.address)
      ),
    }))
    .filter((p) => p.wallets.some((w) => w.address === p.wallet));
  const sample =
    snapshot.sample &&
    snapshot.sample.rows.every(
      (r) =>
        !isKindSuppressed(sets, 'wallet', r.address) &&
        (!r.handle ||
          accounts.some(
            (p) =>
              p.handle === r.handle &&
              p.wallets.some((w) => w.address === r.address)
          ))
    )
      ? snapshot.sample
      : null;
  return { ...snapshot, accounts, sample };
}

export async function readHeroSnapshot(): Promise<HeroSnapshot | null> {
  const db = getDb();
  if (!db) return null;
  const [rows, sets] = await Promise.all([
    db
      .select({ value: ingestState.value })
      .from(ingestState)
      .where(eq(ingestState.name, HERO_STATE_KEY))
      .limit(1),
    loadSuppressionList(),
  ]);
  const parsed = heroSnapshotSchema.safeParse(rows[0]?.value);
  if (
    !parsed.success ||
    Date.now() - Date.parse(parsed.data.checkedAt) > MAX_AGE
  )
    return null;
  return filterHeroSnapshot(parsed.data, sets);
}

/** The landing page never calls this. Only a secret-authenticated refresh does. */
export async function refreshHeroSnapshot(): Promise<HeroSnapshot> {
  const db = getDb();
  if (!db) throw new Error('Hero database unavailable');
  const sets = await loadSuppressionList();
  const previousRows = await db
    .select({ value: ingestState.value })
    .from(ingestState)
    .where(eq(ingestState.name, HERO_STATE_KEY))
    .limit(1);
  const previous = heroSnapshotSchema.safeParse(previousRows[0]?.value);
  const checkedAt = new Date().toISOString();
  const accounts: HeroSnapshot['accounts'] = [];
  for (const seed of seeds) {
    if (
      isKindSuppressed(sets, 'twitter', seed.handle) ||
      isKindSuppressed(sets, 'farcaster', seed.fc)
    )
      continue;
    const rows = await db
      .select({
        address: socialGraph.wallet,
        handle: socialGraph.twitterHandle,
        verified: socialGraph.twitterVerified,
        userId: socialGraph.twitterUserId,
      })
      .from(socialGraph)
      .where(
        and(
          eq(socialGraph.fcFid, seed.fid),
          eq(socialGraph.farcaster, seed.fc),
          eq(socialGraph.farcasterVerified, true)
        )
      )
      .orderBy(socialGraph.wallet)
      .limit(33);
    // Ambiguous/oversized clusters are excluded instead of quietly truncated.
    if (rows.length > 32) continue;
    const wallets = rows
      .filter(
        (r) =>
          !isKindSuppressed(sets, 'wallet', r.address) &&
          (!r.userId || r.userId === seed.xUserId) &&
          (!r.handle || r.handle.toLowerCase() === seed.handle.toLowerCase())
      )
      .map((r) => ({
        address: r.address,
        evidence:
          r.handle && r.verified
            ? 'Walletlink verified X link'
            : 'Walletlink indexed Farcaster link',
        xAttested: !!r.handle && !!r.verified,
      }));
    if (!wallets.some((w) => w.address === seed.wallet)) continue;
    accounts.push({
      id: seed.id as HeroSnapshot['accounts'][number]['id'],
      name: seed.name,
      fid: seed.fid,
      handle: seed.handle,
      fc: seed.fc,
      wallet: seed.wallet,
      wallets,
      checkedAt,
      xVerified: wallets.find((w) => w.address === seed.wallet)!.xAttested,
      xPhoto: seed.xPhoto.replace('./avatars/', '/hero/'),
    });
  }
  await Promise.all(
    accounts.map(async (account) => {
      const seed = seeds.find((p) => p.id === account.id)!;
      const cached = previous.success
        ? previous.data.accounts.find((p) => p.id === account.id)?.xPhoto
        : undefined;
      account.xPhoto = await refreshPortrait(
        account.handle,
        seed.xUserId,
        cached === undefined ? account.xPhoto : cached
      );
    })
  );
  const sampleRows = await db
    .select({
      address: socialGraph.wallet,
      handle: socialGraph.twitterHandle,
      verified: socialGraph.twitterVerified,
    })
    .from(socialGraph)
    .where(
      inArray(
        socialGraph.wallet,
        sampleSeeds.rows.map((r) => r.address)
      )
    );
  const sampleValid = sampleSeeds.rows.every((expected) => {
    const row = sampleRows.find((r) => r.address === expected.address);
    return expected.synthetic
      ? !row
      : row?.handle?.toLowerCase() === expected.handle && row.verified;
  });
  const snapshot = filterHeroSnapshot(
    heroSnapshotSchema.parse({
      version: 1,
      checkedAt,
      accounts: accounts.filter((p) => p.xPhoto !== null),
      sample: sampleValid ? { rows: sampleSeeds.rows } : null,
    }),
    sets
  );
  // A successfully checked empty selection replaces stale identities too.
  // The read route then shows the unavailable state rather than old links.
  // Atomic replacement: a failed refresh leaves the previous dated snapshot intact.
  await db
    .insert(ingestState)
    .values({
      name: HERO_STATE_KEY,
      value: snapshot,
      updatedAt: new Date(checkedAt),
    })
    .onConflictDoUpdate({
      target: ingestState.name,
      set: { value: snapshot, updatedAt: new Date(checkedAt) },
    });
  return snapshot;
}
