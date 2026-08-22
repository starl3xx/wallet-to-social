import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getUserAccess } from '@/lib/access';
import { canSubmit, hasPaidAccess, legacyTierIsUnmetered } from '@/lib/credits';
import {
  getContractHolders,
  hasPublicHolderFallback,
  CHAIN_LABELS,
  SUPPORTED_CHAINS,
  type SupportedChain,
} from '@/lib/contract-holders';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { trackEvent } from '@/lib/analytics';

export const runtime = 'nodejs';

// Longer timeout for potentially slow API calls
export const maxDuration = 60;

interface ContractHoldersRequest {
  contractAddress: string;
  chain: SupportedChain;
}

export async function POST(request: NextRequest) {
  // Require authenticated session
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  const session = await validateSession(sessionToken);
  if (!session.user) {
    return NextResponse.json(
      { error: 'Invalid or expired session' },
      { status: 401 }
    );
  }

  // Declared outside the try so the catch block can name the chain in errors.
  let chain: SupportedChain | undefined;

  try {
    const body: ContractHoldersRequest = await request.json();
    const { contractAddress } = body;
    chain = body.chain;

    // Validate required fields
    if (!contractAddress) {
      return NextResponse.json(
        { error: 'Contract address is required' },
        { status: 400 }
      );
    }

    if (!chain || !SUPPORTED_CHAINS.includes(chain)) {
      return NextResponse.json(
        { error: `Chain must be one of: ${SUPPORTED_CHAINS.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate address format (basic check)
    const addressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!addressRegex.test(contractAddress)) {
      return NextResponse.json(
        { error: 'Please enter a valid Ethereum address' },
        { status: 400 }
      );
    }

    // Contract import is the strongest feature in the product and used to sit
    // behind the top tier, where almost nobody reached it (3 successful imports
    // ever). It is now included in every pack, which is why this is a credit
    // check and not a tier check: a pack buyer keeps tier 'free'.
    const access = await getUserAccess(session.user.email);

    if (!(await hasPaidAccess(session.user.id, access.tier))) {
      trackEvent('contract_import_blocked', {
        userId: session.user.email,
        metadata: {
          tier: access.tier,
          contractAddress,
          chain,
        },
      });

      return NextResponse.json(
        {
          error: 'Contract import needs credits. Buy a pack to unlock it.',
          upgradeRequired: true,
          tier: access.tier,
        },
        { status: 403 }
      );
    }

    // Alchemy backs NFT holder lookups on every supported chain, so it is the one
    // hard requirement. Moralis is only needed for ERC-20 contracts, so it is not
    // gated here — getERC20Holders raises its own error if a token lookup needs it
    // and the key is absent. Gating upfront would block NFT imports on a chain
    // where Moralis has no coverage at all (e.g. Robinhood).
    const alchemyKey = process.env.ALCHEMY_KEY;

    if (!alchemyKey) {
      console.error('ALCHEMY_KEY not configured for contract holder lookups');
      return NextResponse.json(
        { error: 'NFT holder lookup service not configured' },
        { status: 503 }
      );
    }

    // Cap the import at what this account can actually submit, so the feature
    // cannot hand someone a list that Start Lookup then refuses. For a legacy
    // tier that is the per-lookup limit; for a pack holder it is the credit
    // ceiling (remaining matches x SUBMISSION_MULTIPLIER). `access.walletLimit`
    // alone would cap an Index buyer at 500, because their tier stays 'free'.
    let importCap: number | undefined;
    if (legacyTierIsUnmetered(access.tier)) {
      importCap = Number.isFinite(access.walletLimit)
        ? access.walletLimit
        : undefined;
    } else {
      importCap = (await canSubmit(session.user.id, 0, access.tier)).maxWallets;
    }

    const result = await getContractHolders(contractAddress, chain, importCap);

    // Track successful import
    trackEvent('contract_import_success', {
      userId: session.user.email,
      metadata: {
        contractAddress,
        chain,
        tokenName: result.tokenName,
        tokenSymbol: result.tokenSymbol,
        contractType: result.contractType,
        totalHolders: result.totalHolders,
        holdersReturned: result.wallets.length,
        truncated: result.truncated,
        appliedLimit: result.appliedLimit,
      },
    });

    return NextResponse.json({
      wallets: result.wallets,
      // Absent when the source did not report balances, or when an ERC-20's
      // decimals could not be read. The client hides the column rather than
      // showing zeros; see HolderResult.balances.
      balances: result.balances,
      tokenName: result.tokenName,
      tokenSymbol: result.tokenSymbol,
      contractType: result.contractType,
      totalHolders: result.totalHolders,
      truncated: result.truncated,
      appliedLimit: result.appliedLimit,
      chain: result.chain,
    });
  } catch (error) {
    console.error('Contract holders error:', error);

    // Map error codes to user-friendly messages
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    const chainLabel = chain ? (CHAIN_LABELS[chain] ?? chain) : 'this chain';

    const errorMap: Record<string, { message: string; status: number }> = {
      NOT_A_CONTRACT: {
        message: 'This address is not a smart contract',
        status: 400,
      },
      INVALID_ADDRESS: {
        message: 'Please enter a valid Ethereum address',
        status: 400,
      },
      NO_HOLDERS: {
        message: 'This contract has no token holders',
        status: 404,
      },
      RATE_LIMIT: {
        message: 'Too many requests, please try again in a moment',
        status: 429,
      },
      DAILY_ALLOWANCE_SPENT: {
        /**
         * Two different situations reach this code, and they deserve opposite
         * advice.
         *
         * On a chain with no public explorer behind the metered index (BNB
         * Chain), the allowance really is gone until it resets, and "try again
         * shortly" would send the customer into a loop that cannot succeed —
         * which is what they did, repeatedly, before this message said so.
         *
         * On the five chains that do have one, reaching here means the fallback
         * was attempted and failed as well. A backup explorer that failed this
         * minute is far more likely to work in ten than to stay down all day,
         * so pointing at tomorrow would be the misleading half of the pair.
         *
         * No provider named either way, per the UI rule.
         */
        message:
          chain && hasPublicHolderFallback(chain)
            ? `Token (ERC-20) holder import on ${chainLabel} is temporarily unavailable. It is worth trying again in a few minutes. NFT collections are unaffected, and an upload or a pasted list works now.`
            : 'Token (ERC-20) holder import has reached its daily limit and will be available again tomorrow. NFT collections are unaffected, and an upload or a pasted list works now.',
        status: 503,
      },
      MORALIS_NOT_CONFIGURED: {
        message: 'Token holder lookup service not configured',
        status: 503,
      },
      UNSUPPORTED_CHAIN: {
        message: `Unsupported network. Choose one of: ${SUPPORTED_CHAINS.map((c) => CHAIN_LABELS[c]).join(', ')}`,
        status: 400,
      },
      CHAIN_NO_NFT_SUPPORT: {
        message: `NFT holder lookups are not available on ${chainLabel}`,
        status: 400,
      },
      CHAIN_NFT_NOT_ENABLED: {
        // No provider names in UI copy (see CLAUDE.md), and this is our
        // configuration to fix, not something the customer did or can change.
        message: `NFT holder import on ${chainLabel} is temporarily unavailable. Token (ERC-20) import works on this chain in the meantime.`,
        status: 503,
      },
      CHAIN_NO_ERC20_SUPPORT: {
        message: `Token (ERC-20) holder lookups are not available on ${chainLabel}. NFT collections on this chain are supported.`,
        status: 400,
      },
    };

    const mappedError = errorMap[errorMessage];
    if (mappedError) {
      return NextResponse.json(
        { error: mappedError.message },
        { status: mappedError.status }
      );
    }

    // Check for API-specific errors and provide helpful messages
    if (errorMessage.includes('Moralis API error')) {
      console.error('Moralis API failed:', errorMessage);
      return NextResponse.json(
        {
          error:
            'Token holder service temporarily unavailable. Please try again.',
        },
        { status: 503 }
      );
    }

    if (errorMessage.includes('Alchemy API error')) {
      console.error('Alchemy API failed:', errorMessage);
      return NextResponse.json(
        {
          error:
            'NFT holder service temporarily unavailable. Please try again.',
        },
        { status: 503 }
      );
    }

    if (errorMessage.includes('timed out')) {
      return NextResponse.json(
        { error: 'Request timed out. The contract may have too many holders.' },
        { status: 504 }
      );
    }

    if (
      errorMessage.includes('403 Forbidden') ||
      errorMessage.includes('not enabled')
    ) {
      console.error('Network not enabled in API provider:', errorMessage);
      return NextResponse.json(
        {
          error:
            'This network is not currently supported. Please try Ethereum.',
        },
        { status: 503 }
      );
    }

    // Log the full error for debugging
    console.error('Unhandled contract holders error:', {
      message: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Generic error with the actual message in dev
    return NextResponse.json(
      { error: 'Failed to fetch contract holders. Please try again.' },
      { status: 500 }
    );
  }
}
