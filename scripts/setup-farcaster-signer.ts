/**
 * One-time setup: a Neynar managed signer for casting as @walletlink.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/setup-farcaster-signer.ts           # create + print approval link
 *   npx tsx --env-file=.env.local scripts/setup-farcaster-signer.ts --status  # poll an existing signer
 *
 * Needs in .env.local (never committed, never in Vercel):
 *   NEYNAR_API_KEY                  already present
 *   FARCASTER_WALLETLINK_MNEMONIC   the @walletlink account's recovery phrase
 *   NEYNAR_SIGNER_UUID              written back by hand after this runs
 *
 * ## The flow, and why the mnemonic
 *
 * A managed signer is a key Neynar holds and uses to write casts. Farcaster
 * requires the key registration to be signed by an "app" account
 * (SignedKeyRequestValidator, an EIP-712 typed-data signature), and then
 * approved in the Farcaster app by the account the key will act for. We use
 * @walletlink as its own app: its mnemonic signs the request, and Jake
 * approves it while signed in as @walletlink, so the whole arrangement stays
 * inside the one account. The mnemonic signs one typed-data message locally
 * and is never sent anywhere.
 *
 * ## Neynar credit caution
 *
 * This script makes two or three API calls, which is nothing, but the
 * account's period counter is over the plan limit until 2026-09-01 (see
 * project memory and lib/neynar-budget.ts). Casting itself should wait for
 * the reset; scripts/cast-farcaster.ts enforces that.
 */

import { HDNodeWallet } from 'ethers';

const API = 'https://api.neynar.com';

/** The canonical Farcaster SignedKeyRequestValidator on Optimism. */
const SIGNED_KEY_REQUEST_DOMAIN = {
  name: 'Farcaster SignedKeyRequestValidator',
  version: '1',
  chainId: 10,
  verifyingContract: '0x00000000fc700472606ed4fa22623acf62c60553',
} as const;

const SIGNED_KEY_REQUEST_TYPES = {
  SignedKeyRequest: [
    { name: 'requestFid', type: 'uint256' },
    { name: 'key', type: 'bytes' },
    { name: 'deadline', type: 'uint256' },
  ],
};

function headers(): Record<string, string> {
  return {
    'x-api-key': process.env.NEYNAR_API_KEY!,
    'Content-Type': 'application/json',
  };
}

async function neynar(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${API}${path}`, { ...init, headers: headers() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function status(signerUuid: string): Promise<void> {
  const signer = await neynar(
    `/v2/farcaster/signer?signer_uuid=${signerUuid}`,
    { method: 'GET' }
  );
  console.log(`signer ${signerUuid}: ${signer.status}`);
  if (signer.status === 'approved') {
    console.log(`fid: ${signer.fid}`);
    console.log('\nready: scripts/cast-farcaster.ts can cast as this account.');
  } else if (signer.signer_approval_url) {
    console.log(`approval url: ${signer.signer_approval_url}`);
  }
}

async function main() {
  if (!process.env.NEYNAR_API_KEY) {
    console.error('NEYNAR_API_KEY is required');
    process.exit(1);
  }

  if (process.argv.includes('--status')) {
    const uuid = process.env.NEYNAR_SIGNER_UUID;
    if (!uuid) {
      console.error('NEYNAR_SIGNER_UUID is not set in .env.local');
      process.exit(1);
    }
    await status(uuid);
    return;
  }

  const mnemonic = process.env.FARCASTER_WALLETLINK_MNEMONIC;
  if (!mnemonic) {
    console.error(
      'FARCASTER_WALLETLINK_MNEMONIC is required: the @walletlink recovery phrase,\n' +
        'in .env.local only. It signs one message locally and is never transmitted.'
    );
    process.exit(1);
  }

  // Farcaster custody uses the standard Ethereum derivation path.
  const wallet = HDNodeWallet.fromPhrase(mnemonic.trim());
  console.log(`custody address from mnemonic: ${wallet.address}`);

  const user = await neynar(
    `/v2/farcaster/user/custody-address?custody_address=${wallet.address.toLowerCase()}`,
    { method: 'GET' }
  );
  const appFid: number | undefined = user?.user?.fid;
  if (!appFid) {
    console.error(
      'No Farcaster account holds this custody address. Is the mnemonic the\n' +
        'one the Farcaster app shows for @walletlink under recovery phrase?'
    );
    process.exit(1);
  }
  console.log(`account: @${user.user.username} (fid ${appFid})`);

  const created = await neynar('/v2/farcaster/signer', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  console.log(`signer created: ${created.signer_uuid}`);

  // 24 hours, matching the reference implementation.
  const deadline = Math.floor(Date.now() / 1000) + 86400;
  const signature = await wallet.signTypedData(
    SIGNED_KEY_REQUEST_DOMAIN,
    SIGNED_KEY_REQUEST_TYPES,
    {
      requestFid: BigInt(appFid),
      key: created.public_key,
      deadline: BigInt(deadline),
    }
  );

  const registered = await neynar('/v2/farcaster/signer/signed_key', {
    method: 'POST',
    body: JSON.stringify({
      signer_uuid: created.signer_uuid,
      app_fid: appFid,
      deadline,
      signature,
      // Neynar pays the onchain fee where the plan allows; if the plan does
      // not, the approval screen shows the fee and this field is ignored.
      sponsor: { sponsored_by_neynar: true },
    }),
  });

  console.log('\nadd to .env.local:');
  console.log(`NEYNAR_SIGNER_UUID=${created.signer_uuid}`);
  console.log('\napprove IN THE FARCASTER APP, signed in as @walletlink:');
  console.log(registered.signer_approval_url);
  console.log(
    '\nthen check: npx tsx --env-file=.env.local scripts/setup-farcaster-signer.ts --status'
  );
}

main().catch((e) => {
  console.error('setup failed:', e.message ?? e);
  process.exit(1);
});
